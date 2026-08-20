# agent-runtime 고도화: 재시도/자기교정, 서브에이전트 fan-out, 컨텍스트 안전장치

- 날짜: 2026-08-21
- 대상: `app/server/src/agent-runtime/*`, `app/server/src/llm/toolCalling.ts`
- 상태: 승인됨 (구현 계획 작성 대기)

## 배경

`app/server/src/agent-runtime/`(`loop.ts` 138줄, `types.ts` 47줄, `tools.ts` 49줄, `log.ts` 27줄)은
openClaw(`ref_projects/openclaw`)의 agent-loop 패턴을 참고해 만들었지만, 기존 주석에 명시된 대로
"steering/서브에이전트/컨텍스트 컴팩션 없이 명시적 maxTurns 상한만" 둔 최소 구현이다.

실제 호출부는 6곳(`agentDemoGeneration`, `interviewGeneration`, `interviewAnswerMapping`,
`pptGeneration`, `tacitExtraction`, `documentAnalysis`) 모두 3~6턴 안에 `submit_result` tool 호출로
끝나는 단발성 구조화 출력 생성기다. openClaw는 상시 세션·멀티채널·동적 서브에이전트 스폰을 가진
완성형 플랫폼(`src/` 하위 80개 디렉토리, 수천 파일)이라 스케일이 근본적으로 다르다. 이 스펙은
openClaw를 통째로 이식하는 게 아니라, 그 중 QuestOps의 "유한 턴·구조화 출력" 특성에 맞게 축소
적용 가능한 3가지 기법만 다룬다.

## 목표

기존 6개 서비스의 신뢰성/견고성을 개선한다:

1. **자기교정/재시도 정교화** — 일시적 전송 오류로 전체 실행이 죽는 것을 막고, 검증 실패 시
   자기교정 루프의 품질과 예산 관리를 정교화한다.
2. **서브에이전트 fan-out** — 독립적인 하위 작업을 병렬로 위임할 수 있는 런타임 프리미티브를
   추가한다(이번 스코프는 프리미티브 추가까지; 6개 서비스로의 실제 적용은 후속 작업).
3. **컨텍스트 관리 안전장치** — 누적 프롬프트가 비정상적으로 커지는 드문 경우를 위한 하한선을
   추가한다.

## 비목표

- 모델이 스스로 서브에이전트를 동적으로 스폰하는 tool(openClaw 스타일)은 추가하지 않는다.
  QuestOps는 요청당 비용/턴수가 예측 가능해야 하므로 fan-out은 항상 호출부(서비스 코드)가
  정적으로 선언한다.
- 요약 기반 컨텍스트 컴팩션(별도 LLM 호출로 대화를 재작성)은 추가하지 않는다. 3~6턴 유한
  루프에는 비용/실패면 대비 이득이 낮다.
- steering 큐, 상시 세션, 멀티채널 연동 등 openClaw의 나머지 기능은 QuestOps의 사용 사례에
  해당하지 않으므로 다루지 않는다.
- 6개 서비스 중 어느 것도 이번 스펙에서 fan-out으로 전환하지 않는다(런타임 프리미티브만 추가).
- 테스트 프레임워크를 새로 도입하지 않는다. 기존 컨벤션(`tsc` 빌드 + `watchAgentLogs` 기반 수동
  로그 검증)을 유지한다.

## 설계

### 1. 자기교정/재시도 정교화

#### 1a. 전송 오류 재시도 (`llm/toolCalling.ts`)

현재 `stepWithTools`는 OpenRouter 응답이 `!res.ok`면 즉시 `stopReason: "error"`를 반환하고,
`loop.ts`는 이를 받으면 남은 턴과 무관하게 즉시 실행을 중단한다. 429(rate limit)나
500/502/503/504(provider 일시 장애) 같은 일시적 오류 하나가 3~6턴짜리 실행 전체를 죽인다.

- HTTP 상태 코드가 `429 | 500 | 502 | 503 | 504`이거나, `fetchWithTimeout`이 던지는 timeout
  오류일 때만 "재시도 가능"으로 분류한다. 그 외(400 등 클라이언트 오류)는 즉시 실패 반환
  (재시도해도 같은 응답이 반복될 뿐이므로).
- 지수 백오프 + 지터: 시도 간 대기 `base * 2^attempt + random(0, jitterMs)`, `base=500ms`,
  `jitterMs=250ms`, 최대 3회 시도(최초 시도 포함 총 3번 HTTP 호출).
- 재시도 로직은 `stepWithTools` 내부에 캡슐화한다. `loop.ts`는 이 함수가 이미 재시도를
  소진한 뒤의 최종 결과만 본다 — `loop.ts`의 턴 카운트나 `AgentRunResult` 형태는 바뀌지 않는다.
- 재시도할 때마다 `logDebug`로 시도 번호/대기 시간/오류 사유를 남긴다(기존 로그 스타일 유지).

#### 1b. 검증 실패 예산 분리

