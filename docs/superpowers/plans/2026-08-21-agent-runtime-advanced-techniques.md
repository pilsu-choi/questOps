# Agent-Runtime 고도화 (재시도/자기교정, 서브에이전트 fan-out, 컨텍스트 안전장치) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** QuestOps의 공용 `agent-runtime` 모듈(6개 구조화 출력 생성 서비스가 공유)에 전송 오류
재시도, 검증 실패 예산 분리, 구제 턴, 정적 서브에이전트 fan-out 프리미티브, 컨텍스트 안전장치를
추가한다.

**Architecture:** `llm/toolCalling.ts`에 순수 함수(`isRetryableStatus`, `computeBackoffMs`,
`fetchWithRetry`, `buildToolChoice`)로 재시도/강제 tool 선택 로직을 추가하고, `agent-runtime/loop.ts`
는 이를 소비해 검증 실패 카운터·구제 턴·컨텍스트 축소(`shrinkOldestToolMessages`)를 턴 루프에
엮는다. 새 `agent-runtime/fanOut.ts`는 `runAgentLoop`를 그대로 재사용하는 얇은 동시성 스케줄러
(`runWithConcurrency`)다. 기존 6개 서비스 파일은 이 계획에서 수정하지 않는다 — 공용 모듈 변경만으로
자동으로 혜택을 받는다.

**Tech Stack:** TypeScript(ES2022, ESNext 모듈), Node.js, zod, tsx(임시 검증 스크립트 실행용).
테스트 프레임워크는 도입하지 않는다(기존 컨벤션 유지).

**Spec:** `app/docs/superpowers/specs/2026-08-21-agent-runtime-advanced-techniques-design.md`

## Global Constraints

- 새 테스트 프레임워크(vitest 등)를 도입하지 않는다 — 검증은 `tsc --noEmit` + 태스크마다
  작성했다가 통과 확인 후 삭제하는 임시 scratchpad 스크립트(`tsx`로 실행) + 일부 태스크는
  추가로 수동 dev-server 스모크 테스트로 한다.
- 6개 기존 서비스 파일(`services/agentDemoGeneration.ts`, `interviewGeneration.ts`,
  `interviewAnswerMapping.ts`, `pptGeneration.ts`, `tacitExtraction.ts`, `documentAnalysis.ts`)은
  이번 계획에서 수정하지 않는다.
- 모델이 스스로 동적으로 서브에이전트를 스폰하는 tool은 추가하지 않는다. fan-out은 항상
  호출부(서비스 코드, 이번 계획 밖)가 정적으로 선언한다.
- 요약 기반 컨텍스트 컴팩션(별도 LLM 호출로 대화를 재작성)은 추가하지 않는다.
- 새 코드의 주석은 기존 컨벤션대로 한국어로, "무엇"이 아니라 "왜"만 남긴다.
- import 경로는 기존 파일 전부가 따르는 상대 경로 `.js` 확장자 컨벤션(NodeNext/ESM 스타일,
  `moduleResolution: "Bundler"`라 필수는 아니지만 일관성 유지)을 따른다.
- `AgentRunStatus`에 값을 추가하는 것(`"validation_exhausted"`)은 하위 호환이다 — 6개 서비스는
  전부 `status === "submitted"`만 분기하고 나머지는 공용 실패 경로로 처리한다
  (`services/agentDemoGeneration.ts:257` 확인됨).

---

## File Structure

| 파일 | 상태 | 책임 |
|---|---|---|
| `app/server/src/agent-runtime/types.ts` | 수정 | `AgentToolResult.isValidationError`, `AgentRunStatus`에 `"validation_exhausted"` 추가 |
| `app/server/src/agent-runtime/tools.ts` | 수정 | `createSubmitTool`이 검증 실패 시 `isValidationError: true` 반환 |
| `app/server/src/llm/toolCalling.ts` | 수정 | 전송 오류 재시도(`fetchWithRetry`, `isRetryableStatus`, `computeBackoffMs`), 강제 tool 선택(`buildToolChoice`, `forceTool` 파라미터) |
| `app/server/src/agent-runtime/loop.ts` | 수정 | 컨텍스트 축소(`shrinkOldestToolMessages`), 검증 실패 예산, 구제 턴(`tryRescueTurn`) |
| `app/server/src/agent-runtime/fanOut.ts` | 신규 | `runWithConcurrency`(순수 스케줄러), `runFanOutAgents`, `FanOutTask`/`FanOutOptions` |

---

### Task 1: submit_result 검증 실패를 구조화된 플래그로 표시

**Files:**
- Modify: `app/server/src/agent-runtime/types.ts`
- Modify: `app/server/src/agent-runtime/tools.ts`
- Test(임시, 완료 후 삭제): `app/server/src/agent-runtime/_verify.task1.ts`

**Interfaces:**
- Produces: `AgentToolResult.isValidationError?: boolean` — `createSubmitTool`이 스키마 검증
  실패 시 `true`로 설정. `AgentRunStatus`에 `"validation_exhausted"` 값 추가(이 태스크에서는
  타입만 추가, 실제 사용은 Task 5).

- [ ] **Step 1: 임시 검증 스크립트 작성 (아직 실패해야 정상)**

`app/server/src/agent-runtime/_verify.task1.ts` 생성:

```ts
import assert from "node:assert/strict";
import { z } from "zod";
import { createSubmitTool } from "./tools.js";

const schema = z.object({ title: z.string(), count: z.number() });
const tool = createSubmitTool(schema, "테스트용");

const bad = tool.execute({ title: "x" }); // count 누락 -> 검증 실패해야 함
assert.equal(bad.isValidationError, true, "스키마 실패 시 isValidationError가 true여야 한다");
assert.equal(bad.terminate, undefined, "실패 시 terminate는 설정되면 안 된다");

const good = tool.execute({ title: "x", count: 1 });
assert.equal(good.isValidationError, undefined, "성공 시 isValidationError는 없어야 한다");
assert.equal(good.terminate, true, "성공 시 terminate가 true여야 한다");
assert.deepEqual(good.details, { title: "x", count: 1 });

console.log("task1 OK");
```

