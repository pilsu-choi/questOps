import { Router } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import { db } from "../db.js";
import { docFileType, extractText, fixUploadedFilename } from "../services/fileParsing.js";
import { analyzeDocument } from "../services/documentAnalysis.js";
import { logError } from "../logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsRoot = path.join(__dirname, "..", "..", "uploads");
if (!fs.existsSync(uploadsRoot)) fs.mkdirSync(uploadsRoot, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dir = path.join(uploadsRoot, req.params.id);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    cb(null, `${nanoid(8)}__${fixUploadedFilename(file.originalname)}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

export const documentsRouter = Router();

function serializeDoc(row: any) {
  return {
    id: row.id,
    projectId: row.project_id,
    filename: row.filename,
    fileType: row.file_type,
    sizeBytes: row.size_bytes,
    uploader: row.uploader,
    status: row.status,
    analysisResult: row.analysis_result ? JSON.parse(row.analysis_result) : null,
    errorMessage: row.error_message,
    uploadedAt: row.uploaded_at,
    analyzedAt: row.analyzed_at
  };
}

async function runAnalysis(docId: string) {
  const row = db.prepare("SELECT * FROM documents WHERE id = ?").get(docId) as any;
  if (!row) return;
  try {
    const result = await analyzeDocument(row.filename, row.extracted_text || "");
    db.prepare("UPDATE documents SET status = 'analyzed', analysis_result = ?, analyzed_at = ?, error_message = NULL WHERE id = ?").run(
      JSON.stringify(result),
      new Date().toISOString(),
      docId
    );
  } catch (err) {
    db.prepare("UPDATE documents SET status = 'failed', error_message = ? WHERE id = ?").run((err as Error).message, docId);
  }
}

documentsRouter.get("/projects/:id/documents", (req, res) => {
  const rows = db.prepare("SELECT * FROM documents WHERE project_id = ? ORDER BY uploaded_at DESC").all(req.params.id) as any[];
  res.json(rows.map(serializeDoc));
});

documentsRouter.post("/projects/:id/documents", upload.array("files", 20), async (req, res) => {
  const project = db.prepare("SELECT id FROM projects WHERE id = ?").get(req.params.id);
  if (!project) return res.status(404).json({ error: "프로젝트를 찾을 수 없습니다." });

  const files = (req.files as Express.Multer.File[]) || [];
  if (files.length === 0) return res.status(400).json({ error: "업로드할 파일이 없습니다." });

  const created: any[] = [];
  for (const file of files) {
    const id = nanoid(10);
    const now = new Date().toISOString();
    const displayName = fixUploadedFilename(file.originalname);
    const fileType = docFileType(displayName);
    let extractedText = "";
    let status = "analyzing";
    let errorMessage: string | null = null;
    try {
      extractedText = await extractText(file.path, displayName);
    } catch (err) {
      status = "failed";
      errorMessage = (err as Error).message;
    }
    db.prepare(
      `INSERT INTO documents (id, project_id, filename, file_type, size_bytes, uploader, storage_path, extracted_text, status, error_message, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, req.params.id, displayName, fileType, file.size, req.body.uploader || "me", file.path, extractedText, status, errorMessage, now);
    created.push(id);
    if (status === "analyzing") {
      runAnalysis(id).catch((e) => logError("analysis error", e));
    }
  }
  db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), req.params.id);

  const rows = created.map((id) => db.prepare("SELECT * FROM documents WHERE id = ?").get(id));
  res.status(201).json(rows.map(serializeDoc));
});

documentsRouter.post("/documents/:id/reanalyze", async (req, res) => {
  const row = db.prepare("SELECT * FROM documents WHERE id = ?").get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: "문서를 찾을 수 없습니다." });
  db.prepare("UPDATE documents SET status = 'analyzing', error_message = NULL WHERE id = ?").run(req.params.id);
  runAnalysis(req.params.id).catch((e) => logError("analysis error", e));
  const updated = db.prepare("SELECT * FROM documents WHERE id = ?").get(req.params.id);
  res.json(serializeDoc(updated));
});

documentsRouter.delete("/documents/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM documents WHERE id = ?").get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: "문서를 찾을 수 없습니다." });
  try {
    if (row.storage_path && fs.existsSync(row.storage_path)) fs.unlinkSync(row.storage_path);
  } catch {}
  db.prepare("DELETE FROM documents WHERE id = ?").run(req.params.id);
  res.status(204).end();
});
