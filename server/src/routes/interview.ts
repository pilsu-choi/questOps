import { Router } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import { db } from "../db.js";
import { generateInterviewQuestions } from "../services/interviewGeneration.js";
import { generateInterviewDocx } from "../services/docxGeneration.js";
import { extractInsightsFromAnswer } from "../services/tacitExtraction.js";
import { mapTranscriptToAnswers } from "../services/interviewAnswerMapping.js";
import { extractText, fixUploadedFilename } from "../services/fileParsing.js";
import type { DocInput } from "../services/factExtraction.js";
import type { InterviewQuestionItem } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const generatedRoot = path.join(__dirname, "..", "..", "uploads", "_generated");
if (!fs.existsSync(generatedRoot)) fs.mkdirSync(generatedRoot, { recursive: true });
const answerUploadRoot = path.join(__dirname, "..", "..", "uploads", "_answer_files");
if (!fs.existsSync(answerUploadRoot)) fs.mkdirSync(answerUploadRoot, { recursive: true });
const answerUpload = multer({ dest: answerUploadRoot, limits: { fileSize: 30 * 1024 * 1024 } });

export const interviewRouter = Router();

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

function serializeSet(row: any) {
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    questionCount: row.question_count,
    source: row.source,
    hasDocx: Boolean(row.docx_path),
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function getLatestSet(projectId: string) {
  return db.prepare("SELECT * FROM interview_sets WHERE project_id = ? ORDER BY created_at DESC LIMIT 1").get(projectId) as any;
}

interviewRouter.get("/projects/:id/interview", (req, res) => {
  const set = getLatestSet(req.params.id);
  if (!set) return res.json({ set: null, questions: [] });
  const questions = db
    .prepare("SELECT * FROM interview_questions WHERE set_id = ? ORDER BY order_num ASC")
    .all(set.id) as any[];
  res.json({ set: serializeSet(set), questions: questions.map(serializeQuestion) });
});

interviewRouter.get("/projects/:id/interview/eligibility", (req, res) => {
  const docs = db.prepare("SELECT status FROM documents WHERE project_id = ?").all(req.params.id) as any[];
  const analyzed = docs.filter((d) => d.status === "analyzed").length;
  const analyzing = docs.filter((d) => d.status === "analyzing" || d.status === "uploaded").length;
  const eligible = analyzed > 0 && analyzing === 0;
  let reason = "";
  if (docs.length === 0) reason = "업로드된 문서가 없습니다.";
  else if (analyzing > 0) reason = "분석이 진행 중인 문서가 있습니다.";
  else if (analyzed === 0) reason = "분석에 성공한 문서가 없습니다.";
  res.json({ eligible, analyzedCount: analyzed, analyzingCount: analyzing, totalCount: docs.length, reason });
});

async function buildDocxForSet(setId: string, projectId: string) {
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
  const questions = (db.prepare("SELECT * FROM interview_questions WHERE set_id = ? ORDER BY order_num ASC").all(setId) as any[]).map(
    serializeQuestion
  );
  const outPath = path.join(generatedRoot, `interview_${setId}.docx`);
  await generateInterviewDocx(
    { name: project.name, client: project.client, createdDate: new Date().toLocaleDateString("ko-KR") },
    questions,
    outPath
  );
  db.prepare("UPDATE interview_sets SET docx_path = ?, question_count = ?, updated_at = ? WHERE id = ?").run(
    outPath,
    questions.length,
    new Date().toISOString(),
    setId
  );
  return outPath;
}

interviewRouter.post("/projects/:id/interview/generate", async (req, res) => {
  const projectId = req.params.id;
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
  if (!project) return res.status(404).json({ error: "프로젝트를 찾을 수 없습니다." });

  const docs = db.prepare("SELECT * FROM documents WHERE project_id = ?").all(projectId) as any[];
  const analyzing = docs.filter((d) => d.status === "analyzing" || d.status === "uploaded");
  const analyzed = docs.filter((d) => d.status === "analyzed");
  if (analyzing.length > 0) return res.status(409).json({ error: "분석이 진행 중인 문서가 있습니다. 완료 후 다시 시도하세요." });
  if (analyzed.length === 0) return res.status(409).json({ error: "분석 완료된 문서가 없습니다. 먼저 자료를 업로드하고 분석을 완료하세요." });

  const setId = nanoid(10);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO interview_sets (id, project_id, status, question_count, created_at, updated_at) VALUES (?, ?, 'generating', 0, ?, ?)`
  ).run(setId, projectId, now, now);

  try {
    const docInputs: DocInput[] = analyzed.map((d) => ({
      filename: d.filename,
      extractedText: d.extracted_text || "",
      analysis: JSON.parse(d.analysis_result)
    }));
    const projectSummary = `${project.name} (${project.client}) — ${project.description || ""} 목표: ${project.goal || ""}`;
    const { questions, mode } = await generateInterviewQuestions(projectSummary, docInputs);

    if (questions.length === 0) {
      db.prepare("UPDATE interview_sets SET status = 'error', error_message = ?, updated_at = ? WHERE id = ?").run(
        "생성 가능한 질문이 없습니다. 문서 분석 결과에 판단 지점/규칙/예외 정보가 부족합니다.",
        new Date().toISOString(),
        setId
      );
      return res.status(422).json({ error: "생성 가능한 질문이 없습니다. 문서 분석 결과가 충분하지 않습니다." });
    }

    const insertQ = db.prepare(
      `INSERT INTO interview_questions (id, set_id, project_id, order_num, category, sub_type, question, intent, evidence, expected_insight, tacit_knowledge_type, sample_answer, edited)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    );
    questions.forEach((q, i) => {
      insertQ.run(
        `${setId}_${nanoid(6)}`,
        setId,
        projectId,
        i,
        q.category,
        q.subType || null,
        q.question,
        q.intent,
        JSON.stringify(q.evidence),
        q.expectedInsight,
        q.tacitKnowledgeType,
        q.sampleAnswer || ""
      );
    });

    db.prepare("UPDATE interview_sets SET status = 'ready', source = ?, question_count = ?, updated_at = ? WHERE id = ?").run(
      mode,
      questions.length,
      new Date().toISOString(),
      setId
    );

    await buildDocxForSet(setId, projectId);

    const set = db.prepare("SELECT * FROM interview_sets WHERE id = ?").get(setId);
    const savedQuestions = (db.prepare("SELECT * FROM interview_questions WHERE set_id = ? ORDER BY order_num ASC").all(setId) as any[]).map(
      serializeQuestion
    );
    res.status(201).json({ set: serializeSet(set), questions: savedQuestions });
  } catch (err) {
    db.prepare("UPDATE interview_sets SET status = 'error', error_message = ?, updated_at = ? WHERE id = ?").run(
      (err as Error).message,
      new Date().toISOString(),
      setId
    );
    res.status(500).json({ error: `질의서 생성 실패: ${(err as Error).message}` });
  }
});

