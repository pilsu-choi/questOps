// Tool-calling 지원 provider 드라이버.
// 1단계로 OpenRouter(OpenAI 호환 /chat/completions + tools)만 지원한다.
// 다른 provider(Anthropic/OpenAI/Google)는 각자의 tool-calling 포맷에 맞춰
// 추후 이 파일에 드라이버를 추가하면 되고, 그 전까지 agent-runtime은
// toolCallingAvailable()이 false인 경우 기존 completeJSON 단일 턴 경로로 자동 폴백한다.

import { NoLLMError, resolveActiveConfig, fetchWithTimeout } from "./provider.js";
import { logDebug } from "../logger.js";
import type { AgentTool } from "../agent-runtime/types.js";

export interface ToolCallMessage {
  role: "user" | "assistant" | "tool";
  content?: string;
  toolCalls?: { id: string; name: string; arguments: string }[];
  toolCallId?: string;
}

export interface ToolCallStepResult {
  assistantText?: string;
  toolCalls: { id: string; name: string; arguments: string }[];
  stopReason: "tool_calls" | "stop" | "length" | "error";
  errorMessage?: string;
}

export function toolCallingAvailable(): boolean {
  return resolveActiveConfig()?.provider === "openrouter";
}

function toOpenAiTools(tools: AgentTool[]) {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters }
  }));
}

function toOpenAiMessages(systemPrompt: string, messages: ToolCallMessage[]) {
  const out: Record<string, unknown>[] = [{ role: "system", content: systemPrompt }];
  for (const m of messages) {
    if (m.role === "assistant") {
      out.push({
        role: "assistant",
        content: m.content || null,
        ...(m.toolCalls?.length
          ? { tool_calls: m.toolCalls.map((tc) => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: tc.arguments } })) }
          : {})
      });
    } else if (m.role === "tool") {
      out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content ?? "" });
    } else {
      out.push({ role: "user", content: m.content ?? "" });
    }
  }
  return out;
}

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
