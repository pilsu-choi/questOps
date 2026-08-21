# 06. (미커밋, 진행 중) Phase 2 tool 확산 + 문서 구조 보존 파싱

**상태: 2026-08-21 기준 워킹 트리에 아직 커밋되지 않은 변경사항.** 이 문서는 `git diff`로 확인한
내용을 정리한 것이며, 실제 커밋되면 커밋 해시/메시지를 이 문서 상단에 추가하고 상태를 갱신할 것.

## 배경

[04-agent-runtime-planning-filesystem-phase2.md](04-agent-runtime-planning-filesystem-phase2.md)의
스펙은 documentAnalysis/pptGeneration 두 서비스만 파일럿으로 다뤘고, "효과가 검증되면 나머지
4개 서비스로 확산하는 건 이번 스펙 밖의 후속 작업"이라고 명시해뒀음. 이번 미커밋 변경이 그
후속 작업 + 몇 가지 관련 개선을 함께 담고 있음.

## 변경 1 — Planning + Scratch + Project-document tool을 나머지 4개 서비스로 확산

대상: `interviewGeneration.ts`, `interviewAnswerMapping.ts`, `tacitExtraction.ts`,
`agentDemoGeneration.ts`, 그리고 새로 추가된 `domainKnowledgeGeneration.ts`
([05](05-domain-knowledge-dashboard.md)) — 총 5개 서비스.

각 서비스의 `*Agentic()` 함수에 동일한 패턴 적용:
- `runId = nanoid(12)` 생성
- `planTool = createPlanTool(runId)`, `scratchTools = createScratchWorkspaceTools(runId)`,
  `projectDocTools = createProjectDocumentTools(projectId)` 를 tool 목록에 추가
- `try { ...runAgentLoop... } finally { cleanupScratchWorkspace(runId) }` 로 감싸 실행 후 스크래치
  워크스페이스 정리
- 프롬프트에 "제출 전에 초안을 write_scratch_file로 저장하고 다시 읽어 다듬을 수 있다"는 안내 추가
- maxTurns 상향: interviewGeneration 4→6, interviewAnswerMapping 6→8, tacitExtraction 3→5,
  agentDemoGeneration 6→8, domainKnowledgeGeneration 6→8

**연쇄 변경(projectId 배관)**: `createProjectDocumentTools`가 `projectId`를 필요로 하므로, 이
tool을 쓰지 않던 함수들의 시그니처에 `projectId` 파라미터가 새로 추가됨:
- `generateInterviewQuestions(projectSummary, docs, projectId)`
- `mapTranscriptToAnswers(transcript, questions, projectId)`
- `extractInsightsFromAnswer(question, answer, projectId)`
- `DemoGenerationInput`에 `projectId` 필드 추가
- `DomainKnowledgeGenerationInput`에 `projectId` 필드 추가

호출부 라우트도 함께 수정: `routes/interview.ts`(질문 생성, 답변 저장, 업로드 매핑 3곳),
`routes/demo.ts`, `routes/domainKnowledge.ts` — 모두 `projectId`를 그대로 전달하도록 한 줄씩 추가.

**부수 수정**: 이미 커밋된 `documentAnalysis.ts`/`pptGeneration.ts`의 `createPlanTool()` 호출이
`runId` 없이 되어 있던 걸 `createPlanTool(runId)`로 맞춤 (아래 변경 2에서 `createPlanTool`
시그니처 자체가 바뀌었기 때문에 필요해진 수정).

## 변경 2 — `agent-runtime/tools.ts`: plan 이력 파일 저장 + 청크 문단 경계 개선

### `createPlanTool(runId)` — 계획 변경 이력을 파일로 기록

기존에는 `update_plan` 호출 결과가 messages 히스토리에만 남아 이후 턴에서 참조됐음. 이번
변경으로 매 호출을 revision으로 별도 파일(`os.tmpdir()/questops-agent-plans/{runId}.json`,
`PlanRevision[]` 배열)에도 남겨 **런 종료 후에도 계획 변화 이력을 볼 수 있게 함**. 이 디렉토리는
`scratchTools.ts`의 `scratchRoot(runId)`와는 별도 — 스크래치는 `cleanupScratchWorkspace`가 런
종료 시 통째로 지우는 휘발성 공간이라, 계획 기록을 거기 두면 런이 끝나자마자 함께 사라짐.

→ `createPlanTool()`이 `createPlanTool(runId)`로 시그니처 변경 (breaking) — 위 변경 1의 부수
수정이 이 때문에 필요했음.

### `readTextChunk` — 문단 경계 기준 자르기 + overlap

기존에는 `chunkSize`만큼 글자 수로 단순 슬라이스. 이번 변경:
1. `hardEnd` 근방(`chunkSize`의 15%, 최대 1000자 윈도우)에서 마지막 문단 경계(`"\n\n"`)를 찾아
   그 지점에서 자르려 시도 — `fileParsing.ts`가 제목/문단/리스트/표 사이를 `"\n\n"`으로 구분해두는
   것과 짝을 이룸 (아래 변경 3).
