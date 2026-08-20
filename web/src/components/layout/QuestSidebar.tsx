import { NavLink, useNavigate } from "react-router-dom";
import { Check, Lock, FolderKanban, Upload, MessagesSquare, ClipboardList, LayoutPanelTop, Presentation, CheckSquare, FileText, ListTree, ChevronLeft, type LucideIcon } from "lucide-react";
import type { Project, QuestStepId } from "../../types";
import { cn } from "../../lib/cn";

const STEP_ICON: Record<QuestStepId, LucideIcon> = {
  docs: Upload,
  interview_questions: MessagesSquare,
  interview_answers: ClipboardList,
  demo: LayoutPanelTop,
  presentation: Presentation,
  requirements: CheckSquare,
  prd: FileText,
  wbs: ListTree
};

const STEP_PATH: Record<QuestStepId, string> = {
  docs: "docs",
  interview_questions: "interview",
  interview_answers: "interview/answers",
  demo: "demo",
  presentation: "presentation",
  requirements: "requirements",
  prd: "prd",
  wbs: "wbs"
};

export function QuestSidebar({ project }: { project: Project }) {
  const navigate = useNavigate();
  return (
    <aside className="w-64 flex-none h-screen bg-navy-950 text-white flex flex-col">
      <div className="px-5 pt-5 pb-4">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2 text-[13px] text-slate-400 hover:text-white transition-colors mb-4"
        >
          <ChevronLeft size={14} /> 프로젝트 목록
        </button>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-6 h-6 rounded-md bg-accent-500 flex items-center justify-center flex-none">
            <FolderKanban size={14} className="text-white" />
          </div>
          <span className="text-[13px] font-bold tracking-tight">QUEST OPS</span>
        </div>
        <div className="mt-3">
          <div className="text-[13px] font-semibold leading-snug line-clamp-2">{project.name}</div>
          <div className="text-[11px] text-slate-400 mt-1">{project.client} · {project.org || "—"}</div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full bg-accent-500 rounded-full transition-all duration-500" style={{ width: `${project.progress.progressPct}%` }} />
          </div>
          <span className="text-[11px] text-slate-400 flex-none">{project.progress.progressPct}%</span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 px-2 mb-2 mt-2">Quest Progress</div>
        <div className="flex flex-col gap-0.5">
          {project.progress.steps.map((step) => {
            const Icon = STEP_ICON[step.id];
            const disabled = false;
            return (
              <NavLink
                key={step.id}
                to={`/projects/${project.id}/${STEP_PATH[step.id]}`}
                className={({ isActive }) =>
                  cn(
                    "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors",
                    isActive ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
                    disabled && "opacity-40 pointer-events-none"
                  )
                }
              >
                <span
                  className={cn(
                    "flex-none w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold",
                    step.status === "done" && "bg-accent-500/20 text-accent-300",
                    step.status === "current" && "bg-accent-500 text-white",
                    step.status === "pending" && "bg-white/5 text-slate-500"
                  )}
                >
                  {step.status === "done" ? <Check size={12} /> : <Icon size={11} />}
                </span>
                <span className="flex-1 truncate">{step.label}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>

      <div className="px-3 py-3 border-t border-white/10">
        <NavLink
          to={`/projects/${project.id}`}
          end
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors",
              isActive ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
            )
          }
        >
          <LayoutPanelTop size={14} /> 대시보드
        </NavLink>
      </div>
    </aside>
  );
}