interviewRouter.patch("/interview/questions/:id", async (req, res) => {
  const row = db.prepare("SELECT * FROM interview_questions WHERE id = ?").get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: "질문을 찾을 수 없습니다." });
  const { question, intent, category, expectedInsight, sampleAnswer } = req.body || {};
  db.prepare(
    `UPDATE interview_questions SET question = COALESCE(?, question), intent = COALESCE(?, intent), category = COALESCE(?, category), expected_insight = COALESCE(?, expected_insight), sample_answer = COALESCE(?, sample_answer), edited = 1 WHERE id = ?`
  ).run(question, intent, category, expectedInsight, sampleAnswer, req.params.id);
  const updated = db.prepare("SELECT * FROM interview_questions WHERE id = ?").get(req.params.id) as any;
  await buildDocxForSet(updated.set_id, updated.project_id);
  res.json(serializeQuestion(updated));
});

interviewRouter.delete("/interview/questions/:id", async (req, res) => {
  const row = db.prepare("SELECT * FROM interview_questions WHERE id = ?").get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: "질문을 찾을 수 없습니다." });
  db.prepare("DELETE FROM interview_questions WHERE id = ?").run(req.params.id);
  db.prepare("UPDATE interview_sets SET question_count = question_count - 1 WHERE id = ?").run(row.set_id);
  await buildDocxForSet(row.set_id, row.project_id);
  res.status(204).end();
});

