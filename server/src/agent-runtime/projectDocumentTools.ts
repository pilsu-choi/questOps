import { db } from "../db.js";
import { readTextChunk } from "./tools.js";
import type { AgentTool } from "./types.js";

// 처음 프롬프트에 넣어주지 않은, 같은 프로젝트의 다른 문서를 모델이 필요할 때 스스로
// 조회하게 한다. 경로가 아니라 project_id로 스코프한 DB 조회만 쓰므로 임의 경로
// 접근 위험이 구조적으로 없다.
export function createProjectDocumentTools(projectId: string): AgentTool[] {
  const listTool: AgentTool = {
    name: "list_project_documents",
    description: "같은 프로젝트에 업로드된 문서 목록을 본다 (id, 파일명, 분석 상태).",
    parameters: { type: "object", properties: {}, required: [] },
    execute() {
      const rows = db
        .prepare(`SELECT id, filename, status FROM documents WHERE project_id = ? ORDER BY uploaded_at DESC`)
        .all(projectId) as { id: string; filename: string; status: string }[];
      if (!rows.length) return { content: "이 프로젝트에 문서가 없다." };
      return { content: rows.map((r) => `${r.id}\t${r.filename}\t(${r.status})`).join("\n") };
    }
  };

  const readTool: AgentTool = {
    name: "read_project_document_chunk",
    description:
      "list_project_documents로 확인한 문서 id의 원문을 청크 단위로 읽는다. offset(기본 0)부터 최대 8000자, 문단 경계에 맞춰 자르고 이어 읽을 offset은 앞 청크와 약간 겹치게 안내된다.",
    parameters: {
      type: "object",
      properties: {
        documentId: { type: "string" },
        offset: { type: "number", description: "읽기 시작할 문자 인덱스 (기본 0)" }
      },
      required: ["documentId"]
    },
    execute(args: { documentId: string; offset?: number }) {
      const row = db
        .prepare(`SELECT extracted_text FROM documents WHERE id = ? AND project_id = ?`)
        .get(args.documentId, projectId) as { extracted_text: string | null } | undefined;
      if (!row) return { content: `문서 id "${args.documentId}"를 이 프로젝트에서 찾을 수 없다. list_project_documents로 먼저 id를 확인하라.` };
      return { content: readTextChunk(row.extracted_text ?? "", args.offset ?? 0, 8000) };
    }
  };

  return [listTool, readTool];
}
