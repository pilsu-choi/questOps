import { db } from "../db.js";

export const QUEST_STEPS = [
  { id: "docs", label: "자료 수집 & 분석" },
  { id: "domain_knowledge", label: "도메인 지식" },
  { id: "interview_questions", label: "1차 인터뷰 질의서" },
  { id: "interview_answers", label: "인터뷰 결과 / 암묵지" },
  { id: "demo", label: "Demo UI" },
  { id: "presentation", label: "PPT" },
  { id: "requirements", label: "요구사항 확정" },
  { id: "prd", label: "PRD" },
  { id: "wbs", label: "WBS / TODO" }
] as const;

export type QuestStepId = (typeof QUEST_STEPS)[number]["id"];

export interface QuestStepStatus {
  id: QuestStepId;
  label: string;
  status: "done" | "current" | "pending";
}

export interface ProjectProgress {
  steps: QuestStepStatus[];
  currentStepId: QuestStepId;
  currentStepLabel: string;
  progressPct: number;
  stats: {
    documentCount: number;
    analyzedCount: number;
    questionCount: number;
    answeredCount: number;
    tacitKnowledgeCount: number;
    domainKnowledgeReady: boolean;
    demoReady: boolean;
    presentationReady: boolean;
  };
}

export function computeProjectProgress(projectId: string): ProjectProgress {
  const documentCount = (db.prepare("SELECT COUNT(*) c FROM documents WHERE project_id = ?").get(projectId) as any).c;
  const analyzedCount = (
    db.prepare("SELECT COUNT(*) c FROM documents WHERE project_id = ? AND status = 'analyzed'").get(projectId) as any
  ).c;
  const questionSet = db
    .prepare("SELECT * FROM interview_sets WHERE project_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(projectId) as any;
  const questionCount = questionSet?.status === "ready" ? questionSet.question_count : 0;
  const answeredCount = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT ia.question_id) c FROM interview_answers ia
         JOIN interview_questions iq ON iq.id = ia.question_id
         WHERE iq.project_id = ?`
      )
      .get(projectId) as any
  ).c;
  const tacitKnowledgeCount = (
    db.prepare("SELECT COUNT(*) c FROM tacit_knowledge WHERE project_id = ?").get(projectId) as any
  ).c;
  const domainKnowledge = db
    .prepare("SELECT * FROM domain_knowledge WHERE project_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(projectId) as any;
  const demo = db.prepare("SELECT * FROM demos WHERE project_id = ? ORDER BY created_at DESC LIMIT 1").get(projectId) as any;
  const presentation = db
    .prepare("SELECT * FROM presentations WHERE project_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(projectId) as any;

  const done: Record<QuestStepId, boolean> = {
    docs: analyzedCount > 0,
    domain_knowledge: domainKnowledge?.status === "ready",
    interview_questions: questionSet?.status === "ready" && questionCount > 0,
    interview_answers: answeredCount > 0 && questionCount > 0 && answeredCount >= questionCount,
    demo: demo?.status === "ready",
    presentation: presentation?.status === "ready",
    requirements: false,
    prd: false,
    wbs: false
  };

  let currentStepId: QuestStepId = "docs";
  for (const step of QUEST_STEPS) {
    if (!done[step.id]) {
      currentStepId = step.id;
      break;
    }
    currentStepId = step.id;
  }

  const steps: QuestStepStatus[] = QUEST_STEPS.map((s) => ({
    id: s.id,
    label: s.label,
    status: done[s.id] ? "done" : s.id === currentStepId ? "current" : "pending"
  }));

  const doneCount = steps.filter((s) => s.status === "done").length;

  return {
    steps,
    currentStepId,
    currentStepLabel: QUEST_STEPS.find((s) => s.id === currentStepId)!.label,
    progressPct: Math.round((doneCount / QUEST_STEPS.length) * 100),
    stats: {
      documentCount,
      analyzedCount,
      questionCount,
      answeredCount,
      tacitKnowledgeCount,
      domainKnowledgeReady: domainKnowledge?.status === "ready",
      demoReady: demo?.status === "ready",
      presentationReady: presentation?.status === "ready"
    }
  };
}
