# agent-runtime 고도화 Phase 2: Planning + Filesystem (파일럿: documentAnalysis, pptGeneration)

- 날짜: 2026-08-21
- 대상: `app/server/src/agent-runtime/*`, `app/server/src/services/documentAnalysis.ts`,
  `app/server/src/services/pptGeneration.ts`, `app/server/src/routes/documents.ts`,
  `app/server/src/routes/presentation.ts`
- 상태: 승인됨 (구현 계획 작성 대기)
- 선행 스펙: `2026-08-21-agent-runtime-advanced-techniques-design.md` (Phase 1 — 재시도/구제
  턴/컨텍스트 안전장치/정적 fan-out, 이미 main에 병합됨)

## 배경

Phase 1으로 `agent-runtime`의 신뢰성(재시도, 자기교정, 컨텍스트 안전장치)은 개선됐지만, 실제
산출물 품질 문제는 별개다. 6개 서비스 전부에서 "생성 품질이 균일하게 약하다"는 문제가 있는데,
청크 tool을 쓰지 않는 짧은 입력 서비스(`tacitExtraction`, `interviewGeneration`)도 마찬가지로
약하다는 점에서 원인은 "원문이 길어서 다 못 담는다"가 아니라 **"제출 전에 계획하고, 초안을 쓰고,
다듬는 과정이 없다"**는 구조적 문제로 판단된다. 현재 루프는 조사 몇 턴 후 바로
`submit_result`를 부르는 구조라, 사실상 초안 수준에서 끝난다.

추가로 실제 코드에 있는 구체적 버그성 증상 하나를 확인했다: `agent-runtime/loop.ts`의
`truncateForHistory`는 assistant 텍스트를 히스토리에 **2000자로 자른다**
(`MAX_ASSISTANT_TEXT_CHARS_IN_HISTORY = 2000`). 모델이 `submit_result` 이전에 긴 초안을
텍스트로 작성하면 다음 턴에는 대부분 잘려나가 사라진다 — 품질 저하의 직접적 원인 중 하나로
보인다.

openClaw(`ref_projects/openclaw`)의 실제 소스를 다시 확인한 결과, 이 레퍼런스 체크아웃에는
`read_file`/`write_file`/`todo_write` 같은 tool 구현이 없다. openClaw는 자체적으로 파일 조작
tool을 구현하기보다 외부 코딩 에이전트 CLI를 오케스트레이션하는 개인 비서 플랫폼이다
(`VISION.md`). 따라서 이번 스펙의 Planning/Filesystem tool은 openClaw 코드를 참고한 게 아니라,
Claude Code류 코딩 에이전트가 일반적으로 쓰는 표준 패턴(TodoWrite, Read/Write/Edit)을 QuestOps
사용 사례에 맞게 새로 설계한 것이다.

## 목표

`documentAnalysis`, `pptGeneration` 두 서비스에 한해:

1. **Planning** — 작업 시작 전 명시적 계획 tool(`update_plan`)을 1턴째에 강제 호출하게 해서,
   모델이 무엇을 할지 먼저 정리하고 이후 턴에서 그 계획을 스스로 참조하게 한다.
2. **Filesystem — 실행별 스크래치 워크스페이스** — `write_scratch_file`/`read_scratch_file`/
   `list_scratch_files` tool로, `truncateForHistory`가 자르지 않는 별도 저장소에 초안을 쓰고
   다시 읽으며 다듬을 수 있게 한다.
3. **Filesystem — 같은 프로젝트의 다른 문서 접근** — `list_project_documents`/
   `read_project_document_chunk` tool로, 처음 프롬프트에 넣어주지 않은 같은 프로젝트의 다른
   자료를 모델이 필요할 때 스스로 조회할 수 있게 한다.

효과가 검증되면 나머지 4개 서비스로 확산하는 건 이번 스펙 밖의 후속 작업이다.

## 비목표

