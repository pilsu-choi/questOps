import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db.js";
import { logDebug } from "../logger.js";

export class NoLLMError extends Error {
  constructor() {
    super("No LLM configured");
    this.name = "NoLLMError";
  }
}

export type ProviderId = "anthropic" | "openai" | "openrouter" | "google";

export const PROVIDERS: { id: ProviderId; label: string }[] = [
  { id: "anthropic", label: "Anthropic" },
  { id: "openai", label: "OpenAI" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "google", label: "Google (Gemini)" }
];

export interface ActiveLlmConfig {
  provider: ProviderId;
  apiKey: string;
  model: string;
  modelName: string;
  source: "registered" | "env";
}

// None of the raw `fetch` calls to LLM providers had a timeout, so a stalled response
// (dead connection, provider hang) left the caller — and any DB row tracking that request
// as "generating" — stuck forever with no way to recover short of a server restart.
export const LLM_REQUEST_TIMEOUT_MS = 120_000;

export async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new Error(`LLM 요청이 ${LLM_REQUEST_TIMEOUT_MS / 1000}초 내에 응답하지 않아 중단했습니다.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// agent-runtime의 tool-calling 드라이버(llm/toolCalling.ts)가 provider/apiKey에
// 직접 접근해야 해서 export한다. completeText/completeJSON을 쓰는 기존 서비스들은
// 계속 llmAvailable()/activeModelInfo()만 쓰면 된다.
export function resolveActiveConfig(): ActiveLlmConfig | null {
  const row = db.prepare("SELECT * FROM llm_models WHERE is_active = 1 LIMIT 1").get() as any;
  if (row && row.api_key) {
    return { provider: (row.provider || "anthropic") as ProviderId, apiKey: row.api_key, model: row.model_id, modelName: row.name, source: "registered" };
  }
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) {
    const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
    return { provider: "anthropic", apiKey: envKey, model, modelName: `${model} (.env 기본값)`, source: "env" };
  }
  return null;
}

// 등록된 모델 전환 시 서버 재시작 없이 즉시 반영되도록 매 호출마다 활성 설정을 다시 조회한다.
export function llmAvailable(): boolean {
  return resolveActiveConfig() !== null;
}

export function activeModelInfo(): { provider: ProviderId; model: string; modelName: string; source: "registered" | "env" } | null {
  const cfg = resolveActiveConfig();
  return cfg ? { provider: cfg.provider, model: cfg.model, modelName: cfg.modelName, source: cfg.source } : null;
}

// ---- Anthropic ----
const anthropicClients = new Map<string, Anthropic>();
function getAnthropicClient(apiKey: string): Anthropic {
  let c = anthropicClients.get(apiKey);
  if (!c) {
    c = new Anthropic({ apiKey });
    anthropicClients.set(apiKey, c);
  }
  return c;
}

// Most Claude models reject a max_tokens above ~8192 unless the extended-output beta
// header is set for that specific model. OpenRouter/OpenAI/Google are more forgiving
// (they just cap silently), so only the direct Anthropic path needs this clamp.
const ANTHROPIC_MAX_TOKENS_CEILING = 8192;

async function completeAnthropic(apiKey: string, model: string, system: string, user: string, maxTokens: number): Promise<string> {
  const c = getAnthropicClient(apiKey);
  const start = Date.now();
  logDebug(`[llm] anthropic request model=${model} maxTokens=${maxTokens} promptChars=${system.length + user.length}`);
  const res = await c.messages.create(
    {
      model,
      max_tokens: Math.min(maxTokens, ANTHROPIC_MAX_TOKENS_CEILING),
      system,
      messages: [{ role: "user", content: user }]
    },
    { timeout: LLM_REQUEST_TIMEOUT_MS }
  );
  const block = res.content.find((b) => b.type === "text");
  const text = block && block.type === "text" ? block.text : "";
  logDebug(`[llm] anthropic response elapsedMs=${Date.now() - start} responseChars=${text.length} stopReason=${res.stop_reason}`);
  return text;
}

// ---- OpenAI / OpenRouter (OpenAI Chat Completions 호환 API) ----
async function completeOpenAiCompatible(
  providerLabel: string,
  baseUrl: string,
  apiKey: string,
  model: string,
  system: string,
  user: string,
  maxTokens: number,
  extraHeaders?: Record<string, string>
): Promise<string> {
  const start = Date.now();
  logDebug(`[llm] ${providerLabel} request model=${model} maxTokens=${maxTokens} promptChars=${system.length + user.length}`);
  const res = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    })
  });
  if (!res.ok) {
    const errText = (await res.text()).slice(0, 500);
    logDebug(`[llm] ${providerLabel} error elapsedMs=${Date.now() - start} status=${res.status}`);
    throw new Error(`${providerLabel} API 오류 (${res.status}): ${errText}`);
  }
  const data = (await res.json()) as any;
  const text = data.choices?.[0]?.message?.content ?? "";
  logDebug(
    `[llm] ${providerLabel} response elapsedMs=${Date.now() - start} responseChars=${text.length} finishReason=${data.choices?.[0]?.finish_reason}`
  );
  return text;
}

// ---- Google Gemini ----
async function completeGoogle(apiKey: string, model: string, system: string, user: string, maxTokens: number): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
  const start = Date.now();
  logDebug(`[llm] google request model=${model} maxTokens=${maxTokens} promptChars=${system.length + user.length}`);
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: maxTokens }
    })
  });
  if (!res.ok) {
    const errText = (await res.text()).slice(0, 500);
    logDebug(`[llm] google error elapsedMs=${Date.now() - start} status=${res.status}`);
    throw new Error(`Google API 오류 (${res.status}): ${errText}`);
  }
  const data = (await res.json()) as any;
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p: any) => p.text || "").join("");
  logDebug(`[llm] google response elapsedMs=${Date.now() - start} responseChars=${text.length}`);
  return text;
}

export async function completeText(system: string, user: string, maxTokens = 4096): Promise<string> {
  const cfg = resolveActiveConfig();
  if (!cfg) throw new NoLLMError();
  logDebug(`[llm] completeText via provider=${cfg.provider} model=${cfg.model} (${cfg.source})`);

  switch (cfg.provider) {
    case "anthropic":
      return completeAnthropic(cfg.apiKey, cfg.model, system, user, maxTokens);
    case "openai":
      return completeOpenAiCompatible("OpenAI", "https://api.openai.com/v1", cfg.apiKey, cfg.model, system, user, maxTokens);
    case "openrouter":
      return completeOpenAiCompatible("OpenRouter", "https://openrouter.ai/api/v1", cfg.apiKey, cfg.model, system, user, maxTokens, {
        "HTTP-Referer": "https://questops.local",
        "X-Title": "QuestOps"
      });
    case "google":
      return completeGoogle(cfg.apiKey, cfg.model, system, user, maxTokens);
    default:
      throw new Error(`지원하지 않는 provider: ${cfg.provider}`);
  }
}

function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenceMatch) return fenceMatch[1];
  // Some models truncate before emitting the closing ``` — strip a dangling opening fence too.
  const openOnly = trimmed.match(/^```(?:json)?\s*([\s\S]*)$/);
  return openOnly ? openOnly[1] : trimmed;
}

// Some models (especially smaller/community models via OpenRouter) get cut off before
// finishing the JSON — either they hit the requested max_tokens, or the provider silently
// caps output shorter than what we asked for. Rather than hard-failing, close out whatever
// strings/arrays/objects were left open so we can recover the fields that did complete.
function repairTruncatedJson(body: string): string | null {
  let inString = false;
  let escape = false;
  const stack: ("{" | "[")[] = [];

  for (const c of body) {
    if (inString) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" && stack[stack.length - 1] === "{") stack.pop();
    else if (c === "]" && stack[stack.length - 1] === "[") stack.pop();
  }

  if (!inString && stack.length === 0) return null; // nothing to repair

  let repaired = body;
  if (inString) repaired += '"';
  repaired = repaired.replace(/,\s*$/, "").replace(/:\s*$/, ": null");
  for (let i = stack.length - 1; i >= 0; i--) repaired += stack[i] === "{" ? "}" : "]";
  return repaired;
}

export async function completeJSON<T>(system: string, user: string, maxTokens = 8192): Promise<T> {
  const raw = await completeText(system, user, maxTokens);
  const cleaned = stripFences(raw);
  const firstBrace = cleaned.indexOf("{");
  const firstBracket = cleaned.indexOf("[");
  const candidates = [firstBrace, firstBracket].filter((i) => i >= 0);
  const start = candidates.length ? Math.min(...candidates) : -1;
  const body = start >= 0 ? cleaned.slice(start) : cleaned;

  try {
    const parsed = JSON.parse(body) as T;
    logDebug(`[llm] completeJSON parsed cleanly (bodyChars=${body.length})`);
    return parsed;
  } catch (firstErr) {
    logDebug(`[llm] completeJSON initial parse failed, attempting truncation repair: ${(firstErr as Error).message}`);
    const repaired = repairTruncatedJson(body);
    if (repaired) {
      try {
        const parsed = JSON.parse(repaired) as T;
        logDebug(`[llm] completeJSON recovered via truncation repair`);
        return parsed;
      } catch {
        // fall through to the original error below — repair attempt didn't help
      }
    }
    throw new Error(
      `Failed to parse LLM JSON output (response may have been truncated before max_tokens=${maxTokens} was reached): ${
        (firstErr as Error).message
      }\nRaw (last 400 chars): ...${raw.slice(-400)}`
    );
  }
}
