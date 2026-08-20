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

export interface EvidenceRef {
  document: string;
  page?: number;
  section?: string;
  quote?: string;
}

export interface InterviewQuestionItem {
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

export interface ExtractedInsights {
  explicitRules: string[];
  tacitRules: string[];
  exceptions: string[];
  decisionCriteria: string[];
  riskSignals: string[];
  workarounds: string[];
  constraints: string[];
}

export interface AgentWorkflowStep {
  order: number;
  name: string;
  description: string;
  actor: "agent" | "human" | "system";
  criteria?: string[];
}

export interface AgentConcept {
  name: string;
  purpose: string;
  users: string[];
  input: string[];
  workflow: AgentWorkflowStep[];
  rules: string[];
  exceptions: string[];
  dataSources: string[];
  humanApproval: {
    required: boolean;
    points: string[];
  };
  output: string[];
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
  steps: {
    label: string;
    status: "pass" | "warn" | "fail";
    detail: string;
    evidenceQuestionId?: string;
  }[];
  decision: {
    outcome: "approve" | "review_required" | "reject";
    reason: string;
    confidence: number;
  };
}

export interface PresentationSlide {
  order: number;
  title: string;
  layout: "title" | "bullets" | "process" | "table" | "two-column" | "quote" | "closing";
  bullets?: string[];
  subtitle?: string;
  table?: { headers: string[]; rows: string[][] };
  columns?: { title: string; bullets: string[] }[];
  note?: string;
}
