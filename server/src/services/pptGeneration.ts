import { z } from "zod";
import { nanoid } from "nanoid";
import { completeJSON, llmAvailable, NoLLMError } from "../llm/provider.js";
import { toolCallingAvailable } from "../llm/toolCalling.js";
import { runAgentLoop } from "../agent-runtime/loop.js";
import { createSubmitTool, createPlanTool } from "../agent-runtime/tools.js";
import { createScratchWorkspaceTools, cleanupScratchWorkspace } from "../agent-runtime/scratchTools.js";
import { createProjectDocumentTools } from "../agent-runtime/projectDocumentTools.js";
import { saveAgentRunLog } from "../agent-runtime/log.js";
import type { AgentConcept, DemoScreen, DemoScenario, DocumentAnalysis, PresentationSlide } from "../types.js";
import { logError } from "../logger.js";

export interface PptInput {
  projectId: string;
  projectName: string;
  client: string;
  description: string;
  analyses: DocumentAnalysis[];
  tacitKnowledge: { type: string; description: string }[];
  agent?: AgentConcept;
  screens?: DemoScreen[];
  scenario?: DemoScenario;
}

const SYSTEM_PROMPT = `당신은 컨설팅 발표자료를 만드는 Principal AI Solutions Architect다.
프로젝트 문서 분석 결과, 추출된 Tacit Knowledge, (있다면) 제안된 AI Agent 컨셉과 Demo 화면 구성을 근거로
클라이언트에게 실제로 보여줄 수 있는 발표자료 슬라이드 구성안을 설계한다.
반드시 제공된 자료의 실제 업무 용어, 조직명, 시스템명, 규칙을 사용하고 "다양한 이해관계자", "효율성 향상" 같은
범용적인 문구를 만들지 않는다. 각 슬라이드는 근거 자료에서 실제로 확인된 내용만 담는다.`;

function buildUserPrompt(input: PptInput): string {
  const analysisText = input.analyses
    .map(
      (a, i) =>
        `문서 ${i + 1}: ${a.businessContext}\n프로세스: ${a.process.join(" / ")}\nPain Point: ${a.painPoints.join(
          " / "
        )}\n시스템: ${a.systems.join(" / ")}\n규칙: ${a.businessRules.join(" / ")}`
    )
    .join("\n\n");
  const tacitText = input.tacitKnowledge.map((t) => `[${t.type}] ${t.description}`).join("\n");
  const agentText = input.agent
    ? `이름: ${input.agent.name}\n목적: ${input.agent.purpose}\nWorkflow: ${input.agent.workflow
        .map((w) => `${w.order}.[${w.actor}]${w.name}`)
        .join(" -> ")}\n적용 규칙: ${input.agent.rules.join(" / ")}`
    : "";
  const screensText = input.screens?.length
    ? input.screens.map((s) => `${s.title} (${s.status})`).join(" / ")
    : "";
  const scenarioText = input.scenario
    ? `Case ${input.scenario.caseId}: ${input.scenario.steps.map((s) => `[${s.status}]${s.label}`).join(" -> ")} => ${
        input.scenario.decision.outcome
      } (${input.scenario.decision.reason})`
    : "";

  return `프로젝트: ${input.projectName} (고객사: ${input.client})
설명: ${input.description}

--- 문서 분석 요약 ---
${analysisText || "(없음)"}

--- 추출된 Tacit Knowledge ---
${tacitText || "(없음)"}

--- 제안된 AI Agent (있는 경우) ---
${agentText || "(아직 Agent 컨셉이 생성되지 않음)"}

--- Demo 화면 구성 (있는 경우) ---
${screensText || "(아직 Demo가 생성되지 않음)"}

--- Demo 시나리오 (있는 경우) ---
${scenarioText || "(없음)"}

위 내용을 근거로 다음 순서/레이아웃의 슬라이드를 JSON으로 생성하라. 각 슬라이드는 order, title, layout 필수이며
layout에 맞는 필드(bullets/table/columns/subtitle)를 채운다:

1. title: 프로젝트명 + 부제(고객사·제안 성격)
2. bullets: "Project Overview" — 프로젝트 설명, 관련 시스템, 분석 근거 요약
3. process: "Current Business Process" — 현재 업무 프로세스 단계 (최대 6개)
4. bullets: "Current Pain Points" — 실제 확인된 Pain Point (최대 6개)
5. table: "Interview Insights" — headers는 ["Type","Finding"], Tacit Knowledge 기반 행 (최대 8개)
6. bullets: "Tacit Knowledge / Key Findings" — tacitRule/hidden_rule/workaround 유형 위주 (최대 6개)
${input.agent ? `7. two-column: "Proposed AI Agent" — 좌측 컬럼 title은 Agent 이름, bullets는 목적, 우측 컬럼 title은 "적용 범위", bullets는 핵심 규칙 (최대 5개)
8. process: "Agent Workflow" — Agent workflow 단계를 "order. [actor] name — description" 형식으로` : ""}
${input.screens?.length ? `${input.agent ? 9 : 7}. two-column: "Demo UI" — 좌측 컬럼 title "화면 구성" bullets는 각 화면 "title (status)", 우측 컬럼 title은 시나리오 caseId 또는 "Scenario" bullets는 시나리오 단계 "[status] label: detail"` : ""}
다음: bullets: "Expected Benefits" — 근거 자료에 비추어 실제로 기대되는 효과 (반복 판단 자동화, 감사 대응력, human-in-the-loop 등 해당하는 것만)
마지막: closing: "Next Steps" — 다음 단계 제안 (추가 인터뷰, Demo 피드백, PRD 작성 등)

Agent 정보가 없으면 "Proposed AI Agent"/"Agent Workflow" 슬라이드를 만들지 말고, Demo 화면 정보가 없으면 "Demo UI" 슬라이드를 만들지 마라.
슬라이드 개수는 8~11개 사이. 설계가 끝나면 submit_result 툴을 호출해 제출하라.`;
}