- [ ] **Step 2: 실패 확인**

Run (in `app/server`): `npx tsx src/agent-runtime/_verify.task1.ts`
Expected: `AssertionError`가 `bad.isValidationError`에서 발생 (현재 `tools.ts`가 이 필드를
설정하지 않으므로 `undefined !== true`).

- [ ] **Step 3: `types.ts`에 필드 추가**

`app/server/src/agent-runtime/types.ts`의 `AgentToolResult` 인터페이스를 수정:

```ts
export interface AgentToolResult {
  /** 모델에게 tool 결과로 되돌려줄 텍스트. */
  content: string;
  /** 종료 시점에만 의미 있는, 검증을 통과한 실제 산출물 (로그/리턴용). */
  details?: unknown;
  /** true면 이 tool 호출을 마지막으로 루프를 종료한다. */
  terminate?: boolean;
  /** true면 이 결과가 submit_result 스키마 검증 실패로 인한 것임을 표시한다.
   *  loop.ts가 문자열 매칭 없이 검증 실패를 감지해 별도 예산(연속 횟수)으로 추적하는 데 쓴다. */
  isValidationError?: boolean;
}
```

같은 파일의 `AgentRunStatus`를 수정:

```ts
export type AgentRunStatus = "submitted" | "exhausted" | "error" | "validation_exhausted";
```

- [ ] **Step 4: `tools.ts`의 `createSubmitTool`이 플래그를 설정하도록 수정**

`app/server/src/agent-runtime/tools.ts`의 `execute` 함수를:

```ts
    execute(args: unknown) {
      const parsed = schema.safeParse(args);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
        return { content: `검증 실패 - ${issues}\n스키마에 맞춰 submit_result를 다시 호출하라.`, isValidationError: true };
      }
      return { content: "제출이 접수되었습니다.", details: parsed.data, terminate: true };
    }
```

(기존 `content: \`검증 실패 - ...\`` 한 줄짜리 return에 `isValidationError: true`만 추가)

- [ ] **Step 5: 통과 확인**

Run: `npx tsx src/agent-runtime/_verify.task1.ts`
Expected: `task1 OK` 출력, 에러 없음.

- [ ] **Step 6: 타입 체크**

Run (in `app/server`): `npx tsc -p tsconfig.json --noEmit`
Expected: 에러 없음.

- [ ] **Step 7: 임시 스크립트 삭제**

Run: `rm src/agent-runtime/_verify.task1.ts`

- [ ] **Step 8: 커밋**

```bash
git add server/src/agent-runtime/types.ts server/src/agent-runtime/tools.ts
git commit -m "feat(agent-runtime): submit_result 검증 실패를 isValidationError 플래그로 표시"
```

---

### Task 2: LLM 전송 오류 재시도(백오프)

**Files:**
- Modify: `app/server/src/llm/toolCalling.ts`
- Test(임시): `app/server/src/llm/_verify.task2.ts`

**Interfaces:**
- Consumes: 없음 (이 태스크는 독립적)
- Produces: `isRetryableStatus(status: number): boolean`, `computeBackoffMs(attempt: number): number`,
  `fetchWithRetry(doFetch: () => Promise<Response>): Promise<{ res?: Response; errorMessage?: string }>`
  — 전부 `toolCalling.ts`에서 export. `stepWithTools`가 내부적으로 `fetchWithRetry`를 사용하도록
  재작성(시그니처는 이번 태스크에서 변경 없음).

- [ ] **Step 1: 임시 검증 스크립트 작성**

`app/server/src/llm/_verify.task2.ts` 생성:

```ts
import assert from "node:assert/strict";
import { fetchWithRetry, isRetryableStatus, computeBackoffMs } from "./toolCalling.js";

assert.equal(isRetryableStatus(429), true);
assert.equal(isRetryableStatus(500), true);
assert.equal(isRetryableStatus(502), true);
assert.equal(isRetryableStatus(503), true);
assert.equal(isRetryableStatus(504), true);
assert.equal(isRetryableStatus(400), false);
assert.equal(isRetryableStatus(401), false);
assert.equal(isRetryableStatus(200), false);

const b0 = computeBackoffMs(0);
assert.ok(b0 >= 500 && b0 < 750, `backoff(0)은 [500,750) 범위여야 하는데 ${b0}`);
const b1 = computeBackoffMs(1);
assert.ok(b1 >= 1000 && b1 < 1250, `backoff(1)은 [1000,1250) 범위여야 하는데 ${b1}`);

// case 1: 첫 시도 429, 두번째 시도 200 -> 재시도해서 성공
let calls = 0;
const okRes = { ok: true, status: 200 } as unknown as Response;
const rateLimited = { ok: false, status: 429, text: async () => "rate limited" } as unknown as Response;
const r1 = await fetchWithRetry(async () => {
  calls++;
  return calls === 1 ? rateLimited : okRes;
});
assert.equal(calls, 2, "429 이후 재시도해서 2번 호출돼야 한다");
assert.equal(r1.res, okRes);
assert.equal(r1.errorMessage, undefined);

// case 2: 400은 재시도 대상이 아니라 즉시 반환
calls = 0;
const badRequest = { ok: false, status: 400, text: async () => "bad request" } as unknown as Response;
const r2 = await fetchWithRetry(async () => {
  calls++;
  return badRequest;
});
assert.equal(calls, 1, "400은 재시도하지 않고 1번만 호출돼야 한다");
assert.equal(r2.res, badRequest);

// case 3: 계속 429면 최대 3회 시도 후 마지막 응답을 그대로 반환
calls = 0;
const r3 = await fetchWithRetry(async () => {
  calls++;
  return rateLimited;
});
assert.equal(calls, 3, "3회 시도 후 포기해야 한다");
assert.equal(r3.res, rateLimited);

// case 4: fetch 자체가 throw(타임아웃 등)해도 재시도하고, 끝까지 실패하면 errorMessage 반환
calls = 0;
const r4 = await fetchWithRetry(async () => {
  calls++;
  throw new Error("network down");
});
assert.equal(calls, 3);
assert.equal(r4.res, undefined);
assert.equal(r4.errorMessage, "network down");

console.log("task2 OK");
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx src/llm/_verify.task2.ts`
Expected: `isRetryableStatus`/`computeBackoffMs`/`fetchWithRetry`가 아직 export되지 않아
import 단계에서 실패하거나(undefined 호출 오류) 타입 오류로 실행이 안 된다.

