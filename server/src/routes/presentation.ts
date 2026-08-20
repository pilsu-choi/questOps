import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import { db } from "../db.js";
import { generatePresentationSlides } from "../services/pptGeneration.js";
import { renderPresentationHtml } from "../services/pptHtmlGeneration.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const generatedRoot = path.join(__dirname, "..", "..", "uploads", "_generated");
if (!fs.existsSync(generatedRoot)) fs.mkdirSync(generatedRoot, { recursive: true });

export const presentationRouter = Router();

presentationRouter.get("/projects/:id/presentation", (req, res) => {
  const row = db
    .prepare("SELECT * FROM presentations WHERE project_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(req.params.id) as any;
  if (!row) return res.json(null);
  res.json({
    id: row.id,
    status: row.status,
    slides: row.slides ? JSON.parse(row.slides) : [],
    hasFile: Boolean(row.html_path),
    errorMessage: row.error_message,
    createdAt: row.created_at
  });
});

presentationRouter.post("/projects/:id/presentation/generate", async (req, res) => {
  const projectId = req.params.id;
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
  if (!project) return res.status(404).json({ error: "프로젝트를 찾을 수 없습니다." });

  const now = new Date().toISOString();
  const presId = nanoid(10);
  db.prepare("INSERT INTO presentations (id, project_id, status, created_at, updated_at) VALUES (?, ?, 'generating', ?, ?)").run(
    presId,
    projectId,
    now,
    now
  );

  try {
    const analyzedDocs = db.prepare("SELECT * FROM documents WHERE project_id = ? AND status = 'analyzed'").all(projectId) as any[];
    const analyses = analyzedDocs.map((d) => JSON.parse(d.analysis_result));
    const tacitRows = db.prepare("SELECT type, description FROM tacit_knowledge WHERE project_id = ?").all(projectId) as any[];

    const demoRow = db.prepare("SELECT * FROM demos WHERE project_id = ? ORDER BY created_at DESC LIMIT 1").get(projectId) as any;
    const agentRow = demoRow?.agent_id ? (db.prepare("SELECT * FROM agents WHERE id = ?").get(demoRow.agent_id) as any) : null;

    const agent = agentRow
      ? {
          name: agentRow.name,
          purpose: agentRow.purpose,
          users: JSON.parse(agentRow.users || "[]"),
          input: [],
          workflow: JSON.parse(agentRow.workflow || "[]"),
          rules: JSON.parse(agentRow.rules || "[]"),
          exceptions: [],
          dataSources: [],
          humanApproval: JSON.parse(agentRow.human_approval || "{}"),
          output: []
        }
      : undefined;
    const screens = demoRow?.screens ? JSON.parse(demoRow.screens) : undefined;
    const scenario = demoRow?.scenario ? JSON.parse(demoRow.scenario) : undefined;

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

    const html = renderPresentationHtml({ projectName: project.name, client: project.client }, slides);
    const outPath = path.join(generatedRoot, `presentation_${presId}.html`);
    fs.writeFileSync(outPath, html, "utf-8");

    db.prepare("UPDATE presentations SET status = 'ready', slides = ?, html_path = ?, updated_at = ? WHERE id = ?").run(
      JSON.stringify(slides),
      outPath,
      new Date().toISOString(),
      presId
    );

    res.status(201).json({ id: presId, status: "ready", slides, hasFile: true });
  } catch (err) {
    db.prepare("UPDATE presentations SET status = 'error', error_message = ?, updated_at = ? WHERE id = ?").run(
      (err as Error).message,
      new Date().toISOString(),
      presId
    );
    res.status(500).json({ error: `PPT 생성 실패: ${(err as Error).message}` });
  }
});

presentationRouter.get("/presentations/:id/html", (req, res) => {
  const row = db.prepare("SELECT * FROM presentations WHERE id = ?").get(req.params.id) as any;
  if (!row || !row.html_path || !fs.existsSync(row.html_path)) {
    return res.status(404).send("발표자료 HTML을 찾을 수 없습니다.");
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  fs.createReadStream(row.html_path).pipe(res);
});

presentationRouter.get("/presentations/:id/download", (req, res) => {
  const row = db.prepare("SELECT * FROM presentations WHERE id = ?").get(req.params.id) as any;
  if (!row || !row.html_path || !fs.existsSync(row.html_path)) {
    return res.status(404).json({ error: "파일을 찾을 수 없습니다." });
  }
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(row.project_id) as any;
  res.download(row.html_path, `${project?.name || "presentation"}_발표자료.html`);
});
