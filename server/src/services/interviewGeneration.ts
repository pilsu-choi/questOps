import { completeJSON, llmAvailable, NoLLMError } from "../llm/provider.js";
import type { EvidenceRef, InterviewQuestionItem } from "../types.js";
import { buildGroundedFacts, factSheetText, type DocInput, type GroundedFact } from "./factExtraction.js";

const BASE_CATEGORIES = ["Business", "User", "Process", "System", "AI", "Operation"] as const;

const SYSTEM_PROMPT = `당신은 금융권/기업 AI Agent 구축 프로젝트의 Senior Business Analyst이다.

제공된 프로젝트 문서와 분석 결과(Grounded Fact Sheet)만을 근거로 현업 담당자를 위한 1차 인터뷰 질의서를 작성한다.

목표는 업무 설명을 듣는 것이 아니라 문서화되지 않은 Tacit Knowledge를 추출하는 것이다.

다음 정보를 적극적으로 찾아 질문으로 변환한다:
- 실제 업무 판단 기준 (Hidden Threshold)
- 예외 처리 (Exception Handling)
- 비공식적인 Rule (Hidden Rule)
- 담당자의 경험적 판단 (Judgment)
- 팀 간 Handoff 규칙
- Workaround (시스템 미지원으로 인한 수작업 우회)
- 과거 실패 사례 (Failure)
- Risk Signal
- 사람이 반드시 확인해야 하는 조건 (Trust Boundary)
- 시스템이 처리하지 못하는 상황

절대 다음과 같은 generic 질문을 생성하지 않는다:
"업무 프로세스가 어떻게 되나요?" / "어려운 점은 무엇인가요?" / "AI 도입 효과는 무엇인가요?" / "개선할 점은 무엇인가요?"

각 질문은 반드시 Fact Sheet에 있는 구체적인 용어, 프로세스, 시스템, 조직, 수치를 근거로 작성하고, 근거로 사용한 Fact ID를 evidenceFactIds에 명시한다.
Fact Sheet에 없는 사실을 만들어내지 않는다.

좋은 질문 구조: [구체적인 상황/업무객체] → [현업의 실제 판단] → [판단 기준] → [예외/이유/경험]

각 질문에는 반드시 sampleAnswer(예시 답변)를 함께 작성한다.
sampleAnswer는 실제 인터뷰 답변이 아니라, 인터뷰 진행자가 참고할 수 있도록 "이런 식의 답변이 나올 수 있다"를 보여주는 예시다.
반드시 특정 상세 시나리오(구체적인 케이스, 가상의 수치/기간, 예외 상황 등)를 가정하여 실제 업무에 밀착된 내용으로, 담당자의 1인칭 구어체로 작성한다.
Fact Sheet의 근거를 자연스럽게 인용하되, 그 위에 얹는 구체적 수치/사례는 예시임을 알 수 있도록 작성한다 (문서에 실제로 없는 세부사항을 사실인 것처럼 단정하지 않는다).

카테고리는 Business, User, Process, System, AI, Operation 6개를 기본으로 사용하고 각 5~8개씩, 전체 35~50개를 목표로 하되 근거가 부족하면 억지로 채우지 않는다.
tacitKnowledgeType은 다음 중 하나: boundary, exception, hidden_rule, judgment, failure, workaround, handoff, trust_boundary

JSON 배열만 출력하라. 형식:
[
  {
    "category": "Process",
    "subType": null,
    "question": "...",
    "intent": "이 질문을 통해 확인하려는 것",
    "expectedInsight": "기대하는 답변의 성격",
    "tacitKnowledgeType": "exception",
    "evidenceFactIds": ["F003", "F011"],
    "sampleAnswer": "담당자 1인칭 구어체의 구체적 예시 답변"
  }
]`;

function buildUserPrompt(projectSummary: string, facts: GroundedFact[]): string {
  return `프로젝트 개요:
${projectSummary}

Grounded Fact Sheet (아래 Fact ID만 evidence로 인용 가능):
${factSheetText(facts)}

위 Fact들을 근거로 1차 인터뷰 질의서를 JSON 배열로 생성하라.`;
}

interface RawItem {
  category: string;
  subType?: string | null;
  question: string;
  intent: string;
  expectedInsight: string;
  tacitKnowledgeType: string;
  evidenceFactIds: string[];
  sampleAnswer?: string;
}

function toEvidence(factIds: string[], factMap: Map<string, GroundedFact>): EvidenceRef[] {
  return factIds
    .map((id) => factMap.get(id))
    .filter((f): f is GroundedFact => Boolean(f))
    .map((f) => ({ document: f.document, page: f.page, section: f.section, quote: f.text }));
}