- 모델이 스스로 서브에이전트를 동적으로 스폰하는 것은 여전히 추가하지 않는다. 정적
  fan-out(`agent-runtime/fanOut.ts`, Phase 1에서 이미 추가됨)으로 충분하다.
- 요약 기반 컨텍스트 컴팩션(별도 LLM 호출로 대화를 재작성)은 여전히 추가하지 않는다.
- 임의 경로의 파일시스템 접근(경로 파라미터를 받는 범용 `read_file`)은 추가하지 않는다. 스크래치
  워크스페이스는 실행별로 격리된 디렉토리 안의 단순 파일명만 허용하고, 프로젝트 문서 접근은
  경로가 아니라 `documents` 테이블을 `project_id`로 스코프한 DB 조회로만 이뤄진다 — 임의 경로
  탈출 위험이 구조적으로 없다.
- `documentAnalysis`/`pptGeneration` 외 나머지 4개 서비스는 이번 스펙에서 수정하지 않는다.
- 새 테스트 프레임워크는 도입하지 않는다(Phase 1과 동일 컨벤션 유지).

## 설계

### 1. Planning: `update_plan` tool + 1턴째 강제

`agent-runtime/tools.ts`에 추가:

```ts
export const PLAN_TOOL_NAME = "update_plan";

export function createPlanTool(): AgentTool {
  return {
    name: PLAN_TOOL_NAME,
    description: "작업을 시작하기 전에 수행할 단계를 순서대로 기록한다. 진행 중 계획이 바뀌면 다시 호출해 갱신할 수 있다.",
    parameters: {
      type: "object",
      properties: {
        steps: { type: "array", items: { type: "string" }, description: "수행할 단계를 순서대로, 각각 한 문장으로" }
      },
      required: ["steps"]
    },
    execute(args: { steps: string[] }) {
      const list = (args?.steps ?? []).map((s, i) => `${i + 1}. ${s}`).join("\n");
      return { content: `계획이 기록되었습니다:\n${list}` };
    }
  };
}
```

새 상태 관리나 loop.ts 쪽 "계획을 다시 주입" 로직은 필요 없다 — tool 호출 결과는 이미
`messages` 히스토리에 남아 이후 턴에서 모델이 자연히 참조한다(다른 모든 tool 결과와 동일).

`agent-runtime/loop.ts`의 턴 루프에서, 1턴째에 한해 `update_plan`이 `config.tools`에 있으면
강제 호출한다 — Phase 1에서 만든 `forceTool`(`stepWithTools`의 5번째 파라미터) 메커니즘을
그대로 재사용한다:

```ts
const forceTool = turn === 1 && config.tools.some((t) => t.name === PLAN_TOOL_NAME) ? PLAN_TOOL_NAME : undefined;
const step = await stepWithTools(config.systemPrompt, messages, config.tools, maxTokens, forceTool);
```

`PLAN_TOOL_NAME`은 `tools.ts`에서 export해 `loop.ts`가 import한다 — 문자열 리터럴 중복을
피한다. (겸사겸사: 기존에 `"submit_result"`가 `tools.ts`/`loop.ts`에 3곳 하드코딩돼 있던 것도
같은 이유로 `SUBMIT_TOOL_NAME` 상수로 뽑아 정리한다 — Phase 1 최종 리뷰에서 나온 마이너
파인딩을, 지금 어차피 같은 파일의 같은 종류 문제를 고치는 김에 함께 정리.)

`update_plan` tool이 없는 나머지 4개 서비스는 `forceTool`이 항상 `undefined`라 동작 변화가
전혀 없다.

### 2. Filesystem — 실행별 스크래치 워크스페이스