2. 그 경계가 청크를 절반(`chunkSize * 0.5`) 미만으로 줄일 만큼 너무 이르면 포기하고 하드컷.
3. 다음 `offset`은 이번 청크 끝에서 `overlap`(기본 200자, 최대 `chunkSize/2`)만큼 앞으로 당겨
   안내 — 문맥 연속성 확보.

`createReadTextChunkTool`에도 `overlap` 파라미터 추가, tool 설명 문구도 "문단 경계에 맞춰
잘리고 이어 읽을 offset은 앞 청크와 약간 겹치게 안내된다"로 갱신. `projectDocumentTools.ts`의
`read_project_document_chunk` 설명도 동일하게 갱신 (내부에서 같은 `readTextChunk` 함수 공유).

## 변경 3 — `fileParsing.ts`: DOCX/PPTX 구조 보존 파싱

**동기**: 위 청크 문단 경계 로직이 의미 있으려면 원문 텍스트 자체에 문단 경계가 보존돼 있어야
함. 기존 `extractDocx`는 mammoth의 `extractRawText`로 서식 정보 없이 텍스트만 뽑아, 제목/목록/표
경계가 사라진 상태였음.

> 이후 같은 `fileParsing.ts`에 PDF Layout Analysis(`pdfjs-dist` 기반)까지 추가돼 자료 수집
> 파이프라인 전체가 더 정리됨 — 상세는 [08-document-parsing-structure-chunking.md](08-document-parsing-structure-chunking.md) 참고.

### DOCX (`extractDocx`)

- `mammoth.extractRawText` 대신 `mammoth.convertToHtml`로 변환(이미지는 base64 embedding 시
  결과가 비대해지므로 빈 src로 처리) → Word 스타일(Heading 1-6, 목록, 표)이 h1-h6/li/table로
  매핑된 HTML을 받음.
- `htmlToStructuredText()`가 이 HTML을 마크다운 유사 표기로 인코딩:
  - `h1`-`h6` → `"#".repeat(레벨) + " " + 텍스트`
  - `li` → `"- " + 텍스트`
  - `tr` (표 행) → `"| 셀1 | 셀2 | ... |"`
  - 나머지 `p` → 텍스트 그대로
  - 서로 다른 종류 블록 사이는 `"\n\n"`(문단 경계), 같은 목록/같은 표의 연속 항목끼리는
    `"\n"`으로만 구분 — 이 `"\n\n"`을 위 변경 2의 청크 경계 로직이 그대로 활용.
- **안전망**: mammoth가 정규식이 다루지 않는 예상 밖 태그를 내보내는 경우를 대비해, 구조화 결과가
  원문(순수 텍스트 fallback) 대비 30% 미만으로 지나치게 짧으면(내용 유실 의심) 순수 텍스트로
  폴백.

### PPTX (`extractPptx`)

- 기존: 슬라이드 XML에서 모든 `<a:t>` 텍스트 런을 순서 무관하게 이어붙임 (제목/본문/목록
  구분 없음).
- 변경: `<p:sp>`(도형) 단위로 순회, 각 도형이 `placeholder type="title"|"ctrTitle"`인지로
  제목 여부 판단, 문단(`<a:p>`)별로 `<a:buChar>`/`<a:buAutoNum>` 존재 여부로 글머리 기호(목록
  항목) 여부 판단. 제목은 `"# " + 텍스트`, 목록 항목은 `"- " + 텍스트`, 나머지는 텍스트 그대로.
- **안전망**: `<p:sp>` 없이 텍스트가 들어있는 슬라이드(표, 스마트아트 등)는 모든 텍스트 런을
  예전 방식대로 이어붙이는 폴백 유지.

## 아직 남은 것 / 확인 필요

- 이 변경은 아직 **커밋되지 않음**. 커밋 시 이 문서의 상단에 커밋 해시를 추가하고, 필요하면
  [04](04-agent-runtime-planning-filesystem-phase2.md)에서 언급한 "나머지 4개 서비스로 확산은
  후속 작업" 문구 옆에도 완료 표시를 링크할 것.
- ~~6개 서비스 전체(documentAnalysis, pptGeneration 포함)가 이제 동일한 Planning+Scratch+
  Project-document tool 세트를 쓰게 됐는지 최종 확인 필요~~ → **확인 완료**(2026-08-21,
  `grep createPlanTool( server/src/services/*.ts`): 파일럿 2개(documentAnalysis, pptGeneration)
  + 확산 대상 5개(interviewGeneration, interviewAnswerMapping, tacitExtraction,
  agentDemoGeneration, domainKnowledgeGeneration) 총 **7개** 서비스 전부 `createPlanTool(runId)`
  사용 확인(원래 이 TODO의 "6개"는 domainKnowledgeGeneration을 빠뜨린 오기). fan-out까지 쓰는
  서비스는 이 중 5개([07](07-fanout-parallelization.md) 참고, documentAnalysis/pptGeneration도
  포함되어 사실상 7개 전부 아님 — tacitExtraction/interviewAnswerMapping은 fan-out 미적용).