- [ ] **Step 3: `toolCalling.ts`에 재시도 로직 추가**

`app/server/src/llm/toolCalling.ts`에 `toOpenAiMessages` 함수 뒤, `stepWithTools` 앞에 추가:

```ts
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

const RETRYABLE_BACKOFF_BASE_MS = 500;
const RETRYABLE_BACKOFF_JITTER_MS = 250;
const MAX_FETCH_ATTEMPTS = 3;

export function computeBackoffMs(attempt: number): number {
  return RETRYABLE_BACKOFF_BASE_MS * 2 ** attempt + Math.floor(Math.random() * RETRYABLE_BACKOFF_JITTER_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 429(rate limit)나 5xx(provider 일시 장애) 하나로 3~6턴짜리 실행 전체가 죽지 않도록,
// 재시도 가능한 실패만 지수 백오프로 재시도한다. 400 등 클라이언트 오류는 재시도해도
// 같은 응답이 반복될 뿐이라 즉시 반환한다. doFetch를 인자로 받아 순수하게 테스트 가능하게 한다.
export async function fetchWithRetry(doFetch: () => Promise<Response>): Promise<{ res?: Response; errorMessage?: string }> {
  let lastErrorMessage = "";
  for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS; attempt++) {
    try {
      const res = await doFetch();
      if (res.ok || !isRetryableStatus(res.status) || attempt === MAX_FETCH_ATTEMPTS - 1) {
        return { res };
      }
    } catch (err) {
      lastErrorMessage = (err as Error).message;
      if (attempt === MAX_FETCH_ATTEMPTS - 1) return { errorMessage: lastErrorMessage };
    }
    await sleep(computeBackoffMs(attempt));
  }
  return { errorMessage: lastErrorMessage || "알 수 없는 오류" };
}
```

- [ ] **Step 4: `stepWithTools`가 `fetchWithRetry`를 사용하도록 재작성**

`app/server/src/llm/toolCalling.ts`의 `stepWithTools` 함수 전체(56번째 줄 근처, `export async
function stepWithTools`부터 파일 끝까지)를 다음으로 교체:

```ts
export async function stepWithTools(
  systemPrompt: string,
  messages: ToolCallMessage[],
  tools: AgentTool[],
  maxTokens: number
): Promise<ToolCallStepResult> {
  const cfg = resolveActiveConfig();
  if (!cfg) throw new NoLLMError();
  if (cfg.provider !== "openrouter") {
    throw new Error(`현재 provider(${cfg.provider})는 아직 tool-calling 에이전트 루프를 지원하지 않습니다.`);
  }

  const openAiMessages = toOpenAiMessages(systemPrompt, messages);
  const promptChars = JSON.stringify(openAiMessages).length;
  const start = Date.now();
  logDebug(
    `[llm][toolCalling] request model=${cfg.model} maxTokens=${maxTokens} messages=${openAiMessages.length} promptChars=${promptChars} tools=${tools.map((t) => t.name).join(",")}`
  );

  const { res, errorMessage } = await fetchWithRetry(() =>
    fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
        "HTTP-Referer": "https://questops.local",
        "X-Title": "QuestOps"
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: maxTokens,
        messages: openAiMessages,
        tools: toOpenAiTools(tools),
        tool_choice: "auto"
      })
    })
  );

  if (!res) {
    logDebug(`[llm][toolCalling] request failed after retries elapsedMs=${Date.now() - start}: ${errorMessage}`);
    return { toolCalls: [], stopReason: "error", errorMessage: `LLM 요청 실패: ${errorMessage}` };
  }

  if (!res.ok) {
    const errText = (await res.text()).slice(0, 500);
    logDebug(`[llm][toolCalling] error elapsedMs=${Date.now() - start} status=${res.status}`);
    return { toolCalls: [], stopReason: "error", errorMessage: `OpenRouter API 오류 (${res.status}): ${errText}` };
  }

  const data = (await res.json()) as any;
  const choice = data.choices?.[0];
  const msg = choice?.message;
  const toolCalls = (msg?.tool_calls ?? []).map((tc: any) => ({
    id: tc.id,
    name: tc.function?.name,
    arguments: tc.function?.arguments ?? "{}"
  }));

  const finishReason = choice?.finish_reason;
  const stopReason: ToolCallStepResult["stopReason"] = toolCalls.length > 0 ? "tool_calls" : finishReason === "length" ? "length" : "stop";

  logDebug(
    `[llm][toolCalling] response elapsedMs=${Date.now() - start} finishReason=${finishReason} toolCalls=${toolCalls.length} assistantTextChars=${(msg?.content ?? "").length}`
  );

  return { assistantText: msg?.content ?? undefined, toolCalls, stopReason };
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx tsx src/llm/_verify.task2.ts`
Expected: `task2 OK` 출력. (case 1과 case 3, 4는 각각 약 0.5~1.5초의 실제 `sleep`을 거치므로
스크립트 실행에 몇 초 걸리는 게 정상이다.)

- [ ] **Step 6: 타입 체크**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: 에러 없음.

- [ ] **Step 7: 임시 스크립트 삭제**

Run: `rm src/llm/_verify.task2.ts`

