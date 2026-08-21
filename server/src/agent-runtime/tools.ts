import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { logError } from "../logger.js";
import type { AgentTool, ServerTool } from "./types.js";

export const SUBMIT_TOOL_NAME = "submit_result";
export const PLAN_TOOL_NAME = "update_plan";
export const WEB_SEARCH_SERVER_TOOL_TYPE = "openrouter:web_search";

// OpenRouter가 서버 측에서 직접 실행하는 웹서치 tool. 우리 쪽 execute()가 없다 -
// 모델이 호출을 결정하면 OpenRouter가 검색을 수행하고 같은 응답 안에서 결과를 모델에게
// 되돌려주므로 loop.ts가 별도로 디스패치할 필요가 없다. maxUses로 런당 검색 횟수를
// 제한해 비용/턴 예산이 무한정 늘어나지 않게 한다.
export function createWebSearchServerTool(maxUses = 3): ServerTool {
  return { type: WEB_SEARCH_SERVER_TOOL_TYPE, parameters: { max_uses: maxUses } };
}

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

// update_plan 기록의 저장 위치. scratchTools.ts의 scratchRoot(runId)와는 별도 디렉토리다 -
// 그쪽은 실행 종료 시 cleanupScratchWorkspace가 통째로 지우는 휘발성 초안 공간이라,
// 계획 기록을 거기 두면 런이 끝나자마자 함께 사라져버린다.
function planRecordPath(runId: string): string {
  const dir = path.join(os.tmpdir(), "questops-agent-plans");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${runId}.json`);
}

interface PlanRevision {
  at: string;
  steps: string[];
}

// 작업 시작 전 계획을 명시적으로 기록하게 하는 tool. loop.ts가 1턴째에 이 tool을
// forceTool로 강제해, 모델이 조사/제출에 앞서 무엇을 할지 먼저 정리하게 한다.
// tool 호출 결과는 messages 히스토리에도 남아 이후 턴에서 모델이 자연히 다시 참조하지만,
// 그와 별도로 매 호출을 revision으로 파일에 남겨 런 종료 후에도 계획 변화 이력을 볼 수 있게 한다.
export function createPlanTool(runId: string): AgentTool {
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
      const steps = args?.steps ?? [];
      const list = steps.map((s, i) => `${i + 1}. ${s}`).join("\n");

      try {
        const filePath = planRecordPath(runId);
        const revisions: PlanRevision[] = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf-8")) : [];
        revisions.push({ at: new Date().toISOString(), steps });
        fs.writeFileSync(filePath, JSON.stringify(revisions, null, 2), "utf-8");
      } catch (err) {
        logError(`update_plan 기록 저장 실패 (runId=${runId})`, err);
      }

      return { content: `계획이 기록되었습니다:\n${list}` };
    }
  };
}

// 다음 청크를 이어 읽을 때 문맥이 끊기지 않도록 앞 청크와 겹치게 두는 기본 길이.
// 너무 크면 같은 내용을 반복해서 읽어 토큰을 낭비하므로 "최소한의" 겹침만 둔다.
const DEFAULT_CHUNK_OVERLAP = 200;

// hardEnd 근방(searchStart~hardEnd)에서 마지막 문단 경계("\n\n")를 찾는다.
// 문서 파싱 단계(fileParsing.ts)가 제목/문단/리스트/표 사이를 "\n\n"으로 구분해두므로,
// 이 경계에 맞춰 자르면 문장이나 표 행이 청크 중간에서 잘리는 일을 대부분 피할 수 있다.
function findParagraphBoundary(text: string, searchStart: number, hardEnd: number): number | undefined {
  const window = text.slice(searchStart, hardEnd);
  const lastBreak = window.lastIndexOf("\n\n");
  if (lastBreak === -1) return undefined;
  return searchStart + lastBreak + 2;
}

// 긴 텍스트를 offset부터 chunkSize만큼 잘라 사람이 읽기 좋은 형태로 감싸는 순수 함수.
// createReadTextChunkTool과 read_project_document_chunk(projectDocumentTools.ts) 둘 다
// 이 로직을 공유한다 — 하나는 고정 문자열을, 하나는 DB에서 조회한 문자열을 다룰 뿐
// 청크 계산 자체는 동일하다.
//
// 단순 글자 수 슬라이스 대신: (1) chunkSize 근처의 마지막 문단 경계에서 자르려 시도하고,
// (2) 그 경계가 청크를 절반 미만으로 줄일 만큼 너무 이르면 포기하고 하드컷하며,
// (3) 다음 offset은 이번 청크 끝에서 overlap만큼 앞으로 당겨 안내해 문맥 연속성을 준다.
export function readTextChunk(text: string, offset: number, chunkSize: number, overlap: number = DEFAULT_CHUNK_OVERLAP): string {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  const hardEnd = Math.min(safeOffset + chunkSize, text.length);

  let cutEnd = hardEnd;
  if (hardEnd < text.length) {
    const searchWindow = Math.min(Math.floor(chunkSize * 0.15), 1000);
    const boundary = findParagraphBoundary(text, Math.max(safeOffset, hardEnd - searchWindow), hardEnd);
    if (boundary !== undefined && boundary - safeOffset >= chunkSize * 0.5) {
      cutEnd = boundary;
    }
  }

  const slice = text.slice(safeOffset, cutEnd);
  const hasMore = cutEnd < text.length;
  const safeOverlap = Math.min(Math.max(overlap, 0), Math.floor(chunkSize / 2));
  const nextOffset = hasMore ? Math.max(safeOffset + 1, cutEnd - safeOverlap) : cutEnd;

  return `[${safeOffset}-${cutEnd} / 총 ${text.length}자]\n${slice}${
    hasMore
      ? `\n\n(계속 읽으려면 offset=${nextOffset}로 다시 호출 — 문맥 유지를 위해 앞 청크와 ${cutEnd - nextOffset}자 겹침)`
      : "\n\n(문서 끝)"
  }`;
}

// 긴 원문 텍스트를 청크 단위로 읽는 tool. 프롬프트에는 미리보기만 넣고,
// 모델이 필요하다고 판단할 때만 나머지를 조회하게 해서 매 호출 24k자를
// 무조건 밀어넣던 기존 방식보다 토큰을 아끼면서도 필요 시 전문을 다 볼 수 있게 한다.
export function createReadTextChunkTool(
  name: string,
  description: string,
  text: string,
  chunkSize = 8000,
  overlap: number = DEFAULT_CHUNK_OVERLAP
): AgentTool {
  return {
    name,
    description: `${description} 전체 길이는 ${text.length}자. offset(문자 인덱스, 기본 0)을 지정해 그 위치부터 최대 ${chunkSize}자를 읽는다. 문단 경계에 맞춰 잘리고, 이어 읽을 offset은 앞 청크와 약간 겹치게 안내된다.`,
    parameters: {
      type: "object",
      properties: { offset: { type: "number", description: "읽기 시작할 문자 인덱스 (기본 0)" } },
      required: []
    },
    execute(args: { offset?: number }) {
      return { content: readTextChunk(text, args?.offset ?? 0, chunkSize, overlap) };
    }
  };
}
