# Agent-Runtime Phase 2: Planning + Filesystem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `documentAnalysis`, `pptGeneration` 두 서비스에 계획(Planning) tool과 두 종류의
filesystem tool(실행별 스크래치 워크스페이스, 같은 프로젝트의 다른 문서 조회)을 추가해, 제출
전에 계획하고 초안을 쓰고 다듬는 과정을 만든다.

**Architecture:** `agent-runtime/tools.ts`에 `createPlanTool`(계획 tool)과 `readTextChunk`
(청크 계산 순수 함수, 리팩터링)를 추가. 신규 `agent-runtime/scratchTools.ts`(실행별 임시
디렉토리 read/write/list)와 `agent-runtime/projectDocumentTools.ts`(project_id로 스코프한
DB 조회 기반 문서 접근)를 추가. `agent-runtime/loop.ts`는 1턴째에 `update_plan`을
`forceTool`(Phase 1에서 이미 만든 메커니즘)로 강제하는 순수 헬퍼 하나만 추가. 두 서비스
파일과 그 호출부(routes) 2곳만 수정 — 나머지 4개 서비스는 이번 계획에서 건드리지 않는다.

**Tech Stack:** TypeScript(ES2022, ESNext 모듈), Node.js(`node:fs`/`node:os`/`node:path`,
`node:sqlite` 기반 `db.ts`), zod, tsx(임시 검증 스크립트 실행용). 테스트 프레임워크는 도입하지
않는다.

**Spec:** `app/docs/superpowers/specs/2026-08-21-agent-runtime-planning-filesystem-design.md`

## Global Constraints

- 새 테스트 프레임워크를 도입하지 않는다 — 검증은 `tsc --noEmit` + 태스크마다 작성했다가
  통과 확인 후 삭제하는 임시 scratchpad 스크립트(`tsx`로 실행) + LLM을 실제로 호출하는 서비스
  통합 부분은 수동 dev-server 스모크 테스트로 한다.
- `documentAnalysis.ts`, `pptGeneration.ts`와 그 라우트 호출부(`routes/documents.ts`,
  `routes/presentation.ts`) 외 나머지 4개 서비스 파일(`agentDemoGeneration.ts`,
  `interviewGeneration.ts`, `interviewAnswerMapping.ts`, `tacitExtraction.ts`)은 이번
  계획에서 수정하지 않는다.
- 모델이 스스로 동적으로 서브에이전트를 스폰하는 tool은 추가하지 않는다.
- 요약 기반 컨텍스트 컴팩션은 추가하지 않는다.
- 스크래치 워크스페이스 tool은 슬래시나 상위 경로(`..`)가 포함된 파일명을 반드시 거부한다 —
  실행별 임시 디렉토리 밖으로 나갈 수 없어야 한다.
- 프로젝트 문서 접근 tool은 경로 파라미터를 받지 않는다 — 항상 `documents` 테이블을
  `project_id`로 스코프한 SQL 바인딩 조회만 쓴다.
- 새 코드의 주석은 한국어로, "무엇"이 아니라 "왜"만 남긴다.
- import 경로는 상대 경로 `.js` 확장자 컨벤션을 따른다.
- `data/`(sqlite 파일 위치)는 `.gitignore`돼 있다 — 이 계획을 실행하는 워크트리는 항상 빈
  DB로 시작하므로, Task 4의 검증 스크립트가 실제 `db.js`에 행을 삽입해도 실제 사용자 데이터에
  영향을 주지 않는다.

---

## File Structure

| 파일 | 상태 | 책임 |
|---|---|---|
| `app/server/src/agent-runtime/tools.ts` | 수정 | `SUBMIT_TOOL_NAME`/`PLAN_TOOL_NAME` 상수, `createPlanTool`, `readTextChunk` 순수 함수로 리팩터링 |
| `app/server/src/agent-runtime/loop.ts` | 수정 | `computePlanForceTool` 순수 헬퍼 추가, 1턴째 강제 호출 연결, `SUBMIT_TOOL_NAME` 상수 사용 |
| `app/server/src/agent-runtime/scratchTools.ts` | 신규 | `createScratchWorkspaceTools`, `cleanupScratchWorkspace` |
| `app/server/src/agent-runtime/projectDocumentTools.ts` | 신규 | `createProjectDocumentTools` |
| `app/server/src/services/documentAnalysis.ts` | 수정 | `projectId` 파라미터, 3종 tool 통합, `maxTurns` 8로 상향 |
| `app/server/src/services/pptGeneration.ts` | 수정 | `PptInput.projectId` 필드, 3종 tool 통합, `maxTurns` 6으로 상향 |
| `app/server/src/routes/documents.ts` | 수정 | `analyzeDocument` 호출에 `row.project_id` 전달 |
| `app/server/src/routes/presentation.ts` | 수정 | `generatePresentationSlides` 호출에 `projectId` 전달 |

---

### Task 1: `tools.ts` — 상수, `createPlanTool`, `readTextChunk` 리팩터링

**Files:**
- Modify: `app/server/src/agent-runtime/tools.ts`
- Test(임시): `app/server/src/agent-runtime/_verify.task1.ts`

