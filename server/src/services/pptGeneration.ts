import { z } from "zod";
import { nanoid } from "nanoid";
import { completeJSON, llmAvailable, NoLLMError } from "../llm/provider.js";
import { toolCallingAvailable } from "../llm/toolCalling.js";
import { runFanOutAgents } from "../agent-runtime/fanOut.js";
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

function buildContext(input: PptInput): string {
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
${scenarioText || "(없음)"}`;
}

function buildUserPrompt(input: PptInput): string {
  return `${buildContext(input)}

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

// 슬라이드 8~11장을 통짜 대화 하나로 생성하던 것을, 서로 독립적인 슬라이드 그룹 단위로
// 나눠 병렬 서브에이전트로 생성한다. Agent/Demo 관련 슬라이드는 input.agent/input.screens가
// 있을 때만 해당 그룹의 task 자체를 만든다 - 모델이 "만들지 말라"는 지시를 따르길 기대하는
// 대신 애초에 요청을 안 보내는 쪽이 훨씬 확실하다. 순서/번호는 그룹을 고정된 배열 순서로
// concat한 뒤 renumber()로 부여하므로 서브에이전트의 완료 순서와 무관하게 항상 올바르다.
const GroupSlidesSchema = z.object({ slides: z.array(PresentationSlideSchema).min(1).max(3) });

interface SlideGroupTemplate {
  key: string;
  template: string;
}

const OVERVIEW_GROUP: SlideGroupTemplate = {
  key: "overview",
  template: `1. title: 프로젝트명 + 부제(고객사·제안 성격)
2. bullets: "Project Overview" — 프로젝트 설명, 관련 시스템, 분석 근거 요약`
};
const PROCESS_PAINPOINTS_GROUP: SlideGroupTemplate = {
  key: "process_painpoints",
  template: `1. process: "Current Business Process" — 현재 업무 프로세스 단계 (최대 6개)
2. bullets: "Current Pain Points" — 실제 확인된 Pain Point (최대 6개)`
};
const INSIGHTS_GROUP: SlideGroupTemplate = {
  key: "insights",
  template: `1. table: "Interview Insights" — headers는 ["Type","Finding"], Tacit Knowledge 기반 행 (최대 8개)
2. bullets: "Tacit Knowledge / Key Findings" — tacitRule/hidden_rule/workaround 유형 위주 (최대 6개)`
};
const AGENT_WORKFLOW_GROUP: SlideGroupTemplate = {
  key: "agent_workflow",
  template: `1. two-column: "Proposed AI Agent" — 좌측 컬럼 title은 Agent 이름, bullets는 목적, 우측 컬럼 title은 "적용 범위", bullets는 핵심 규칙 (최대 5개)
2. process: "Agent Workflow" — Agent workflow 단계를 "order. [actor] name — description" 형식으로`
};
const DEMO_UI_GROUP: SlideGroupTemplate = {
  key: "demo_ui",
  template: `1. two-column: "Demo UI" — 좌측 컬럼 title "화면 구성" bullets는 각 화면 "title (status)", 우측 컬럼 title은 시나리오 caseId 또는 "Scenario" bullets는 시나리오 단계 "[status] label: detail"`
};
const BENEFITS_NEXT_GROUP: SlideGroupTemplate = {
  key: "benefits_next",
  template: `1. bullets: "Expected Benefits" — 근거 자료에 비추어 실제로 기대되는 효과 (반복 판단 자동화, 감사 대응력, human-in-the-loop 등 해당하는 것만)
2. closing: "Next Steps" — 다음 단계 제안 (추가 인터뷰, Demo 피드백, PRD 작성 등)`
};

function buildGroupUserPrompt(input: PptInput, group: SlideGroupTemplate): string {
  return `${buildContext(input)}

이번 요청에서는 아래 슬라이드만 순서대로 생성한다 (order는 1부터 순서대로 매기면 되며, 전체 발표자료에 합쳐질 때 다시 번호가 매겨진다):
${group.template}
각 슬라이드는 title, layout 필수이며 layout에 맞는 필드(bullets/table/columns/subtitle/note)를 채운다.
반드시 제공된 자료의 실제 업무 용어, 조직명, 시스템명, 규칙을 사용하고 범용적인 문구를 만들지 않는다.`;
}

async function generateSlidePlanAgentic(input: PptInput): Promise<PresentationSlide[]> {
  const groups: SlideGroupTemplate[] = [
    OVERVIEW_GROUP,
    PROCESS_PAINPOINTS_GROUP,
    INSIGHTS_GROUP,
    ...(input.agent ? [AGENT_WORKFLOW_GROUP] : []),
    ...(input.screens?.length ? [DEMO_UI_GROUP] : []),
    BENEFITS_NEXT_GROUP
  ];
  const runIds: string[] = [];

  try {
    const tasks = groups.map((group) => {
      const runId = nanoid(12);
      runIds.push(runId);
      return {
        runLabel: `pptGeneration:${group.key}`,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: `${buildGroupUserPrompt(input, group)}\n\n필요하면 list_project_documents/read_project_document_chunk로 이 프로젝트의 다른 문서를 참고할 수 있다.\n작성이 끝나면 submit_result 툴을 호출해 제출하라.`,
        tools: [
          createPlanTool(runId),
          ...createScratchWorkspaceTools(runId),
          ...createProjectDocumentTools(input.projectId),
          createSubmitTool(GroupSlidesSchema, "이 그룹에 해당하는 슬라이드를 제출한다.")
        ],
        maxTurns: 3,
        maxTokensPerTurn: 3000
      };
    });

    const results = await runFanOutAgents(tasks);
    results.forEach((r) => saveAgentRunLog(r));

    const failed = results.find((r) => r.status !== "submitted" || !r.submission);
    if (failed) {
      throw new Error(`PPT 슬라이드 fan-out 중 일부 그룹이 실패했습니다 (${failed.runLabel} status=${failed.status}). ${failed.error ?? ""}`.trim());
    }

    // groups 배열 순서대로 tasks를 만들었고 runFanOutAgents는 입력 인덱스 순서로 결과를
    // 반환하므로, 완료 순서와 무관하게 concat만으로 항상 올바른 슬라이드 순서가 된다.
    const slides = results.flatMap((r) => (r.submission as { slides: PresentationSlide[] }).slides);
    return renumber(slides);
  } finally {
    for (const runId of runIds) cleanupScratchWorkspace(runId);
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
