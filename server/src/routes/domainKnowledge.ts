import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import { db } from "../db.js";
import { generateDomainKnowledge } from "../services/domainKnowledgeGeneration.js";
import { renderDomainKnowledgeHtml } from "../services/domainKnowledgeHtmlGeneration.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const generatedRoot = path.join(__dirname, "..", "..", "uploads", "_generated");
if (!fs.existsSync(generatedRoot)) fs.mkdirSync(generatedRoot, { recursive: true });

export const domainKnowledgeRouter = Router();

domainKnowledgeRouter.get("/projects/:id/domain-knowledge/eligibility", (req, res) => {
  const analyzed = (
    db.prepare("SELECT COUNT(*) c FROM documents WHERE project_id = ? AND status = 'analyzed'").get(req.params.id) as any
  ).c;
  const eligible = analyzed > 0;
  res.json({
    eligible,
    analyzedCount: analyzed,
    reason: eligible ? "" : "먼저 자료 분석을 최소 1건 이상 완료하세요."
  });
});

domainKnowledgeRouter.get("/projects/:id/domain-knowledge", (req, res) => {
  const row = db
    .prepare("SELECT * FROM domain_knowledge WHERE project_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(req.params.id) as any;
  if (!row) return res.json(null);
  res.json({
    id: row.id,
    status: row.status,
    content: row.content ? JSON.parse(row.content) : null,
    hasHtml: Boolean(row.html_path),
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
});

domainKnowledgeRouter.post("/projects/:id/domain-knowledge/generate", async (req, res) => {
  const projectId = req.params.id;
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
  if (!project) return res.status(404).json({ error: "프로젝트를 찾을 수 없습니다." });

  const now = new Date().toISOString();
  const dkId = nanoid(10);
  db.prepare(
    `INSERT INTO domain_knowledge (id, project_id, status, created_at, updated_at) VALUES (?, ?, 'generating', ?, ?)`
  ).run(dkId, projectId, now, now);

  try {
    const analyzedDocs = db.prepare("SELECT * FROM documents WHERE project_id = ? AND status = 'analyzed'").all(projectId) as any[];
    const analyses = analyzedDocs.map((d) => JSON.parse(d.analysis_result));

    const { result } = await generateDomainKnowledge({
      projectName: project.name,
      client: project.client,
      org: project.org || undefined,
      projectType: project.project_type || undefined,
      description: project.description || "",
      goal: project.goal,
      analyses
    });

    const html = renderDomainKnowledgeHtml({ projectName: project.name, client: project.client }, result);
    const htmlPath = path.join(generatedRoot, `domain_knowledge_${dkId}.html`);
    fs.writeFileSync(htmlPath, html, "utf-8");

    db.prepare(
      "UPDATE domain_knowledge SET status = 'ready', content = ?, html_path = ?, updated_at = ? WHERE id = ?"
    ).run(JSON.stringify(result), htmlPath, new Date().toISOString(), dkId);

    res.status(201).json({
      id: dkId,
      status: "ready",
      content: result,
      hasHtml: true,
      errorMessage: null,
      createdAt: now,
      updatedAt: new Date().toISOString()
    });
  } catch (err) {
    db.prepare("UPDATE domain_knowledge SET status = 'error', error_message = ?, updated_at = ? WHERE id = ?").run(
      (err as Error).message,
      new Date().toISOString(),
      dkId
    );
    res.status(500).json({ error: `도메인 지식 생성 실패: ${(err as Error).message}` });
  }
});

domainKnowledgeRouter.get("/domain-knowledge/:id/html", (req, res) => {
  const row = db.prepare("SELECT * FROM domain_knowledge WHERE id = ?").get(req.params.id) as any;
  if (!row || !row.html_path || !fs.existsSync(row.html_path)) {
    return res.status(404).send("도메인 지식 HTML을 찾을 수 없습니다.");
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  fs.createReadStream(row.html_path).pipe(res);
});

domainKnowledgeRouter.get("/domain-knowledge/:id/download", (req, res) => {
  const row = db.prepare("SELECT * FROM domain_knowledge WHERE id = ?").get(req.params.id) as any;
  if (!row || !row.html_path || !fs.existsSync(row.html_path)) {
    return res.status(404).json({ error: "파일을 찾을 수 없습니다." });
  }
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(row.project_id) as any;
  res.download(row.html_path, `${project?.name || "project"}_도메인지식.html`);
});
