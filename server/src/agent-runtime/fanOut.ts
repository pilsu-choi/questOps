import { runAgentLoop } from "./loop.js";
import type { AgentRunConfig, AgentRunResult } from "./types.js";

// FanOutTask는 AgentRunConfig와 필드가 동일하다(독립된 하위 실행 하나 = 하나의 AgentRunConfig).
// 별도 이름을 쓰는 건 "fan-out으로 병렬 실행되는 task"라는 의도를 호출부에서 명시하기 위함이다.
export type FanOutTask = AgentRunConfig;

export interface FanOutOptions {
  /** 동시에 실행할 최대 task 수. 기본 3. */
  concurrency?: number;
}

const DEFAULT_CONCURRENCY = 3;

// 동시성 캡을 둔 채로 thunk 배열을 실행하는 범용 스케줄러. LLM 호출과 분리해뒀기 때문에
// 네트워크 없이 순수하게 테스트 가능하다.
export async function runWithConcurrency<T>(thunks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results: T[] = new Array(thunks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex++;
      if (i >= thunks.length) return;
      results[i] = await thunks[i]();
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, thunks.length || 1));
  await Promise.all(Array.from({ length: thunks.length ? workerCount : 0 }, () => worker()));
  return results;
}

// 독립적인 하위 작업들을 병렬로 위임하는 fan-out 프리미티브.
// openClaw처럼 모델이 스스로 서브에이전트를 동적으로 스폰하지는 않는다 - QuestOps는 요청당
// 비용/턴수가 예측 가능해야 하므로, fan-out은 항상 호출부(서비스 코드)가 task 배열을 정적으로
// 선언한다. runAgentLoop는 이미 모든 실패를 AgentRunResult로 흡수해 throw하지 않는 구조지만,
// 방어적으로 개별 task를 try/catch로 감싸 예상치 못한 예외가 나머지 task를 중단시키지 않게 한다.
export async function runFanOutAgents(tasks: FanOutTask[], options?: FanOutOptions): Promise<AgentRunResult[]> {
  const concurrency = options?.concurrency ?? DEFAULT_CONCURRENCY;
  const thunks = tasks.map((task) => async (): Promise<AgentRunResult> => {
    try {
      return await runAgentLoop(task);
    } catch (err) {
      return { runLabel: task.runLabel, status: "error", turns: [], error: `fan-out 실행 중 예외: ${(err as Error).message}` };
    }
  });
  return runWithConcurrency(thunks, concurrency);
}