신규 파일 `agent-runtime/scratchTools.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { AgentTool } from "./types.js";

const FILENAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

function scratchRoot(runId: string): string {
  return path.join(os.tmpdir(), "questops-agent-scratch", runId);
}

function assertSafeFilename(name: string): void {
  if (!FILENAME_PATTERN.test(name) || name === "." || name === "..") {
    throw new Error(`허용되지 않는 파일명: "${name}". 슬래시나 상위 경로 없이 단순 파일명만 사용하라.`);
  }
}

export function createScratchWorkspaceTools(runId: string): AgentTool[] {
  const root = scratchRoot(runId);

  const writeTool: AgentTool = {
    name: "write_scratch_file",
    description: "작업 중인 초안이나 메모를 실행 전용 임시 파일에 저장한다. 이후 read_scratch_file로 다시 불러올 수 있다.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "파일명 (슬래시 없이 단순 이름, 예: draft.md)" },
        content: { type: "string" }
      },
      required: ["name", "content"]
    },
    execute(args: { name: string; content: string }) {
      assertSafeFilename(args.name);
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(path.join(root, args.name), args.content, "utf-8");
      return { content: `"${args.name}" 저장됨 (${args.content.length}자).` };
    }
  };

  const readTool: AgentTool = {
    name: "read_scratch_file",
    description: "이전에 write_scratch_file로 저장한 파일을 읽는다.",
    parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    execute(args: { name: string }) {
      assertSafeFilename(args.name);
      const p = path.join(root, args.name);
      if (!fs.existsSync(p)) return { content: `"${args.name}" 파일이 없다. write_scratch_file로 먼저 저장하라.` };
      return { content: fs.readFileSync(p, "utf-8") };
    }
  };

  const listTool: AgentTool = {
    name: "list_scratch_files",
    description: "지금까지 저장한 임시 파일 목록을 본다.",
    parameters: { type: "object", properties: {}, required: [] },
    execute() {
      if (!fs.existsSync(root)) return { content: "아직 저장된 파일이 없다." };
      const files = fs.readdirSync(root);
      return { content: files.length ? files.join("\n") : "아직 저장된 파일이 없다." };
    }
  };

  return [writeTool, readTool, listTool];
}

export function cleanupScratchWorkspace(runId: string): void {
  fs.rmSync(scratchRoot(runId), { recursive: true, force: true });
}
```

**보안**: `assertSafeFilename`이 슬래시·상위 경로 문자를 정규식으로 거부하므로, 파일은 항상
`scratchRoot(runId)` 바로 아래 평평한(flat) 구조로만 쓰이고 읽힌다. `runId`는 서비스가 생성해
넘기며(`nanoid()`, 이미 프로젝트 의존성), 다른 실행의 워크스페이스와 충돌하지 않는다.

**생명주기**: `agent-runtime`은 이 tool들의 존재를 모른다 — 만든 서비스가 소유한다. 호출부
패턴:

```ts
const runId = nanoid(12);
const scratchTools = createScratchWorkspaceTools(runId);
try {
  const result = await runAgentLoop({ ..., tools: [...otherTools, ...scratchTools] });
  // ...
} finally {
  cleanupScratchWorkspace(runId);
}
```

### 3. Filesystem — 같은 프로젝트의 다른 문서 접근

`agent-runtime/tools.ts`에 순수 헬퍼로 리팩터링(기존 `createReadTextChunkTool`의 청크 계산
로직을 뽑아냄, 동작 변화 없음):

```ts
export function readTextChunk(text: string, offset: number, chunkSize: number): string {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  const slice = text.slice(safeOffset, safeOffset + chunkSize);
  const nextOffset = safeOffset + slice.length;
  const hasMore = nextOffset < text.length;
  return `[${safeOffset}-${nextOffset} / 총 ${text.length}자]\n${slice}${
    hasMore ? `\n\n(계속 읽으려면 offset=${nextOffset}로 다시 호출)` : "\n\n(문서 끝)"
  }`;
}
```

`createReadTextChunkTool`의 `execute`는 이제 `return { content: readTextChunk(text, args?.offset ?? 0, chunkSize) };`
한 줄로 바뀐다(설명 문자열이나 파라미터 스키마는 그대로).

신규 파일 `agent-runtime/projectDocumentTools.ts`:

