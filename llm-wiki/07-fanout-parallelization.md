# 07. (미커밋, 진행 중) 5개 생성 파이프라인 fan-out 병렬화

**상태: 2026-08-21 기준 워킹 트리에 아직 커밋되지 않은 변경사항.** [06](06-wip-tool-rollout-and-doc-structure-parsing.md)이
다룬 Planning+Scratch+Project-document tool 확산 위에서 진행된 별도 작업. 커밋되면 이 문서 상단에
해시/메시지를 추가하고 상태를 갱신할 것.

## 배경

사용자가 자료수집&분석/도메인 지식/1차 인터뷰 질의서/Demo UI/PPT 생성까지 전 과정이 느리다고
문제 제기. 6개 서브에이전트(5개 파이프라인 + agent-runtime 공통 인프라)를 병렬로 띄워 원인을
조사한 결과, 5개 파이프라인 모두 동일한 구조적 병목을 갖고 있었음:

- 각 서비스가 `runAgentLoop()` 하나로 6~8턴짜리 **순차** LLM 호출을 거쳐 전체 결과물(모든
  슬라이드, 모든 카테고리, 모든 필드, 모든 화면)을 **한 번의 대화**에서 생성.
- 체감 소요 시간의 대부분은 로컬 I/O(SQLite, 스크래치 파일, HTML 렌더링)가 아니라 LLM 왕복
  지연 × 턴 수.
- `agent-runtime/fanOut.ts`(`runFanOutAgents`/`runWithConcurrency`, 기본 동시성 3)가 이미
  구현돼 있었지만 **어느 서비스에서도 호출되지 않는 죽은 코드** 상태였음([03](03-agent-runtime-reliability-phase1.md)에서
  Phase1의 일부로 만들어졌으나 실사용은 이번이 처음).

이어서 "서브에이전트마다 컨텍스트가 좁아지면 전체 일관성(용어 통일 등)이 약해질 수 있다"는
우려에 대한 개선 방향을 논의했고, 그 결론(공유 그라운딩 → 병렬 생성 → 결정론적 병합)을 5개
파이프라인 모두에 동일하게 적용함. `interviewGeneration.ts`부터 시작해 실제 LLM(OpenRouter
`deepseek/deepseek-v4-flash-0731`)으로 전/후 비교 검증 후, 나머지 4개로 확장.

## 공통 설계 원칙

1. **공유 그라운딩**: 모든 서브에이전트가 동일한 `SYSTEM_PROMPT`와 동일한 소스 컨텍스트(문서
   분석 요약, Fact Sheet 등)를 프롬프트로 공유 — 문체/근거 규칙/용어가 병렬 실행 때문에
   갈리지 않게 함. 갈리는 지점은 "이번 요청에서 어떤 부분만 생성할지"뿐이라 그 지시만
   프롬프트에 추가.
2. **이중 강제(가능한 경우)**: 모델이 스코프 제한 지시를 무시할 가능성에 대비해, 프롬프트
   지시 + 부분 Zod 스키마(`.pick()`) + (필요시) 병합 시점 코드 레벨 필터링까지 겹쳐서 적용.
3. **결정론적 병합**: 순서/번호/중복 제거처럼 기계적으로 보장 가능한 부분은 LLM이 아니라
   코드로 처리 — 그룹을 고정 배열 순서로 `concat`한 뒤 `renumber()`, 질문 텍스트 정규화 후
   `Set` 기반 dedup 등.
4. **안전한 실패 처리**: fan-out 태스크 중 하나라도 실패하면(스키마 필드가 모두 필수라 부분
   채움이 의미 없는 경우) 즉시 `throw`해 기존에 있던 상위 폴백 체인(agentic → 단일 턴
   `completeJSON` → 휴리스틱)으로 넘김 — fan-out 도입 이전부터 있던 폴백 구조를 그대로
   안전망으로 재사용.
5. 각 서브에이전트는 자기 `runId`로 별도 스크래치 워크스페이스를 가지므로(`scratchTools.ts`가
   원래 `runId`로 디렉터리를 격리해두고 있었음) 병렬 실행해도 충돌 없음. `projectDocumentTools`는
   읽기 전용이라 인스턴스를 여러 태스크가 공유해도 안전.

## 파이프라인별 적용

### `interviewGeneration.ts` — 카테고리별 fan-out

- 기존: `BASE_CATEGORIES`(Business/User/Process/System/AI/Operation) 6개를 한 대화에서 순차
  생성 (`maxTurns: 6, maxTokensPerTurn: 8000`).
- 변경: 카테고리별로 `runFanOutAgents` 태스크 6개 생성. 각 태스크는 동일한 `SYSTEM_PROMPT` +
  동일한 Grounded Fact Sheet(`buildGroundedFacts`, 로컬 로직이라 원래도 공유돼 있었음)를 쓰고,
  `buildUserPrompt(..., categoryFilter)`로 "이번 요청에서는 category=X만 생성" 지시를 추가.
