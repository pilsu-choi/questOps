import { Router } from "express";
import { nanoid } from "nanoid";
import { db } from "../db.js";
import { computeProjectProgress } from "../services/progress.js";

export const projectsRouter = Router();

function serializeProject(row: any) {
  return {
    id: row.id,
    name: row.name,
    client: row.client,
    owner: row.owner,
    org: row.org,
    projectType: row.project_type,
    startDate: row.start_date,
    endDate: row.end_date,
    description: row.description,
    goal: row.goal,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

projectsRouter.get("/", (_req, res) => {
  const rows = db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as any[];
  const withProgress = rows.map((r) => ({
    ...serializeProject(r),
    progress: computeProjectProgress(r.id)
  }));
  res.json(withProgress);
});

projectsRouter.post("/", (req, res) => {
  const { name, client, owner, org, projectType, startDate, endDate, description, goal } = req.body || {};
  if (!name || !client) {
    return res.status(400).json({ error: "프로젝트명과 고객사는 필수입니다." });
  }
  const id = nanoid(10);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO projects (id, name, client, owner, org, project_type, start_date, end_date, description, goal, current_quest, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'docs', ?, ?)`
  ).run(id, name, client, owner || null, org || null, projectType || "AI Agent 구축", startDate || null, endDate || null, description || null, goal || null, now, now);
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  res.status(201).json({ ...serializeProject(row), progress: computeProjectProgress(id) });
});

projectsRouter.get("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "프로젝트를 찾을 수 없습니다." });
  res.json({ ...serializeProject(row), progress: computeProjectProgress(req.params.id) });
});

projectsRouter.get("/:id/dashboard", (req, res) => {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: "프로젝트를 찾을 수 없습니다." });
  const progress = computeProjectProgress(req.params.id);
  res.json({ project: serializeProject(row), progress });
});

projectsRouter.patch("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: "프로젝트를 찾을 수 없습니다." });
  const fields = ["name", "client", "owner", "org", "projectType", "startDate", "endDate", "description", "goal"] as const;
  const colMap: Record<string, string> = {
    name: "name",
    client: "client",
    owner: "owner",
    org: "org",
    projectType: "project_type",
    startDate: "start_date",
    endDate: "end_date",
    description: "description",
    goal: "goal"
  };
  const updates: string[] = [];
  const values: any[] = [];
  for (const f of fields) {
    if (req.body?.[f] !== undefined) {
      updates.push(`${colMap[f]} = ?`);
      values.push(req.body[f]);
    }
  }
  if (updates.length > 0) {
    values.push(new Date().toISOString(), req.params.id);
    db.prepare(`UPDATE projects SET ${updates.join(", ")}, updated_at = ? WHERE id = ?`).run(...values);
  }
  const updated = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id);
  res.json({ ...serializeProject(updated), progress: computeProjectProgress(req.params.id) });
});
