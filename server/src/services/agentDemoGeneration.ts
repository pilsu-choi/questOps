import { z } from "zod";
import { nanoid } from "nanoid";
import { completeJSON, llmAvailable, NoLLMError } from "../llm/provider.js";
import { toolCallingAvailable } from "../llm/toolCalling.js";
import { runAgentLoop } from "../agent-runtime/loop.js";
import { runFanOutAgents } from "../agent-runtime/fanOut.js";
import { createSubmitTool, createPlanTool } from "../agent-runtime/tools.js";
import { createScratchWorkspaceTools, cleanupScratchWorkspace } from "../agent-runtime/scratchTools.js";
import { createProjectDocumentTools } from "../agent-runtime/projectDocumentTools.js";
import { saveAgentRunLog } from "../agent-runtime/log.js";
import type { AgentConcept, DemoScreen, DemoScenario, DocumentAnalysis, InterviewQuestionItem } from "../types.js";
import { logDebug, logError } from "../logger.js";

export interface DemoGenerationInput {
  projectId: string;
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

function buildContext(input: DemoGenerationInput): string {
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
${tacitText || "(없음)"}`;
}

function buildUserPrompt(input: DemoGenerationInput): string {
  return `${buildContext(input)}

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

const AgentWorkflowStepSchema = z.object({
  order: z.number(),
  name: z.string(),
  description: z.string(),
  actor: z.enum(["agent", "human", "system"]),
  criteria: z.array(z.string()).optional()
});

const AgentConceptSchema = z.object({
  name: z.string(),
  purpose: z.string(),
  users: z.array(z.string()),
  input: z.array(z.string()),
  workflow: z.array(AgentWorkflowStepSchema),
  rules: z.array(z.string()),
  exceptions: z.array(z.string()),
  dataSources: z.array(z.string()),
  humanApproval: z.object({ required: z.boolean(), points: z.array(z.string()) }),
  output: z.array(z.string())
});

const DemoScreenSchema = z.object({
  id: z.string(),
  kind: z.enum(["input", "analysis", "decision", "monitor"]),
  title: z.string(),
  description: z.string(),
  status: z.enum(["confirmed", "ai_inferred", "need_confirmation"]),
  mockData: z.record(z.any())
});

const DemoScenarioSchema = z.object({
  caseId: z.string(),
  agentName: z.string(),
  steps: z.array(
    z.object({
      label: z.string(),
      status: z.enum(["pass", "warn", "fail"]),
      detail: z.string(),
      evidenceQuestionId: z.string().optional()
    })
  ),
  decision: z.object({
    outcome: z.enum(["approve", "review_required", "reject"]),
    reason: z.string(),
    confidence: z.number()
  })
});

const RawDemoSchema = z.object({
  agent: AgentConceptSchema,
  screens: z.array(DemoScreenSchema),
  scenario: DemoScenarioSchema
});

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

// agent 컨셉을 먼저 생성해 나머지 서브에이전트가 공유하는 고정 컨텍스트로 삼는다(그라운딩).
// 화면 4개(input/analysis/decision/monitor)와 시나리오가 서로 다른 Agent 이름/목적/규칙을
// 상상해내는 것을 막기 위함이다 - 이 단계가 없으면 각 서브에이전트가 독립적으로 Agent를
// 추론해 이름이나 workflow가 갈릴 위험이 있다.
function buildAgentOnlyPrompt(input: DemoGenerationInput): string {
  return `${buildContext(input)}

위 내용을 근거로 AI Agent 컨셉만 다음 JSON 형식으로 생성하라 (화면/시나리오는 이번 요청에 포함하지 않는다):
{
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
}
반드시 제공된 자료의 실제 업무 용어, 조직명, 시스템명, 규칙을 사용하고 절대 "AI Assistant", "Chatbot" 같은 범용적인 이름/설명을 만들지 않는다.
Human-in-the-loop 지점을 명확히 표시한다. JSON만 출력.`;
}

const SCREEN_KIND_ORDER: DemoScreen["kind"][] = ["input", "analysis", "decision", "monitor"];

const SCREEN_KIND_HINTS: Record<DemoScreen["kind"], string> = {
  input: "사용자 입력/접수 화면 - 처리 대상 건의 정보를 사용자가 입력/접수하는 화면",
  analysis: "AI 판단·근거 화면 - Business Rule 검토 및 예외 탐지 등 AI의 1차 분석 결과와 근거를 보여주는 화면",
  decision: "사람 승인/반려 화면 - AI 판단 결과에 대해 담당자가 최종 승인/반려를 결정하는 화면",
  monitor: "처리 현황 모니터링 화면 - 전체 처리 건의 현황과 감사 로그를 보여주는 화면"
};

function buildScreenPrompt(input: DemoGenerationInput, agent: AgentConcept, kind: DemoScreen["kind"]): string {
  return `${buildContext(input)}

--- 이미 설계된 AI Agent 컨셉 (아래 내용과 일치하도록 화면을 설계하라) ---
${JSON.stringify(agent, null, 2)}

이번 요청에서는 kind="${kind}" 화면 하나만 설계한다 (다른 kind는 만들지 않는다). ${SCREEN_KIND_HINTS[kind]}
다음 JSON 하나만 생성하라:
{
  "id": "${kind}",
  "kind": "${kind}",
  "title": "화면 제목 (실제 업무 용어 사용)",
  "description": "설명",
  "status": "confirmed|ai_inferred|need_confirmation",
  "mockData": { "설명 목적의 key-value 쌍": "실제 업무 맥락을 반영한 realistic mock 값" }
}
JSON만 출력.`;
}

function buildScenarioPrompt(input: DemoGenerationInput, agent: AgentConcept): string {
  return `${buildContext(input)}

--- 이미 설계된 AI Agent 컨셉 (아래 내용을 그대로 사용해 시나리오를 설계하라) ---
${JSON.stringify(agent, null, 2)}

이번 요청에서는 이 Agent가 처리하는 대표 Demo 시나리오 하나만 설계한다.
다음 JSON 하나만 생성하라:
{
  "caseId": "실제 업무에서 쓸 법한 케이스 번호 형식",
  "agentName": "${agent.name}",
  "steps": [{ "label": "단계", "status": "pass|warn|fail", "detail": "설명" }],
  "decision": { "outcome": "approve|review_required|reject", "reason": "판단 근거", "confidence": 0.0 }
}
JSON만 출력.`;
}

async function generateAgentDemoAgentic(input: DemoGenerationInput): Promise<RawDemo> {
  const runIds: string[] = [];

  try {
    const agentRunId = nanoid(12);
    runIds.push(agentRunId);
    const agentResult = await runAgentLoop({
      runLabel: "agentDemoGeneration:agent",
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: `${buildAgentOnlyPrompt(input)}\n\n요약만으로 부족하면 list_project_documents/read_project_document_chunk로 원문을 직접 확인할 수 있다.\n설계가 끝나면 submit_result 툴을 호출해 제출하라.`,
      tools: [
        createPlanTool(agentRunId),
        ...createScratchWorkspaceTools(agentRunId),
        ...createProjectDocumentTools(input.projectId),
        createSubmitTool(AgentConceptSchema, "AI Agent 컨셉을 제출한다.")
      ],
      maxTurns: 5,
      maxTokensPerTurn: 5000
    });
    saveAgentRunLog(agentResult);
    if (agentResult.status !== "submitted" || !agentResult.submission) {
      throw new Error(`Agent 컨셉 생성이 실패했습니다 (status=${agentResult.status}). ${agentResult.error ?? ""}`.trim());
    }
    const agent = agentResult.submission as AgentConcept;

    const screenTasks = SCREEN_KIND_ORDER.map((kind) => {
      const runId = nanoid(12);
      runIds.push(runId);
      return {
        runLabel: `agentDemoGeneration:screen:${kind}`,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: `${buildScreenPrompt(input, agent, kind)}\n\n설계가 끝나면 submit_result 툴을 호출해 제출하라.`,
        tools: [
          createPlanTool(runId),
          ...createScratchWorkspaceTools(runId),
          ...createProjectDocumentTools(input.projectId),
          createSubmitTool(DemoScreenSchema, "Demo 화면 하나를 제출한다.")
        ],
        maxTurns: 4,
        maxTokensPerTurn: 4000
      };
    });

    const scenarioRunId = nanoid(12);
    runIds.push(scenarioRunId);
    const scenarioTask = {
      runLabel: "agentDemoGeneration:scenario",
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: `${buildScenarioPrompt(input, agent)}\n\n설계가 끝나면 submit_result 툴을 호출해 제출하라.`,
      tools: [
        createPlanTool(scenarioRunId),
        ...createScratchWorkspaceTools(scenarioRunId),
        ...createProjectDocumentTools(input.projectId),
        createSubmitTool(DemoScenarioSchema, "Demo 시나리오를 제출한다.")
      ],
      maxTurns: 4,
      maxTokensPerTurn: 4000
    };

    // screenTasks가 SCREEN_KIND_ORDER 순서대로 배열돼 있고, runFanOutAgents는 완료 순서와
    // 무관하게 입력 인덱스 순서로 결과를 반환하므로 슬라이스만으로 kind별 결과를 안전하게 뽑을 수 있다.
    const results = await runFanOutAgents([...screenTasks, scenarioTask]);
    results.forEach((r) => saveAgentRunLog(r));

    const failed = results.find((r) => r.status !== "submitted" || !r.submission);
    if (failed) {
      throw new Error(
        `Demo 화면/시나리오 fan-out 중 일부가 실패했습니다 (${failed.runLabel} status=${failed.status}). ${failed.error ?? ""}`.trim()
      );
    }

    const screens = results.slice(0, SCREEN_KIND_ORDER.length).map((r) => r.submission as DemoScreen);
    const scenario = results[results.length - 1].submission as DemoScenario;

    return { agent, screens, scenario };
  } finally {
    for (const runId of runIds) cleanupScratchWorkspace(runId);
  }
}

export async function generateAgentDemo(input: DemoGenerationInput): Promise<{ result: RawDemo; mode: "llm" | "heuristic" }> {
  const overallStart = Date.now();
  logDebug(`[agentDemoGeneration] start project="${input.projectName}" analyses=${input.analyses.length} qaPairs=${input.qaPairs.length} tacitKnowledge=${input.tacitKnowledge.length}`);

  if (llmAvailable()) {
    if (toolCallingAvailable()) {
      logDebug(`[agentDemoGeneration] attempting agentic path`);
      try {
        const raw = await generateAgentDemoAgentic(input);
        logDebug(`[agentDemoGeneration] agentic path returned agent=${Boolean(raw?.agent)} screens=${raw?.screens?.length ?? 0}, totalElapsedMs=${Date.now() - overallStart}`);
        if (raw?.agent && raw?.screens?.length) return { result: raw, mode: "llm" };
      } catch (err) {
        logError("agent loop failed for agentDemoGeneration, falling back to single-turn completeJSON", err);
      }
    }
    logDebug(`[agentDemoGeneration] attempting single-turn completeJSON path`);
    try {
      const raw = await completeJSON<RawDemo>(SYSTEM_PROMPT, buildUserPrompt(input), 16000);
      logDebug(`[agentDemoGeneration] completeJSON path returned agent=${Boolean(raw?.agent)} screens=${raw?.screens?.length ?? 0}, totalElapsedMs=${Date.now() - overallStart}`);
      if (raw?.agent && raw?.screens?.length) return { result: raw, mode: "llm" };
    } catch (err) {
      if (!(err instanceof NoLLMError)) logError("LLM demo generation failed, falling back", err);
    }
  }
  logDebug(`[agentDemoGeneration] using heuristic fallback, totalElapsedMs=${Date.now() - overallStart}`);
  return { result: heuristicGenerate(input), mode: "heuristic" };
}