지금은 `submit_result` 스키마 검증 실패가 "일반 턴 소진"과 구분되지 않는다 — 모델이 계속
잘못된 인자로 재제출을 시도하다 `maxTurns`를 다 쓰면, 정말 탐색이 필요해서 소진된 건지
검증 실패 루프에 빠져서 소진된 건지 로그로 구분할 수 없다.

- `AgentToolResult`(`types.ts`)에 `isValidationError?: boolean` 필드를 추가한다.
  `createSubmitTool`(`tools.ts`)의 `execute`가 `safeParse` 실패 시 이 플래그를 `true`로 설정해
  반환한다. `loop.ts`는 문자열 매칭이 아니라 이 플래그로 검증 실패를 감지한다.
- `loop.ts`에 `consecutiveValidationFailures` 카운터를 `consecutiveNoToolCallTurns`와 같은
  패턴으로 추가한다. `MAX_CONSECUTIVE_VALIDATION_FAILURES = 3`을 넘으면 남은 턴이 있어도
  즉시 종료한다.
- 종료 status로 기존 `AgentRunStatus`(`"submitted" | "exhausted" | "error"`)에
  `"validation_exhausted"`를 추가한다. 호출부(6개 서비스)는 전부 `status === "submitted"`만
  분기하고 나머지는 공용 실패 경로로 처리하므로(`agentDemoGeneration.ts:257` 등에서 확인)
  이 값 추가는 기존 호출부를 깨지 않는 하위 호환 변경이다.
- 2번째 연속 검증 실패부터는 tool 결과 텍스트에 "이미 N회 검증에 실패했다. 스키마 요구사항을
  다시 확인하고 신중하게 재제출하라"는 경고를 덧붙여, 모델이 같은 실수를 반복하지 않도록
  유도한다(기존 `NO_TOOL_CALL_NUDGE`와 동일한 철학).

#### 1c. 구제 턴 (강제 제출)

턴이 소진되거나(tool 호출 없음) 검증 실패가 반복돼 조기 종료 직전이 되면, 정말 마지막
기회로 1턴을 더 주되 `tool_choice`를 `submit_result`로 강제해 "지금까지 조사한 내용으로
최선을 다해 제출하라"고 요청한다. 이 턴에서도 검증에 실패하면 그대로 종료한다(무한 루프
방지 — 구제 턴은 정확히 1회만 허용).

- `stepWithTools`/`toOpenAiTools`에 `forceTool?: string` 파라미터를 추가한다. OpenAI 호환
  tool-calling API는 `tool_choice: { type: "function", function: { name } }`로 특정 tool을
  강제 호출하는 표준 기능을 이미 지원하므로 provider 쪽 변경은 없다.
- `loop.ts`에서 조기 종료 조건(턴 소진 직전, 또는 `MAX_CONSECUTIVE_VALIDATION_FAILURES`/
  `MAX_CONSECUTIVE_NO_TOOL_CALL_TURNS` 도달 직전)을 만나면 `rescueAttempted` 플래그가
  꺼져 있는 경우에 한해 한 번 더 턴을 돌리고, 그 호출에 `forceTool: "submit_result"`를
  넘긴다. 구제 턴은 `maxTurns`와 별개의 예산으로, 정확히 1회만 소비된다.
- 구제 턴에서 성공하면 `status: "submitted"`로 정상 종료. 실패하면 원래 종료 사유(status)
  그대로 반환하되 구제 턴 시도 사실을 로그에 남긴다.

### 2. 서브에이전트 fan-out 런타임 프리미티브

`agent-runtime/fanOut.ts` 신규 파일.

```ts
export interface FanOutTask {
  runLabel: string;
  systemPrompt: string;
  userPrompt: string;
  tools: AgentTool[];
  maxTurns?: number;
  maxTokensPerTurn?: number;
}

export interface FanOutOptions {
  concurrency?: number; // 기본 3
}

export async function runFanOutAgents(
  tasks: FanOutTask[],
  options?: FanOutOptions
): Promise<AgentRunResult[]>
```

- 내부 구현: 외부 의존성 추가 없이 간단한 동시성 캡 풀(concurrency-limited pool)로 구현한다
  (`tasks`를 순회하며 최대 `concurrency`개까지만 동시에 `runAgentLoop` 실행, 하나 끝나면 다음
  시작). 반환 배열은 입력 `tasks` 순서를 보존한다.
- 각 task는 `runAgentLoop`를 그대로 호출하므로 위 1a/1b/1c(재시도/검증 예산/구제 턴)를 개별
  task 단위로 자동으로 받는다.
- `runAgentLoop`는 이미 내부적으로 모든 오류를 `AgentRunResult`(status: "error" 등)로 흡수하고
  throw하지 않는 구조이지만, `runFanOutAgents`는 방어적으로 각 task 실행을 개별
  `try/catch`로 감싸 예상치 못한 예외가 나머지 task를 중단시키지 않게 한다(하나가 진짜로
  throw하면 해당 task만 `status: "error"`로 변환해 반환).
