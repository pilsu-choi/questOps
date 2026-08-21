import fs from "node:fs/promises";
import path from "node:path";

// multer/busboy decode multipart filename headers as latin1 by default, even though
// browsers actually send UTF-8 bytes — so a Korean filename arrives mojibake'd
// (e.g. "외환.docx" -> "ì¸í.docx"). Re-interpreting those bytes as UTF-8 recovers
// the original name. Safe to call on already-correct ASCII names (no-op).
export function fixUploadedFilename(name: string): string {
  return Buffer.from(name, "latin1").toString("utf8");
}

export function docFileType(filename: string): string {
  const ext = path.extname(filename).toLowerCase().replace(".", "");
  const map: Record<string, string> = {
    pdf: "PDF",
    docx: "DOCX",
    doc: "DOC",
    pptx: "PPTX",
    xlsx: "XLSX",
    xls: "XLS",
    txt: "TXT",
    md: "MD",
    csv: "CSV",
    png: "IMAGE",
    jpg: "IMAGE",
    jpeg: "IMAGE"
  };
  return map[ext] || ext.toUpperCase() || "FILE";
}

// pdfjs-dist가 실패하거나(암호화/손상된 PDF 등) 예외를 던질 때 쓰는 안전망.
// 좌표 정보 없이 페이지 안의 텍스트 런을 그냥 이어붙이므로 구조는 없지만, 최소한
// 텍스트 자체는 회수한다.
async function extractPdfFallback(buf: Buffer): Promise<string> {
  const pdfParse = (await import("pdf-parse")).default;
  let pageNum = 0;
  const data = await pdfParse(buf, {
    pagerender: (pageData: any) =>
      pageData.getTextContent().then((textContent: any) => {
        pageNum += 1;
        const text = textContent.items.map((i: any) => i.str).join(" ");
        return `\n[[PAGE ${pageNum}]]\n${text}`;
      })
  });
  return data.text;
}

interface PdfLineItem {
  str: string;
  x: number;
  y: number;
  fontSize: number;
  width: number;
}

interface PdfLine {
  y: number;
  fontSize: number;
  items: PdfLineItem[];
}

let pdfjsAssetUrls: { standardFontDataUrl: string; cMapUrl: string } | undefined;

// pdfjs-dist는 임베딩 안 된 표준 폰트의 글자 폭(standard_fonts)과 CID 폰트 인코딩(cmaps,
// 한글 PDF에서 흔함)을 로컬 파일로 제공받아야 조용히, 정확히 동작한다. 패키지 설치 위치를
// 런타임에 찾아 file:// URL로 넘긴다.
function resolvePdfjsAssetUrls(): { standardFontDataUrl: string; cMapUrl: string } {
  if (!pdfjsAssetUrls) {
    const pkgUrl = import.meta.resolve("pdfjs-dist/package.json");
    pdfjsAssetUrls = {
      standardFontDataUrl: new URL("../standard_fonts/", pkgUrl).href,
      cMapUrl: new URL("../cmaps/", pkgUrl).href
    };
  }
  return pdfjsAssetUrls;
}

// 문장 내부 커닝/자간으로 쪼개진 인접 글자 사이의 미세한 틈(대략 fontSize의 0.15배 미만)은
// 같은 단어로 보고 공백을 넣지 않는다. 그보다 크면 단어 사이 공백으로 본다.
function joinLineText(items: PdfLineItem[]): string {
  let text = "";
  let prevEnd: number | null = null;
  for (const it of items) {
    if (prevEnd !== null && it.x - prevEnd > it.fontSize * 0.15) text += " ";
    text += it.str;
    prevEnd = it.x + (it.width || 0);
  }
  return text.trim();
}

