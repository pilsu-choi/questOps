import { nanoid } from "nanoid";
import { db } from "../db.js";
import { logDebug, logError } from "../logger.js";
import type { AgentRunResult } from "./types.js";

// 지금까지 QuestOps는 LLM 호출 실패/재시도 추적이 전혀 없었다.
// 에이전트 루프는 턴이 여러 번 도는 만큼, 무슨 tool을 호출했고 왜 검증에
// 실패했는지 남겨야 디버깅이 가능해서 매 실행을 한 행으로 기록한다.
// DB(agent_run_logs)뿐 아니라 서버 로그(DEBUG 레벨)로도 남겨서, DB를 직접 열어보지
// 않고도 실시간으로 tail 가능하게 한다. 개발 단계가 끝나 LOG_LEVEL을 올리면(info 이상)
// 이 상세 로그는 자동으로 꺼지고 DB 기록만 남는다.
export function saveAgentRunLog(result: AgentRunResult): void {
  logDebug(`agent run [${result.runLabel}] status=${result.status} turns=${result.turns.length}`, {
    runLabel: result.runLabel,
    status: result.status,
    error: result.error,
    turns: result.turns
  });

  try {
    db.prepare(
      `INSERT INTO agent_run_logs (id, run_label, status, turn_count, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(nanoid(12), result.runLabel, result.status, result.turns.length, JSON.stringify({ turns: result.turns, error: result.error }), new Date().toISOString());
  } catch (err) {
    logError("agent run log 저장 실패", err);
  }
}
