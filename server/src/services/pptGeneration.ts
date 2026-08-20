import type { AgentConcept, DemoScreen, DemoScenario, DocumentAnalysis, PresentationSlide } from "../types.js";

export interface PptInput {
  projectName: string;
  client: string;
  description: string;
  analyses: DocumentAnalysis[];
  tacitKnowledge: { type: string; description: string }[];
  agent?: AgentConcept;
  screens?: DemoScreen[];
  scenario?: DemoScenario;
}

export function buildSlidePlan(input: PptInput): PresentationSlide[] {
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

  return slides.map((s, i) => ({ ...s, order: i + 1 }));
}