- 이중 강제: 병합 시 `it.category`가 요청한 카테고리와 일치하는 항목만 코드로 재필터링.
- 병합: 6개 결과를 concat 후 질문 텍스트를 정규화(trim/공백압축/소문자)해 `Set` 기반 중복 제거,
  이후 기존 `finalize()`가 그대로 `Q01, Q02...` ID를 재부여.
- 태스크당 `maxTurns: 6→4`, `maxTokensPerTurn: 8000→6000` (스코프가 5~8문항으로 좁아져 축소).

### `domainKnowledgeGeneration.ts` — 필드 3그룹 fan-out

- 기존: 11개 출력 필드(`companyOverview`~`openQuestions`)를 한 대화에서 생성
  (`maxTurns: 8, maxTokensPerTurn: 8000`).
- 변경: `DomainKnowledgeSchema.pick({...})`으로 서로 겹치지 않는 3개 부분 스키마 정의 —
  `overview`(companyOverview/businessDomain/domainKeywords/drivingDepartments/businessScope),
  `systems_rules`(keySystems/glossary/domainRules),
  `stakeholders_risks`(stakeholders/risksAndConsiderations/openQuestions).
- 컨텍스트 빌더를 `buildAnalysisContext(input)`로 분리해 3개 태스크가 공유.
- 병합: 필드가 서로 겹치지 않아 `results.reduce((acc, r) => ({ ...acc, ...r.submission }), {})`
  단순 객체 스프레드로 끝남.
- 태스크당 `maxTurns: 8→5`, `maxTokensPerTurn: 8000→5000`.

### `agentDemoGeneration.ts` — agent 선행 그라운딩 + 화면/시나리오 fan-out

- 기존: `agent`(AgentConcept) + `screens`(4개) + `scenario`를 한 대화에서 생성
  (`maxTurns: 8, maxTokensPerTurn: 8000`).
- 변경: 2단계 구조.
  1. **Phase 1(그라운딩)**: `AgentConceptSchema`만 제출하는 별도 `runAgentLoop` 1회
     (`maxTurns: 5, maxTokensPerTurn: 5000`) — 화면/시나리오가 서로 다른 Agent 이름/목적을
     상상해내는 걸 막기 위한 단일 진실 공급원.
  2. **Phase 2(fan-out)**: `SCREEN_KIND_ORDER = ["input","analysis","decision","monitor"]`
     각각 + `scenario` 1개, 총 5개 태스크를 `runFanOutAgents`로 병렬 실행. 각 태스크 프롬프트에
     Phase 1에서 만든 `agent` 객체를 `JSON.stringify`로 그대로 박아넣어 고정 컨텍스트로 사용.
     태스크당 `maxTurns: 4, maxTokensPerTurn: 4000`.
- 순서 보장: `screenTasks`를 `SCREEN_KIND_ORDER` 순서로 배열에 넣고, `runFanOutAgents`가
  완료 순서와 무관하게 입력 인덱스 순서로 결과를 반환한다는 점을 이용해 `results.slice(0, 4)`로
  안전하게 kind별 결과를 매칭.

### `pptGeneration.ts` — 조건부 슬라이드 그룹 fan-out

- 기존: 슬라이드 8~11개를 한 대화에서 생성하며, "Agent 정보가 없으면 관련 슬라이드를 만들지
  마라"는 지시를 프롬프트로만 전달 (`maxTurns: 6, maxTokensPerTurn: 8000`).
- 변경: 슬라이드를 6개 그룹으로 분리 — `overview`(title+Project Overview),
  `process_painpoints`, `insights`(Interview Insights table + Tacit Knowledge),
  `agent_workflow`(Proposed AI Agent + Agent Workflow, **`input.agent`가 있을 때만**),
  `demo_ui`(**`input.screens`가 있을 때만**), `benefits_next`(Expected Benefits + Next Steps).
- 조건부 그룹은 "모델이 만들지 말라는 지시를 따르길 기대"하는 대신 **애초에 해당 그룹의
  fan-out 태스크 자체를 생성하지 않음** — 코드 레벨에서 확정.
- 순서 보장: `groups` 배열을 고정 순서로 만들고 그 순서대로 태스크를 만든 뒤, 결과를
  `results.flatMap(...)`으로 그대로 이어붙이고 기존 `renumber()`로 1부터 재번호 — 완료 순서와
  무관하게 항상 올바른 순서.
- 태스크당 `maxTurns: 6→3`, `maxTokensPerTurn: 8000→3000` (그룹당 슬라이드 1~2개뿐이라 대폭 축소).

