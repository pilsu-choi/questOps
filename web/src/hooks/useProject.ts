import { createContext, useContext } from "react";
import type { Project } from "../types";

export interface ProjectContextValue {
  project: Project;
  refresh: () => Promise<void>;
}

export const ProjectContext = createContext<ProjectContextValue | null>(null);

export function useProjectContext() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProjectContext must be used within a project route");
  return ctx;
}
