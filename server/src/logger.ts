type LogLevel = "debug" | "info" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, error: 2 };

// 개발 단계라 기본값은 debug — 운영 전환 시 .env에 LOG_LEVEL=info(또는 error)로 낮추면 된다.
function resolveLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL || "").toLowerCase();
  return raw === "debug" || raw === "info" || raw === "error" ? raw : "debug";
}

const currentLevel = resolveLevel();

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

function timestamp(): string {
  return new Date().toISOString();
}

export function logDebug(message: string, meta?: Record<string, unknown>): void {
  if (!shouldLog("debug")) return;
  if (meta !== undefined) console.debug(`[${timestamp()}] DEBUG ${message}`, meta);
  else console.debug(`[${timestamp()}] DEBUG ${message}`);
}

export function logInfo(message: string, meta?: Record<string, unknown>): void {
  if (!shouldLog("info")) return;
  if (meta !== undefined) console.log(`[${timestamp()}] INFO ${message}`, meta);
  else console.log(`[${timestamp()}] INFO ${message}`);
}

export function logError(message: string, err?: unknown): void {
  if (!shouldLog("error")) return;
  if (err !== undefined) console.error(`[${timestamp()}] ERROR ${message}`, err);
  else console.error(`[${timestamp()}] ERROR ${message}`);
}