```ts
import { db } from "../db.js";
import { readTextChunk } from "./tools.js";
import type { AgentTool } from "./types.js";

export function createProjectDocumentTools(projectId: string): AgentTool[] {
  const listTool: AgentTool = {
    name: "list_project_documents",
    description: "같은 프로젝트에 업로드된 문서 목록을 본다 (id, 파일명, 분석 상태).",
    parameters: { type: "object", properties: {}, required: [] },
    execute() {
      const rows = db
        .prepare(`SELECT id, filename, status FROM documents WHERE project_id = ? ORDER BY uploaded_at DESC`)
        .all(projectId) as { id: string; filename: string; status: string }[];
      if (!rows.length) return { content: "이 프로젝트에 문서가 없다." };
      return { content: rows.map((r) => `${r.id}\t${r.filename}\t(${r.status})`).join("\n") };
    }
  };

  const readTool: AgentTool = {
    name: "read_project_document_chunk",
    description: "list_project_documents로 확인한 문서 id의 원문을 청크 단위로 읽는다. offset(기본 0)부터 최대 8000자.",
    parameters: {
      type: "object",
      properties: {
        documentId: { type: "string" },
        offset: { type: "number", description: "읽기 시작할 문자 인덱스 (기본 0)" }
      },
      required: ["documentId"]
    },
    execute(args: { documentId: string; offset?: number }) {
      const row = db
        .prepare(`SELECT extracted_text FROM documents WHERE id = ? AND project_id = ?`)
        .get(args.documentId, projectId) as { extracted_text: string | null } | undefined;
      if (!row) return { content: `문서 id "${args.documentId}"를 이 프로젝트에서 찾을 수 없다. list_project_documents로 먼저 id를 확인하라.` };
      return { content: readTextChunk(row.extracted_text ?? "", args.offset ?? 0, 8000) };
    }
  };

  return [listTool, readTool];
}
```

**보안**: SQL은 `project_id = ?` 바인딩만 쓰고, 경로 파라미터를 전혀 받지 않는다. 다른
프로젝트의 문서는 `documentId`를 알아도 `AND project_id = ?` 조건에 걸려 조회되지 않는다.

### 4. 서비스 통합

#### `documentAnalysis.ts`

- `analyzeDocument(filename, text)` → `analyzeDocument(filename, text, projectId)`. 유일한
  호출부인 `routes/documents.ts:50`의 `analyzeDocument(row.filename, row.extracted_text || "")`를
  `analyzeDocument(row.filename, row.extracted_text || "", row.project_id)`로 수정
  (`row`에 이미 `project_id` 컬럼이 있음, 확인됨).
- `analyzeDocumentAgentic`도 같은 `projectId` 파라미터를 받아 `createPlanTool()`,
  `createScratchWorkspaceTools(runId)`, `createProjectDocumentTools(projectId)`를 만들어
  기존 `readChunkTool`/`submitTool`과 함께 `tools` 배열에 추가.
- `maxTurns: 6` → `8` (계획 턴 + 초안/다듬기 여유).
- `finally`로 `cleanupScratchWorkspace(runId)` 호출.

#### `pptGeneration.ts`

- `PptInput` 인터페이스에 `projectId: string` 필드 추가. 유일한 호출부인
  `routes/presentation.ts:70`의 `generatePresentationSlides({...})` 호출에 `projectId`(이미
  32번째 줄에서 `const projectId = req.params.id;`로 확보됨)를 추가.
- `generateSlidePlanAgentic`에서 `createPlanTool()`, `createScratchWorkspaceTools(runId)`,
  `createProjectDocumentTools(input.projectId)`를 만들어 기존 `submitTool`과 함께 `tools`
  배열에 추가.
- `maxTurns: 4` → `6`.
- `finally`로 `cleanupScratchWorkspace(runId)` 호출.

나머지 4개 서비스 파일은 이번 스펙에서 수정하지 않는다.

## 인터페이스 변경 요약