- 모델이 동적으로 fan-out을 트리거하는 tool은 만들지 않는다 — 호출부(서비스 코드)가 언제,
  몇 개의 task로 나눌지 정적으로 결정한다.
- 이번 스코프에서는 6개 서비스 중 어느 것도 이 프리미티브로 전환하지 않는다. `documentAnalysis`
  (청크별 분석 병렬화)와 `interviewAnswerMapping`(질문 그룹별 매핑 병렬화)이 향후 가장 유력한
  적용 대상이라는 것만 기록해둔다.

### 3. 컨텍스트 관리 안전장치

`loop.ts`의 턴 루프 안, 매 턴 `stepWithTools` 호출 직전에 누적 히스토리 크기를 확인한다.

- `toolCalling.ts`가 이미 계산해 로깅만 하던 `promptChars`(현재 39번째 줄 근처)를 실제 가드로
  승격한다. `loop.ts`에서 다음 턴 호출 전 현재 `messages` 배열을 직렬화한 문자수를 계산하고,
  `MAX_HISTORY_CHARS = 120_000`을 넘으면 **가장 오래된** `role: "tool"` 메시지부터 순서대로
  `content`를 짧은 placeholder(`"[이전 tool 결과 생략됨, N자]"`)로 치환해 임계값 아래로 내려갈
  때까지 반복한다. 가장 최근 tool 결과는 절대 축소하지 않는다(모델이 방금 조회한 내용을
  잃으면 안 되므로).
- 이 로직은 기존 `RUNAWAY_RESPONSE_CHARS` 가드(단일 응답 폭주 감지)와 같은 파일, 같은 철학으로
  추가한다 — 다만 그건 "즉시 종료"이고 이건 "축소 후 계속 진행"이라는 차이가 있다.
- 기본적으로 이 가드는 거의 트리거되지 않을 것으로 예상한다(3~6턴, chunk 8000자 단위 특성상).
  드물게 문서가 아주 크거나 모델이 청크를 반복 조회하는 경우를 위한 하한선이다.

## 인터페이스 변경 요약

| 파일 | 변경 |
|---|---|
| `agent-runtime/types.ts` | `AgentToolResult.isValidationError?: boolean` 추가, `AgentRunStatus`에 `"validation_exhausted"` 추가 |
| `agent-runtime/tools.ts` | `createSubmitTool`이 검증 실패 시 `isValidationError: true` 반환 |
| `agent-runtime/loop.ts` | 검증 실패 카운터, 구제 턴 로직, 컨텍스트 축소 가드 추가 |
| `agent-runtime/fanOut.ts` | 신규 — `runFanOutAgents` |
| `llm/toolCalling.ts` | 전송 오류 재시도(백오프), `forceTool` 파라미터 추가 |

6개 서비스 파일(`services/*.ts`)은 수정하지 않는다 — 공용 `loop.ts`/`toolCalling.ts` 변경이므로
재시도·검증 예산·구제 턴·컨텍스트 가드 혜택을 코드 변경 없이 자동으로 받는다.

## 오류 처리 / 엣지 케이스

- 재시도 소진 후에도 실패하면 기존과 동일하게 `status: "error"`로 반환(동작 유지, 재시도
  횟수만 늘어남).
- 구제 턴은 정확히 1회만 허용 — `forceTool` 호출 자체가 다시 검증에 실패해도 추가 구제 턴을
  주지 않고 즉시 원래 종료 사유로 반환한다(무한 루프 방지).
- `runFanOutAgents`에 빈 배열이 들어오면 빈 배열을 즉시 반환한다.
- 컨텍스트 축소 가드가 모든 tool 메시지를 축소해도 여전히 임계값을 넘는 극단적 경우(예:
  system/user 프롬프트 자체가 이미 120,000자를 넘는 경우)는 축소를 더 하지 않고 그대로
  진행한다 — 이 가드의 목적은 tool 결과 누적을 막는 것이지 원본 입력을 강제로 자르는 게
  아니다.

## 검증 계획

프로젝트에 테스트 프레임워크가 없는 기존 상태를 유지한다.

- `tsc -p tsconfig.json`으로 타입 체크 통과 확인.
- `npm run dev` 기동 후 기존 6개 서비스 중 최소 1곳(예: `documentAnalysis` — chunk tool +
  submit_result 둘 다 사용)을 실제로 호출해 `logs:agent`(`watchAgentLogs.ts`)로 정상 동작(턴
  진행, tool 호출, 최종 submit) 로그를 확인한다.
- 재시도 로직은 실제 429/5xx를 인위로 재현하기 어려우므로, 코드 리뷰로 백오프 계산과 재시도
  가능 상태 코드 분류가 맞는지 확인하고 로그 문구로 재시도 시도가 남는지 확인한다(정상
  케이스에서는 재시도가 트리거되지 않아야 함).
- 구제 턴 로직은 의도적으로 `maxTurns`를 낮게(예: 1) 설정해 강제로 소진 경로를 태워보고,
  구제 턴이 정확히 1회 시도되는지 로그로 확인한다.
