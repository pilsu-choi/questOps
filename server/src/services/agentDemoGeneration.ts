import { completeJSON, llmAvailable, NoLLMError } from "../llm/provider.js";
import type { AgentConcept, DemoScreen, DemoScenario, DocumentAnalysis, InterviewQuestionItem } from "../types.js";

export interface DemoGenerationInput {
  projectName: string;
  client: string;
  description: string;
  goal?: string;
  analyses: DocumentAnalysis[];
  qaPairs: { question: InterviewQuestionItem; answer: string }[];
  tacitKnowledge: { type: string; description: string }[];
}

const SYSTEM_PROMPT = `당신은 AI Agent 설계를 담당하는 Principal AI Solutions Architect다.
프로젝트 문서 분석 결과, 인터뷰 질문/답변, 추출된 Tacit Knowledge를 근거로 실제로 구축 가능한 AI Agent 컨셉과 그 Agent가 처리하는 대표 사례(Demo Scenario)를 설계한다.
반드시 제공된 자료의 실제 업무 용어, 조직명, 시스템명, 규칙을 사용하고 절대 "AI Assistant", "Chatbot" 같은 범용적인 이름/설명을 만들지 않는다.
Human-in-the-loop 지점을 명확히 표시한다.`;

function buildUserPrompt(input: DemoGenerationInput): string {
  const analysisText = input.analyses
    .map(
      (a, i) =>
        `문서 ${i + 1}: ${a.businessContext}\n프로세스: ${a.process.join(" / ")}\n규칙: ${a.businessRules.join(
          " / "
        )}\n예외: ${a.exceptions.join(" / ")}\n시스템: ${a.systems.join(" / ")}`
    )
    .join("\n\n");
  const qaText = input.qaPairs
    .map((qa) => `Q(${qa.question.category}/${qa.question.tacitKnowledgeType}): ${qa.question.question}\nA: ${qa.answer}`)
    .join("\n\n");
  const tacitText = input.tacitKnowledge.map((t) => `[${t.type}] ${t.description}`).join("\n");

  return `프로젝트: ${input.projectName} (고객사: ${input.client})
설명: ${input.description}
목표: ${input.goal || "명시되지 않음"}

--- 문서 분석 요약 ---
${analysisText || "(없음)"}

--- 인터뷰 Q&A ---
${qaText || "(없음)"}

--- 추출된 Tacit Knowledge ---
${tacitText || "(없음)"}

위 내용을 근거로 다음 JSON을 생성하라:
{
  "agent": {
    "name": "실제 업무 맥락을 반영한 Agent 이름",
    "purpose": "Agent의 목적 (2-3문장)",
    "users": ["실제 사용자/조직"],
    "input": ["Agent가 받는 입력 데이터/문서"],
    "workflow": [
      { "order": 1, "name": "단계명", "description": "설명", "actor": "agent|human|system", "criteria": ["판단 기준"] }
    ],
    "rules": ["Agent가 적용하는 실제 Business Rule / Tacit Rule"],
    "exceptions": ["Agent가 인지해야 하는 예외 상황"],
    "dataSources": ["연동 시스템/데이터"],
    "humanApproval": { "required": true, "points": ["사람이 반드시 확인해야 하는 지점"] },
    "output": ["Agent의 최종 산출물/액션"]
  },
  "screens": [
    {
      "id": "input",
      "kind": "input",
      "title": "화면 제목 (실제 업무 용어 사용)",
      "description": "설명",
      "status": "confirmed|ai_inferred|need_confirmation",
      "mockData": { "설명 목적의 key-value 쌍": "실제 업무 맥락을 반영한 realistic mock 값" }
    }
  ],
  "scenario": {
    "caseId": "실제 업무에서 쓸 법한 케이스 번호 형식",
    "agentName": "Agent 이름",
    "steps": [{ "label": "단계", "status": "pass|warn|fail", "detail": "설명" }],
    "decision": { "outcome": "approve|review_required|reject", "reason": "판단 근거", "confidence": 0.0 }
  }
}
screens는 정확히 4개: input(사용자 입력/접수), analysis(AI 판단·근거), decision(사람 승인/반려), monitor(처리 현황 모니터링).
JSON만 출력.`;
}

interface RawDemo {
  agent: AgentConcept;
  screens: DemoScreen[];
  scenario: DemoScenario;
}