interviewRouter.post("/projects/:id/interview/questions", async (req, res) => {
  const set = getLatestSet(req.params.id);
  if (!set) return res.status(409).json({ error: "먼저 질의서를 생성하세요." });
  const { category, question, intent, expectedInsight, tacitKnowledgeType, sampleAnswer } = req.body || {};
  if (!category || !question) return res.status(400).json({ error: "category와 question은 필수입니다." });
  const maxOrder = (db.prepare("SELECT MAX(order_num) m FROM interview_questions WHERE set_id = ?").get(set.id) as any).m || 0;
  const id = `${set.id}_${nanoid(6)}`;
  db.prepare(
    `INSERT INTO interview_questions (id, set_id, project_id, order_num, category, sub_type, question, intent, evidence, expected_insight, tacit_knowledge_type, sample_answer, edited)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, '[]', ?, ?, ?, 1)`
  ).run(id, set.id, req.params.id, maxOrder + 1, category, question, intent || "", expectedInsight || "", tacitKnowledgeType || "judgment", sampleAnswer || "");
  db.prepare("UPDATE interview_sets SET question_count = question_count + 1 WHERE id = ?").run(set.id);
  await buildDocxForSet(set.id, req.params.id);
  const created = db.prepare("SELECT * FROM interview_questions WHERE id = ?").get(id);
  res.status(201).json(serializeQuestion(created));
});

interviewRouter.get("/interview/sets/:id/docx", (req, res) => {
  const set = db.prepare("SELECT * FROM interview_sets WHERE id = ?").get(req.params.id) as any;
  if (!set || !set.docx_path || !fs.existsSync(set.docx_path)) {
    return res.status(404).json({ error: "문서 파일을 찾을 수 없습니다." });
  }
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(set.project_id) as any;
  res.download(set.docx_path, `${project?.name || "interview"}_1차인터뷰질의서.docx`);
});

// ---- Answers ----

