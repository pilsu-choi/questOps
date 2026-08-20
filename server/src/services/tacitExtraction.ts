import { completeJSON, llmAvailable, NoLLMError } from "../llm/provider.js";
import type { ExtractedInsights } from "../types.js";
import { splitSentences, matchLines } from "./textUtils.js";

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

export async function extractInsightsFromAnswer(question: string, answer: string): Promise<{ insights: ExtractedInsights; mode: "llm" | "heuristic" }> {
  if (llmAvailable()) {
    try {
      const raw = await completeJSON<RawExtract>(SYSTEM_PROMPT, buildUserPrompt(question, answer), 8000);
      return { insights: normalize(raw), mode: "llm" };
    } catch (err) {
      if (!(err instanceof NoLLMError)) console.error("LLM insight extraction failed, falling back:", err);
    }
  }
  return { insights: heuristicExtract(answer), mode: "heuristic" };
}
