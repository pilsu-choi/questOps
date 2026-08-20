import { completeJSON, llmAvailable, NoLLMError } from "../llm/provider.js";
import type { DocumentAnalysis } from "../types.js";
import { splitSentences, matchLines } from "./textUtils.js";

const SYSTEM_PROMPT = `당신은 금융/기업 업무 프로세스를 분석하는 Senior Business Analyst이자 AI Agent 설계 컨설턴트다.
제공된 프로젝트 문서 원문을 근거로 구조화된 분석 결과를 JSON으로만 출력한다.
문서에 실제로 등장하는 용어, 조직명, 시스템명, 수치, 규정을 최대한 그대로 인용하듯 사용하고, 문서에 없는 사실을 창작하지 않는다.
특히 "unknowns" 필드에는 이후 현업 인터뷰에서 반드시 확인해야 할, 문서에 기준/근거가 없는 판단 지점을 적어라.`;

function buildUserPrompt(filename: string, text: string): string {
  const trimmed = text.slice(0, 24000);
  return `문서 파일명: ${filename}

--- 문서 원문 (일부 발췌될 수 있음) ---
${trimmed}
--- 문서 원문 끝 ---

다음 JSON 스키마에 맞춰 이 문서를 분석하라. 각 배열 항목은 문서 내용에 근거한 구체적인 문장으로 작성한다 (일반론 금지).

{
  "businessContext": "이 문서가 다루는 업무/사업의 배경과 목적 (2-4문장)",
  "keyUsers": ["문서에 언급된 실제 조직/역할/담당자"],
  "process": ["문서에 나타난 업무 처리 단계, 순서대로"],
  "systems": ["문서에 언급된 시스템/솔루션/연동 대상"],
  "businessRules": ["문서에 명시된 구체적 규정, 기준, 수치, 한도"],
  "decisionPoints": ["담당자가 판단/승인/검토해야 하는 지점"],
  "exceptions": ["문서에 언급된 예외 상황, 특이 케이스"],
  "painPoints": ["문서에서 드러나는 문제점, 비효율, 병목"],
  "aiOpportunities": ["이 업무에서 AI Agent가 자동화하거나 보조할 수 있는 구체적 후보"],
  "unknowns": ["문서만으로는 판단 기준/예외 처리 방식이 불명확하여 인터뷰로 확인이 필요한 항목"]
}

JSON만 출력하라.`;
}

function extractOrgTokens(text: string, limit: number): string[] {
  const matches = text.match(/[가-힣A-Za-z0-9]{2,12}(팀|부|센터|과|본부|사업부|그룹)/g) || [];
  const counts = new Map<string, number>();
  for (const m of matches) counts.set(m, (counts.get(m) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k]) => k);
}

function extractSystemTokens(text: string, limit: number): string[] {
  const matches = text.match(/[A-Za-z가-힣]{2,20}\s?(시스템|System|API|플랫폼|솔루션|DB|데이터베이스)/g) || [];
  const swift = text.match(/SWIFT[^\s,.]*/gi) || [];
  const all = [...matches.map((m) => m.trim()), ...swift];
  return [...new Set(all)].slice(0, limit);
}

function heuristicAnalysis(filename: string, text: string): DocumentAnalysis {
  const sentences = splitSentences(text);
  const businessContext =
    sentences.slice(0, 2).join(" ") ||
    `${filename} 문서를 자동 분석했습니다. 문서 내 단락 구조가 명확하지 않아 요약 정확도가 제한적일 수 있습니다.`;

  const process = matchLines(
    sentences,
    [/접수/, /처리/, /검토/, /승인/, /등록/, /조회/, /전송/, /입력 후/, /절차/],
    8
  );
  const businessRules = matchLines(
    sentences,
    [/기준/, /이내/, /이상/, /초과/, /한도/, /%/, /만원/, /영업일/, /시\s?이전/, /시까지/, /규정/],
    8
  );
  const decisionPoints = matchLines(sentences, [/판단/, /검토/, /확인 후/, /승인/, /반려/, /결정/], 8);
  const exceptions = matchLines(sentences, [/예외/, /미비/, /불일치/, /오류/, /장애/, /보류/, /상이/, /누락/], 8);
  const painPoints = matchLines(sentences, [/문제/, /어려움/, /불편/, /지연/, /수작업/, /반복적/, /비효율/], 6);
  const unknowns = matchLines(sentences, [/추후/, /미정/, /TBD/, /별도 협의/, /확인 필요/], 6);

  const keyUsers = extractOrgTokens(text, 6);
  const systems = extractSystemTokens(text, 6);

  const aiOpportunities = decisionPoints.slice(0, 4).map((d) => `"${d.slice(0, 40)}..." 판단을 AI가 1차 분석하고 근거를 제시하는 기능`);

  if (unknowns.length === 0 && decisionPoints.length > 0) {
    unknowns.push(`"${decisionPoints[0].slice(0, 50)}" 판단 시 문서에 정량 기준이 없어 추가 확인 필요`);
  }

  return {
    businessContext,
    keyUsers: keyUsers.length ? keyUsers : ["문서에서 조직/역할 식별 필요 (인터뷰로 확인)"],
    process: process.length ? process : ["문서에서 처리 단계 식별 필요"],
    systems: systems.length ? systems : [],
    businessRules,
    decisionPoints,
    exceptions,
    painPoints,
    aiOpportunities,
    unknowns
  };
}

export async function analyzeDocument(filename: string, text: string): Promise<DocumentAnalysis> {
  if (!text || text.trim().length < 20) {
    return {
      businessContext: "문서에서 추출된 텍스트가 거의 없어 자동 분석을 수행할 수 없습니다. 이미지 기반 문서일 수 있습니다.",
      keyUsers: [],
      process: [],
      systems: [],
      businessRules: [],
      decisionPoints: [],
      exceptions: [],
      painPoints: [],
      aiOpportunities: [],
      unknowns: ["문서 내용을 텍스트로 재제공하거나 요약을 별도로 입력해 주세요."]
    };
  }

  if (llmAvailable()) {
    try {
      return await completeJSON<DocumentAnalysis>(SYSTEM_PROMPT, buildUserPrompt(filename, text), 16000);
    } catch (err) {
      if (!(err instanceof NoLLMError)) throw err;
    }
  }
  return heuristicAnalysis(filename, text);
}