// y좌표가 비슷한(같은 fontSize 대비 허용오차 이내) 텍스트 아이템들을 한 줄로 묶는다.
// PDF 좌표계는 아래가 원점(y 증가=위쪽)이라 y 내림차순 정렬이 곧 위→아래 읽기 순서다.
function groupPdfLines(rawItems: any[]): PdfLine[] {
  const items: PdfLineItem[] = rawItems
    .filter((it) => typeof it.str === "string" && it.str.trim().length > 0)
    .map((it) => ({
      str: it.str,
      x: it.transform[4],
      y: it.transform[5],
      fontSize: Math.hypot(it.transform[0], it.transform[1]) || it.height || 1,
      width: it.width ?? 0
    }));
  items.sort((a, b) => b.y - a.y || a.x - b.x);

  const lines: PdfLine[] = [];
  for (const it of items) {
    const last = lines[lines.length - 1];
    const tolerance = Math.max(2, it.fontSize * 0.3);
    if (last && Math.abs(last.y - it.y) <= tolerance) {
      last.items.push(it);
    } else {
      lines.push({ y: it.y, fontSize: it.fontSize, items: [it] });
    }
  }
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    line.fontSize = Math.max(...line.items.map((i) => i.fontSize));
  }
  return lines;
}

interface PdfColumn {
  x: number;
  text: string;
}

// 줄 안에서 fontSize 대비 확실히 큰(칸 구분급) 공백을 기준으로만 컬럼을 나눈다 -
// 실제 PDF는 커닝 때문에 평범한 한 문장도 아이템이 여러 개로 쪼개져 나오는 일이 흔해서,
// 단순히 "아이템 개수 &gt;= 2"로 표를 판정하면 거의 모든 문단 줄이 표로 오탐된다.
function splitLineIntoColumns(line: PdfLine): PdfColumn[] {
  const bigGap = Math.max(line.fontSize * 1.8, 14);
  const cols: PdfColumn[] = [];
  let curStart = line.items[0].x;
  let curText = "";
  let prevEnd: number | null = null;
  for (const it of line.items) {
    if (prevEnd !== null && it.x - prevEnd > bigGap) {
      cols.push({ x: curStart, text: curText.trim() });
      curStart = it.x;
      curText = "";
    } else if (prevEnd !== null && it.x - prevEnd > it.fontSize * 0.15) {
      curText += " ";
    }
    curText += it.str;
    prevEnd = it.x + (it.width || 0);
  }
  cols.push({ x: curStart, text: curText.trim() });
  return cols.filter((c) => c.text.length > 0);
}

// 컬럼 구성(개수와 x 시작 위치)이 연속된 줄 사이에 그대로 반복되면 표로 본다.
// 표 후보 줄들의 인덱스 집합을 반환한다.
function detectPdfTableLines(lines: PdfLine[]): { tableLineIndexes: Set<number>; columnsByLine: PdfColumn[][] } {
  const columnsByLine = lines.map(splitLineIntoColumns);
  const aligned = (a: PdfColumn[], b: PdfColumn[]) =>
    a.length === b.length && a.every((c, i) => Math.abs(c.x - b[i].x) <= 12);

  const tableLineIndexes = new Set<number>();
  let i = 0;
  while (i < lines.length) {
    if (columnsByLine[i].length < 2) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < lines.length && columnsByLine[j].length >= 2 && aligned(columnsByLine[i], columnsByLine[j])) j++;
    if (j - i >= 2) for (let k = i; k < j; k++) tableLineIndexes.add(k);
    i = j > i + 1 ? j : i + 1;
  }
  return { tableLineIndexes, columnsByLine };
}