- [ ] **Step 8: 커밋**

```bash
git add server/src/llm/toolCalling.ts
git commit -m "feat(llm): tool-calling 요청에 재시도 가능한 전송 오류 백오프 재시도 추가"
```

---

### Task 3: 특정 tool 강제 호출(`forceTool`) 지원

**Files:**
- Modify: `app/server/src/llm/toolCalling.ts`
- Test(임시): `app/server/src/llm/_verify.task3.ts`

**Interfaces:**
- Consumes: Task 2에서 만든 `stepWithTools` 본문(같은 함수를 다시 수정).
- Produces: `buildToolChoice(forceTool?: string): "auto" | { type: "function"; function: { name: string } }`
  (export). `stepWithTools`에 5번째 파라미터 `forceTool?: string` 추가 — Task 6(구제 턴)이 이걸
  소비한다.

- [ ] **Step 1: 임시 검증 스크립트 작성**

`app/server/src/llm/_verify.task3.ts` 생성:

```ts
import assert from "node:assert/strict";
import { buildToolChoice } from "./toolCalling.js";

assert.deepEqual(buildToolChoice(), "auto");
assert.deepEqual(buildToolChoice(undefined), "auto");
assert.deepEqual(buildToolChoice("submit_result"), { type: "function", function: { name: "submit_result" } });

console.log("task3 OK");
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx src/llm/_verify.task3.ts`
Expected: `buildToolChoice`가 아직 없어 import/호출 단계에서 실패.

- [ ] **Step 3: `buildToolChoice` 추가 + `stepWithTools`에 `forceTool` 파라미터 연결**

`app/server/src/llm/toolCalling.ts`에 `isRetryableStatus` 근처(또는 그 위)에 추가:

```ts
export function buildToolChoice(forceTool?: string): "auto" | { type: "function"; function: { name: string } } {
  return forceTool ? { type: "function", function: { name: forceTool } } : "auto";
}
```

`stepWithTools`의 시그니처를 수정:

```ts
export async function stepWithTools(
  systemPrompt: string,
  messages: ToolCallMessage[],
  tools: AgentTool[],
  maxTokens: number,
  forceTool?: string
): Promise<ToolCallStepResult> {
```

그리고 요청 body 안의 `tool_choice: "auto"`를 `tool_choice: buildToolChoice(forceTool)`로 교체.

- [ ] **Step 4: 통과 확인**

Run: `npx tsx src/llm/_verify.task3.ts`
Expected: `task3 OK` 출력.

- [ ] **Step 5: 타입 체크**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: 에러 없음.

- [ ] **Step 6: 임시 스크립트 삭제**

Run: `rm src/llm/_verify.task3.ts`

- [ ] **Step 7: 커밋**

```bash
git add server/src/llm/toolCalling.ts
git commit -m "feat(llm): stepWithTools에 forceTool(강제 tool_choice) 파라미터 추가"
```

---

### Task 4: 컨텍스트 크기 안전장치 (`shrinkOldestToolMessages`)

**Files:**
- Modify: `app/server/src/agent-runtime/loop.ts`
- Test(임시): `app/server/src/agent-runtime/_verify.task4.ts`

**Interfaces:**
- Consumes: `ToolCallMessage` 타입 (`llm/toolCalling.ts`에서 이미 export됨, 변경 없음).
- Produces: `shrinkOldestToolMessages(messages: ToolCallMessage[], maxChars: number): ToolCallMessage[]`
  (export, `loop.ts`). `runAgentLoop`가 매 턴 시작 시 이 함수로 `messages`를 갱신한다.

- [ ] **Step 1: 임시 검증 스크립트 작성**

`app/server/src/agent-runtime/_verify.task4.ts` 생성:

```ts
import assert from "node:assert/strict";
import { shrinkOldestToolMessages } from "./loop.js";
import type { ToolCallMessage } from "../llm/toolCalling.js";

function msg(role: ToolCallMessage["role"], size: number, tag: string): ToolCallMessage {
  return { role, content: `${tag}:` + "x".repeat(size), toolCallId: role === "tool" ? tag : undefined };
}

// 임계값 밑이면 그대로 반환 (같은 참조일 필요는 없고 내용이 같으면 된다)
const small: ToolCallMessage[] = [msg("user", 10, "u1"), msg("tool", 10, "t1")];
const untouched = shrinkOldestToolMessages(small, 10_000);
assert.deepEqual(untouched, small);

// 임계값 초과 시 오래된 tool 결과부터 축소, 가장 최근 tool 결과는 원본 그대로 보존
const big: ToolCallMessage[] = [
  msg("user", 5, "u1"),
  msg("tool", 40_000, "t-old-1"),
  msg("assistant", 5, "a1"),
  msg("tool", 40_000, "t-old-2"),
  msg("assistant", 5, "a2"),
  msg("tool", 40_000, "t-latest")
];
const shrunk = shrinkOldestToolMessages(big, 50_000);
assert.ok(shrunk[1].content!.startsWith("[이전 tool 결과 생략됨"), "가장 오래된 tool 결과는 축소돼야 한다");
assert.ok(shrunk[3].content!.startsWith("[이전 tool 결과 생략됨"), "두번째로 오래된 tool 결과도 축소돼야 한다");
assert.ok(shrunk[5].content!.includes("t-latest"), "가장 최근 tool 결과는 원본 그대로 보존돼야 한다");
assert.equal(shrunk[0].content, big[0].content, "tool이 아닌 메시지는 건드리지 않는다");
assert.ok(JSON.stringify(shrunk).length <= 50_000, "축소 후에는 임계값 이하여야 한다");

console.log("task4 OK");
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx src/agent-runtime/_verify.task4.ts`
Expected: `shrinkOldestToolMessages`가 아직 없어 import/호출 단계에서 실패.

- [ ] **Step 3: `loop.ts`에 함수 추가 + `messages`를 `let`으로 변경**