**Interfaces:**
- Produces: `SUBMIT_TOOL_NAME = "submit_result"`, `PLAN_TOOL_NAME = "update_plan"` (둘 다
  export). `createPlanTool(): AgentTool`. `readTextChunk(text: string, offset: number,
  chunkSize: number): string` (export, 순수 함수 — Task 4의 `projectDocumentTools.ts`가
  import해서 쓴다). `createSubmitTool`은 이제 `name: SUBMIT_TOOL_NAME`을 쓴다(값은
  `"submit_result"`로 동일, 동작 변화 없음). `createReadTextChunkTool`은 내부적으로
  `readTextChunk`를 호출하도록 리팩터링(출력 동일, 동작 변화 없음).

- [ ] **Step 1: 임시 검증 스크립트 작성**

`app/server/src/agent-runtime/_verify.task1.ts` 생성:

```ts
import assert from "node:assert/strict";
import { z } from "zod";
import {
  createSubmitTool,
  createPlanTool,
  createReadTextChunkTool,
  readTextChunk,
  PLAN_TOOL_NAME,
  SUBMIT_TOOL_NAME
} from "./tools.js";

assert.equal(SUBMIT_TOOL_NAME, "submit_result");
assert.equal(PLAN_TOOL_NAME, "update_plan");

const submitTool = createSubmitTool(z.object({ x: z.string() }), "테스트");
assert.equal(submitTool.name, SUBMIT_TOOL_NAME);

const planTool = createPlanTool();
assert.equal(planTool.name, PLAN_TOOL_NAME);
const planResult = planTool.execute({ steps: ["첫번째", "두번째"] });
assert.equal(planResult.content, "계획이 기록되었습니다:\n1. 첫번째\n2. 두번째");
const emptyPlanResult = planTool.execute({} as any);
assert.equal(emptyPlanResult.content, "계획이 기록되었습니다:\n");

const longText = "x".repeat(20000);
const chunk1 = readTextChunk(longText, 0, 8000);
assert.ok(chunk1.startsWith("[0-8000 / 총 20000자]"));
assert.ok(chunk1.includes("(계속 읽으려면 offset=8000로 다시 호출)"));
const lastChunk = readTextChunk(longText, 16000, 8000);
assert.ok(lastChunk.includes("(문서 끝)"));

const chunkTool = createReadTextChunkTool("read_x", "설명", longText);
const toolChunkResult = chunkTool.execute({ offset: 0 });
assert.equal(toolChunkResult.content, chunk1, "createReadTextChunkTool은 readTextChunk와 동일한 결과를 내야 한다");

console.log("task1 OK");
```

- [ ] **Step 2: 실패 확인**

Run (in `app/server`): `npx tsx src/agent-runtime/_verify.task1.ts`
Expected: `createPlanTool`/`readTextChunk`/`PLAN_TOOL_NAME`/`SUBMIT_TOOL_NAME`이 아직 없어
import/호출 단계에서 실패.

- [ ] **Step 3: `tools.ts` 전체를 아래 내용으로 교체**

```ts
import type { ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { AgentTool } from "./types.js";

export const SUBMIT_TOOL_NAME = "submit_result";
export const PLAN_TOOL_NAME = "update_plan";

// 모든 agent 실행의 종료 지점이 되는 공용 tool.
// Zod 스키마 검증을 통과해야 terminate:true가 되어 루프가 끝나고,
// 실패하면 오류를 tool 결과 텍스트로 되돌려줘서 모델이 스스로 고쳐 재제출하게 한다
// (openClaw의 "에러를 tool 결과로 피드백해 자기교정" 패턴).
export function createSubmitTool<T>(schema: ZodType<T>, description: string): AgentTool {
  return {
    name: SUBMIT_TOOL_NAME,
    description: `${description} 이 스키마를 만족하는 인자로만 호출해야 하며, 검증에 실패하면 오류 메시지가 반환되니 수정해서 다시 호출하라. 조사가 끝나면 반드시 이 tool로 최종 제출한다.`,
    parameters: zodToJsonSchema(schema, { target: "openApi3" }) as Record<string, unknown>,
    execute(args: unknown) {
      const parsed = schema.safeParse(args);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
        return { content: `검증 실패 - ${issues}\n스키마에 맞춰 ${SUBMIT_TOOL_NAME}을 다시 호출하라.`, isValidationError: true };
      }
      return { content: "제출이 접수되었습니다.", details: parsed.data, terminate: true };
    }
  };
}

// 작업 시작 전 계획을 명시적으로 기록하게 하는 tool. loop.ts가 1턴째에 이 tool을
// forceTool로 강제해, 모델이 조사/제출에 앞서 무엇을 할지 먼저 정리하게 한다.
// 별도 상태 저장이 필요 없다 — tool 호출 결과는 messages 히스토리에 남아
// 다른 tool 결과와 동일하게 이후 턴에서 모델이 자연히 다시 참조한다.
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
    execute(args: { steps?: string[] }) {
      const list = (args?.steps ?? []).map((s, i) => `${i + 1}. ${s}`).join("\n");
      return { content: `계획이 기록되었습니다:\n${list}` };
    }
  };
}

// 긴 텍스트를 offset부터 chunkSize만큼 잘라 사람이 읽기 좋은 형태로 감싸는 순수 함수.
// createReadTextChunkTool과 read_project_document_chunk(projectDocumentTools.ts) 둘 다
// 이 로직을 공유한다 — 하나는 고정 문자열을, 하나는 DB에서 조회한 문자열을 다룰 뿐
// 청크 계산 자체는 동일하다.
export function readTextChunk(text: string, offset: number, chunkSize: number): string {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  const slice = text.slice(safeOffset, safeOffset + chunkSize);
  const nextOffset = safeOffset + slice.length;
  const hasMore = nextOffset < text.length;
  return `[${safeOffset}-${nextOffset} / 총 ${text.length}자]\n${slice}${
    hasMore ? `\n\n(계속 읽으려면 offset=${nextOffset}로 다시 호출)` : "\n\n(문서 끝)"
  }`;
}

// 긴 원문 텍스트를 청크 단위로 읽는 tool. 프롬프트에는 미리보기만 넣고,
// 모델이 필요하다고 판단할 때만 나머지를 조회하게 해서 매 호출 24k자를
// 무조건 밀어넣던 기존 방식보다 토큰을 아끼면서도 필요 시 전문을 다 볼 수 있게 한다.
export function createReadTextChunkTool(name: string, description: string, text: string, chunkSize = 8000): AgentTool {
  return {
    name,
    description: `${description} 전체 길이는 ${text.length}자. offset(문자 인덱스, 기본 0)을 지정해 그 위치부터 최대 ${chunkSize}자를 읽는다.`,
    parameters: {
      type: "object",
      properties: { offset: { type: "number", description: "읽기 시작할 문자 인덱스 (기본 0)" } },
      required: []
    },
    execute(args: { offset?: number }) {
      return { content: readTextChunk(text, args?.offset ?? 0, chunkSize) };
    }
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx src/agent-runtime/_verify.task1.ts`
Expected: `task1 OK` 출력.