function median(nums: number[]): number {
  if (!nums.length) return 14;
  const sorted = [...nums].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// 문서 내에서 가장 흔히 쓰인(총 글자 수 기준 가중치) 폰트 크기를 본문 크기로 본다 -
// 제목/섹션 폰트는 이보다 눈에 띄게 커야 헤딩으로 인정한다.
function estimateBodyFontSize(lines: PdfLine[]): number {
  const weight = new Map<number, number>();
  for (const line of lines) {
    const size = Math.round(line.fontSize * 10) / 10;
    const text = joinLineText(line.items);
    weight.set(size, (weight.get(size) ?? 0) + text.length);
  }
  let best = 11;
  let bestWeight = -1;
  for (const [size, w] of weight) {
    if (w > bestWeight) {
      best = size;
      bestWeight = w;
    }
  }
  return best;
}

type PdfBlock = { kind: "heading" | "tr" | "p"; line: string };

// 한 페이지의 줄들을 "# 제목"(폰트 크기 비율 기반, 최대 3레벨) / "| 칸 | 칸 |"(표) /
// 줄바꿈만으로 이어지던 것을 하나의 문단으로 합친 일반 텍스트로 변환한다.
// 줄 간격이 본문 줄간격의 1.6배를 넘으면 새 문단으로 끊는다(문단 경계 추정).
function pdfLinesToBlocks(lines: PdfLine[]): PdfBlock[] {
  if (!lines.length) return [];
  const bodyFontSize = estimateBodyFontSize(lines);
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) gaps.push(lines[i - 1].y - lines[i].y);
  const typicalGap = median(gaps);
  const { tableLineIndexes, columnsByLine } = detectPdfTableLines(lines);

  const blocks: PdfBlock[] = [];
  let paragraph: string | null = null;
  const flushParagraph = () => {
    if (paragraph) blocks.push({ kind: "p", line: paragraph });
    paragraph = null;
  };

  lines.forEach((line, i) => {
    if (tableLineIndexes.has(i)) {
      flushParagraph();
      const row = columnsByLine[i].map((c) => c.text).join(" | ");
      blocks.push({ kind: "tr", line: `| ${row} |` });
      return;
    }

    const text = joinLineText(line.items);
    if (!text) return;

    const ratio = line.fontSize / bodyFontSize;
    const headingLevel = ratio >= 1.8 ? 1 : ratio >= 1.4 ? 2 : ratio >= 1.15 ? 3 : 0;
    if (headingLevel > 0) {
      flushParagraph();
      blocks.push({ kind: "heading", line: `${"#".repeat(headingLevel)} ${text}` });
      return;
    }

    const lineGap = i > 0 ? lines[i - 1].y - line.y : typicalGap;
    if (paragraph === null || lineGap > typicalGap * 1.6) {
      flushParagraph();
      paragraph = text;
    } else {
      paragraph += ` ${text}`;
    }
  });
  flushParagraph();
  return blocks;
}

function renderPdfBlocks(blocks: PdfBlock[]): string {
  let out = "";
  blocks.forEach((b, i) => {
    if (i > 0) {
      const prev = blocks[i - 1];
      const sameGroup = prev.kind === b.kind && b.kind === "tr";
      out += sameGroup ? "\n" : "\n\n";
    }
    out += b.line;
  });
  return out;
}

// pdf-parse는 좌표 없이 텍스트만 흘려보내던 것과 달리, pdfjs-dist로 각 텍스트의 위치와
// 폰트 크기를 받아 제목/문단/표를 구분해 인코딩한다(fileParsing.ts 상단 DOCX/PPTX와
// 같은 방식: "# 제목", 문단은 "\n\n"으로 구분, "| 칸 | 칸 |" 표). 휴리스틱이라 완벽하지
// 않지만, 문단 경계도 없이 페이지 텍스트를 통짜로 흘려보내던 이전 방식보다는 청킹·분석
// 단계에서 구조를 훨씬 잘 살릴 수 있다.
async function extractPdfLayout(buf: Buffer): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { standardFontDataUrl, cMapUrl } = resolvePdfjsAssetUrls();
  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(buf),
    standardFontDataUrl,
    cMapUrl,
    cMapPacked: true,
    verbosity: 0
  }).promise;

  const pageTexts: string[] = [];
  try {
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      const lines = groupPdfLines(content.items);
      const blocks = pdfLinesToBlocks(lines);
      pageTexts.push(`\n[[PAGE ${pageNum}]]\n${renderPdfBlocks(blocks)}`);
    }
  } finally {
    await doc.destroy();
  }
  return pageTexts.join("\n\n");
}