function finalize(items: RawItem[], factMap: Map<string, GroundedFact>): InterviewQuestionItem[] {
  return items
    .filter((it) => it.question && it.question.trim().length > 0)
    .map((it, i) => ({
      id: `Q${String(i + 1).padStart(2, "0")}`,
      category: it.category,
      subType: it.subType || undefined,
      question: it.question.trim(),
      intent: it.intent?.trim() || "",
      evidence: toEvidence(it.evidenceFactIds || [], factMap),
      expectedInsight: it.expectedInsight?.trim() || "",
      tacitKnowledgeType: it.tacitKnowledgeType || "judgment",
      sampleAnswer: it.sampleAnswer?.trim() || ""
    }));
}

// ---------- Heuristic fallback ----------

const TEMPLATES: Record<string, (a: GroundedFact, b?: GroundedFact) => string> = {
  boundary: (a) =>
    `"${a.text}" 기준에서 살짝 벗어나는 경계 사례가 접수되면, 실제로는 어느 정도 범위까지 정상 처리로 인정하십니까? 그 경계를 판단하는 기준은 무엇입니까?`,
  exception: (a) =>
    `"${a.text}"와 같은 예외가 발생했을 때, 문서화된 절차 외에 담당자가 추가로 확인하는 사항이 있습니까? 이 예외는 얼마나 자주 발생합니까?`,
  hidden_rule: (a) =>
    `"${a.text}" 관련 판단을 할 때, 매뉴얼에는 없지만 팀 내에서 관행적으로 적용하는 기준이 있습니까?`,
  judgment: (a) =>
    `"${a.text}" 상황에서 시스템/문서 기준만으로 판단이 어려운 경우, 담당자의 경험에 의존해 최종 결정하는 요소는 무엇입니까?`,
  failure: (a) =>
    `"${a.text}"와 관련하여 과거에 판단을 잘못해 문제가 발생했던 사례가 있다면, 어떤 상황이었고 이후 기준이 어떻게 바뀌었습니까?`,
  workaround: (a) =>
    `"${a.text}" 처리 과정에서 시스템이 지원하지 못해 담당자가 직접 우회해서 처리하는 절차가 있습니까? 구체적으로 어떻게 처리하십니까?`,
  handoff: (a, b) =>
    `"${a.text}"에서 ${b ? `"${b.text}" 조직으로` : "다음 담당 조직으로"} 업무가 넘어갈 때, 공식 문서·시스템에는 없지만 구두나 메신저로 반드시 확인하는 정보가 있습니까?`,
  trust_boundary: (a) =>
    `"${a.text}" 판단을 AI Agent가 1차로 수행한다면, 어느 수준까지 자동 처리해도 되고 어느 지점부터는 반드시 사람이 재확인해야 한다고 보십니까? 그 기준은 무엇입니까?`
};

const SAMPLE_ANSWER_TEMPLATES: Record<string, (a: GroundedFact, b?: GroundedFact) => string> = {
  boundary: (a) =>
    `(예시) "${a.text}" 기준을 살짝 넘긴 건, 예를 들어 하루에 한두 건 정도는 그날 상황이나 담당자 재량으로 정상 처리하기도 합니다. 정확한 허용 범위가 문서화되어 있진 않고, 애매하면 선임이나 팀장과 상의해서 결정합니다.`,
  exception: (a) =>
    `(예시) 이런 예외는 한 달에 몇 건 정도 발생하는 편인데, 매뉴얼에 나온 절차 외에 과거 유사 사례가 있었는지 이력을 먼저 찾아보고 판단합니다. 애매한 건은 보류해두고 다음 날 재확인하기도 합니다.`,
  hidden_rule: (a) =>
    `(예시) 문서에는 안 나와 있지만, 저희 팀에서는 "${a.text}"와 관련해서 한 번 더 교차 확인하는 게 관행입니다. 예전에 한 번 문제가 된 뒤로 자연스럽게 그렇게 하고 있습니다.`,
  judgment: (a) =>
    `(예시) 시스템이나 문서 기준만으로 판단이 애매할 때는 비슷한 과거 케이스를 떠올려서 경험적으로 결정하는 경우가 많습니다. 신입 담당자라면 놓칠 수 있는 부분이라 선임에게 물어보고 처리하기도 합니다.`,
  failure: (a) =>
    `(예시) 예전에 이 부분을 놓쳐서 한 번 문제가 된 적이 있습니다. 그 이후로 관련 확인 절차가 한 단계 더 추가됐고, 지금은 그렇게 처리하고 있습니다.`,
  workaround: (a) =>
    `(예시) 시스템이 이 부분을 지원하지 않아서, 담당자가 엑셀이나 별도 메모로 관리하고 있습니다. 번거롭긴 한데 아직 대체할 방법이 없어서 계속 그렇게 하고 있습니다.`,
  handoff: (a, b) =>
    `(예시) ${b ? `"${b.text}" 쪽으로` : "다음 담당 조직으로"} 넘길 때는 시스템 기록만으로는 부족해서, 메신저나 유선으로 한 번 더 확인하고 넘기는 게 관행입니다. 특히 애매한 건은 꼭 구두로 확인합니다.`,
  trust_boundary: (a) =>
    `(예시) 단순 조회나 형식 확인 수준은 AI가 처리해도 괜찮다고 봅니다. 다만 금액이 크거나 평소와 다른 패턴이면 반드시 사람이 최종 확인해야 한다고 생각합니다. 예전에 자동화를 검토하다가 오탐 우려로 보류된 적도 있습니다.`
};

