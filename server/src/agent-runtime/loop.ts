import { stepWithTools, type ToolCallMessage } from "../llm/toolCalling.js";
import { logDebug } from "../logger.js";
import type { AgentRunConfig, AgentRunResult, AgentToolResult, AgentTurnLog } from "./types.js";

const DEFAULT_MAX_TURNS = 5;
const DEFAULT_MAX_TOKENS_PER_TURN = 4096;

// 일부 모델(특히 OpenRouter의 특정 provider 라우팅)은 tools 파라미터를 지원한다고
// 광고하면서도 reasoning에서만 "tool을 호출하겠다"고 말하고 실제 tool_calls를
// 채우지 않는 경우가 있다. 이런 모델은 나머지 턴에서도 같은 패턴을 반복할 뿐이라,
// 연속으로 이 횟수만큼 tool 호출 없이 끝나면 maxTurns까지 기다리지 않고 조기 종료한다.
const MAX_CONSECUTIVE_NO_TOOL_CALL_TURNS = 2;

const MAX_CONSECUTIVE_VALIDATION_FAILURES = 3;

const NO_TOOL_CALL_NUDGE =
  "결과는 반드시 등록된 tool을 호출해서 제출해야 한다. 설명이나 요약을 텍스트로 직접 답하지 말고, 필요한 조사를 마쳤으면 submit_result 툴을 호출하라.";

const RESCUE_NUDGE =
  "더 이상 조사를 진행할 수 없다. 지금까지 확인한 내용을 바탕으로 최선을 다해 submit_result를 호출해 제출하라.";

// 일부 OpenRouter 라우팅(예: Venice가 서빙하는 reasoning 모델)은 max_tokens를 사실상
// 무시하고 수십만~수백만 자짜리 폭주 응답을 낼 때가 있다. 이걸 그대로 대화 히스토리에
// 쌓으면 다음 턴 요청 크기가 턴마다 누적돼 provider의 컨텍스트 한도를 순식간에 넘긴다.
// 1) 히스토리에는 항상 잘라서 저장하고, 2) 원본 자체가 이례적으로 크면(정상적인
// tool-calling 응답일 리 없다는 신호) 재시도해도 반복될 가능성이 높으므로 즉시 종료한다.
const MAX_ASSISTANT_TEXT_CHARS_IN_HISTORY = 2000;
const RUNAWAY_RESPONSE_CHARS = 100_000;

// 누적 히스토리가 비정상적으로 커지는 드문 경우(문서가 매우 크거나 모델이 청크를 반복
// 조회하는 경우)를 위한 하한선. 3~6턴짜리 유한 루프에서는 거의 트리거되지 않을 것으로 예상한다.
const MAX_HISTORY_CHARS = 120_000;

// 가장 오래된 tool 결과부터 짧은 placeholder로 축소해 누적 히스토리 크기를 임계값 아래로
// 내린다. 가장 최근 tool 결과는 모델이 방금 조회한 내용이라 절대 축소하지 않는다.
export function shrinkOldestToolMessages(messages: ToolCallMessage[], maxChars: number): ToolCallMessage[] {
  if (JSON.stringify(messages).length <= maxChars) return messages;

  const result = messages.map((m) => ({ ...m }));
  const toolIndexes = result.reduce<number[]>((acc, m, i) => {
    if (m.role === "tool" && m.content && m.content.length > 0) acc.push(i);
    return acc;
  }, []);

  for (let k = 0; k < toolIndexes.length - 1; k++) {
    if (JSON.stringify(result).length <= maxChars) break;
    const idx = toolIndexes[k];
    const original = result[idx].content ?? "";
    if (original.length <= 50) continue;
    result[idx] = { ...result[idx], content: `[이전 tool 결과 생략됨, ${original.length}자]` };
  }
  return result;
}

function truncateForHistory(text: string | undefined): string | undefined {
  if (!text || text.length <= MAX_ASSISTANT_TEXT_CHARS_IN_HISTORY) return text;
  return `${text.slice(0, MAX_ASSISTANT_TEXT_CHARS_IN_HISTORY)}\n...(생략됨, 원본 ${text.length}자)`;
}

async function runTool(
  config: AgentRunConfig,
  call: { id: string; name: string; arguments: string }
): Promise<AgentToolResult> {
  const tool = config.tools.find((t) => t.name === call.name);
  if (!tool) {
    return { content: `알 수 없는 tool: "${call.name}". 사용 가능한 tool: ${config.tools.map((t) => t.name).join(", ")}` };
  }

  let args: unknown;
  try {
    args = JSON.parse(call.arguments || "{}");
  } catch {
    return { content: `"${call.name}" 인자 JSON 파싱에 실패했습니다. 올바른 JSON으로 다시 호출하라. 받은 인자: ${call.arguments}` };
  }

  try {
    return await tool.execute(args);
  } catch (err) {
    return { content: `"${call.name}" 실행 중 오류: ${(err as Error).message}` };
  }
}