| 파일 | 변경 |
|---|---|
| `agent-runtime/tools.ts` | `PLAN_TOOL_NAME`/`SUBMIT_TOOL_NAME` 상수 추가, `createPlanTool` 추가, `readTextChunk` 헬퍼로 리팩터링 |
| `agent-runtime/loop.ts` | 1턴째 `update_plan` 강제 호출 로직 추가, `SUBMIT_TOOL_NAME` 상수 사용으로 교체 |
| `agent-runtime/scratchTools.ts` | 신규 — `createScratchWorkspaceTools`, `cleanupScratchWorkspace` |
| `agent-runtime/projectDocumentTools.ts` | 신규 — `createProjectDocumentTools` |
| `services/documentAnalysis.ts` | `projectId` 파라미터 추가, 3종 tool 통합, `maxTurns` 8로 상향 |
| `services/pptGeneration.ts` | `PptInput.projectId` 필드 추가, 3종 tool 통합, `maxTurns` 6으로 상향 |
| `routes/documents.ts` | `analyzeDocument` 호출에 `row.project_id` 추가 |
| `routes/presentation.ts` | `generatePresentationSlides` 호출에 `projectId` 추가 |

## 오류 처리 / 엣지 케이스

- `assertSafeFilename`이 거부하는 파일명(슬래시, `..` 등)을 모델이 시도하면 tool은 `throw`한다
  — `agent-runtime/loop.ts`의 `runTool`이 이미 모든 tool 실행을 `try/catch`로 감싸고 있어
  (Phase 1 이전부터 있던 기존 동작), 예외가 tool 결과 텍스트로 모델에게 피드백되고 루프는 계속
  진행된다. 새로 처리할 게 없다.
- `read_scratch_file`을 존재하지 않는 파일명으로 호출하면 예외 대신 안내 문자열을 반환한다(모델이
  스스로 재시도할 수 있게).
- `read_project_document_chunk`에 다른 프로젝트의 `documentId`나 존재하지 않는 id를 넘기면
  안내 문자열을 반환한다.
- `cleanupScratchWorkspace`는 `runAgentLoop`가 어떤 상태로 끝나든(`submitted`/`exhausted`/
  `error`/예외) `finally`에서 호출되므로 임시 파일이 서버에 남지 않는다.
- 계획을 강제하는 1턴째에 모델이 스키마와 다른 인자로 `update_plan`을 호출하면(예: `steps`
  누락) 어떻게 되는가 — `createPlanTool`은 `createSubmitTool`과 달리 zod 검증이 없다(스키마가
  단순 배열이라 형식 오류 여지가 적음). OpenAI 호환 API가 `parameters`에 명시된 required 필드를
  강제하지 않는 provider가 있을 수 있으므로, `execute`는 `args?.steps ?? []`로 방어해 빈
  배열이어도 안전하게 진행한다(에러로 루프를 막지 않음).

## 검증 계획

Phase 1과 동일한 컨벤션을 유지한다.

- `tsc -p tsconfig.json --noEmit` 통과 확인.
- 순수 로직(`readTextChunk`, `assertSafeFilename`이 유발하는 안전/비안전 케이스,
  `createScratchWorkspaceTools`가 반환하는 tool들의 execute 동작, 1턴째 `forceTool` 계산)은
  임시 scratchpad 스크립트(`tsx` 실행, 통과 후 삭제)로 자동 검증한다 — 전부 파일시스템/순수
  함수만 다뤄 실제 LLM 호출이 필요 없다.
- `createProjectDocumentTools`는 실제 sqlite DB에 임시로 프로젝트/문서 행을 넣고 조회하는 것도
  스크래치 스크립트로 검증 가능하다(DB 자체는 실제 LLM 호출이 아니므로 네트워크 불필요).
- `documentAnalysis`/`pptGeneration`의 서비스 통합(전체 흐름에서 계획→탐색→제출)은 Phase 1과
  동일하게 `tsc` + 실제 LLM 자격 증명 환경에서의 수동 스모크 테스트로 확인한다(자동화 불가 —
  실제 모델 호출 필요).