function candidateQuestion(
  category: string,
  tacitType: keyof typeof TEMPLATES,
  fact: GroundedFact,
  second?: GroundedFact
): RawItem {
  return {
    category,
    subType: undefined,
    question: TEMPLATES[tacitType](fact, second),
    intent: `${fact.kind} 사실(${fact.id})에 대해 문서화되지 않은 판단 기준·예외를 확인`,
    expectedInsight: "현업 담당자의 실제 처리 관행, 경험적 판단, 예외 처리 사례",
    tacitKnowledgeType: tacitType,
    evidenceFactIds: second ? [fact.id, second.id] : [fact.id],
    sampleAnswer: SAMPLE_ANSWER_TEMPLATES[tacitType](fact, second)
  };
}

function heuristicGenerate(facts: GroundedFact[]): RawItem[] {
  const byKind = (k: GroundedFact["kind"]) => facts.filter((f) => f.kind === k);
  const rules = byKind("rule");
  const decisions = byKind("decision");
  const exceptions = byKind("exception");
  const process = byKind("process");
  const painpoints = byKind("painpoint");
  const systems = byKind("system");
  const users = byKind("user");

  const items: RawItem[] = [];
  const take = <T>(arr: T[], n: number) => arr.slice(0, n);

  for (const f of take(rules, 4)) items.push(candidateQuestion("Business", "boundary", f));
  for (const f of take(decisions, 4)) items.push(candidateQuestion("Business", "judgment", f));

  for (let i = 0; i < Math.min(4, users.length); i++) {
    const a = users[i];
    const b = users[(i + 1) % users.length];
    if (a && b && a.id !== b.id) items.push(candidateQuestion("User", "handoff", a, b));
  }
  for (const f of take(decisions, 4)) items.push(candidateQuestion("User", "hidden_rule", f));

  for (const f of take(process, 5)) items.push(candidateQuestion("Process", "workaround", f));
  for (const f of take(exceptions, 5)) items.push(candidateQuestion("Process", "exception", f));

  for (const f of take(systems, 4)) items.push(candidateQuestion("System", "failure", f));
  for (const f of take(systems, 3)) items.push(candidateQuestion("System", "workaround", f));

  for (const f of take(decisions, 6)) items.push(candidateQuestion("AI", "trust_boundary", f));

  for (const f of take(exceptions, 3)) items.push(candidateQuestion("Operation", "failure", f));
  for (const f of take(painpoints, 4)) items.push(candidateQuestion("Operation", "workaround", f));

  const seen = new Set<string>();
  return items.filter((it) => {
    if (seen.has(it.question)) return false;
    seen.add(it.question);
    return true;
  });
}

export async function generateInterviewQuestions(
  projectSummary: string,
  docs: DocInput[]
): Promise<{ questions: InterviewQuestionItem[]; mode: "llm" | "heuristic" }> {
  const facts = buildGroundedFacts(docs);
  const factMap = new Map(facts.map((f) => [f.id, f]));

  if (facts.length === 0) {
    return { questions: [], mode: "heuristic" };
  }

  if (llmAvailable()) {
    try {
      const raw = await completeJSON<RawItem[]>(SYSTEM_PROMPT, buildUserPrompt(projectSummary, facts), 8192);
      const finalized = finalize(raw, factMap);
      if (finalized.length > 0) return { questions: finalized, mode: "llm" };
    } catch (err) {
      if (!(err instanceof NoLLMError)) {
        console.error("LLM interview generation failed, falling back to heuristic:", err);
      }
    }
  }

  const raw = heuristicGenerate(facts);
  return { questions: finalize(raw, factMap), mode: "heuristic" };
}

export { BASE_CATEGORIES };