- [ ] **Step 5: 타입 체크**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: 에러 없음.

- [ ] **Step 6: 임시 스크립트 삭제**

Run: `rm src/agent-runtime/_verify.task1.ts`

- [ ] **Step 7: 커밋**

```bash
git add server/src/agent-runtime/tools.ts
git commit -m "feat(agent-runtime): update_plan tool 추가, tool 이름 상수화, readTextChunk 공유 함수로 추출"
```

---

### Task 2: `loop.ts` — 1턴째 `update_plan` 강제 호출

**Files:**
- Modify: `app/server/src/agent-runtime/loop.ts`
- Test(임시): `app/server/src/agent-runtime/_verify.task2.ts`

**Interfaces:**
- Consumes: `PLAN_TOOL_NAME`, `SUBMIT_TOOL_NAME`(Task 1, `tools.ts`).
- Produces: `computePlanForceTool(turn: number, tools: AgentTool[]): string | undefined`
  (export, 순수 함수).

- [ ] **Step 1: 임시 검증 스크립트 작성**

`app/server/src/agent-runtime/_verify.task2.ts` 생성:

```ts
import assert from "node:assert/strict";
import { computePlanForceTool } from "./loop.js";
import type { AgentTool } from "./types.js";

const planTool = { name: "update_plan" } as AgentTool;
const otherTool = { name: "read_x" } as AgentTool;

assert.equal(computePlanForceTool(1, [planTool, otherTool]), "update_plan");
assert.equal(computePlanForceTool(2, [planTool, otherTool]), undefined, "2턴째는 강제하지 않는다");
assert.equal(computePlanForceTool(1, [otherTool]), undefined, "update_plan이 없으면 강제하지 않는다");
assert.equal(computePlanForceTool(1, []), undefined, "tool이 하나도 없으면 강제하지 않는다");

console.log("task2 OK");
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx src/agent-runtime/_verify.task2.ts`
Expected: `computePlanForceTool`이 아직 없어 import 단계에서 실패.

- [ ] **Step 3: `loop.ts` 수정**

파일 최상단 import 블록(1~3번째 줄)을:

```ts
import { stepWithTools, type ToolCallMessage } from "../llm/toolCalling.js";
import { logDebug } from "../logger.js";
import type { AgentRunConfig, AgentRunResult, AgentTool, AgentToolResult, AgentTurnLog } from "./types.js";
import { PLAN_TOOL_NAME, SUBMIT_TOOL_NAME } from "./tools.js";
```

로 교체(기존 3번째 줄의 타입 import에 `AgentTool` 추가 + `tools.js`에서 두 상수 import 추가).

`truncateForHistory` 함수(현재 55~58번째 줄 근처) 바로 아래, `runTool` 함수 바로 위에 추가:

```ts
// 1턴째에 한해 update_plan tool이 있으면 강제 호출시킨다 — 모델이 조사/제출에 앞서
// 계획부터 세우게 한다. update_plan이 없는 서비스는 항상 undefined라 동작 변화가 없다.
export function computePlanForceTool(turn: number, tools: AgentTool[]): string | undefined {
  return turn === 1 && tools.some((t) => t.name === PLAN_TOOL_NAME) ? PLAN_TOOL_NAME : undefined;
}
```

`tryRescueTurn` 함수 안의 다음 줄:

```ts
  if (!config.tools.some((t) => t.name === "submit_result")) return null;
```

을:

```ts
  if (!config.tools.some((t) => t.name === SUBMIT_TOOL_NAME)) return null;
```

로 교체. 같은 함수 안, `stepWithTools` 호출의 마지막 인자:

```ts
  const step = await stepWithTools(
    config.systemPrompt,
    rescueMessages,
    config.tools,
    config.maxTokensPerTurn ?? DEFAULT_MAX_TOKENS_PER_TURN,
    "submit_result"
  );
```

을:

```ts
  const step = await stepWithTools(
    config.systemPrompt,
    rescueMessages,
    config.tools,
    config.maxTokensPerTurn ?? DEFAULT_MAX_TOKENS_PER_TURN,
    SUBMIT_TOOL_NAME
  );
```

로 교체.

`runAgentLoop`의 메인 턴 루프 안, 다음 줄:

```ts
    const step = await stepWithTools(config.systemPrompt, messages, config.tools, maxTokens);
```

을:

```ts
    const step = await stepWithTools(config.systemPrompt, messages, config.tools, maxTokens, computePlanForceTool(turn, config.tools));
```

로 교체. (이 줄은 `messages = shrinkOldestToolMessages(...)` 다음, `logDebug`의 "calling
model..." 로그 다음 줄이다.)

- [ ] **Step 4: 통과 확인**

Run: `npx tsx src/agent-runtime/_verify.task2.ts`
Expected: `task2 OK` 출력.

- [ ] **Step 5: 타입 체크**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: 에러 없음.

- [ ] **Step 6: 임시 스크립트 삭제**

Run: `rm src/agent-runtime/_verify.task2.ts`

- [ ] **Step 7: 커밋**

```bash
git add server/src/agent-runtime/loop.ts
git commit -m "feat(agent-runtime): 1턴째 update_plan 강제 호출, tool 이름 상수 사용"
```

---

### Task 3: `scratchTools.ts` — 실행별 스크래치 워크스페이스

**Files:**
- Create: `app/server/src/agent-runtime/scratchTools.ts`
- Test(임시): `app/server/src/agent-runtime/_verify.task3.ts`

**Interfaces:**
- Consumes: `AgentTool`(`types.ts`, 변경 없음).
- Produces: `createScratchWorkspaceTools(runId: string): AgentTool[]`(3개 tool:
  `write_scratch_file`, `read_scratch_file`, `list_scratch_files`, 이 순서로 배열에 담김),
  `cleanupScratchWorkspace(runId: string): void`. 둘 다 export.

- [ ] **Step 1: 임시 검증 스크립트 작성**

`app/server/src/agent-runtime/_verify.task3.ts` 생성:

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createScratchWorkspaceTools, cleanupScratchWorkspace } from "./scratchTools.js";

const runId = `test-${Date.now()}`;
const [writeTool, readTool, listTool] = createScratchWorkspaceTools(runId);

const emptyList = listTool.execute();
assert.equal(emptyList.content, "아직 저장된 파일이 없다.");

const writeResult = writeTool.execute({ name: "draft.md", content: "초안 내용" });
assert.ok(writeResult.content.includes("draft.md"));
const readResult = readTool.execute({ name: "draft.md" });
assert.equal(readResult.content, "초안 내용");

const listResult = listTool.execute();
assert.equal(listResult.content, "draft.md");

const missingResult = readTool.execute({ name: "nope.md" });
assert.ok(missingResult.content.includes("파일이 없다"));

assert.throws(() => writeTool.execute({ name: "../escape.txt", content: "x" }));
assert.throws(() => writeTool.execute({ name: "a/b.txt", content: "x" }));
assert.throws(() => readTool.execute({ name: ".." }));

const expectedPath = path.join(os.tmpdir(), "questops-agent-scratch", runId, "draft.md");
assert.ok(fs.existsSync(expectedPath), "실제로 os.tmpdir() 아래에 파일이 생성돼야 한다");

cleanupScratchWorkspace(runId);
assert.ok(!fs.existsSync(path.join(os.tmpdir(), "questops-agent-scratch", runId)), "정리 후 디렉토리가 삭제돼야 한다");

