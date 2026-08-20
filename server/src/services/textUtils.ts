import { findNearestPage, findNearestSection } from "./fileParsing.js";

const KOREAN_SENTENCE_END = /(다|요|함|음|까|임|됨)[.!?]?$/;

export function splitSentences(text: string): string[] {
  const cleaned = text.replace(/\r/g, "").replace(/\[\[PAGE \d+\]\]/g, "");
  const lines = cleaned.split(/\n+/);
  const out: string[] = [];
  for (const line of lines) {
    const parts = line.split(/(?<=[.!?])\s+(?=[A-Z가-힣0-9])/);
    for (const raw of parts) {
      const s = raw.trim();
      if (s.length <= 6 || s.length >= 300) continue;
      const looksLikeSentence = /[.!?]$/.test(s) || KOREAN_SENTENCE_END.test(s);
      if (looksLikeSentence) out.push(s);
    }
  }
  return out;
}

export function matchLines(sentences: string[], patterns: RegExp[], limit: number): string[] {
  const out: string[] = [];
  for (const s of sentences) {
    if (patterns.some((p) => p.test(s))) {
      out.push(s);
      if (out.length >= limit) break;
    }
  }
  return [...new Set(out)];
}

export interface SentenceEvidence {
  sentence: string;
  page?: number;
  section?: string;
}

export function locateSentence(rawText: string, sentence: string): { page?: number; section?: string } {
  const key = sentence.slice(0, Math.min(30, sentence.length));
  const idx = rawText.indexOf(key);
  if (idx === -1) return {};
  return {
    page: findNearestPage(rawText, idx),
    section: findNearestSection(rawText, idx)
  };
}