`app/server/src/agent-runtime/loop.ts` 상단, 기존 `RUNAWAY_RESPONSE_CHARS` 상수 선언 바로
아래에 추가:

```ts
// 누적 히스토리가 비정상적으로 커지는 드문 경우(문서가 매우 크거나 모델이 청크를 반복
// 조회하는 경우)를 위한 하한선. 3~6턴짜리 유한 루프에서는 거의 트리거되지 않을 것으로 예상한다.
const MAX_HISTORY_CHARS = 120_000;

// 가장 오래된 tool 결과부터 짧은 placeholder로 축소해 누적 히스토리 크기를 임계값 아래로
// 내린다. 가장 최근 tool 결과는 모델이 방금 조회한 내용이라 절대 축소하지 않는다.
export function shrinkOldestToolMessages(messages: ToolCallMessage[], maxChars: number): ToolCallMessage[] {
  if (JSON.stringify(messages).length <= maxChars) return messages;

  const result = messages.map((m) => ({ ...m }));
  const toolIndexes = result.reduce<number[]>((acc, m, i) => {
    if (m.role === "tool" && m.content && m.content.length > 0) acc.push(i);
    return acc;
  }, []);

  for (let k = 0; k < toolIndexes.length - 1; k++) {
    if (JSON.stringify(result).length <= maxChars) break;
    const idx = toolIndexes[k];
    const original = result[idx].content ?? "";
    if (original.length <= 50) continue;
    result[idx] = { ...result[idx], content: `[이전 tool 결과 생략됨, ${original.length}자]` };
  }
  return result;
}
```

`runAgentLoop` 안, `const messages: ToolCallMessage[] = [{ role: "user", content: config.userPrompt }];`
줄을 `let messages: ToolCallMessage[] = [{ role: "user", content: config.userPrompt }];`로 변경
(`const` → `let`).

`for (let turn = 1; turn <= maxTurns; turn++) {` 바로 다음 줄에 추가:

```ts
    messages = shrinkOldestToolMessages(messages, MAX_HISTORY_CHARS);
```

(기존 `const turnStart = Date.now();` 줄 바로 위)

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
git add server/src/agent-runtime/loop.ts
git commit -m "feat(agent-runtime): 누적 히스토리 크기 안전장치(오래된 tool 결과 축소) 추가"
```

---

### Task 5: 검증 실패 예산 분리 (`validation_exhausted`)

**Files:**
- Modify: `app/server/src/agent-runtime/loop.ts`

**Interfaces:**
- Consumes: `AgentToolResult.isValidationError`(Task 1), `AgentRunStatus`의 `"validation_exhausted"`(Task 1).
- Produces: `runAgentLoop`가 연속 검증 실패 시 `status: "validation_exhausted"`로 조기 종료.
  (다음 태스크에서 이 종료 경로에 구제 턴을 연결한다.)

이 태스크는 `runAgentLoop`의 턴 루프 제어 흐름을 수정하는 부분이라 순수 함수로 분리하기
어렵다. `tsc` 타입 체크와, 실제 LLM 자격 증명이 있는 환경에서의 수동 스모크 테스트로
검증한다(아래 Step 4).

- [ ] **Step 1: `loop.ts` 상단에 상수 추가**

`MAX_CONSECUTIVE_NO_TOOL_CALL_TURNS` 선언 바로 아래에 추가:

```ts
const MAX_CONSECUTIVE_VALIDATION_FAILURES = 3;
```

- [ ] **Step 2: `runAgentLoop` 안에 카운터 선언 추가**

`let consecutiveNoToolCallTurns = 0;` 바로 아래에 추가:

```ts
  let consecutiveValidationFailures = 0;
```

- [ ] **Step 3: tool 호출 처리 루프와 턴 종료 분기 수정**

`runAgentLoop`의 `for (const call of step.toolCalls) { ... }` 블록을 다음으로 교체:

```ts
    for (const call of step.toolCalls) {
      const toolStart = Date.now();
      const result = await runTool(config, call);
      logDebug(
        `[agent-loop] [${config.runLabel}] turn ${turn} tool="${call.name}" elapsedMs=${Date.now() - toolStart} terminate=${Boolean(result.terminate)} result="${result.content.slice(0, 200)}"`
      );

      let toolResultContent = result.content;
      if (result.isValidationError) {
        consecutiveValidationFailures++;
        if (consecutiveValidationFailures >= 2) {
          toolResultContent = `(이미 ${consecutiveValidationFailures}회 검증에 실패했다. 스키마 요구사항을 다시 확인하고 신중하게 재제출하라)\n${toolResultContent}`;
        }
      } else {
        consecutiveValidationFailures = 0;
      }

      messages.push({ role: "tool", toolCallId: call.id, content: toolResultContent });
      turnLog.toolCalls.push({ name: call.name, args: call.arguments, resultSummary: result.content.slice(0, 300) });
      if (result.terminate) {
        terminate = true;
        submission = result.details;
      }
    }

    turns.push(turnLog);
    if (terminate) {
      logDebug(`[agent-loop] [${config.runLabel}] submitted on turn ${turn}, totalElapsedMs=${Date.now() - runStart}`);
      return { runLabel: config.runLabel, status: "submitted", submission, turns };
    }

    if (consecutiveValidationFailures >= MAX_CONSECUTIVE_VALIDATION_FAILURES) {
      logDebug(`[agent-loop] [${config.runLabel}] giving up after ${consecutiveValidationFailures} consecutive validation failures`);
      return {
        runLabel: config.runLabel,
        status: "validation_exhausted",
        turns,
        error: `submit_result 검증에 ${consecutiveValidationFailures}회 연속 실패해 조기 종료했습니다.`
      };
    }