const PresentationSlideSchema = z.object({
  order: z.number(),
  title: z.string(),
  layout: z.enum(["title", "bullets", "process", "table", "two-column", "quote", "closing"]),
  bullets: z.array(z.string()).optional(),
  subtitle: z.string().optional(),
  table: z.object({ headers: z.array(z.string()), rows: z.array(z.array(z.string())) }).optional(),
  columns: z.array(z.object({ title: z.string(), bullets: z.array(z.string()) })).optional(),
  note: z.string().optional()
});

const SlidePlanSchema = z.object({ slides: z.array(PresentationSlideSchema).min(6).max(12) });

function renumber(slides: PresentationSlide[]): PresentationSlide[] {
  return slides.map((s, i) => ({ ...s, order: i + 1 }));
}

function heuristicSlidePlan(input: PptInput): PresentationSlide[] {
  const slides: PresentationSlide[] = [];
  const painPoints = [...new Set(input.analyses.flatMap((a) => a.painPoints))];
  const process = [...new Set(input.analyses.flatMap((a) => a.process))];
  const systems = [...new Set(input.analyses.flatMap((a) => a.systems))];

  slides.push({
    order: 1,
    title: input.projectName,
    layout: "title",
    subtitle: `${input.client} · AI Agent 구축 제안`
  });

  slides.push({
    order: 2,
    title: "Project Overview",
    layout: "bullets",
    bullets: [
      input.description || "프로젝트 설명이 등록되지 않았습니다.",
      systems.length ? `관련 시스템: ${systems.slice(0, 5).join(", ")}` : "",
      `분석 문서 ${input.analyses.length}건 기반`
    ].filter(Boolean)
  });

  slides.push({
    order: 3,
    title: "Current Business Process",
    layout: "process",
    bullets: process.length ? process.slice(0, 6) : ["현재 프로세스 정보가 충분하지 않습니다."]
  });

  slides.push({
    order: 4,
    title: "Current Pain Points",
    layout: "bullets",
    bullets: painPoints.length ? painPoints.slice(0, 6) : ["문서에서 명확한 Pain Point가 식별되지 않았습니다."]
  });

  const tacit = input.tacitKnowledge;
  slides.push({
    order: 5,
    title: "Interview Insights",
    layout: "table",
    table: {
      headers: ["Type", "Finding"],
      rows: tacit.slice(0, 8).map((t) => [t.type, t.description.slice(0, 90)])
    }
  });

  slides.push({
    order: 6,
    title: "Tacit Knowledge / Key Findings",
    layout: "bullets",
    bullets: tacit
      .filter((t) => t.type === "tacitRule" || t.type === "hidden_rule" || t.type === "workaround")
      .slice(0, 6)
      .map((t) => t.description)
      .concat(tacit.length === 0 ? ["아직 인터뷰 답변에서 추출된 Tacit Knowledge가 없습니다."] : [])
  });

  if (input.agent) {
    slides.push({
      order: 7,
      title: "Proposed AI Agent",
      layout: "two-column",
      columns: [
        { title: input.agent.name, bullets: [input.agent.purpose] },
        { title: "적용 범위", bullets: input.agent.rules.slice(0, 5) }
      ]
    });

    slides.push({
      order: 8,
      title: "Agent Workflow",
      layout: "process",
      bullets: input.agent.workflow.map((w) => `${w.order}. [${w.actor}] ${w.name} — ${w.description}`)
    });
  }

  if (input.screens?.length) {
    slides.push({
      order: 9,
      title: "Demo UI",
      layout: "two-column",
      columns: [
        { title: "화면 구성", bullets: input.screens.map((s) => `${s.title} (${s.status})`) },
        {
          title: input.scenario ? `Scenario ${input.scenario.caseId}` : "Scenario",
          bullets: input.scenario ? input.scenario.steps.map((s) => `[${s.status}] ${s.label}: ${s.detail}`) : []
        }
      ]
    });
  }

  slides.push({
    order: 10,
    title: "Expected Benefits",
    layout: "bullets",
    bullets: [
      process.length ? `${process.length}개 처리 단계 중 반복 판단 업무 자동화` : "업무 처리 시간 단축",
      "판단 근거의 구조화·이력화를 통한 감사 대응력 강화",
      input.agent?.humanApproval?.required ? "Human-in-the-loop 유지로 리스크 관리" : "예외 상황에 대한 신속한 대응"
    ]
  });

  slides.push({
    order: 11,
    title: "Next Steps",
    layout: "closing",
    bullets: ["추가 인터뷰를 통한 미확인 항목 검증", "Demo UI 피드백 반영 및 v2 제작", "요구사항 확정 및 PRD 작성"]
  });

  return renumber(slides);
}

