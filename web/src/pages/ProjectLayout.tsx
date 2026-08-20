import { useCallback, useEffect, useState } from "react";
import { Outlet, useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { api } from "../api/client";
import type { Project } from "../types";
import { ProjectContext } from "../hooks/useProject";
import { QuestSidebar } from "../components/layout/QuestSidebar";

export default function ProjectLayout() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const p = await api.getProject(id);
      setProject(p);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center flex-col gap-3">
        <p className="text-slate-500 text-sm">{error}</p>
        <button className="text-accent-600 text-sm underline" onClick={() => navigate("/")}>
          프로젝트 목록으로
        </button>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="animate-spin text-accent-500" size={24} />
      </div>
    );
  }

  return (
    <ProjectContext.Provider value={{ project, refresh }}>
      <div className="flex h-screen overflow-hidden bg-[#F6F7FB]">
        <QuestSidebar project={project} />
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto px-8 py-8 pb-24">
            <Outlet />
          </div>
        </main>
      </div>
    </ProjectContext.Provider>
  );
}
