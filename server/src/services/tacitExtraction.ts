import { z } from "zod";
import { completeJSON, llmAvailable, NoLLMError } from "../llm/provider.js";
import { toolCallingAvailable } from "../llm/toolCalling.js";
import { runAgentLoop } from "../agent-runtime/loop.js";
import { createSubmitTool } from "../agent-runtime/tools.js";
import { saveAgentRunLog } from "../agent-runtime/log.js";
import type { ExtractedInsights } from "../types.js";
import { splitSentences, matchLines } from "./textUtils.js";
import { logDebug, logError } from "../logger.js";

const SYSTEM_PROMPT = `당신은 금융권 AI Agent 구축 프로젝트의 Knowledge Engineer다.
현업 담당자의 인터뷰 답변에서 문서화되지 않은 지식을 구조화하여 추출한다.
답변에 실제로 있는 내용만 추출하고 추측하여 새로운 사실을 만들지 않는다. 해당 없는 카테고리는 빈 배열로 둔다.`;

function buildUserPrompt(question: string, answer: string): string {
  return `질문: ${question}

답변:
${answer}

다음 JSON 스키마로 추출하라:
{
  "explicitRule": ["답변에서 언급된, 이미 문서/시스템에 명시된 공식 규칙"],
  "tacitRule": ["문서에는 없지만 담당자가 실제로 적용한다고 밝힌 비공식 규칙/관행"],
  "exception": ["예외 상황과 그 처리 방식"],
  "decisionCriteria": ["담당자가 판단할 때 사용하는 구체적 기준"],
  "riskSignal": ["위험 신호, 주의해야 할 조건"],
  "workaround": ["시스템 미지원으로 인한 수작업/우회 처리"],
  "constraint": ["업무상 제약 조건"]
}
JSON만 출력.`;
}

interface RawExtract {
  explicitRule: string[];
  tacitRule: string[];
  exception: string[];
  decisionCriteria: string[];
  riskSignal: string[];
  workaround: string[];
  constraint: string[];
}

const RawExtractSchema = z.object({
  explicitRule: z.array(z.string()),
  tacitRule: z.array(z.string()),
  exception: z.array(z.string()),
  decisionCriteria: z.array(z.string()),
  riskSignal: z.array(z.string()),
  workaround: z.array(z.string()),
  constraint: z.array(z.string())
});

function normalize(raw: Partial<RawExtract>): ExtractedInsights {
  return {
    explicitRules: raw.explicitRule || [],
    tacitRules: raw.tacitRule || [],
    exceptions: raw.exception || [],
    decisionCriteria: raw.decisionCriteria || [],
    riskSignals: raw.riskSignal || [],
    workarounds: raw.workaround || [],
    constraints: raw.constraint || []
  };
}

const NEGATION = /없(다|고|음|어서)|아니(다|고)|안\s?됩니다/;

function heuristicExtract(answer: string): ExtractedInsights {
  const sentences = splitSentences(answer);
  const nonNegated = sentences.filter((s) => !NEGATION.test(s));
  return {
    explicitRules: matchLines(nonNegated, [/규정상/, /매뉴얼(에|상)/, /공식적으로/, /원칙적으로/], 5),
    tacitRules: matchLines(sentences, [/사실은/, /실제로는/, /관행적으로/, /암묵적으로/, /보통은/, /통상/], 5),
    exceptions: matchLines(sentences, [/예외/, /다만/, /단,/, /경우에 한해/, /특이하게/], 5),
    decisionCriteria: matchLines(sentences, [/기준은/, /판단은/, /확인하는 것은/, /기준으로/], 5),
    riskSignals: matchLines(sentences, [/위험/, /주의/, /문제가 생길/, /사고/, /리스크/], 5),
    workarounds: matchLines(sentences, [/수작업/, /직접 처리/, /우회/, /수기로/, /엑셀로/], 5),
    constraints: matchLines(sentences, [/불가능/, /안 됩니다/, /제약/, /할 수 없/, /허용되지 않/], 5)
  };
}

async function extractInsightsAgentic(question: string, answer: string): Promise<RawExtract> {
  const submitTool = createSubmitTool(RawExtractSchema, "추출된 암묵지 항목을 제출한다.");

  const result = await runAgentLoop({
    runLabel: "tacitExtraction",
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: `${buildUserPrompt(question, answer)}\n\n추출이 끝나면 submit_result 툴을 호출해 제출하라.`,
    tools: [submitTool],
    maxTurns: 3,
    maxTokensPerTurn: 2048
  });

  saveAgentRunLog(result);

  if (result.status === "submitted" && result.submission) {
    return result.submission as RawExtract;
  }
  throw new Error(`암묵지 추출 에이전트가 결과를 제출하지 못했습니다 (status=${result.status}). ${result.error ?? ""}`.trim());
}

export async function extractInsightsFromAnswer(question: string, answer: string): Promise<{ insights: ExtractedInsights; mode: "llm" | "heuristic" }> {
  const overallStart = Date.now();
  logDebug(`[tacitExtraction] start questionChars=${question.length} answerChars=${answer.length}`);

  if (llmAvailable()) {
    if (toolCallingAvailable()) {
      logDebug(`[tacitExtraction] attempting agentic path`);
      try {
        const raw = await extractInsightsAgentic(question, answer);
        logDebug(`[tacitExtraction] agentic path succeeded, totalElapsedMs=${Date.now() - overallStart}`);
        return { insights: normalize(raw), mode: "llm" };
      } catch (err) {
        logError("agent loop failed for tacitExtraction, falling back to single-turn completeJSON", err);
      }
    }
    logDebug(`[tacitExtraction] attempting single-turn completeJSON path`);
    try {
      const raw = await completeJSON<RawExtract>(SYSTEM_PROMPT, buildUserPrompt(question, answer), 8000);
      logDebug(`[tacitExtraction] completeJSON path succeeded, totalElapsedMs=${Date.now() - overallStart}`);
      return { insights: normalize(raw), mode: "llm" };
    } catch (err) {
      if (!(err instanceof NoLLMError)) logError("LLM insight extraction failed, falling back", err);
    }
  }
  logDebug(`[tacitExtraction] using heuristic fallback, totalElapsedMs=${Date.now() - overallStart}`);
  return { insights: heuristicExtract(answer), mode: "heuristic" };
}
