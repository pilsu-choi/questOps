import { z } from "zod";
import { completeJSON, llmAvailable, NoLLMError } from "../llm/provider.js";
import { toolCallingAvailable } from "../llm/toolCalling.js";
import { runAgentLoop } from "../agent-runtime/loop.js";
import { createSubmitTool } from "../agent-runtime/tools.js";
import { saveAgentRunLog } from "../agent-runtime/log.js";
import type { DomainKnowledgeContent, DocumentAnalysis } from "../types.js";
import { logDebug, logError } from "../logger.js";

export interface DomainKnowledgeGenerationInput {
  projectName: string;
  client: string;
  org?: string;
  projectType?: string;
  description: string;
  goal?: string;
  analyses: DocumentAnalysis[];
}

const SYSTEM_PROMPT = `당신은 기업 컨설팅 프로젝트에 처음 투입되는 컨설턴트가 가장 먼저 읽어야 할 "도메인 지식 브리핑"을 작성하는 Principal Business Domain Analyst다.
제공된 프로젝트 메타 정보와 문서 분석 결과를 근거로, 대상 기업의 사업, 사업을 추진하는 부서, 사업 내용, 사업 도메인에 대해 컨설턴트가 반드시 인지해야 하는 깊이 있는 도메인 지식을 정리한다.
반드시 문서에 실제로 등장하는 조직명, 시스템명, 용어, 수치, 규정을 그대로 사용하고, 문서에 없는 사실을 창작하지 않는다.
문서만으로 판단하기 어려운 부분은 openQuestions에 남긴다.`;

function buildUserPrompt(input: DomainKnowledgeGenerationInput): string {
  const analysisText = input.analyses
    .map(
      (a, i) =>
        `문서 ${i + 1}: ${a.businessContext}\n관련 조직/사용자: ${a.keyUsers.join(", ")}\n프로세스: ${a.process.join(
          " / "
        )}\n시스템: ${a.systems.join(" / ")}\n업무 규정: ${a.businessRules.join(" / ")}\n예외: ${a.exceptions.join(
          " / "
        )}\n미확인 항목: ${a.unknowns.join(" / ")}`
    )
    .join("\n\n");

  return `프로젝트: ${input.projectName} (고객사: ${input.client}${input.org ? `, 담당 조직: ${input.org}` : ""})
프로젝트 유형: ${input.projectType || "명시되지 않음"}
설명: ${input.description}
목표: ${input.goal || "명시되지 않음"}

--- 문서 분석 요약 ---
${analysisText || "(없음)"}

위 내용을 근거로 다음 JSON을 생성하라:
{
  "companyOverview": "대상 기업/사업의 배경, 목적, 맥락 (3-5문장, 실제 근거 기반)",
  "businessDomain": "이 프로젝트가 속한 사업 도메인의 정의와 특성 (2-4문장)",
  "domainKeywords": ["이 도메인을 이해하는 데 필요한 핵심 키워드/개념"],
  "drivingDepartments": [{ "name": "사업을 추진하는 실제 부서/조직명", "role": "해당 부서의 역할과 책임" }],
  "businessScope": ["이번 사업이 다루는 구체적인 업무 범위/내용"],
  "keySystems": ["관련된 실제 시스템/솔루션/연동 대상"],
  "glossary": [{ "term": "문서에 등장하는 도메인 용어", "definition": "그 용어의 의미와 맥락" }],
  "domainRules": ["이 도메인에서 반드시 지켜야 하는 규정/기준/제약"],
  "stakeholders": ["실제 이해관계자 (부서, 역할, 외부기관 등)"],
  "risksAndConsiderations": ["컨설팅 수행 시 유의해야 할 리스크와 고려사항"],
  "openQuestions": ["문서만으로는 확인이 안 되어 인터뷰/추가 확인이 필요한 도메인 지식"]
}
JSON만 출력.`;
}

const DomainKnowledgeSchema = z.object({
  companyOverview: z.string(),
  businessDomain: z.string(),
  domainKeywords: z.array(z.string()),
  drivingDepartments: z.array(z.object({ name: z.string(), role: z.string() })),
  businessScope: z.array(z.string()),
  keySystems: z.array(z.string()),
  glossary: z.array(z.object({ term: z.string(), definition: z.string() })),
  domainRules: z.array(z.string()),
  stakeholders: z.array(z.string()),
  risksAndConsiderations: z.array(z.string()),
  openQuestions: z.array(z.string())
});

