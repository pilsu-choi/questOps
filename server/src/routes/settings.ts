import { Router } from "express";
import { nanoid } from "nanoid";
import { db } from "../db.js";
import { activeModelInfo, llmAvailable, PROVIDERS, type ProviderId } from "../llm/provider.js";

export const settingsRouter = Router();

const PROVIDER_IDS = new Set(PROVIDERS.map((p) => p.id));
function normalizeProvider(value: unknown): ProviderId {
  return typeof value === "string" && PROVIDER_IDS.has(value as ProviderId) ? (value as ProviderId) : "anthropic";
}

function serialize(row: any) {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    modelId: row.model_id,
    hasApiKey: Boolean(row.api_key),
    apiKeyPreview: row.api_key ? `••••${String(row.api_key).slice(-4)}` : null,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

settingsRouter.get("/llm-models", (_req, res) => {
  const rows = db.prepare("SELECT * FROM llm_models ORDER BY created_at ASC").all() as any[];
  res.json({
    models: rows.map(serialize),
    providers: PROVIDERS,
    llmAvailable: llmAvailable(),
    active: activeModelInfo()
  });
});

settingsRouter.post("/llm-models", (req, res) => {
  const { name, modelId, apiKey, provider } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "모델 별칭을 입력해 주세요." });
  if (!modelId || !String(modelId).trim()) return res.status(400).json({ error: "모델 ID를 입력해 주세요." });

  const id = nanoid(10);
  const now = new Date().toISOString();
  const existingCount = (db.prepare("SELECT COUNT(*) as c FROM llm_models").get() as any).c;
  const makeActive = existingCount === 0 ? 1 : 0;

  db.prepare(
    `INSERT INTO llm_models (id, name, provider, model_id, api_key, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, String(name).trim(), normalizeProvider(provider), String(modelId).trim(), apiKey ? String(apiKey).trim() : null, makeActive, now, now);

  const row = db.prepare("SELECT * FROM llm_models WHERE id = ?").get(id);
  res.status(201).json(serialize(row));
});

settingsRouter.patch("/llm-models/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM llm_models WHERE id = ?").get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: "모델을 찾을 수 없습니다." });

  const { name, modelId, apiKey, provider } = req.body || {};
  const nextName = name !== undefined && String(name).trim() ? String(name).trim() : row.name;
  const nextModelId = modelId !== undefined && String(modelId).trim() ? String(modelId).trim() : row.model_id;
  const nextProvider = provider !== undefined ? normalizeProvider(provider) : row.provider;
  // apiKey가 요청에 없으면(undefined) 기존 키 유지, 빈 문자열이면 키 삭제, 값이 있으면 교체.
  const nextApiKey = apiKey === undefined ? row.api_key : apiKey === "" ? null : String(apiKey).trim();

  db.prepare("UPDATE llm_models SET name = ?, provider = ?, model_id = ?, api_key = ?, updated_at = ? WHERE id = ?").run(
    nextName,
    nextProvider,
    nextModelId,
    nextApiKey,
    new Date().toISOString(),
    req.params.id
  );

  const updated = db.prepare("SELECT * FROM llm_models WHERE id = ?").get(req.params.id);
  res.json(serialize(updated));
});

settingsRouter.post("/llm-models/:id/activate", (req, res) => {
  const row = db.prepare("SELECT * FROM llm_models WHERE id = ?").get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: "모델을 찾을 수 없습니다." });

  db.prepare("UPDATE llm_models SET is_active = 0").run();
  db.prepare("UPDATE llm_models SET is_active = 1, updated_at = ? WHERE id = ?").run(new Date().toISOString(), req.params.id);

  const updated = db.prepare("SELECT * FROM llm_models WHERE id = ?").get(req.params.id);
  res.json(serialize(updated));
});

settingsRouter.delete("/llm-models/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM llm_models WHERE id = ?").get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: "모델을 찾을 수 없습니다." });

  db.prepare("DELETE FROM llm_models WHERE id = ?").run(req.params.id);

  if (row.is_active) {
    const next = db.prepare("SELECT id FROM llm_models ORDER BY created_at ASC LIMIT 1").get() as any;
    if (next) db.prepare("UPDATE llm_models SET is_active = 1 WHERE id = ?").run(next.id);
  }
  res.status(204).end();
});
