import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db.js";

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

interface ActiveLlmConfig {
  provider: ProviderId;
  apiKey: string;
  model: string;
  modelName: string;
  source: "registered" | "env";
}

function resolveActiveConfig(): ActiveLlmConfig | null {
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

async function completeAnthropic(apiKey: string, model: string, system: string, user: string, maxTokens: number): Promise<string> {
  const c = getAnthropicClient(apiKey);
  const res = await c.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }]
  });
  const block = res.content.find((b) => b.type === "text");
  return block && block.type === "text" ? block.text : "";
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
  const res = await fetch(`${baseUrl}/chat/completions`, {
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
    throw new Error(`${providerLabel} API 오류 (${res.status}): ${(await res.text()).slice(0, 500)}`);
  }
  const data = (await res.json()) as any;
  return data.choices?.[0]?.message?.content ?? "";
}

// ---- Google Gemini ----
async function completeGoogle(apiKey: string, model: string, system: string, user: string, maxTokens: number): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: maxTokens }
    })
  });
  if (!res.ok) {
    throw new Error(`Google API 오류 (${res.status}): ${(await res.text()).slice(0, 500)}`);
  }
  const data = (await res.json()) as any;
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p: any) => p.text || "").join("");
}

export async function completeText(system: string, user: string, maxTokens = 4096): Promise<string> {
  const cfg = resolveActiveConfig();
  if (!cfg) throw new NoLLMError();

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
  return trimmed;
}

export async function completeJSON<T>(system: string, user: string, maxTokens = 8192): Promise<T> {
  const raw = await completeText(system, user, maxTokens);
  const cleaned = stripFences(raw);
  const start = cleaned.indexOf("{") === -1 ? cleaned.indexOf("[") : Math.min(...[cleaned.indexOf("{"), cleaned.indexOf("[")].filter((i) => i >= 0));
  const lastBrace = cleaned.lastIndexOf("}");
  const lastBracket = cleaned.lastIndexOf("]");
  const end = Math.max(lastBrace, lastBracket);
  const jsonSlice = start >= 0 && end >= 0 ? cleaned.slice(start, end + 1) : cleaned;
  try {
    return JSON.parse(jsonSlice) as T;
  } catch (err) {
    throw new Error(`Failed to parse LLM JSON output: ${(err as Error).message}\nRaw: ${raw.slice(0, 500)}`);
  }
}