console.log("task3 OK");
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx src/agent-runtime/_verify.task3.ts`
Expected: `scratchTools.ts`가 아직 없어 모듈을 찾지 못해 실패.

- [ ] **Step 3: `scratchTools.ts` 구현**

`app/server/src/agent-runtime/scratchTools.ts` 생성:

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

// 모델이 제출 전에 초안/메모를 쓰고 다시 읽으며 다듬을 수 있는 실행 전용 스크래치
// 공간. loop.ts의 truncateForHistory가 assistant 텍스트를 2000자로 자르는 것과 달리,
// 파일로 저장한 초안은 잘리지 않고 그대로 다시 읽을 수 있다.
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

- [ ] **Step 4: 통과 확인**

Run: `npx tsx src/agent-runtime/_verify.task3.ts`
Expected: `task3 OK` 출력.

- [ ] **Step 5: 타입 체크**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: 에러 없음.

- [ ] **Step 6: 임시 스크립트 삭제**

Run: `rm src/agent-runtime/_verify.task3.ts`

- [ ] **Step 7: 커밋**

```bash
git add server/src/agent-runtime/scratchTools.ts
git commit -m "feat(agent-runtime): 실행별 스크래치 워크스페이스 tool(write/read/list_scratch_file) 추가"
```

---

### Task 4: `projectDocumentTools.ts` — 같은 프로젝트의 다른 문서 접근

**Files:**
- Create: `app/server/src/agent-runtime/projectDocumentTools.ts`
- Test(임시): `app/server/src/agent-runtime/_verify.task4.ts`

**Interfaces:**
- Consumes: `readTextChunk`(Task 1, `tools.ts`), `db`(`../db.js`, 기존).
- Produces: `createProjectDocumentTools(projectId: string): AgentTool[]`(2개 tool:
  `list_project_documents`, `read_project_document_chunk`, 이 순서로 배열에 담김). export.

- [ ] **Step 1: 임시 검증 스크립트 작성**

`app/server/src/agent-runtime/_verify.task4.ts` 생성:

```ts
import assert from "node:assert/strict";
import { nanoid } from "nanoid";
import { db } from "../db.js";
import { createProjectDocumentTools } from "./projectDocumentTools.js";

const projectId = nanoid(12);
const otherProjectId = nanoid(12);
const now = new Date().toISOString();

db.prepare(
  `INSERT INTO projects (id, name, client, current_quest, created_at, updated_at) VALUES (?, ?, ?, 'docs', ?, ?)`
).run(projectId, "테스트 프로젝트", "테스트 고객사", now, now);
db.prepare(
  `INSERT INTO projects (id, name, client, current_quest, created_at, updated_at) VALUES (?, ?, ?, 'docs', ?, ?)`
).run(otherProjectId, "다른 프로젝트", "다른 고객사", now, now);

const docId = nanoid(12);
db.prepare(
  `INSERT INTO documents (id, project_id, filename, file_type, extracted_text, status, uploaded_at) VALUES (?, ?, ?, ?, ?, 'analyzed', ?)`
).run(docId, projectId, "제안서.pdf", "pdf", "이것은 테스트 문서 원문입니다. ".repeat(500), now);

const otherDocId = nanoid(12);
db.prepare(
  `INSERT INTO documents (id, project_id, filename, file_type, extracted_text, status, uploaded_at) VALUES (?, ?, ?, ?, ?, 'analyzed', ?)`
).run(otherDocId, otherProjectId, "다른문서.pdf", "pdf", "다른 프로젝트 문서", now);

const [listTool, readTool] = createProjectDocumentTools(projectId);

const listResult = listTool.execute();
assert.ok(listResult.content.includes(docId));
assert.ok(listResult.content.includes("제안서.pdf"));
assert.ok(!listResult.content.includes(otherDocId), "다른 프로젝트 문서가 섞이면 안 된다");

const readResult = readTool.execute({ documentId: docId, offset: 0 });
assert.ok(readResult.content.includes("이것은 테스트 문서 원문입니다"));

const crossProjectRead = readTool.execute({ documentId: otherDocId });
assert.ok(crossProjectRead.content.includes("찾을 수 없다"), "다른 프로젝트 문서는 project_id 조건에 걸려 조회되면 안 된다");

console.log("task4 OK");
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx src/agent-runtime/_verify.task4.ts`
Expected: `projectDocumentTools.ts`가 아직 없어 모듈을 찾지 못해 실패.

- [ ] **Step 3: `projectDocumentTools.ts` 구현**

`app/server/src/agent-runtime/projectDocumentTools.ts` 생성:

```ts
import { db } from "../db.js";
import { readTextChunk } from "./tools.js";
import type { AgentTool } from "./types.js";

// 처음 프롬프트에 넣어주지 않은, 같은 프로젝트의 다른 문서를 모델이 필요할 때 스스로
// 조회하게 한다. 경로가 아니라 project_id로 스코프한 DB 조회만 쓰므로 임의 경로
// 접근 위험이 구조적으로 없다.
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

- [ ] **Step 4: 통과 확인**

Run: `npx tsx src/agent-runtime/_verify.task4.ts`
Expected: `task4 OK` 출력.

- [ ] **Step 5: 타입 체크**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: 에러 없음.

- [ ] **Step 6: 임시 스크립트 삭제**

Run: `rm src/agent-runtime/_verify.task4.ts`

- [ ] **Step 7: 커밋**

```bash
git add server/src/agent-runtime/projectDocumentTools.ts
git commit -m "feat(agent-runtime): 프로젝트 범위 문서 목록/청크 조회 tool 추가"
```

---

### Task 5: `documentAnalysis.ts` 통합

**Files:**
- Modify: `app/server/src/services/documentAnalysis.ts`
- Modify: `app/server/src/routes/documents.ts`

**Interfaces:**
- Consumes: `createPlanTool`(Task 1), `createScratchWorkspaceTools`/`cleanupScratchWorkspace`
  (Task 3), `createProjectDocumentTools`(Task 4).
- Produces: `analyzeDocument(filename: string, text: string, projectId: string):
  Promise<DocumentAnalysis>` — 시그니처에 `projectId` 추가(기존 호출부는 이 태스크에서 같이
  수정하므로 하위 호환을 신경 쓸 필요 없음, 유일한 호출부가 `routes/documents.ts`임을 확인함).