function heuristicGenerate(input: DomainKnowledgeGenerationInput): DomainKnowledgeContent {
  const users = [...new Set(input.analyses.flatMap((a) => a.keyUsers))];
  const systems = [...new Set(input.analyses.flatMap((a) => a.systems))];
  const rules = [...new Set(input.analyses.flatMap((a) => a.businessRules))];
  const unknowns = [...new Set(input.analyses.flatMap((a) => a.unknowns))];
  const painPoints = [...new Set(input.analyses.flatMap((a) => a.painPoints))];
  const process = [...new Set(input.analyses.flatMap((a) => a.process))];
  const overviewParts = input.analyses.map((a) => a.businessContext).filter(Boolean);

  return {
    companyOverview:
      overviewParts.join(" ") ||
      `${input.client}${input.org ? ` ${input.org}` : ""}이(가) 추진하는 "${input.projectName}" 프로젝트. ${input.description || input.goal || ""}`.trim(),
    businessDomain: input.projectType || `${input.client} 관련 업무 도메인 (문서 분석 결과 기반, 세부 정의는 인터뷰로 보강 필요)`,
    domainKeywords: [...new Set([...systems, ...rules.slice(0, 5)])].slice(0, 10),
    drivingDepartments: users.slice(0, 6).map((u) => ({ name: u, role: "문서에서 확인된 관련 조직/역할 (구체적 책임은 인터뷰로 확인 필요)" })),
    businessScope: process.slice(0, 8),
    keySystems: systems.length ? systems : ["연동 시스템 미확인 (인터뷰 필요)"],
    glossary: rules.slice(0, 6).map((r) => ({ term: r.slice(0, 24), definition: r })),
    domainRules: rules.slice(0, 10),
    stakeholders: users.length ? users : [`${input.client} 실무 담당자`],
    risksAndConsiderations: painPoints.slice(0, 6),
    openQuestions: unknowns.slice(0, 10)
  };
}

async function generateDomainKnowledgeAgentic(input: DomainKnowledgeGenerationInput): Promise<DomainKnowledgeContent> {
  const submitTool = createSubmitTool(DomainKnowledgeSchema, "도메인 지식 브리핑 내용을 제출한다.");

  const result = await runAgentLoop({
    runLabel: "domainKnowledgeGeneration",
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: `${buildUserPrompt(input)}\n\n정리가 끝나면 submit_result 툴을 호출해 제출하라.`,
    tools: [submitTool],
    maxTurns: 6,
    maxTokensPerTurn: 8000
  });

  saveAgentRunLog(result);

  if (result.status === "submitted" && result.submission) {
    return result.submission as DomainKnowledgeContent;
  }
  throw new Error(`도메인 지식 생성 에이전트가 결과를 제출하지 못했습니다 (status=${result.status}). ${result.error ?? ""}`.trim());
}

export async function generateDomainKnowledge(
  input: DomainKnowledgeGenerationInput
): Promise<{ result: DomainKnowledgeContent; mode: "llm" | "heuristic" }> {
  const overallStart = Date.now();
  logDebug(`[domainKnowledgeGeneration] start project="${input.projectName}" analyses=${input.analyses.length}`);

  if (llmAvailable()) {
    if (toolCallingAvailable()) {
      logDebug(`[domainKnowledgeGeneration] attempting agentic path`);
      try {
        const raw = await generateDomainKnowledgeAgentic(input);
        logDebug(`[domainKnowledgeGeneration] agentic path returned companyOverview=${Boolean(raw?.companyOverview)}, totalElapsedMs=${Date.now() - overallStart}`);
        if (raw?.companyOverview) return { result: raw, mode: "llm" };
      } catch (err) {
        logError("agent loop failed for domainKnowledgeGeneration, falling back to single-turn completeJSON", err);
      }
    }
    logDebug(`[domainKnowledgeGeneration] attempting single-turn completeJSON path`);
    try {
      const raw = await completeJSON<DomainKnowledgeContent>(SYSTEM_PROMPT, buildUserPrompt(input), 8000);
      logDebug(`[domainKnowledgeGeneration] completeJSON path returned companyOverview=${Boolean(raw?.companyOverview)}, totalElapsedMs=${Date.now() - overallStart}`);
      if (raw?.companyOverview) return { result: raw, mode: "llm" };
    } catch (err) {
      if (!(err instanceof NoLLMError)) logError("LLM domain knowledge generation failed, falling back", err);
    }
  }
  logDebug(`[domainKnowledgeGeneration] using heuristic fallback, totalElapsedMs=${Date.now() - overallStart}`);
  return { result: heuristicGenerate(input), mode: "heuristic" };
}