function serializeAnswer(row: any) {
  return {
    id: row.id,
    questionId: row.question_id,
    answerText: row.answer_text,
    note: row.note,
    extracted: row.extracted ? JSON.parse(row.extracted) : null,
    source: row.source || "manual",
    sourceDocument: row.source_document || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

interviewRouter.get("/projects/:id/interview/answers", (req, res) => {
  const rows = db
    .prepare(
      `SELECT ia.* FROM interview_answers ia JOIN interview_questions iq ON iq.id = ia.question_id WHERE iq.project_id = ?`
    )
    .all(req.params.id) as any[];
  res.json(rows.map(serializeAnswer));
});

async function saveAnswerForQuestion(
  question: any,
  answerText: string,
  note: string | null,
  source: "manual" | "upload",
  sourceDocument: string | null
) {
  const existing = db.prepare("SELECT * FROM interview_answers WHERE question_id = ?").get(question.id) as any;
  const now = new Date().toISOString();

  const { insights, mode } = await extractInsightsFromAnswer(question.question, answerText);

  if (existing) {
    db.prepare(
      "UPDATE interview_answers SET answer_text = ?, note = ?, extracted = ?, source = ?, source_document = ?, updated_at = ? WHERE id = ?"
    ).run(answerText, note, JSON.stringify(insights), source, sourceDocument, now, existing.id);
  } else {
    db.prepare(
      `INSERT INTO interview_answers (id, question_id, project_id, answer_text, note, extracted, source, source_document, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(nanoid(10), question.id, question.project_id, answerText, note, JSON.stringify(insights), source, sourceDocument, now, now);
  }

  db.prepare("DELETE FROM tacit_knowledge WHERE source_question_id = ?").run(question.id);
  const insertTk = db.prepare(
    `INSERT INTO tacit_knowledge (id, project_id, source_question_id, type, description, evidence, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const confidence = mode === "llm" ? 0.85 : 0.55;
  const evidence = JSON.stringify([
    { document: sourceDocument || `인터뷰 답변 (${question.category})`, section: question.question.slice(0, 60) }
  ]);
  const buckets: [string, string[]][] = [
    ["explicitRule", insights.explicitRules],
    ["tacitRule", insights.tacitRules],
    ["exception", insights.exceptions],
    ["decisionCriteria", insights.decisionCriteria],
    ["riskSignal", insights.riskSignals],
    ["workaround", insights.workarounds],
    ["constraint", insights.constraints]
  ];
  for (const [type, items] of buckets) {
    for (const desc of items) {
      insertTk.run(nanoid(10), question.project_id, question.id, type, desc, evidence, confidence, now);
    }
  }

  return db.prepare("SELECT * FROM interview_answers WHERE question_id = ?").get(question.id);
}

interviewRouter.post("/interview/questions/:id/answer", async (req, res) => {
  const question = db.prepare("SELECT * FROM interview_questions WHERE id = ?").get(req.params.id) as any;
  if (!question) return res.status(404).json({ error: "질문을 찾을 수 없습니다." });
  const { answerText, note } = req.body || {};
  if (!answerText || !answerText.trim()) return res.status(400).json({ error: "답변 내용이 필요합니다." });

  const saved = await saveAnswerForQuestion(question, answerText, note || null, "manual", null);
  res.json(serializeAnswer(saved));
});

interviewRouter.post("/projects/:id/interview/answers/upload", answerUpload.single("file"), async (req, res) => {
  const projectId = req.params.id;
  const file = req.file;
  if (!file) return res.status(400).json({ error: "업로드할 파일이 없습니다." });

  const set = getLatestSet(projectId);
  if (!set) {
    fs.unlink(file.path, () => {});
    return res.status(409).json({ error: "먼저 1차 인터뷰 질의서를 생성하세요." });
  }
  const questions = db
    .prepare("SELECT * FROM interview_questions WHERE set_id = ? ORDER BY order_num ASC")
    .all(set.id) as any[];

  const displayName = fixUploadedFilename(file.originalname);
  try {
    const transcript = await extractText(file.path, displayName);
    if (!transcript || transcript.trim().length < 20) {
      return res.status(422).json({ error: "파일에서 텍스트를 추출하지 못했습니다. 텍스트가 포함된 문서인지 확인하세요." });
    }

    const mapped = await mapTranscriptToAnswers(
      transcript,
      questions.map((q) => ({ id: q.id, question: q.question, category: q.category }))
    );

    const results: { questionId: string; saved: boolean }[] = [];
    for (const m of mapped) {
      const question = questions.find((q) => q.id === m.questionId);
      if (!question || !m.answerText.trim()) continue;
      await saveAnswerForQuestion(question, m.answerText.trim(), null, "upload", displayName);
      results.push({ questionId: m.questionId, saved: true });
    }

    res.status(201).json({ matchedCount: results.length, totalQuestions: questions.length, filename: displayName });
  } catch (err) {
    res.status(500).json({ error: `답변 파일 처리 실패: ${(err as Error).message}` });
  } finally {
    fs.unlink(file.path, () => {});
  }
});

interviewRouter.get("/projects/:id/tacit-knowledge", (req, res) => {
  const rows = db
    .prepare("SELECT * FROM tacit_knowledge WHERE project_id = ? ORDER BY created_at DESC")
    .all(req.params.id) as any[];
  res.json(
    rows.map((r) => ({
      id: r.id,
      type: r.type,
      description: r.description,
      evidence: r.evidence ? JSON.parse(r.evidence) : [],
      confidence: r.confidence,
      sourceQuestionId: r.source_question_id,
      createdAt: r.created_at
    }))
  );
});