async function extractPdf(buf: Buffer): Promise<string> {
  try {
    return await extractPdfLayout(buf);
  } catch (err) {
    return await extractPdfFallback(buf);
  }
}

export function findNearestPage(text: string, index: number): number | undefined {
  const upTo = text.slice(0, index);
  const matches = [...upTo.matchAll(/\[\[PAGE (\d+)\]\]/g)];
  if (matches.length === 0) return undefined;
  return Number(matches[matches.length - 1][1]);
}

export function findNearestSection(text: string, index: number): string | undefined {
  const upTo = text.slice(0, index);
  const matches = [...upTo.matchAll(/## (Sheet|Slide)[^\n]*/g)];
  if (matches.length === 0) return undefined;
  return matches[matches.length - 1][0].replace(/^##\s*/, "");
}

// mammoth의 기본 변환은 Word 스타일(Heading 1..6, 목록, 표)을 h1-h6/li/table로 매핑해준다.
// 이걸 그대로 텍스트로 밀어버리던 extractRawText 대신 convertToHtml로 받아 구조를 보존한 채
// 마크다운 유사 표기(# 제목 / - 목록 / | 표 |)로 인코딩해, 청킹·분석 단계에서 문단/섹션
// 경계를 알 수 있게 한다. 이미지는 base64로 embedding하면 결과가 비대해지므로 비워둔다.
async function extractDocx(buf: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.convertToHtml(
    { buffer: buf },
    { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) }
  );
  return htmlToStructuredText(result.value);
}

const BLOCK_TAG_RE =
  /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>|<li[^>]*>([\s\S]*?)<\/li>|<tr[^>]*>([\s\S]*?)<\/tr>|<p[^>]*>([\s\S]*?)<\/p>/gi;
const TABLE_CELL_RE = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function tableRowToLine(rowHtml: string): string {
  const cells = [...rowHtml.matchAll(TABLE_CELL_RE)].map((m) => stripTags(m[1]));
  return cells.length ? `| ${cells.join(" | ")} |` : "";
}

// h1-h6는 "#"×레벨, 목록은 "- ", 표 행은 "| a | b |"로, 나머지 문단은 그대로 한 줄로 만들고
// 서로 다른 종류의 블록 사이는 "\n\n"(문단 경계)으로, 같은 목록/같은 표의 연속 항목끼리는
// "\n"으로만 구분한다 — agent-runtime의 문단 경계 인식 청킹(tools.ts readTextChunk)이
// 이 "\n\n"을 그대로 활용한다.
function htmlToStructuredText(html: string): string {
  type Block = { kind: "heading" | "li" | "tr" | "p"; line: string };
  const blocks: Block[] = [];

  for (const m of html.matchAll(BLOCK_TAG_RE)) {
    if (m[1] !== undefined) {
      const line = stripTags(m[2]);
      if (line) blocks.push({ kind: "heading", line: `${"#".repeat(Number(m[1]))} ${line}` });
    } else if (m[3] !== undefined) {
      const line = stripTags(m[3]);
      if (line) blocks.push({ kind: "li", line: `- ${line}` });
    } else if (m[4] !== undefined) {
      const line = tableRowToLine(m[4]);
      if (line) blocks.push({ kind: "tr", line });
    } else if (m[5] !== undefined) {
      const line = stripTags(m[5]);
      if (line) blocks.push({ kind: "p", line });
    }
  }

  let structured = "";
  blocks.forEach((b, i) => {
    if (i > 0) {
      const prev = blocks[i - 1];
      const sameGroup = prev.kind === b.kind && (b.kind === "li" || b.kind === "tr");
      structured += sameGroup ? "\n" : "\n\n";
    }
    structured += b.line;
  });

  // mammoth가 예상 밖의 태그(위 정규식이 다루지 않는 블록)를 내보내는 경우를 대비한
  // 안전망: 구조화 결과가 원문 대비 지나치게 짧으면(내용 유실 의심) 순수 텍스트로 폴백한다.
  const rawFallback = stripTags(html);
  if (rawFallback.length > 50 && structured.length < rawFallback.length * 0.3) {
    return rawFallback;
  }
  return structured;
}

async function extractXlsx(buf: Buffer): Promise<string> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "buffer" });
  const chunks: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    chunks.push(`## Sheet: ${sheetName}`);
    chunks.push(XLSX.utils.sheet_to_csv(sheet));
  }
  return chunks.join("\n\n");
}

