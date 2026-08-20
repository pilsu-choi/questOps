import fs from "node:fs/promises";
import path from "node:path";

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

async function extractPdf(buf: Buffer): Promise<string> {
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

async function extractDocx(buf: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: buf });
  return result.value;
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
    const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
    chunks.push(`## Slide ${i + 1}\n${texts.join(" ")}`);
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
