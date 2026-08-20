export type QuestStepId =
  | "docs"
  | "interview_questions"
  | "interview_answers"
  | "demo"
  | "presentation"
  | "requirements"
  | "prd"
  | "wbs";

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
    demoReady: boolean;
    presentationReady: boolean;
  };
}

export interface Project {
  id: string;
  name: string;
  client: string;
  owner?: string;
  org?: string;
  projectType?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  goal?: string;
  createdAt: string;
  updatedAt: string;
  progress: ProjectProgress;
}

export type DocumentStatus = "uploaded" | "analyzing" | "analyzed" | "failed";

export interface DocumentAnalysis {
  businessContext: string;
  keyUsers: string[];
  process: string[];
  systems: string[];
  businessRules: string[];
  decisionPoints: string[];
  exceptions: string[];
  painPoints: string[];
  aiOpportunities: string[];
  unknowns: string[];
}

export interface ProjectDocument {
  id: string;
  projectId: string;
  filename: string;
  fileType: string;
  sizeBytes: number;
  uploader: string;
  status: DocumentStatus;
  analysisResult: DocumentAnalysis | null;
  errorMessage: string | null;
  uploadedAt: string;
  analyzedAt: string | null;
}

export interface EvidenceRef {
  document: string;
  page?: number;
  section?: string;
  quote?: string;
}

export interface InterviewQuestion {
  id: string;
  category: string;
  subType?: string;
  question: string;
  intent: string;
  evidence: EvidenceRef[];
  expectedInsight: string;
  tacitKnowledgeType: string;
  sampleAnswer: string;
}

export interface InterviewSet {
  id: string;
  projectId: string;
  status: "idle" | "generating" | "ready" | "error";
  questionCount: number;
  source: string | null;
  hasDocx: boolean;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExtractedInsights {
  explicitRules: string[];
  tacitRules: string[];
  exceptions: string[];
  decisionCriteria: string[];
  riskSignals: string[];
  workarounds: string[];
  constraints: string[];
}

export interface InterviewAnswer {
  id: string;
  questionId: string;
  answerText: string;
  note: string | null;
  extracted: ExtractedInsights | null;
  source: "manual" | "upload";
  sourceDocument: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TacitKnowledgeItem {
  id: string;
  type: string;
  description: string;
  evidence: EvidenceRef[];
  confidence: number;
  sourceQuestionId: string | null;
  createdAt: string;
}

export interface AgentWorkflowStep {
  order: number;
  name: string;
  description: string;
  actor: "agent" | "human" | "system";
  criteria?: string[];
}

export interface AgentConcept {
  id?: string;
  name: string;
  purpose: string;
  users: string[];
  workflow: AgentWorkflowStep[];
  rules: string[];
  humanApproval: { required: boolean; points: string[] };
}

export interface DemoScreen {
  id: string;
  kind: "input" | "analysis" | "decision" | "monitor";
  title: string;
  description: string;
  status: "confirmed" | "ai_inferred" | "need_confirmation";
  mockData: Record<string, unknown>;
}

export interface DemoScenario {
  caseId: string;
  agentName: string;
  steps: { label: string; status: "pass" | "warn" | "fail"; detail: string }[];
  decision: { outcome: "approve" | "review_required" | "reject"; reason: string; confidence: number };
}

export interface DemoState {
  id: string;
  status: "idle" | "generating" | "ready" | "error";
  screens: DemoScreen[];
  scenario: DemoScenario | null;
  hasHtml?: boolean;
  errorMessage?: string | null;
}

export interface PresentationSlide {
  order: number;
  title: string;
  layout: string;
  bullets?: string[];
  subtitle?: string;
  table?: { headers: string[]; rows: string[][] };
  columns?: { title: string; bullets: string[] }[];
}

export interface PresentationState {
  id: string;
  status: "idle" | "generating" | "ready" | "error";
  slides: PresentationSlide[];
  hasFile: boolean;
  errorMessage?: string | null;
}

export type LlmProviderId = "anthropic" | "openai" | "openrouter" | "google";

export interface LlmProviderInfo {
  id: LlmProviderId;
  label: string;
}

export interface LlmModel {
  id: string;
  name: string;
  provider: LlmProviderId;
  modelId: string;
  hasApiKey: boolean;
  apiKeyPreview: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LlmActiveInfo {
  provider: LlmProviderId;
  model: string;
  modelName: string;
  source: "registered" | "env";
}
