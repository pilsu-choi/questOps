import { completeJSON, llmAvailable, NoLLMError } from "../llm/provider.js";
import { splitSentences } from "./textUtils.js";

export interface QuestionRef {
  id: string;
  question: string;
  category: string;
}

export interface MappedAnswer {
  questionId: string;
  answerText: string;
}

const SYSTEM_PROMPT = `당신은 인터뷰 녹취록/회의록에서 질문별 답변을 정리하는 어시스턴트다.
제공된 인터뷰 질문 목록과 녹취록 원문을 대조하여, 녹취록에서 실제로 답변된 질문에 한해
해당 질문에 대한 답변 내용을 원문에 최대한 가깝게 정리한다.
녹취록에서 다루지 않은 질문은 결과에 포함하지 않는다. 답변 내용을 지어내지 않는다.`;

function buildUserPrompt(transcript: string, questions: QuestionRef[]): string {
  const qList = questions.map((q) => `[${q.id}] (${q.category}) ${q.question}`).join("\n");
  return `인터뷰 질문 목록:
${qList}

--- 녹취록/회의록 원문 ---
${transcript.slice(0, 30000)}
--- 원문 끝 ---

각 질문에 대해 녹취록에서 실제로 다뤄진 경우에만 아래 JSON 배열로 정리하라:
[{ "questionId": "...", "answerText": "녹취록 내용을 근거로 정리한 답변" }]
JSON만 출력.`;
}

function tokenize(text: string): Set<string> {
  const matches = text.match(/[가-힣]{2,}|[A-Za-z]{3,}|\d+/g) || [];
  return new Set(matches.map((t) => t.toLowerCase()));
}

function heuristicMap(transcript: string, questions: QuestionRef[]): MappedAnswer[] {
  const sentences = splitSentences(transcript);
  if (sentences.length < 2) return [];

  const sentenceTokens = sentences.map(tokenize);

  // Rarer tokens (mentioned in fewer sentences) are stronger match signals than
  // common domain words ("처리", "확인", "담당자"...) that appear almost everywhere.
  const docFreq = new Map<string, number>();
  for (const toks of sentenceTokens) {
    for (const t of toks) docFreq.set(t, (docFreq.get(t) || 0) + 1);
  }
  const weight = (t: string) => 1 / Math.log2(2 + (docFreq.get(t) || 1));

  const results: MappedAnswer[] = [];
  for (const q of questions) {
    const qTokens = [...tokenize(q.question)];
    if (qTokens.length === 0) continue;
    const maxScore = qTokens.reduce((sum, t) => sum + weight(t), 0);

    let bestIdx = -1;
    let bestScore = 0;
    let bestRareShared = 0;
    sentenceTokens.forEach((sTokens, i) => {
      let score = 0;
      let rareShared = 0;
      for (const t of qTokens) {
        if (sTokens.has(t)) {
          score += weight(t);
          if ((docFreq.get(t) || 0) <= 2) rareShared += 1;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
        bestRareShared = rareShared;
      }
    });

    const ratio = maxScore > 0 ? bestScore / maxScore : 0;
    if (bestIdx >= 0 && ratio >= 0.4 && bestRareShared >= 2) {
      const windowStart = bestIdx;
      const windowEnd = Math.min(sentences.length, bestIdx + 3);
      const answerText = sentences.slice(windowStart, windowEnd).join(" ");
      results.push({ questionId: q.id, answerText });
    }
  }
  return results;
}

export async function mapTranscriptToAnswers(transcript: string, questions: QuestionRef[]): Promise<MappedAnswer[]> {
  if (llmAvailable()) {
    try {
      const raw = await completeJSON<MappedAnswer[]>(SYSTEM_PROMPT, buildUserPrompt(transcript, questions), 8192);
      if (Array.isArray(raw) && raw.length > 0) {
        return raw.filter((r) => r.questionId && r.answerText?.trim());
      }
    } catch (err) {
      if (!(err instanceof NoLLMError)) console.error("LLM answer mapping failed, falling back to heuristic:", err);
    }
  }
  return heuristicMap(transcript, questions);
}
