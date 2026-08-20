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

  const res = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
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
  });

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