```

(기존 코드와의 차이: tool 결과를 바로 `messages.push`하지 않고 `toolResultContent` 변수를
거치도록 바꿨고, 루프가 끝난 뒤 `terminate` 체크 다음에 `consecutiveValidationFailures` 체크를
새로 추가했다.)

- [ ] **Step 4: 타입 체크 + 수동 스모크 테스트**

Run: `npx tsc -p tsconfig.json --noEmit` — 에러 없음을 확인.

실제 LLM 자격 증명이 설정된 환경(로컬 `.env` 또는 등록된 모델)에서:
1. `npm run dev`로 서버 기동.
2. 다른 터미널에서 `npm run logs:agent`로 로그 tail.
3. `documentAnalysis` 서비스를 실제로 한 번 호출(웹 UI 또는 해당 API 라우트)하고, 정상
   케이스에서는 `consecutiveValidationFailures` 관련 로그가 나오지 않는지(즉 회귀가
   없는지) 확인한다.
4. 검증 실패 조기 종료 경로 자체는 특정 모델의 실제 오작동에 의존하므로 이 태스크만으로는
   강제 재현하지 않는다 — Task 7(구제 턴)의 스모크 테스트에서 `maxTurns`를 낮춰 관련 경로를
   함께 확인한다.

- [ ] **Step 5: 커밋**

```bash
git add server/src/agent-runtime/loop.ts
git commit -m "feat(agent-runtime): submit_result 연속 검증 실패 예산을 턴 예산과 분리"
```

---

### Task 6: 구제 턴 (`tryRescueTurn`)

**Files:**
- Modify: `app/server/src/agent-runtime/loop.ts`

**Interfaces:**
- Consumes: `stepWithTools(..., forceTool?)`(Task 3), `AgentToolResult.isValidationError`(Task 1).
- Produces: `runAgentLoop`가 3가지 조기 종료 경로(턴 소진 tool-call 없음 / 검증 실패 예산 소진 /
  `maxTurns` 정상 소진) 각각에서 정확히 1회 구제 턴을 시도한다.

- [ ] **Step 1: 상수와 `tryRescueTurn` 함수 추가**

`NO_TOOL_CALL_NUDGE` 상수 바로 아래에 추가:

```ts
const RESCUE_NUDGE =
  "더 이상 조사를 진행할 수 없다. 지금까지 확인한 내용을 바탕으로 최선을 다해 submit_result를 호출해 제출하라.";
```

`runTool` 함수 정의 바로 아래, `runAgentLoop` 함수 정의 바로 위에 추가:

```ts
// 정상 턴 예산이 소진되기 직전, 마지막으로 딱 1번 tool_choice를 submit_result로 강제해
// "지금까지 조사한 내용으로 최선을 다해 제출하라"는 구제 턴을 시도한다. 이 턴에서도 실패하면
// 추가 구제 없이 그대로 포기한다(무한 루프 방지 - 구제는 런 전체에서 정확히 1회만 허용).
async function tryRescueTurn(
  config: AgentRunConfig,
  messages: ToolCallMessage[],
  turns: AgentTurnLog[]
): Promise<AgentRunResult | null> {
  if (!config.tools.some((t) => t.name === "submit_result")) return null;

  logDebug(`[agent-loop] [${config.runLabel}] attempting rescue turn (forceTool=submit_result)`);
  const rescueMessages: ToolCallMessage[] = [...messages, { role: "user", content: RESCUE_NUDGE }];
  const step = await stepWithTools(
    config.systemPrompt,
    rescueMessages,
    config.tools,
    config.maxTokensPerTurn ?? DEFAULT_MAX_TOKENS_PER_TURN,
    "submit_result"
  );

  if (step.stopReason === "error" || step.toolCalls.length === 0) {
    logDebug(`[agent-loop] [${config.runLabel}] rescue turn produced no tool call, giving up`);
    return null;
  }

  const turnLog: AgentTurnLog = { turn: turns.length + 1, assistantText: truncateForHistory(step.assistantText), toolCalls: [] };
  for (const call of step.toolCalls) {
    const result = await runTool(config, call);
    turnLog.toolCalls.push({ name: call.name, args: call.arguments, resultSummary: result.content.slice(0, 300) });
    if (result.terminate) {
      turns.push(turnLog);
      logDebug(`[agent-loop] [${config.runLabel}] rescue turn submitted successfully`);
      return { runLabel: config.runLabel, status: "submitted", submission: result.details, turns };
    }
  }
  turns.push(turnLog);
  logDebug(`[agent-loop] [${config.runLabel}] rescue turn tool call did not terminate, giving up`);
  return null;
}
```

- [ ] **Step 2: `runAgentLoop`에 `rescueAttempted` 플래그 추가**

`let consecutiveValidationFailures = 0;` 바로 아래에 추가:

```ts
  let rescueAttempted = false;
```

- [ ] **Step 3: 3곳의 조기 종료 경로에 구제 턴 연결**

(a) "tool 호출 없음" 조기 종료 블록:

```ts
      if (consecutiveNoToolCallTurns >= MAX_CONSECUTIVE_NO_TOOL_CALL_TURNS) {
        logDebug(`[agent-loop] [${config.runLabel}] giving up after ${consecutiveNoToolCallTurns} tool-less turns, totalElapsedMs=${Date.now() - runStart}`);
        if (!rescueAttempted) {
          rescueAttempted = true;
          const rescued = await tryRescueTurn(config, messages, turns);
          if (rescued) return rescued;
        }
        return {
          runLabel: config.runLabel,
          status: "exhausted",
          turns,
          error: `모델이 ${consecutiveNoToolCallTurns}턴 연속 tool을 호출하지 않아 조기 종료했습니다. 현재 provider/모델이 tool-calling을 신뢰성 있게 지원하지 않을 수 있습니다.`
        };
      }