const SHAPE_RE = /<p:sp>([\s\S]*?)<\/p:sp>/g;
const SLIDE_PARA_RE = /<a:p>([\s\S]*?)<\/a:p>/g;
const RUN_TEXT_RE = /<a:t>([^<]*)<\/a:t>/g;
const TITLE_PLACEHOLDER_RE = /<p:ph[^>]*\btype="(title|ctrTitle)"/;
const BULLET_RE = /<a:buChar\b|<a:buAutoNum\b/;

function paragraphText(paraXml: string): string {
  return decodeHtmlEntities([...paraXml.matchAll(RUN_TEXT_RE)].map((m) => m[1]).join(""))
    .trim();
}

// 슬라이드 XML의 도형(p:sp) 하나를 제목/본문 여부(placeholder type)와 문단별 글머리
// 기호 유무(a:buChar/a:buAutoNum)로 구분해, 제목은 "# ", 목록 항목은 "- "로 인코딩한다.
function shapeToLines(shapeXml: string): string[] {
  const isTitle = TITLE_PLACEHOLDER_RE.test(shapeXml);
  const lines: string[] = [];
  for (const p of shapeXml.matchAll(SLIDE_PARA_RE)) {
    const text = paragraphText(p[1]);
    if (!text) continue;
    if (isTitle) lines.push(`# ${text}`);
    else if (BULLET_RE.test(p[1])) lines.push(`- ${text}`);
    else lines.push(text);
  }
  return lines;
}

async function extractPptx(buf: Buffer): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  const slideFiles = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml/)?.[1] ?? 0);
      const nb = Number(b.match(/slide(\d+)\.xml/)?.[1] ?? 0);
      return na - nb;
    });
  const chunks: string[] = [];
  for (const [i, f] of slideFiles.entries()) {
    const xml = await zip.files[f].async("text");
    const shapeMatches = [...xml.matchAll(SHAPE_RE)];
    let lines = shapeMatches.flatMap((m) => shapeToLines(m[1]));
    if (!lines.length) {
      // 표/스마트아트 등 p:sp가 아닌 형태로 텍스트가 들어있는 슬라이드에 대한 안전망 -
      // 구조 인식 없이 슬라이드 내 모든 텍스트 런을 예전 방식대로 그대로 이어붙인다.
      const flat = [...xml.matchAll(RUN_TEXT_RE)].map((m) => decodeHtmlEntities(m[1])).join(" ").trim();
      if (flat) lines = [flat];
    }
    chunks.push(`## Slide ${i + 1}${lines.length ? "\n" + lines.join("\n") : ""}`);
  }
  return chunks.join("\n\n");
}

export async function extractText(filePath: string, filename: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  const type = docFileType(filename);
  try {
    switch (type) {
      case "PDF":
        return await extractPdf(buf);
      case "DOCX":
        return await extractDocx(buf);
      case "XLSX":
      case "XLS":
        return await extractXlsx(buf);
      case "PPTX":
        return await extractPptx(buf);
      case "TXT":
      case "MD":
      case "CSV":
        return buf.toString("utf-8");
      case "IMAGE":
        return "";
      default:
        return buf.toString("utf-8");
    }
  } catch (err) {
    throw new Error(`텍스트 추출 실패 (${type}): ${(err as Error).message}`);
  }
}
