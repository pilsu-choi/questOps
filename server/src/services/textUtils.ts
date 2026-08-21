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

const OUTLINE_MAX_CHARS = 2500;
const OUTLINE_MAX_ENTRIES = 60;
const TOC_HEADING_RE = /^#{0,3}\s*(목\s*차|차\s*례|Table of Contents)\s*$/i;

// "목차"/"차례" 헤딩 뒤에 이어지는 항목들을 그대로 발췌한다. 실제 목차가 있는 문서(매뉴얼,
// 제안서 등)에서는 이 원문 그대로가 가장 신뢰도 높은 구조 요약이 된다. 다음 실제 섹션
// 헤딩이 나오거나 빈 줄이 연속(문단 경계 2번)되면 목차 블록이 끝난 것으로 본다.
function extractTocSection(text: string): string | undefined {
  const lines = text.replace(/\r/g, "").split("\n");
  const headingIdx = lines.findIndex((l) => TOC_HEADING_RE.test(l.trim()));
  if (headingIdx === -1) return undefined;

  const collected: string[] = [];
  let blankStreak = 0;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^#{1,3}\s/.test(line) && !TOC_HEADING_RE.test(line.trim())) break;
    if (line.trim() === "") {
      blankStreak++;
      if (blankStreak >= 2) break;
      continue;
    }
    blankStreak = 0;
    collected.push(line);
    if (collected.join("\n").length >= OUTLINE_MAX_CHARS) break;
  }
  const toc = collected.join("\n").trim();
  return toc.length >= 30 ? toc : undefined;
}

// marker(예: "[[PAGE 3]]") 바로 다음에 나오는 첫 의미 있는 줄을 짧게 잘라 스니펫으로 쓴다.
function snippetAfter(text: string, fromIndex: number, excludeRe: RegExp): string {
  const after = text.slice(fromIndex, fromIndex + 200);
  const line = after
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !excludeRe.test(l));
  return line ? line.replace(/^#{1,6}\s*/, "").slice(0, 50) : "";
}

// 목차가 없는 문서를 위한 폴백: 파싱 단계(fileParsing.ts)가 이미 남겨둔 구조 마커
// ([[PAGE n]] / ## Slide n / ## Sheet: x / # 헤딩)를 훑어 "n p (offset=...): 스니펫" 형태의
// 목록을 만든다. offset을 같이 주는 이유는, 모델이 이 목록만 보고도 read_document_chunk를
// 청크 탐색 없이 원하는 위치로 바로 호출할 수 있게 하기 위함이다.
function buildStructureMap(text: string): string | undefined {
  const entries: string[] = [];

  if (/\[\[PAGE \d+\]\]/.test(text)) {
    const markerRe = /\[\[PAGE (\d+)\]\]/g;
    let m: RegExpExecArray | null;
    while ((m = markerRe.exec(text)) && entries.length < OUTLINE_MAX_ENTRIES) {
      const snippet = snippetAfter(text, markerRe.lastIndex, /^\[\[PAGE/);
      entries.push(`${m[1]}p (offset=${m.index})${snippet ? `: ${snippet}` : ""}`);
    }
  } else if (/^## Slide \d+/m.test(text)) {
    const markerRe = /^## Slide (\d+)$/gm;
    let m: RegExpExecArray | null;
    while ((m = markerRe.exec(text)) && entries.length < OUTLINE_MAX_ENTRIES) {
      const snippet = snippetAfter(text, markerRe.lastIndex, /^##\s/);
      entries.push(`Slide ${m[1]} (offset=${m.index})${snippet ? `: ${snippet}` : ""}`);
    }
  } else if (/^## Sheet: /m.test(text)) {
    const markerRe = /^## Sheet: (.+)$/gm;
    let m: RegExpExecArray | null;
    while ((m = markerRe.exec(text)) && entries.length < OUTLINE_MAX_ENTRIES) {
      entries.push(`Sheet: ${m[1].trim()} (offset=${m.index})`);
    }
  } else {
    const headingRe = /^(#{1,2})\s+(.+)$/gm;
    let m: RegExpExecArray | null;
    while ((m = headingRe.exec(text)) && entries.length < OUTLINE_MAX_ENTRIES) {
      entries.push(`${m[1]} ${m[2].trim()} (offset=${m.index})`);
    }
  }

  if (!entries.length) return undefined;
  const joined = entries.join("\n");
  return joined.length > OUTLINE_MAX_CHARS ? `${joined.slice(0, OUTLINE_MAX_CHARS)}\n...(생략)` : joined;
}

// 문서 구조 요약을 얻는 진입점: 실제 "목차" 섹션이 있으면 그 원문을, 없으면 페이지/슬라이드/
// 시트/헤딩 마커 기반 구조 맵(오프셋 포함)을 반환한다. 둘 다 없으면(마커 없는 순수 텍스트)
// undefined — 이 경우 호출부는 기존처럼 미리보기만으로 진행한다.
export function buildDocumentOutline(text: string): string | undefined {
  return extractTocSection(text) ?? buildStructureMap(text);
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