// 정상 턴 예산이 소진되기 직전, 마지막으로 딱 1번 tool_choice를 submit_result로 강제해
// "지금까지 조사한 내용으로 최선을 다해 제출하라"는 구제 턴을 시도한다. 이 턴에서도 실패하면
// 추가 구제 없이 그대로 포기한다(무한 루프 방지 - 구제는 런 전체에서 정확히 1회만 허용).
async function tryRescueTurn(
  config: AgentRunConfig,
  messages: ToolCallMessage[],
  turns: AgentTurnLog[]
): Promise<AgentRunResult | null> {
  if (!config.tools.some((t) => t.name === "submit_result")) return null;

  logDebug(`[agent-loop] [${config.runLabel}] attempting rescue turn (forceTool=submit_result)`);
  const shrunkMessages = shrinkOldestToolMessages(messages, MAX_HISTORY_CHARS);
  const rescueMessages: ToolCallMessage[] = [...shrunkMessages, { role: "user", content: RESCUE_NUDGE }];
  const step = await stepWithTools(
    config.systemPrompt,
    rescueMessages,
    config.tools,
    config.maxTokensPerTurn ?? DEFAULT_MAX_TOKENS_PER_TURN,
    "submit_result"
  );

  if (step.stopReason === "error") {
    logDebug(`[agent-loop] [${config.runLabel}] rescue turn failed: ${step.errorMessage}`);
    return null;
  }
  if (step.toolCalls.length === 0) {
    logDebug(`[agent-loop] [${config.runLabel}] rescue turn produced no tool call, giving up`);
    return null;
  }

  const turnLog: AgentTurnLog = { turn: turns.length + 1, assistantText: truncateForHistory(step.assistantText), toolCalls: [] };
  for (const call of step.toolCalls) {
    const result = await runTool(config, call);
    turnLog.toolCalls.push({ name: call.name, args: call.arguments, resultSummary: result.content.slice(0, 300) });
    if (result.terminate) {
      turns.push(turnLog);
      logDebug(`[agent-loop] [${config.runLabel}] rescue turn submitted successfully`);
      return { runLabel: config.runLabel, status: "submitted", submission: result.details, turns };
    }
  }
  turns.push(turnLog);
  logDebug(`[agent-loop] [${config.runLabel}] rescue turn tool call did not terminate, giving up`);
  return null;
}

