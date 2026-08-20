import { db } from "../db.js";

const POLL_INTERVAL_MS = 1000;

interface AgentRunLogRow {
  rowid: number;
  id: string;
  run_label: string;
  status: string;
  turn_count: number;
  detail: string;
  created_at: string;
}

function formatDetail(detail: string): string {
  try {
    const parsed = JSON.parse(detail);
    return parsed.error ? `error=${JSON.stringify(parsed.error)}` : "";
  } catch {
    return "";
  }
}

function printRow(row: AgentRunLogRow): void {
  const detailPart = formatDetail(row.detail);
  console.log(
    `[${row.created_at}] ${row.run_label} status=${row.status} turn_count=${row.turn_count}${detailPart ? " " + detailPart : ""}`
  );
}

function main(): void {
  const initialRows = db
    .prepare(`SELECT rowid, * FROM agent_run_logs ORDER BY rowid DESC LIMIT 20`)
    .all() as unknown as AgentRunLogRow[];
  [...initialRows].reverse().forEach(printRow);

  let lastRowid = initialRows.reduce((max, row) => Math.max(max, row.rowid), 0);

  console.log(`\n--- watching agent_run_logs for new entries (Ctrl+C to stop) ---\n`);

  setInterval(() => {
    const newRows = db
      .prepare(`SELECT rowid, * FROM agent_run_logs WHERE rowid > ? ORDER BY rowid ASC`)
      .all(lastRowid) as unknown as AgentRunLogRow[];
    for (const row of newRows) {
      printRow(row);
      lastRowid = row.rowid;
    }
  }, POLL_INTERVAL_MS);
}

main();
