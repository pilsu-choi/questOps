import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import { db } from "../db.js";
import { generateAgentDemo } from "../services/agentDemoGeneration.js";
import { renderDemoHtml } from "../services/demoHtmlGeneration.js";
import type { InterviewQuestionItem } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const generatedRoot = path.join(__dirname, "..", "..", "uploads", "_generated");
if (!fs.existsSync(generatedRoot)) fs.mkdirSync(generatedRoot, { recursive: true });

export const demoRouter = Router();

function serializeQuestion(row: any): InterviewQuestionItem {
  return {
    id: row.id,
    category: row.category,
    subType: row.sub_type || undefined,
    question: row.question,
    intent: row.intent || "",
    evidence: row.evidence ? JSON.parse(row.evidence) : [],
    expectedInsight: row.expected_insight || "",
    tacitKnowledgeType: row.tacit_knowledge_type || "",
    sampleAnswer: row.sample_answer || ""
  };
}

demoRouter.get("/projects/:id/demo/eligibility", (req, res) => {
  const answered = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT ia.question_id) c FROM interview_answers ia
         JOIN interview_questions iq ON iq.id = ia.question_id WHERE iq.project_id = ?`
      )
      .get(req.params.id) as any
  ).c;
  const analyzed = (
    db.prepare("SELECT COUNT(*) c FROM documents WHERE project_id = ? AND status = 'analyzed'").get(req.params.id) as any
  ).c;
  const eligible = answered > 0 || analyzed > 0;
  res.json({
    eligible,
    answeredCount: answered,
    analyzedDocCount: analyzed,
    reason: eligible ? "" : "먼저 자료 분석 또는 인터뷰 답변을 최소 1건 이상 등록하세요."
  });
});

demoRouter.get("/projects/:id/demo", (req, res) => {
  const demo = db.prepare("SELECT * FROM demos WHERE project_id = ? ORDER BY created_at DESC LIMIT 1").get(req.params.id) as any;
  if (!demo) return res.json({ demo: null, agent: null });
  const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(demo.agent_id) as any;
  res.json({
    demo: {
      id: demo.id,
      status: demo.status,
      screens: demo.screens ? JSON.parse(demo.screens) : [],
      scenario: demo.scenario ? JSON.parse(demo.scenario) : null,
      hasHtml: Boolean(demo.html_path),
      errorMessage: demo.error_message,
      createdAt: demo.created_at,
      updatedAt: demo.updated_at
    },
    agent: agent
      ? {
          id: agent.id,
          name: agent.name,
          purpose: agent.purpose,
          users: JSON.parse(agent.users || "[]"),
          workflow: JSON.parse(agent.workflow || "[]"),
          rules: JSON.parse(agent.rules || "[]"),
          humanApproval: JSON.parse(agent.human_approval || "{}")
        }
      : null
  });
});

demoRouter.post("/projects/:id/demo/generate", async (req, res) => {
  const projectId = req.params.id;
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
  if (!project) return res.status(404).json({ error: "프로젝트를 찾을 수 없습니다." });

  const now = new Date().toISOString();
  const demoId = nanoid(10);
  db.prepare(
    `INSERT INTO demos (id, project_id, status, created_at, updated_at) VALUES (?, ?, 'generating', ?, ?)`
  ).run(demoId, projectId, now, now);

  try {
    const analyzedDocs = db.prepare("SELECT * FROM documents WHERE project_id = ? AND status = 'analyzed'").all(projectId) as any[];
    const analyses = analyzedDocs.map((d) => JSON.parse(d.analysis_result));

    const questions = db.prepare("SELECT * FROM interview_questions WHERE project_id = ?").all(projectId) as any[];
    const answers = db
      .prepare(
        `SELECT ia.* FROM interview_answers ia JOIN interview_questions iq ON iq.id = ia.question_id WHERE iq.project_id = ?`
      )
      .all(projectId) as any[];
    const answerByQ = new Map(answers.map((a) => [a.question_id, a.answer_text]));
    const qaPairs = questions
      .filter((q) => answerByQ.has(q.id))
      .map((q) => ({ question: serializeQuestion(q), answer: answerByQ.get(q.id)! }));

    const tacitRows = db.prepare("SELECT type, description FROM tacit_knowledge WHERE project_id = ?").all(projectId) as any[];

    const { result } = await generateAgentDemo({
      projectName: project.name,
      client: project.client,
      description: project.description || "",
      goal: project.goal,
      analyses,
      qaPairs,
      tacitKnowledge: tacitRows
    });

    const agentId = nanoid(10);
    db.prepare(
      `INSERT INTO agents (id, project_id, name, purpose, users, workflow, rules, human_approval, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      agentId,
      projectId,
      result.agent.name,
      result.agent.purpose,
      JSON.stringify(result.agent.users),
      JSON.stringify(result.agent.workflow),
      JSON.stringify(result.agent.rules),
      JSON.stringify(result.agent.humanApproval),
      now
    );

    const html = renderDemoHtml({ projectName: project.name, client: project.client }, result.agent, result.screens, result.scenario);
    const htmlPath = path.join(generatedRoot, `demo_${demoId}.html`);
    fs.writeFileSync(htmlPath, html, "utf-8");

    db.prepare(
      "UPDATE demos SET status = 'ready', agent_id = ?, screens = ?, scenario = ?, html_path = ?, updated_at = ? WHERE id = ?"
    ).run(agentId, JSON.stringify(result.screens), JSON.stringify(result.scenario), htmlPath, new Date().toISOString(), demoId);

    res.status(201).json({
      demo: { id: demoId, status: "ready", screens: result.screens, scenario: result.scenario, hasHtml: true },
      agent: { id: agentId, ...result.agent }
    });
  } catch (err) {
    db.prepare("UPDATE demos SET status = 'error', error_message = ?, updated_at = ? WHERE id = ?").run(
      (err as Error).message,
      new Date().toISOString(),
      demoId
    );
    res.status(500).json({ error: `Demo 생성 실패: ${(err as Error).message}` });
  }
});

demoRouter.get("/demos/:id/html", (req, res) => {
  const demo = db.prepare("SELECT * FROM demos WHERE id = ?").get(req.params.id) as any;
  if (!demo || !demo.html_path || !fs.existsSync(demo.html_path)) {
    return res.status(404).send("Demo HTML을 찾을 수 없습니다.");
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  fs.createReadStream(demo.html_path).pipe(res);
});

demoRouter.get("/demos/:id/download", (req, res) => {
  const demo = db.prepare("SELECT * FROM demos WHERE id = ?").get(req.params.id) as any;
  if (!demo || !demo.html_path || !fs.existsSync(demo.html_path)) {
    return res.status(404).json({ error: "파일을 찾을 수 없습니다." });
  }
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(demo.project_id) as any;
  res.download(demo.html_path, `${project?.name || "demo"}_Demo_UI.html`);
});