이 태스크는 실제 LLM 호출 경로를 바꾸는 서비스 통합이라 자동 검증이 없다(Phase 1의 서비스
통합 태스크들과 동일한 이유 — 모킹 프레임워크를 두지 않기로 했으므로). `tsc` 통과 + 아래
수동 스모크 테스트로 확인한다.

- [ ] **Step 1: `documentAnalysis.ts` import 블록 수정**

파일 최상단의:

```ts
import { z } from "zod";
import { completeJSON, llmAvailable, NoLLMError } from "../llm/provider.js";
import { toolCallingAvailable } from "../llm/toolCalling.js";
import { runAgentLoop } from "../agent-runtime/loop.js";
import { createSubmitTool, createReadTextChunkTool } from "../agent-runtime/tools.js";
import { saveAgentRunLog } from "../agent-runtime/log.js";
import { logDebug, logError } from "../logger.js";
import type { DocumentAnalysis } from "../types.js";
import { splitSentences, matchLines } from "./textUtils.js";
```

을:

```ts
import { z } from "zod";
import { nanoid } from "nanoid";
import { completeJSON, llmAvailable, NoLLMError } from "../llm/provider.js";
import { toolCallingAvailable } from "../llm/toolCalling.js";
import { runAgentLoop } from "../agent-runtime/loop.js";
import { createSubmitTool, createReadTextChunkTool, createPlanTool } from "../agent-runtime/tools.js";
import { createScratchWorkspaceTools, cleanupScratchWorkspace } from "../agent-runtime/scratchTools.js";
import { createProjectDocumentTools } from "../agent-runtime/projectDocumentTools.js";
import { saveAgentRunLog } from "../agent-runtime/log.js";
import { logDebug, logError } from "../logger.js";
import type { DocumentAnalysis } from "../types.js";
import { splitSentences, matchLines } from "./textUtils.js";
```

로 교체.

- [ ] **Step 2: `analyzeDocumentAgentic` 함수 수정**

현재 함수 전체(`async function analyzeDocumentAgentic(filename: string, text: string):
Promise<DocumentAnalysis> { ... }`)를 다음으로 교체:

```ts
async function analyzeDocumentAgentic(filename: string, text: string, projectId: string): Promise<DocumentAnalysis> {
  const preview = text.slice(0, 2000);
  const readChunkTool = createReadTextChunkTool("read_document_chunk", "문서 원문을 청크 단위로 읽는다.", text);
  const submitTool = createSubmitTool(DocumentAnalysisSchema, "문서 분석 결과를 제출한다.");
  const planTool = createPlanTool();
  const runId = nanoid(12);
  const scratchTools = createScratchWorkspaceTools(runId);
  const projectDocTools = createProjectDocumentTools(projectId);

  try {
    const result = await runAgentLoop({
      runLabel: "documentAnalysis",
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: `문서 파일명: ${filename}
문서 총 길이: ${text.length}자

--- 문서 미리보기 (앞부분) ---
${preview}
--- 미리보기 끝 ---

미리보기만으로 분석이 충분하지 않으면 read_document_chunk 툴로 필요한 구간을 더 읽어라.
같은 프로젝트에 참고할 만한 다른 문서가 있으면 list_project_documents/read_project_document_chunk로 확인할 수 있다.
분석이 끝나면 submit_result 툴을 호출해 다음 필드를 제출하라: businessContext, keyUsers, process, systems, businessRules, decisionPoints, exceptions, painPoints, aiOpportunities, unknowns.
각 배열 항목은 문서 내용에 근거한 구체적 문장으로 작성하고 일반론은 금지한다.`,
      tools: [planTool, readChunkTool, ...scratchTools, ...projectDocTools, submitTool],
      maxTurns: 8,
      maxTokensPerTurn: 4096
    });

    saveAgentRunLog(result);

    if (result.status === "submitted" && result.submission) {
      return result.submission as DocumentAnalysis;
    }
    throw new Error(`문서 분석 에이전트가 최종 결과를 제출하지 못했습니다 (status=${result.status}). ${result.error ?? ""}`.trim());
  } finally {
    cleanupScratchWorkspace(runId);
  }
}
```

(변경점: 파라미터에 `projectId` 추가, `planTool`/`scratchTools`/`projectDocTools` 생성 및
`tools` 배열에 추가, 유저 프롬프트에 프로젝트 문서 조회 안내 한 줄 추가, `maxTurns: 6` →
`8`, 전체를 `try/finally`로 감싸 `cleanupScratchWorkspace` 호출. userPrompt 템플릿의 나머지
내용은 원본과 동일.)

- [ ] **Step 3: `analyzeDocument` 함수 수정**

`export async function analyzeDocument(filename: string, text: string): Promise<DocumentAnalysis> {`
를 `export async function analyzeDocument(filename: string, text: string, projectId: string): Promise<DocumentAnalysis> {`로 교체.

같은 함수 안의:

```ts
        const result = await analyzeDocumentAgentic(filename, text);
```

를:

```ts
        const result = await analyzeDocumentAgentic(filename, text, projectId);
```