```

(b) Task 5에서 추가한 "검증 실패 예산 소진" 블록:

```ts
    if (consecutiveValidationFailures >= MAX_CONSECUTIVE_VALIDATION_FAILURES) {
      logDebug(`[agent-loop] [${config.runLabel}] giving up after ${consecutiveValidationFailures} consecutive validation failures`);
      if (!rescueAttempted) {
        rescueAttempted = true;
        const rescued = await tryRescueTurn(config, messages, turns);
        if (rescued) return rescued;
      }
      return {
        runLabel: config.runLabel,
        status: "validation_exhausted",
        turns,
        error: `submit_result 검증에 ${consecutiveValidationFailures}회 연속 실패해 조기 종료했습니다.`
      };
    }
```

(c) 함수 맨 끝, `for` 루프가 정상적으로 `maxTurns`를 다 돈 뒤의 마지막 return:

```ts
  logDebug(`[agent-loop] [${config.runLabel}] exhausted after ${maxTurns} turns, totalElapsedMs=${Date.now() - runStart}`);
  if (!rescueAttempted) {
    rescueAttempted = true;
    const rescued = await tryRescueTurn(config, messages, turns);
    if (rescued) return rescued;
  }
  return { runLabel: config.runLabel, status: "exhausted", turns };
```

- [ ] **Step 4: 타입 체크**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: 에러 없음.

- [ ] **Step 5: 수동 스모크 테스트 (실제 LLM 자격 증명 필요)**

실제 LLM 자격 증명이 설정된 환경에서:
1. `app/server/src/services/tacitExtraction.ts`(가장 짧은 `maxTurns: 3` 서비스)를 열어
   `maxTurns: 3`을 일시적으로 `maxTurns: 1`로 바꾼다(테스트 후 반드시 원복).
2. `npm run dev` 기동, `npm run logs:agent`로 로그 tail.
3. tacitExtraction을 실제로 한 번 호출(웹 UI 또는 API 라우트)한다. 1턴 안에 모델이
   `submit_result`를 호출하지 못하면(현실적으로 가능성이 높다) 로그에
   `attempting rescue turn (forceTool=submit_result)`가 정확히 1번 찍히고, 그 뒤
   `rescue turn submitted successfully` 또는 `rescue turn ... giving up` 중 하나가 이어지는지
   확인한다. `attempting rescue turn`이 2번 이상 찍히면 버그다.
4. `maxTurns: 3`으로 원복하고 다시 커밋 대상에서 이 파일이 빠졌는지(`git status`) 확인한다.

- [ ] **Step 6: 커밋**

```bash
git add server/src/agent-runtime/loop.ts
git commit -m "feat(agent-runtime): 턴/검증 예산 소진 직전 강제 제출 구제 턴 1회 추가"
```

---

### Task 7: 서브에이전트 fan-out 프리미티브 (`runFanOutAgents`)

**Files:**
- Create: `app/server/src/agent-runtime/fanOut.ts`
- Test(임시): `app/server/src/agent-runtime/_verify.task7.ts`

**Interfaces:**
- Consumes: `runAgentLoop`, `AgentRunConfig`, `AgentRunResult` (기존 `loop.ts`/`types.ts`, 변경 없음).
- Produces: `runWithConcurrency<T>(thunks: Array<() => Promise<T>>, concurrency: number): Promise<T[]>`,
  `runFanOutAgents(tasks: FanOutTask[], options?: FanOutOptions): Promise<AgentRunResult[]>`,
  `FanOutTask`(= `AgentRunConfig`), `FanOutOptions`(`{ concurrency?: number }`). 이번 계획에서는
  어떤 서비스도 이 프리미티브를 소비하지 않는다(후속 작업에서 `documentAnalysis`/
  `interviewAnswerMapping` 적용 검토).

- [ ] **Step 1: 임시 검증 스크립트 작성 (순수 스케줄러만 테스트, LLM 호출 없음)**

`app/server/src/agent-runtime/_verify.task7.ts` 생성:

```ts
import assert from "node:assert/strict";
import { runWithConcurrency } from "./fanOut.js";

function delay<T>(ms: number, value: T): () => Promise<T> {
  return () => new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

// 완료 순서와 무관하게 입력 순서를 보존해야 한다
const results = await runWithConcurrency([delay(30, "a"), delay(10, "b"), delay(20, "c")], 3);
assert.deepEqual(results, ["a", "b", "c"]);

// concurrency 캡: 동시 실행 개수가 cap을 넘지 않아야 한다
let active = 0;
let maxActive = 0;
function track(): () => Promise<boolean> {
  return async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 20));
    active--;
    return true;
  };
}
await runWithConcurrency([track(), track(), track(), track(), track()], 2);
assert.ok(maxActive <= 2, `concurrency=2인데 동시 실행이 ${maxActive}까지 올라갔다`);

// 빈 배열
const empty = await runWithConcurrency([], 3);
assert.deepEqual(empty, []);

console.log("task7 OK");
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx src/agent-runtime/_verify.task7.ts`
Expected: `fanOut.ts`가 아직 없어 import 단계에서 모듈을 찾지 못해 실패.

- [ ] **Step 3: `fanOut.ts` 구현**

`app/server/src/agent-runtime/fanOut.ts` 생성:

```ts
import { runAgentLoop } from "./loop.js";
import type { AgentRunConfig, AgentRunResult } from "./types.js";

// FanOutTask는 AgentRunConfig와 필드가 동일하다(독립된 하위 실행 하나 = 하나의 AgentRunConfig).
// 별도 이름을 쓰는 건 "fan-out으로 병렬 실행되는 task"라는 의도를 호출부에서 명시하기 위함이다.
export type FanOutTask = AgentRunConfig;

export interface FanOutOptions {
  /** 동시에 실행할 최대 task 수. 기본 3. */
  concurrency?: number;
}

const DEFAULT_CONCURRENCY = 3;

// 동시성 캡을 둔 채로 thunk 배열을 실행하는 범용 스케줄러. LLM 호출과 분리해뒀기 때문에
// 네트워크 없이 순수하게 테스트 가능하다.
export async function runWithConcurrency<T>(thunks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results: T[] = new Array(thunks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex++;
      if (i >= thunks.length) return;
      results[i] = await thunks[i]();
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, thunks.length || 1));
  await Promise.all(Array.from({ length: thunks.length ? workerCount : 0 }, () => worker()));
  return results;
}

