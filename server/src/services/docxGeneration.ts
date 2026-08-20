import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ShadingType
} from "docx";
import fs from "node:fs/promises";
import type { InterviewQuestionItem } from "../types.js";

interface ProjectMeta {
  name: string;
  client: string;
  owner?: string;
  createdDate: string;
}

const ACCENT = "1E3A8A";

function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]) {
  return new Paragraph({ text, heading: level, spacing: { before: 320, after: 160 } });
}

function questionBlock(q: InterviewQuestionItem, index: number): Paragraph[] {
  const paras: Paragraph[] = [];
  paras.push(
    new Paragraph({
      spacing: { before: 240, after: 60 },
      children: [
        new TextRun({ text: `${q.id}  `, bold: true, color: ACCENT }),
        new TextRun({ text: q.question, bold: true })
      ]
    })
  );
  if (q.intent) {
    paras.push(
      new Paragraph({
        spacing: { after: 40 },
        children: [new TextRun({ text: "Interview Intent: ", bold: true, size: 18 }), new TextRun({ text: q.intent, size: 18 })]
      })
    );
  }
  if (q.expectedInsight) {
    paras.push(
      new Paragraph({
        spacing: { after: 40 },
        children: [
          new TextRun({ text: "Expected Insight: ", bold: true, size: 18 }),
          new TextRun({ text: q.expectedInsight, size: 18 })
        ]
      })
    );
  }
  if (q.sampleAnswer) {
    paras.push(
      new Paragraph({
        spacing: { after: 40 },
        shading: { type: ShadingType.SOLID, color: "F3F4FA", fill: "F3F4FA" },
        children: [
          new TextRun({ text: "Example Answer: ", bold: true, size: 18, color: "3D3CB5" }),
          new TextRun({ text: q.sampleAnswer, size: 18 })
        ]
      })
    );
  }
  if (q.evidence.length > 0) {
    const ev = q.evidence
      .map((e) => [e.document, e.page ? `p.${e.page}` : null, e.section].filter(Boolean).join(" · "))
      .join("; ");
    paras.push(
      new Paragraph({
        spacing: { after: 40 },
        children: [
          new TextRun({ text: "Evidence: ", bold: true, size: 18, italics: true }),
          new TextRun({ text: ev, size: 18, italics: true, color: "555555" })
        ]
      })
    );
  }
  return paras;
}

export async function generateInterviewDocx(
  meta: ProjectMeta,
  questions: InterviewQuestionItem[],
  outPath: string
): Promise<void> {
  const byCategory = new Map<string, InterviewQuestionItem[]>();
  for (const q of questions) {
    if (!byCategory.has(q.category)) byCategory.set(q.category, []);
    byCategory.get(q.category)!.push(q);
  }

  const sections: Paragraph[] = [];

  sections.push(
    new Paragraph({ text: "1차 인터뷰 질의서", heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { after: 120 } }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [new TextRun({ text: meta.name, size: 26, bold: true })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [new TextRun({ text: `고객사: ${meta.client}`, size: 20 })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [new TextRun({ text: `Interview Target: 현업 담당자 / 실무진`, size: 20 })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [new TextRun({ text: `작성일: ${meta.createdDate}`, size: 20 })]
    }),
    new Paragraph({ text: "", pageBreakBefore: true })
  );

  sections.push(
    heading("1. Interview Purpose", HeadingLevel.HEADING_1),
    new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({
          text:
            "본 인터뷰는 수집된 프로젝트 문서 분석 결과를 바탕으로, 문서에 기록되지 않은 현업의 실제 판단 기준·예외 처리·경험적 지식(Tacit Knowledge)을 확인하기 위해 진행합니다. " +
            "각 질문은 실제 업무 문서와 분석 결과를 근거로 구성되었으며, AI Agent 설계에 직접 반영됩니다."
        })
      ]
    })
  );

  sections.push(
    heading("2. Project Context", HeadingLevel.HEADING_1),
    new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: `프로젝트명: `, bold: true }), new TextRun({ text: meta.name })]
    }),
    new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: `고객사: `, bold: true }), new TextRun({ text: meta.client })]
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [new TextRun({ text: `총 문항 수: `, bold: true }), new TextRun({ text: `${questions.length}개` })]
    })
  );

  sections.push(heading("3. Interview Questions", HeadingLevel.HEADING_1));

  for (const [category, qs] of byCategory) {
    sections.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 280, after: 100 },
        children: [new TextRun({ text: `${category}  ` }), new TextRun({ text: `(${qs.length}문항)`, size: 18, color: "888888" })]
      })
    );
    qs.forEach((q, i) => sections.push(...questionBlock(q, i)));
  }

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: "Malgun Gothic", size: 21 } }
      }
    },
    sections: [{ properties: {}, children: sections }]
  });

  const buffer = await Packer.toBuffer(doc);
  await fs.writeFile(outPath, buffer);
}
