import type { DocumentAnalysis } from "../types.js";
import { locateSentence } from "./textUtils.js";

export interface GroundedFact {
  id: string;
  document: string;
  page?: number;
  section?: string;
  text: string;
  kind: "rule" | "decision" | "exception" | "process" | "painpoint" | "system" | "user" | "unknown" | "opportunity";
}

export interface DocInput {
  filename: string;
  extractedText: string;
  analysis: DocumentAnalysis;
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `F${String(counter).padStart(3, "0")}`;
}

function toFacts(
  filename: string,
  rawText: string,
  items: string[],
  kind: GroundedFact["kind"]
): GroundedFact[] {
  return items.map((text) => {
    const loc = locateSentence(rawText, text);
    return { id: nextId(), document: filename, page: loc.page, section: loc.section, text, kind };
  });
}

export function buildGroundedFacts(docs: DocInput[]): GroundedFact[] {
  counter = 0;
  const facts: GroundedFact[] = [];
  for (const d of docs) {
    const a = d.analysis;
    facts.push(...toFacts(d.filename, d.extractedText, a.businessRules, "rule"));
    facts.push(...toFacts(d.filename, d.extractedText, a.decisionPoints, "decision"));
    facts.push(...toFacts(d.filename, d.extractedText, a.exceptions, "exception"));
    facts.push(...toFacts(d.filename, d.extractedText, a.process, "process"));
    facts.push(...toFacts(d.filename, d.extractedText, a.painPoints, "painpoint"));
    facts.push(...toFacts(d.filename, d.extractedText, a.systems, "system"));
    facts.push(...toFacts(d.filename, d.extractedText, a.keyUsers, "user"));
    facts.push(...toFacts(d.filename, d.extractedText, a.unknowns, "unknown"));
    facts.push(...toFacts(d.filename, d.extractedText, a.aiOpportunities, "opportunity"));
  }
  return facts;
}

export function factSheetText(facts: GroundedFact[]): string {
  return facts
    .map((f) => {
      const loc = [f.document, f.page ? `p.${f.page}` : null, f.section || null].filter(Boolean).join(" · ");
      return `[${f.id}] (${f.kind}) ${f.text}\n  출처: ${loc}`;
    })
    .join("\n");
}