로 교체.

- [ ] **Step 4: `routes/documents.ts` 호출부 수정**

`server/src/routes/documents.ts`의 `runAnalysis` 함수 안:

```ts
    const result = await analyzeDocument(row.filename, row.extracted_text || "");
```

를:

```ts
    const result = await analyzeDocument(row.filename, row.extracted_text || "", row.project_id);
```

로 교체.

- [ ] **Step 5: 타입 체크**

Run (in `app/server`): `npx tsc -p tsconfig.json --noEmit`
Expected: 에러 없음.

- [ ] **Step 6: 수동 스모크 테스트 (실제 LLM 자격 증명 필요)**

실제 LLM 자격 증명이 설정된 환경에서:
1. `npm run dev` 기동, `npm run logs:agent`로 로그 tail.
2. 프로젝트를 하나 만들고 문서를 업로드해 분석을 트리거한다(웹 UI 또는 해당 API 라우트).
3. 로그에서 1턴째에 `update_plan` tool 호출이 나타나는지, 이후 턴에서 필요 시
   `write_scratch_file`/`read_scratch_file`/`list_project_documents`/
   `read_project_document_chunk` 호출이 (모델이 필요하다고 판단하면) 나타나는지 확인한다.
4. 최종적으로 `submitted` status로 끝나는지, 분석 결과가 이전과 비슷한 형태로 채워지는지
   확인한다(회귀 확인).

- [ ] **Step 7: 커밋**

```bash
git add server/src/services/documentAnalysis.ts server/src/routes/documents.ts
git commit -m "feat(documentAnalysis): planning/scratch/project-document tool 통합, maxTurns 8로 상향"
```

---

### Task 6: `pptGeneration.ts` 통합

**Files:**
- Modify: `app/server/src/services/pptGeneration.ts`
- Modify: `app/server/src/routes/presentation.ts`

**Interfaces:**
- Consumes: `createPlanTool`(Task 1), `createScratchWorkspaceTools`/`cleanupScratchWorkspace`
  (Task 3), `createProjectDocumentTools`(Task 4).
- Produces: `PptInput`에 `projectId: string` 필드 추가(기존 호출부는 이 태스크에서 같이
  수정, 유일한 호출부가 `routes/presentation.ts`임을 확인함).

Task 5와 마찬가지로 자동 검증이 없다. `tsc` 통과 + 수동 스모크 테스트로 확인한다.

- [ ] **Step 1: `pptGeneration.ts` import 블록과 `PptInput` 수정**

파일 최상단의:

```ts
import { z } from "zod";
import { completeJSON, llmAvailable, NoLLMError } from "../llm/provider.js";
import { toolCallingAvailable } from "../llm/toolCalling.js";
import { runAgentLoop } from "../agent-runtime/loop.js";
import { createSubmitTool } from "../agent-runtime/tools.js";
import { saveAgentRunLog } from "../agent-runtime/log.js";
import type { AgentConcept, DemoScreen, DemoScenario, DocumentAnalysis, PresentationSlide } from "../types.js";
import { logError } from "../logger.js";

export interface PptInput {
  projectName: string;
  client: string;
  description: string;
  analyses: DocumentAnalysis[];
  tacitKnowledge: { type: string; description: string }[];
  agent?: AgentConcept;
  screens?: DemoScreen[];
  scenario?: DemoScenario;
}
```

을:

```ts
import { z } from "zod";
import { nanoid } from "nanoid";
import { completeJSON, llmAvailable, NoLLMError } from "../llm/provider.js";
import { toolCallingAvailable } from "../llm/toolCalling.js";
import { runAgentLoop } from "../agent-runtime/loop.js";
import { createSubmitTool, createPlanTool } from "../agent-runtime/tools.js";
import { createScratchWorkspaceTools, cleanupScratchWorkspace } from "../agent-runtime/scratchTools.js";
import { createProjectDocumentTools } from "../agent-runtime/projectDocumentTools.js";
import { saveAgentRunLog } from "../agent-runtime/log.js";
import type { AgentConcept, DemoScreen, DemoScenario, DocumentAnalysis, PresentationSlide } from "../types.js";
import { logError } from "../logger.js";

export interface PptInput {
  projectId: string;
  projectName: string;
  client: string;
  description: string;
  analyses: DocumentAnalysis[];
  tacitKnowledge: { type: string; description: string }[];
  agent?: AgentConcept;
  screens?: DemoScreen[];
  scenario?: DemoScenario;
}
```

로 교체.

- [ ] **Step 2: `generateSlidePlanAgentic` 함수 수정**

현재 함수 전체를:

```ts
async function generateSlidePlanAgentic(input: PptInput): Promise<PresentationSlide[]> {
  const submitTool = createSubmitTool(SlidePlanSchema, "발표자료 슬라이드 구성안을 제출한다.");

  const result = await runAgentLoop({
    runLabel: "pptGeneration",
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(input),
    tools: [submitTool],
    maxTurns: 4,
    maxTokensPerTurn: 8000
  });

  saveAgentRunLog(result);

  if (result.status === "submitted" && result.submission) {
    return renumber((result.submission as { slides: PresentationSlide[] }).slides);
  }
  throw new Error(`PPT 생성 에이전트가 결과를 제출하지 못했습니다 (status=${result.status}). ${result.error ?? ""}`.trim());
}
```

