import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { AgentTool } from "./types.js";

const FILENAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

function scratchRoot(runId: string): string {
  return path.join(os.tmpdir(), "questops-agent-scratch", runId);
}

function assertSafeFilename(name: string): void {
  if (!FILENAME_PATTERN.test(name) || name === "." || name === "..") {
    throw new Error(`허용되지 않는 파일명: "${name}". 슬래시나 상위 경로 없이 단순 파일명만 사용하라.`);
  }
}

// 모델이 제출 전에 초안/메모를 쓰고 다시 읽으며 다듬을 수 있는 실행 전용 스크래치
// 공간. loop.ts의 truncateForHistory가 assistant 텍스트를 2000자로 자르는 것과 달리,
// 파일로 저장한 초안은 잘리지 않고 그대로 다시 읽을 수 있다.
export function createScratchWorkspaceTools(runId: string): AgentTool[] {
  const root = scratchRoot(runId);

  const writeTool: AgentTool = {
    name: "write_scratch_file",
    description: "작업 중인 초안이나 메모를 실행 전용 임시 파일에 저장한다. 이후 read_scratch_file로 다시 불러올 수 있다.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "파일명 (슬래시 없이 단순 이름, 예: draft.md)" },
        content: { type: "string" }
      },
      required: ["name", "content"]
    },
    execute(args: { name: string; content: string }) {
      assertSafeFilename(args.name);
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(path.join(root, args.name), args.content, "utf-8");
      return { content: `"${args.name}" 저장됨 (${args.content.length}자).` };
    }
  };

  const readTool: AgentTool = {
    name: "read_scratch_file",
    description: "이전에 write_scratch_file로 저장한 파일을 읽는다.",
    parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    execute(args: { name: string }) {
      assertSafeFilename(args.name);
      const p = path.join(root, args.name);
      if (!fs.existsSync(p)) return { content: `"${args.name}" 파일이 없다. write_scratch_file로 먼저 저장하라.` };
      return { content: fs.readFileSync(p, "utf-8") };
    }
  };

  const listTool: AgentTool = {
    name: "list_scratch_files",
    description: "지금까지 저장한 임시 파일 목록을 본다.",
    parameters: { type: "object", properties: {}, required: [] },
    execute() {
      if (!fs.existsSync(root)) return { content: "아직 저장된 파일이 없다." };
      const files = fs.readdirSync(root);
      return { content: files.length ? files.join("\n") : "아직 저장된 파일이 없다." };
    }
  };

  return [writeTool, readTool, listTool];
}

export function cleanupScratchWorkspace(runId: string): void {
  fs.rmSync(scratchRoot(runId), { recursive: true, force: true });
}