### `documentAnalysis.ts` — 필드 3그룹 fan-out (문서 내부 병렬화)

- 배경: 이 파이프라인은 원래도 **문서 간** 병렬성이 있었음(`routes/documents.ts`가 업로드된
  각 파일의 `runAnalysis()`를 `await` 없이 fire-and-forget으로 호출) — 병목은 **문서 1건당**
  최대 8턴 순차 호출.
- 변경: 10개 출력 필드를 3그룹으로 분리 — `context`(businessContext/keyUsers/process/systems),
  `rules_decisions`(businessRules/decisionPoints/exceptions),
  `painpoints_ai_unknowns`(painPoints/aiOpportunities/unknowns). `DocumentAnalysisSchema.pick()`
  사용.
- 각 태스크가 **같은 문서 원문을 독립적으로** 읽음 — `createReadTextChunkTool`을 태스크마다
  새로 생성해 문서 텍스트 클로저를 각자 갖되(상태 없는 순수 함수라 안전), preview/outline은
  `buildDocPreamble()`로 공유.
- 태스크당 `maxTurns: 8→5`, `maxTokensPerTurn: 4096→3000`.
- **주의**: 문서 간 병렬성(기존, 무제한) × 문서 내부 fan-out(신규, 최대 3)이 겹치므로, 여러
  문서를 한꺼번에 업로드하면 동시 LLM 요청 수가 이전보다 늘어남. 아래 실측 검증에서 실제로
  이 변경 중 유일하게 부분 실패가 관찰됨.

## 실측 검증 (OpenRouter `deepseek/deepseek-v4-flash-0731`)

앱의 실제 모델 등록 경로(`llm_models` 테이블, 설정 UI와 동일 메커니즘)로 임시 등록해 검증.
검증용 임시 스크립트와 DB row는 테스트 후 모두 삭제함 — 저장소에는 흔적 없음.

| 파이프라인 | 결과 | 소요시간 | 비고 |
|---|---|---|---|
| interviewGeneration | ✅ 성공 (34문항, 중복 0, 카테고리 오염 0) | 168초 | 같은 조건 OLD(통짜 단일루프)는 7턴 소진 후 **제출 실패**(289초) — fan-out이 속도뿐 아니라 이 모델 기준 안정성도 개선 |
| domainKnowledgeGeneration | ✅ 성공, 전 필드 정상 | 56.8초 | glossary=9, domainRules=6, stakeholders=9, openQuestions=11 |
| agentDemoGeneration | ✅ 성공, agent명이 도메인 특화(예: "FX-AML 한도·스크리닝 검증 보좌 에이전트") | 108.7초 | 화면 4개 kind 순서 정상 |
| pptGeneration | ✅ 성공, 11슬라이드, order 1~11 연속성 정상 | 66.7초 | agent_workflow/demo_ui 조건부 그룹 포함해도 최종 순서 완벽 |
| documentAnalysis | ⚠️ 부분 실패 → 자동 폴백으로 결과는 정상 | 133.9초 | `painpoints_ai_unknowns` 그룹이 5턴 내 미제출(`exhausted`) → fan-out 전체 실패 → 기존 단일 턴 `completeJSON` 폴백이 모든 필드를 정상 채움. 속도 이득은 이 케이스에서 못 봄 |

documentAnalysis의 부분 실패는 이 모델(`deepseek-v4-flash-0731`, 저비용/경량) 자체의
tool-calling 신뢰성 이슈로 추정됨 — interviewGeneration의 OLD(통짜) 경로도 같은 모델에서
이미 한 번 완전 실패했던 전례가 있음. "그룹 하나라도 실패하면 전체를 던지고 안전하게
폴백한다"는 설계가 데이터 무결성 관점에서는 의도대로 작동한 사례.

## 아직 남은 것 / 확인 필요

- 이 변경은 아직 **커밋되지 않음**.
- documentAnalysis는 더 안정적인 모델(Claude/GPT 계열 등)에서 재검증 권장 — 이 모델 한정
  이슈인지 fan-out 설계 자체의 문제인지 구분 필요.
- 문서 여러 건을 한꺼번에 업로드하는 케이스에서, 문서 간 무제한 병렬성 × 문서 내부 fan-out(최대
  3)이 겹쳐 provider rate limit(429)에 더 잘 걸릴 가능성 — 아직 실측 안 됨.
- 현재 정책은 "그룹 하나 실패 시 전체를 완전 폴백"이라 부분 성공을 살리지 못함. 실패한 그룹만
  선택적으로 재시도하는 개선 여지가 있으나 이번 스펙 밖.
- `fanOut.ts`의 기본 동시성(3)을 그대로 사용 중 — 파이프라인별로 다르게 튜닝할지는 검토 안 함.