async function generateSlidePlanAgentic(input: PptInput): Promise<PresentationSlide[]> {
  const submitTool = createSubmitTool(SlidePlanSchema, "발표자료 슬라이드 구성안을 제출한다.");
  const planTool = createPlanTool();
  const runId = nanoid(12);
  const scratchTools = createScratchWorkspaceTools(runId);
  const projectDocTools = createProjectDocumentTools(input.projectId);

  try {
    const result = await runAgentLoop({
      runLabel: "pptGeneration",
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: `${buildUserPrompt(input)}\n\n필요하면 list_project_documents/read_project_document_chunk로 이 프로젝트의 다른 문서를 참고할 수 있다.`,
      tools: [planTool, ...scratchTools, ...projectDocTools, submitTool],
      maxTurns: 6,
      maxTokensPerTurn: 8000
    });

    saveAgentRunLog(result);

    if (result.status === "submitted" && result.submission) {
      return renumber((result.submission as { slides: PresentationSlide[] }).slides);
    }
    throw new Error(`PPT 생성 에이전트가 결과를 제출하지 못했습니다 (status=${result.status}). ${result.error ?? ""}`.trim());
  } finally {
    cleanupScratchWorkspace(runId);
  }
}

export async function generatePresentationSlides(input: PptInput): Promise<{ result: PresentationSlide[]; mode: "llm" | "heuristic" }> {
  if (llmAvailable()) {
    if (toolCallingAvailable()) {
      try {
        const slides = await generateSlidePlanAgentic(input);
        if (slides?.length) return { result: slides, mode: "llm" };
      } catch (err) {
        logError("agent loop failed for pptGeneration, falling back to single-turn completeJSON", err);
      }
    }
    try {
      const raw = await completeJSON<{ slides: PresentationSlide[] }>(SYSTEM_PROMPT, buildUserPrompt(input), 16000);
      if (raw?.slides?.length) return { result: renumber(raw.slides), mode: "llm" };
    } catch (err) {
      if (!(err instanceof NoLLMError)) logError("LLM ppt generation failed, falling back", err);
    }
  }
  return { result: heuristicSlidePlan(input), mode: "heuristic" };
}
