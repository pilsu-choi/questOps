import type { ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { AgentTool } from "./types.js";

// 모든 agent 실행의 종료 지점이 되는 공용 tool.
// Zod 스키마 검증을 통과해야 terminate:true가 되어 루프가 끝나고,
// 실패하면 오류를 tool 결과 텍스트로 되돌려줘서 모델이 스스로 고쳐 재제출하게 한다
// (openClaw의 "에러를 tool 결과로 피드백해 자기교정" 패턴).
export function createSubmitTool<T>(schema: ZodType<T>, description: string): AgentTool {
  return {
    name: "submit_result",
    description: `${description} 이 스키마를 만족하는 인자로만 호출해야 하며, 검증에 실패하면 오류 메시지가 반환되니 수정해서 다시 호출하라. 조사가 끝나면 반드시 이 tool로 최종 제출한다.`,
    parameters: zodToJsonSchema(schema, { target: "openApi3" }) as Record<string, unknown>,
    execute(args: unknown) {
      const parsed = schema.safeParse(args);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
        return { content: `검증 실패 - ${issues}\n스키마에 맞춰 submit_result를 다시 호출하라.`, isValidationError: true };
      }
      return { content: "제출이 접수되었습니다.", details: parsed.data, terminate: true };
    }
  };
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
      const offset = Math.max(0, Math.min(args?.offset ?? 0, text.length));
      const slice = text.slice(offset, offset + chunkSize);
      const nextOffset = offset + slice.length;
      const hasMore = nextOffset < text.length;
      return {
        content: `[${offset}-${nextOffset} / 총 ${text.length}자]\n${slice}${
          hasMore ? `\n\n(계속 읽으려면 offset=${nextOffset}로 다시 호출)` : "\n\n(문서 끝)"
        }`
      };
    }
  };
}