// 턴 루프: 모델 호출 -> tool 실행 -> 결과를 컨텍스트에 append -> 반복.
// openClaw의 agent-loop 패턴을 차용하되, QuestOps는 유한한 구조화 산출물 생성이
// 목적이라 steering/동적 서브에이전트 스폰/요약 컴팩션 없이 명시적 maxTurns 상한 +
// 정적 fan-out(fanOut.ts) + 안전장치(재시도, 검증 예산, 컨텍스트 축소, 구제 턴) 위주로 구성한다.
export async function runAgentLoop(config: AgentRunConfig): Promise<AgentRunResult> {
  const maxTurns = config.maxTurns ?? DEFAULT_MAX_TURNS;
  const maxTokens = config.maxTokensPerTurn ?? DEFAULT_MAX_TOKENS_PER_TURN;
  let messages: ToolCallMessage[] = [{ role: "user", content: config.userPrompt }];
  const turns: AgentTurnLog[] = [];
  let consecutiveNoToolCallTurns = 0;
  let consecutiveValidationFailures = 0;
  let rescueAttempted = false;
  const runStart = Date.now();

  logDebug(`[agent-loop] start [${config.runLabel}] maxTurns=${maxTurns} maxTokensPerTurn=${maxTokens} tools=${config.tools.map((t) => t.name).join(",")}`);

  for (let turn = 1; turn <= maxTurns; turn++) {
    messages = shrinkOldestToolMessages(messages, MAX_HISTORY_CHARS);
    const turnStart = Date.now();
    logDebug(`[agent-loop] [${config.runLabel}] turn ${turn}/${maxTurns} calling model...`);
    const step = await stepWithTools(config.systemPrompt, messages, config.tools, maxTokens);
    logDebug(
      `[agent-loop] [${config.runLabel}] turn ${turn} model responded elapsedMs=${Date.now() - turnStart} stopReason=${step.stopReason} toolCalls=${step.toolCalls.length}`
    );

    if (step.stopReason === "error") {
      logDebug(`[agent-loop] [${config.runLabel}] aborting on error: ${step.errorMessage}`);
      return { runLabel: config.runLabel, status: "error", turns, error: step.errorMessage };
    }

    const rawAssistantLength = step.assistantText?.length ?? 0;
    if (rawAssistantLength > RUNAWAY_RESPONSE_CHARS) {
      logDebug(`[agent-loop] [${config.runLabel}] turn ${turn} runaway response detected (${rawAssistantLength} chars), aborting`);
      turns.push({ turn, assistantText: `(비정상적으로 큰 응답 ${rawAssistantLength}자 감지, 생략)`, toolCalls: [] });
      return {
        runLabel: config.runLabel,
        status: "error",
        turns,
        error: `모델 응답이 비정상적으로 큽니다 (${rawAssistantLength}자). provider/모델 오작동으로 보여 즉시 종료합니다.`
      };
    }

    messages.push({ role: "assistant", content: truncateForHistory(step.assistantText), toolCalls: step.toolCalls });

    if (step.toolCalls.length === 0) {
      turns.push({ turn, assistantText: truncateForHistory(step.assistantText), toolCalls: [] });
      consecutiveNoToolCallTurns++;
      logDebug(`[agent-loop] [${config.runLabel}] turn ${turn} no tool call (consecutive=${consecutiveNoToolCallTurns})`);
      if (consecutiveNoToolCallTurns >= MAX_CONSECUTIVE_NO_TOOL_CALL_TURNS) {
        logDebug(`[agent-loop] [${config.runLabel}] giving up after ${consecutiveNoToolCallTurns} tool-less turns, totalElapsedMs=${Date.now() - runStart}`);
        if (!rescueAttempted) {
          rescueAttempted = true;
          const rescued = await tryRescueTurn(config, messages, turns);
          if (rescued) return rescued;
        }
        return {
          runLabel: config.runLabel,
          status: "exhausted",
          turns,
          error: `모델이 ${consecutiveNoToolCallTurns}턴 연속 tool을 호출하지 않아 조기 종료했습니다. 현재 provider/모델이 tool-calling을 신뢰성 있게 지원하지 않을 수 있습니다.`
        };
      }
      messages.push({ role: "user", content: NO_TOOL_CALL_NUDGE });
      continue;
    }
    consecutiveNoToolCallTurns = 0;

    const turnLog: AgentTurnLog = { turn, assistantText: truncateForHistory(step.assistantText), toolCalls: [] };
    let submission: unknown;
    let terminate = false;

    for (const call of step.toolCalls) {
      const toolStart = Date.now();
      const result = await runTool(config, call);
      logDebug(
        `[agent-loop] [${config.runLabel}] turn ${turn} tool="${call.name}" elapsedMs=${Date.now() - toolStart} terminate=${Boolean(result.terminate)} result="${result.content.slice(0, 200)}"`
      );

      let toolResultContent = result.content;
      if (result.isValidationError) {
        consecutiveValidationFailures++;
        if (consecutiveValidationFailures >= 2) {
          toolResultContent = `(이미 ${consecutiveValidationFailures}회 검증에 실패했다. 스키마 요구사항을 다시 확인하고 신중하게 재제출하라)\n${toolResultContent}`;
        }
      } else {
        consecutiveValidationFailures = 0;
      }

      messages.push({ role: "tool", toolCallId: call.id, content: toolResultContent });
      turnLog.toolCalls.push({ name: call.name, args: call.arguments, resultSummary: result.content.slice(0, 300) });
      if (result.terminate) {
        terminate = true;
        submission = result.details;
      }
    }

    turns.push(turnLog);
    if (terminate) {
      logDebug(`[agent-loop] [${config.runLabel}] submitted on turn ${turn}, totalElapsedMs=${Date.now() - runStart}`);
      return { runLabel: config.runLabel, status: "submitted", submission, turns };
    }

    if (consecutiveValidationFailures >= MAX_CONSECUTIVE_VALIDATION_FAILURES) {
      logDebug(`[agent-loop] [${config.runLabel}] giving up after ${consecutiveValidationFailures} consecutive validation failures`);
      if (!rescueAttempted) {
        rescueAttempted = true;
        const rescued = await tryRescueTurn(config, messages, turns);
        if (rescued) return rescued;
      }
      return {
        runLabel: config.runLabel,
        status: "validation_exhausted",
        turns,
        error: `submit_result 검증에 ${consecutiveValidationFailures}회 연속 실패해 조기 종료했습니다.`
      };
    }
  }

  logDebug(`[agent-loop] [${config.runLabel}] exhausted after ${maxTurns} turns, totalElapsedMs=${Date.now() - runStart}`);
  if (!rescueAttempted) {
    rescueAttempted = true;
    const rescued = await tryRescueTurn(config, messages, turns);
    if (rescued) return rescued;
  }
  return { runLabel: config.runLabel, status: "exhausted", turns };
}
