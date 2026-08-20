import type { ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { AgentTool } from "./types.js";

export const SUBMIT_TOOL_NAME = "submit_result";
export const PLAN_TOOL_NAME = "update_plan";

// 모든 agent 실행의 종료 지점이 되는 공용 tool.
// Zod 스키마 검증을 통과해야 terminate:true가 되어 루프가 끝나고,
// 실패하면 오류를 tool 결과 텍스트로 되돌려줘서 모델이 스스로 고쳐 재제출하게 한다
// (openClaw의 "에러를 tool 결과로 피드백해 자기교정" 패턴).
export function createSubmitTool<T>(schema: ZodType<T>, description: string): AgentTool {
  return {
    name: SUBMIT_TOOL_NAME,
    description: `${description} 이 스키마를 만족하는 인자로만 호출해야 하며, 검증에 실패하면 오류 메시지가 반환되니 수정해서 다시 호출하라. 조사가 끝나면 반드시 이 tool로 최종 제출한다.`,
    parameters: zodToJsonSchema(schema, { target: "openApi3" }) as Record<string, unknown>,
    execute(args: unknown) {
      const parsed = schema.safeParse(args);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
        return { content: `검증 실패 - ${issues}\n스키마에 맞춰 ${SUBMIT_TOOL_NAME}을 다시 호출하라.`, isValidationError: true };
      }
      return { content: "제출이 접수되었습니다.", details: parsed.data, terminate: true };
    }
  };
}

// 작업 시작 전 계획을 명시적으로 기록하게 하는 tool. loop.ts가 1턴째에 이 tool을
// forceTool로 강제해, 모델이 조사/제출에 앞서 무엇을 할지 먼저 정리하게 한다.
// 별도 상태 저장이 필요 없다 — tool 호출 결과는 messages 히스토리에 남아
// 다른 tool 결과와 동일하게 이후 턴에서 모델이 자연히 다시 참조한다.
export function createPlanTool(): AgentTool {
  return {
    name: PLAN_TOOL_NAME,
    description: "작업을 시작하기 전에 수행할 단계를 순서대로 기록한다. 진행 중 계획이 바뀌면 다시 호출해 갱신할 수 있다.",
    parameters: {
      type: "object",
      properties: {
        steps: { type: "array", items: { type: "string" }, description: "수행할 단계를 순서대로, 각각 한 문장으로" }
      },
      required: ["steps"]
    },
    execute(args: { steps?: string[] }) {
      const list = (args?.steps ?? []).map((s, i) => `${i + 1}. ${s}`).join("\n");
      return { content: `계획이 기록되었습니다:\n${list}` };
    }
  };
}

// 긴 텍스트를 offset부터 chunkSize만큼 잘라 사람이 읽기 좋은 형태로 감싸는 순수 함수.
// createReadTextChunkTool과 read_project_document_chunk(projectDocumentTools.ts) 둘 다
// 이 로직을 공유한다 — 하나는 고정 문자열을, 하나는 DB에서 조회한 문자열을 다룰 뿐
// 청크 계산 자체는 동일하다.
export function readTextChunk(text: string, offset: number, chunkSize: number): string {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  const slice = text.slice(safeOffset, safeOffset + chunkSize);
  const nextOffset = safeOffset + slice.length;
  const hasMore = nextOffset < text.length;
  return `[${safeOffset}-${nextOffset} / 총 ${text.length}자]\n${slice}${
    hasMore ? `\n\n(계속 읽으려면 offset=${nextOffset}로 다시 호출)` : "\n\n(문서 끝)"
  }`;
}

// 긴 원문 텍스트를 청크 단위로 읽는 tool. 프롬프트에는 미리보기만 넣고,
// 모델이 필요하다고 판단할 때만 나머지를 조회하게 해서 매 호출 24k자를
// 무조건 밀어넣던 기존 방식보다 토큰을 아끼면서도 필요 시 전문을 다 볼 수 있게 한다.
export function createReadTextChunkTool(name: string, description: string, text: string, chunkSize = 8000): AgentTool {
  return {
    name,
    description: `${description} 전체 길이는 ${text.length}자. offset(문자 인덱스, 기본 0)을 지정해 그 위치부터 최대 ${chunkSize}자를 읽는다.`,
    parameters: {
      type: "object",
      properties: { offset: { type: "number", description: "읽기 시작할 문자 인덱스 (기본 0)" } },
      required: []
    },
    execute(args: { offset?: number }) {
      return { content: readTextChunk(text, args?.offset ?? 0, chunkSize) };
    }
  };
}
