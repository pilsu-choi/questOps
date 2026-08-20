import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const rawDb = new DatabaseSync(path.join(dataDir, "questops.sqlite"));
rawDb.exec("PRAGMA journal_mode = WAL");
rawDb.exec("PRAGMA foreign_keys = ON");

// Thin wrapper matching the better-sqlite3-style API used across routes/services.
export const db = {
  exec(sql: string) {
    rawDb.exec(sql);
  },
  prepare(sql: string) {
    const stmt = rawDb.prepare(sql);
    return {
      run: (...params: any[]) => stmt.run(...params.map(normalize)),
      get: (...params: any[]) => stmt.get(...params.map(normalize)),
      all: (...params: any[]) => stmt.all(...params.map(normalize))
    };
  }
};

function normalize(v: any) {
  return v === undefined ? null : v;
}

db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  client TEXT NOT NULL,
  owner TEXT,
  org TEXT,
  project_type TEXT,
  start_date TEXT,
  end_date TEXT,
  description TEXT,
  goal TEXT,
  current_quest TEXT NOT NULL DEFAULT 'docs',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_type TEXT NOT NULL,
  size_bytes INTEGER,
  uploader TEXT,
  storage_path TEXT,
  extracted_text TEXT,
  status TEXT NOT NULL DEFAULT 'uploaded',
  analysis_result TEXT,
  error_message TEXT,
  uploaded_at TEXT NOT NULL,
  analyzed_at TEXT
);

CREATE TABLE IF NOT EXISTS interview_sets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'idle',
  question_count INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  docx_path TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS interview_questions (
  id TEXT PRIMARY KEY,
  set_id TEXT NOT NULL REFERENCES interview_sets(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  order_num INTEGER NOT NULL,
  category TEXT NOT NULL,
  sub_type TEXT,
  question TEXT NOT NULL,
  intent TEXT,
  evidence TEXT,
  expected_insight TEXT,
  tacit_knowledge_type TEXT,
  sample_answer TEXT,
  edited INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS interview_answers (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES interview_questions(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  answer_text TEXT NOT NULL,
  note TEXT,
  extracted TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  source_document TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tacit_knowledge (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_question_id TEXT,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  evidence TEXT,
  confidence REAL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  purpose TEXT,
  users TEXT,
  workflow TEXT,
  rules TEXT,
  human_approval TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS demos (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'idle',
  screens TEXT,
  scenario TEXT,
  html_path TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'anthropic',
  model_id TEXT NOT NULL,
  api_key TEXT,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_run_logs (
  id TEXT PRIMARY KEY,
  run_label TEXT NOT NULL,
  status TEXT NOT NULL,
  turn_count INTEGER NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS presentations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'idle',
  slides TEXT,
  file_path TEXT,
  html_path TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

// Lightweight migrations for columns added after the initial CREATE TABLE (existing local DBs won't have them).
function ensureColumn(table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

ensureColumn("interview_questions", "sample_answer", "sample_answer TEXT");
ensureColumn("interview_answers", "source", "source TEXT NOT NULL DEFAULT 'manual'");
ensureColumn("interview_answers", "source_document", "source_document TEXT");
ensureColumn("demos", "html_path", "html_path TEXT");
ensureColumn("presentations", "html_path", "html_path TEXT");

// A row left in 'generating' status belongs to a request handler that ran in a previous
// process (this process just started). That handler is gone, so the row can never reach
// 'ready' or 'error' on its own — without this sweep it sits there forever and, since these
// generation endpoints always surface the most-recently-created row regardless of status,
// permanently hides the last real result behind a "generating" screen.
function sweepStaleGeneratingRows() {
  const sweptAt = new Date().toISOString();
  const message = "서버가 재시작되어 생성이 중단되었습니다. 다시 시도해주세요.";
  for (const table of ["interview_sets", "demos", "presentations"]) {
    db.prepare(`UPDATE ${table} SET status = 'error', error_message = ?, updated_at = ? WHERE status = 'generating'`).run(
      message,
      sweptAt
    );
  }
}
sweepStaleGeneratingRows();