로 다음으로 교체:

```ts
async function generateSlidePlanAgentic(input: PptInput): Promise<PresentationSlide[]> {
  const submitTool = createSubmitTool(SlidePlanSchema, "발표자료 슬라이드 구성안을 제출한다.");
  const planTool = createPlanTool();
  const runId = nanoid(12);
  const scratchTools = createScratchWorkspaceTools(runId);
  const projectDocTools = createProjectDocumentTools(input.projectId);

  try {
    const result = await runAgentLoop({
      runLabel: "pptGeneration",
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: `${buildUserPrompt(input)}\n\n필요하면 list_project_documents/read_project_document_chunk로 이 프로젝트의 다른 문서를 참고할 수 있다.`,
      tools: [planTool, ...scratchTools, ...projectDocTools, submitTool],
      maxTurns: 6,
      maxTokensPerTurn: 8000
    });

    saveAgentRunLog(result);

    if (result.status === "submitted" && result.submission) {
      return renumber((result.submission as { slides: PresentationSlide[] }).slides);
    }
    throw new Error(`PPT 생성 에이전트가 결과를 제출하지 못했습니다 (status=${result.status}). ${result.error ?? ""}`.trim());
  } finally {
    cleanupScratchWorkspace(runId);
  }
}
```

- [ ] **Step 3: `routes/presentation.ts` 호출부 수정**

`server/src/routes/presentation.ts`의 다음 블록(현재 70~79번째 줄)을:

```ts
    const { result: slides } = await generatePresentationSlides({
      projectName: project.name,
      client: project.client,
      description: project.description || "",
      analyses,
      tacitKnowledge: tacitRows,
      agent,
      screens,
      scenario
    });
```

다음으로 교체(`projectName: project.name,` 바로 위에 `projectId,` 한 줄만 추가, 나머지
필드는 전부 그대로):

```ts
    const { result: slides } = await generatePresentationSlides({
      projectId,
      projectName: project.name,
      client: project.client,
      description: project.description || "",
      analyses,
      tacitKnowledge: tacitRows,
      agent,
      screens,
      scenario
    });
```

(32번째 줄에서 이미 선언된 지역 변수 `projectId`를 그대로 넘긴다.)

- [ ] **Step 4: 타입 체크**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: 에러 없음.

- [ ] **Step 5: 수동 스모크 테스트 (실제 LLM 자격 증명 필요)**

실제 LLM 자격 증명이 설정된 환경에서:
1. `npm run dev` 기동, `npm run logs:agent`로 로그 tail.
2. 분석이 끝난 문서가 있는 프로젝트에서 발표자료 생성을 트리거한다.
3. 로그에서 1턴째 `update_plan` 강제 호출과, 필요 시 스크래치/프로젝트 문서 tool 호출이
   나타나는지 확인한다.
4. 최종적으로 6~12장 사이의 슬라이드가 `submitted`로 제출되는지 확인한다(회귀 확인 —
   `SlidePlanSchema`는 `min(6).max(12)`).

- [ ] **Step 6: 커밋**

```bash
git add server/src/services/pptGeneration.ts server/src/routes/presentation.ts
git commit -m "feat(pptGeneration): planning/scratch/project-document tool 통합, maxTurns 6으로 상향"
```

---

## Self-Review 결과

- **스펙 커버리지**: 스펙의 1(Planning)=Task1+Task2, 2(스크래치 워크스페이스)=Task3,
  3(프로젝트 문서 접근)=Task4, 4(서비스 통합)=Task5+Task6 전부 태스크로 매핑됨. 인터페이스
  변경 요약 표의 8개 파일 전부 태스크에 등장함.
- **플레이스홀더 스캔**: "TBD"/"나중에"/"적절히 처리" 류 문구 없음. Pre-flight 스캔에서 Task 6
  Step 3이 원래 `// ...` 생략 표기를 쓰고 있던 걸 발견해, 전체 블록을 완전한 before/after
  코드로 교체함(아래 pre-flight 스캔 표 참고).
- **타입 일관성**: `PLAN_TOOL_NAME`/`SUBMIT_TOOL_NAME`(Task1) → `loop.ts`의
  `computePlanForceTool`/`tryRescueTurn`(Task2)까지 동일한 이름으로 import·사용 확인.
  `createScratchWorkspaceTools`/`cleanupScratchWorkspace`(Task3) → Task5/Task6에서 동일한
  이름으로 import. `createProjectDocumentTools`(Task4) → Task5/Task6에서 동일한 시그니처로
  호출(`projectId: string` 하나). `PptInput.projectId`(Task6) → `routes/presentation.ts` 호출부
  까지 필드명 일치 확인.

---

## Execution Handoff

Plan complete and saved to `app/docs/superpowers/plans/2026-08-21-agent-runtime-planning-filesystem.md`.

이전 Phase 1과 동일하게 Subagent-Driven Development로 진행합니다(사용자가 이미 이 방식을
선택했고, 이번 계획도 태스크가 순차 의존적이라 같은 세션에서 진행하는 편이 낫습니다).