// 독립적인 하위 작업들을 병렬로 위임하는 fan-out 프리미티브.
// openClaw처럼 모델이 스스로 서브에이전트를 동적으로 스폰하지는 않는다 - QuestOps는 요청당
// 비용/턴수가 예측 가능해야 하므로, fan-out은 항상 호출부(서비스 코드)가 task 배열을 정적으로
// 선언한다. runAgentLoop는 이미 모든 실패를 AgentRunResult로 흡수해 throw하지 않는 구조지만,
// 방어적으로 개별 task를 try/catch로 감싸 예상치 못한 예외가 나머지 task를 중단시키지 않게 한다.
export async function runFanOutAgents(tasks: FanOutTask[], options?: FanOutOptions): Promise<AgentRunResult[]> {
  const concurrency = options?.concurrency ?? DEFAULT_CONCURRENCY;
  const thunks = tasks.map((task) => async (): Promise<AgentRunResult> => {
    try {
      return await runAgentLoop(task);
    } catch (err) {
      return { runLabel: task.runLabel, status: "error", turns: [], error: `fan-out 실행 중 예외: ${(err as Error).message}` };
    }
  });
  return runWithConcurrency(thunks, concurrency);
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx src/agent-runtime/_verify.task7.ts`
Expected: `task7 OK` 출력.

- [ ] **Step 5: 타입 체크**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: 에러 없음.

- [ ] **Step 6: 임시 스크립트 삭제**

Run: `rm src/agent-runtime/_verify.task7.ts`

- [ ] **Step 7: 커밋**

```bash
git add server/src/agent-runtime/fanOut.ts
git commit -m "feat(agent-runtime): 정적 서브에이전트 fan-out 프리미티브(runFanOutAgents) 추가"
```

---

### Task 8: 모듈 헤더 주석 업데이트

**Files:**
- Modify: `app/server/src/agent-runtime/types.ts`
- Modify: `app/server/src/agent-runtime/loop.ts`

기존 헤더 주석이 "steering/서브에이전트/컨텍스트 컴팩션 없이"라고 명시하고 있는데, Task 1~7로
그 설명이 더 이상 정확하지 않다. 코드를 바꾸지 않고 주석만 현재 상태에 맞게 고친다.

- [ ] **Step 1: `types.ts` 헤더 주석 수정**

파일 최상단 주석 블록을:

```ts
// 범용 Agent Loop 런타임의 공용 타입.
// openClaw(ref_projects/openclaw)의 turn/tool 루프 패턴을 참고하되,
// QuestOps는 개방형 대화가 아니라 "유한한 구조화 산출물 생성"이 목적이므로
// steering 큐, 동적 서브에이전트 스폰(모델이 스스로 트리거하는), 요약 기반 컨텍스트 컴팩션은
// 두지 않는다. 대신 정적 fan-out(fanOut.ts), 재시도/구제 턴, 컨텍스트 축소 안전장치로
// 신뢰성을 높인다.
```

로 교체.

- [ ] **Step 2: `loop.ts`의 `runAgentLoop` 위 주석 수정**

이미 Task 4/6에서 다음 내용으로 교체됐다(별도 작업 불필요, 아래는 확인용):

```ts
// 턴 루프: 모델 호출 -> tool 실행 -> 결과를 컨텍스트에 append -> 반복.
// openClaw의 agent-loop 패턴을 차용하되, QuestOps는 유한한 구조화 산출물 생성이
// 목적이라 steering/동적 서브에이전트 스폰/요약 컴팩션 없이 명시적 maxTurns 상한 +
// 정적 fan-out(fanOut.ts) + 안전장치(재시도, 검증 예산, 컨텍스트 축소, 구제 턴) 위주로 구성한다.
```

이 주석이 Task 4의 Step 3에서 이미 반영되지 않았다면 지금 반영한다(원래 파일과 diff 확인 후).

- [ ] **Step 3: 타입 체크**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add server/src/agent-runtime/types.ts server/src/agent-runtime/loop.ts
git commit -m "docs(agent-runtime): 헤더 주석을 fan-out/재시도/구제 턴 도입 이후 상태로 갱신"
```

---

## Self-Review 결과

- **스펙 커버리지**: 스펙의 1a(전송 재시도)=Task2, 1b(검증 예산 분리)=Task1+Task5,
  1c(구제 턴)=Task3+Task6, 2(fan-out 프리미티브)=Task7, 3(컨텍스트 안전장치)=Task4 전부 태스크로
  매핑됨. 인터페이스 변경 요약 표의 5개 파일 전부 태스크에 등장함.
- **플레이스홀더 스캔**: "TBD"/"나중에"/"적절히 처리" 류 문구 없음. 모든 코드 스텝에 실제
  코드 블록 포함.
- **타입 일관성**: `isValidationError`(Task1) → `tools.ts`(Task1) → `loop.ts`(Task5)까지
  동일한 필드명 사용 확인. `forceTool`(Task3) → `tryRescueTurn`의 `stepWithTools` 호출(Task6)
  까지 동일 파라미터명/순서 확인. `FanOutTask = AgentRunConfig`(Task7)는 별도 필드 정의 없이
  타입 별칭이라 드리프트 가능성 없음.

---

## Execution Handoff

Plan complete and saved to `app/docs/superpowers/plans/2026-08-21-agent-runtime-advanced-techniques.md`.
Two execution options:

1. **Subagent-Driven (recommended)** - 태스크마다 새 subagent를 띄워 구현시키고, 두 단계
   리뷰(구현 직후 + 통합 후)를 거친다. 빠른 반복.
2. **Inline Execution** - 이 세션에서 executing-plans로 배치 실행, 태스크 사이 체크포인트에서
   검토.

어느 쪽으로 진행할까요?