function heuristicGenerate(input: DemoGenerationInput): RawDemo {
  const rules = input.analyses.flatMap((a) => a.businessRules).slice(0, 6);
  const tacitRules = input.tacitKnowledge.filter((t) => t.type === "tacitRule" || t.type === "hidden_rule").map((t) => t.description);
  const exceptions = [...input.analyses.flatMap((a) => a.exceptions), ...input.tacitKnowledge.filter((t) => t.type === "exception").map((t) => t.description)].slice(0, 6);
  const systems = [...new Set(input.analyses.flatMap((a) => a.systems))].slice(0, 5);
  const users = [...new Set(input.analyses.flatMap((a) => a.keyUsers))].slice(0, 5);
  const process = input.analyses.flatMap((a) => a.process).slice(0, 5);
  const approvalPoints = input.tacitKnowledge.filter((t) => t.type === "trust_boundary" || t.type === "decisionCriteria").map((t) => t.description);

  const baseName = input.projectName.replace(/AI Agent 구축|고도화|컨설팅/g, "").trim() || input.projectName;
  const agentName = `${baseName} Agent`.replace(/\s+/g, " ").trim();

  const agent: AgentConcept = {
    name: agentName,
    purpose: input.goal || input.description || `${input.client} 업무 담당자의 판단을 보조하는 AI Agent`,
    users: users.length ? users : [`${input.client} 실무 담당자`],
    input: process.length ? process.slice(0, 3) : ["접수 데이터", "관련 서류"],
    workflow: [
      { order: 1, name: "입력 접수", description: process[0] || "사용자가 처리 대상 건을 입력/접수한다.", actor: "human", criteria: [] },
      { order: 2, name: "데이터 조회", description: systems.length ? `${systems.join(", ")}에서 관련 데이터를 조회한다.` : "관련 시스템에서 데이터를 조회한다.", actor: "agent", criteria: [] },
      { order: 3, name: "Business Rule 검토", description: rules[0] || "정의된 업무 규칙에 따라 1차 검토를 수행한다.", actor: "agent", criteria: rules.slice(0, 3) },
      { order: 4, name: "예외/리스크 탐지", description: exceptions[0] || "예외 및 리스크 신호를 탐지한다.", actor: "agent", criteria: exceptions.slice(0, 3) },
      { order: 5, name: "판단 및 근거 제시", description: "검토 결과와 근거를 정리하여 제시한다.", actor: "agent", criteria: tacitRules.slice(0, 3) },
      { order: 6, name: "담당자 승인", description: "담당자가 판단 결과를 검토 후 승인/반려한다.", actor: "human", criteria: approvalPoints.slice(0, 3) },
      { order: 7, name: "처리 실행 및 기록", description: "승인된 건을 처리하고 이력을 기록한다.", actor: "system", criteria: [] }
    ],
    rules: [...rules, ...tacitRules].slice(0, 8),
    exceptions,
    dataSources: systems.length ? systems : ["연동 시스템 미확인 (인터뷰 필요)"],
    humanApproval: {
      required: true,
      points: approvalPoints.length ? approvalPoints : ["AI 판단 결과에 대한 담당자 최종 승인"]
    },
    output: ["판단 결과 및 근거", "승인/반려 이력", "처리 완료 알림"]
  };

  const caseId = `#${new Date().getFullYear()}-${String(Math.floor(Math.random() * 90000) + 10000)}`;

  const screens: DemoScreen[] = [
    {
      id: "input",
      kind: "input",
      title: `${agentName} · 접수 화면`,
      description: process[0] || "처리 대상 건의 정보를 입력/접수하는 화면",
      status: process.length ? "confirmed" : "need_confirmation",
      mockData: { caseId, 접수정보: process.slice(0, 3), 담당자: users[0] || "담당자" }
    },
    {
      id: "analysis",
      kind: "analysis",
      title: "AI 판단 결과 & 근거",
      description: "Business Rule 검토 및 예외 탐지 결과",
      status: rules.length ? "ai_inferred" : "need_confirmation",
      mockData: { 검토항목: rules.slice(0, 4), 예외탐지: exceptions.slice(0, 3) }
    },
    {
      id: "decision",
      kind: "decision",
      title: "담당자 승인/반려",
      description: "AI 판단 결과에 대한 최종 승인 화면",
      status: approvalPoints.length ? "confirmed" : "ai_inferred",
      mockData: { 승인기준: approvalPoints.slice(0, 3) }
    },
    {
      id: "monitor",
      kind: "monitor",
      title: "처리 현황 모니터링",
      description: "전체 처리 건 현황 및 감사 로그",
      status: "need_confirmation",
      mockData: { 표시항목: ["처리건수", "승인율", "평균처리시간", "예외건수"] }
    }
  ];

  const steps = [
    { label: "Document Validation", status: "pass" as const, detail: process[0] || "입력 데이터 형식 검증 통과" },
    { label: "Business Rule Check", status: (rules.length ? "pass" : "warn") as "pass" | "warn", detail: rules[0] || "적용 가능한 규칙 정보 부족" },
    { label: "Exception / Risk Detection", status: (exceptions.length ? "warn" : "pass") as "pass" | "warn", detail: exceptions[0] || "탐지된 예외 없음" }
  ];

  const scenario: DemoScenario = {
    caseId,
    agentName,
    steps,
    decision: {
      outcome: exceptions.length ? "review_required" : "approve",
      reason: exceptions[0] || rules[0] || "정의된 기준에 따라 자동 판단",
      confidence: exceptions.length ? 0.62 : 0.88
    }
  };

  return { agent, screens, scenario };
}

export async function generateAgentDemo(input: DemoGenerationInput): Promise<{ result: RawDemo; mode: "llm" | "heuristic" }> {
  if (llmAvailable()) {
    try {
      const raw = await completeJSON<RawDemo>(SYSTEM_PROMPT, buildUserPrompt(input), 16000);
      if (raw?.agent && raw?.screens?.length) return { result: raw, mode: "llm" };
    } catch (err) {
      if (!(err instanceof NoLLMError)) console.error("LLM demo generation failed, falling back:", err);
    }
  }
  return { result: heuristicGenerate(input), mode: "heuristic" };
}
