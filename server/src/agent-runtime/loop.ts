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

const NO_TOOL_CALL_NUDGE =
  "결과는 반드시 등록된 tool을 호출해서 제출해야 한다. 설명이나 요약을 텍스트로 직접 답하지 말고, 필요한 조사를 마쳤으면 submit_result 툴을 호출하라.";

// 일부 OpenRouter 라우팅(예: Venice가 서빙하는 reasoning 모델)은 max_tokens를 사실상
// 무시하고 수십만~수백만 자짜리 폭주 응답을 낼 때가 있다. 이걸 그대로 대화 히스토리에
// 쌓으면 다음 턴 요청 크기가 턴마다 누적돼 provider의 컨텍스트 한도를 순식간에 넘긴다.
// 1) 히스토리에는 항상 잘라서 저장하고, 2) 원본 자체가 이례적으로 크면(정상적인
// tool-calling 응답일 리 없다는 신호) 재시도해도 반복될 가능성이 높으므로 즉시 종료한다.
const MAX_ASSISTANT_TEXT_CHARS_IN_HISTORY = 2000;
const RUNAWAY_RESPONSE_CHARS = 100_000;

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

// 턴 루프: 모델 호출 -> tool 실행 -> 결과를 컨텍스트에 append -> 반복.
// openClaw의 agent-loop 패턴을 차용하되, QuestOps는 유한한 구조화 산출물 생성이
// 목적이라 steering/서브에이전트/컴팩션 없이 명시적 maxTurns 상한만 둔다.
export async function runAgentLoop(config: AgentRunConfig): Promise<AgentRunResult> {
  const maxTurns = config.maxTurns ?? DEFAULT_MAX_TURNS;
  const maxTokens = config.maxTokensPerTurn ?? DEFAULT_MAX_TOKENS_PER_TURN;
  const messages: ToolCallMessage[] = [{ role: "user", content: config.userPrompt }];
  const turns: AgentTurnLog[] = [];
  let consecutiveNoToolCallTurns = 0;
  const runStart = Date.now();

  logDebug(`[agent-loop] start [${config.runLabel}] maxTurns=${maxTurns} maxTokensPerTurn=${maxTokens} tools=${config.tools.map((t) => t.name).join(",")}`);

  for (let turn = 1; turn <= maxTurns; turn++) {
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
      messages.push({ role: "tool", toolCallId: call.id, content: result.content });
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
  }

  logDebug(`[agent-loop] [${config.runLabel}] exhausted after ${maxTurns} turns, totalElapsedMs=${Date.now() - runStart}`);
  return { runLabel: config.runLabel, status: "exhausted", turns };
}
