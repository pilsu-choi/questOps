// 범용 Agent Loop 런타임의 공용 타입.
// openClaw(ref_projects/openclaw)의 turn/tool 루프 패턴을 참고하되,
// QuestOps는 개방형 대화가 아니라 "유한한 구조화 산출물 생성"이 목적이므로
// steering 큐, 서브에이전트, 컨텍스트 컴팩션 없이 최소 형태로 구성한다.

export interface AgentToolResult {
  /** 모델에게 tool 결과로 되돌려줄 텍스트. */
  content: string;
  /** 종료 시점에만 의미 있는, 검증을 통과한 실제 산출물 (로그/리턴용). */
  details?: unknown;
  /** true면 이 tool 호출을 마지막으로 루프를 종료한다. */
  terminate?: boolean;
  /** true면 이 결과가 submit_result 스키마 검증 실패로 인한 것임을 표시한다.
   *  loop.ts가 문자열 매칭 없이 검증 실패를 감지해 별도 예산(연속 횟수)으로 추적하는 데 쓴다. */
  isValidationError?: boolean;
}

export interface AgentTool<TArgs = any> {
  name: string;
  description: string;
  /** OpenAI 호환 tool-calling API에 그대로 전달되는 JSON Schema. */
  parameters: Record<string, unknown>;
  execute(args: TArgs): Promise<AgentToolResult> | AgentToolResult;
}

export interface AgentRunConfig {
  runLabel: string;
  systemPrompt: string;
  userPrompt: string;
  tools: AgentTool[];
  /** 기본 5. 개방형 루프가 아니므로 반드시 상한을 둔다. */
  maxTurns?: number;
  maxTokensPerTurn?: number;
}

export interface AgentTurnLog {
  turn: number;
  assistantText?: string;
  toolCalls: { name: string; args: string; resultSummary: string }[];
}

export type AgentRunStatus = "submitted" | "exhausted" | "error" | "validation_exhausted";

export interface AgentRunResult {
  runLabel: string;
  status: AgentRunStatus;
  submission?: unknown;
  turns: AgentTurnLog[];
  error?: string;
}
