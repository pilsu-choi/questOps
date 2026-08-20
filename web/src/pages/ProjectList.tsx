import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, FolderKanban, Loader2, ArrowUpRight, Settings } from "lucide-react";
import { api } from "../api/client";
import type { Project } from "../types";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Progress } from "../components/ui/Progress";
import { EmptyState } from "../components/ui/EmptyState";

function statusFor(p: Project): { label: string; tone: "accent" | "neutral" | "outline" } {
  if (p.progress.progressPct >= 100) return { label: "완료", tone: "neutral" };
  if (p.progress.progressPct === 0) return { label: "초기", tone: "outline" };
  return { label: "진행중", tone: "accent" };
}

export default function ProjectList() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.listProjects().then(setProjects);
  }, []);

  return (
    <div className="min-h-screen bg-[#F6F7FB]">
      <div className="max-w-6xl mx-auto px-8 py-10">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-navy-950 flex items-center justify-center">
              <FolderKanban size={15} className="text-accent-400" />
            </div>
            <span className="text-[14px] font-bold tracking-tight text-navy-900">QUEST OPS</span>
          </div>
          <Button variant="ghost" size="sm" icon={<Settings size={14} />} onClick={() => navigate("/settings")}>
            LLM 모델 설정
          </Button>
        </div>

        <div className="flex items-end justify-between mb-1">
          <h1 className="text-[26px] font-bold text-navy-900 tracking-tight">프로젝트</h1>
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => navigate("/projects/new")}>
            새 프로젝트
          </Button>
        </div>
        <p className="text-[14px] text-slate-500 mb-8">진행 중인 AI Agent 프로젝트를 선택하거나 새 프로젝트를 시작하세요.</p>

        {!projects && (
          <div className="flex justify-center py-24">
            <Loader2 className="animate-spin text-accent-500" size={22} />
          </div>
        )}

        {projects && projects.length === 0 && (
          <EmptyState
            icon={<FolderKanban size={32} />}
            title="아직 프로젝트가 없습니다"
            description="새 프로젝트를 생성하면 자료 수집부터 시작해 인터뷰, Demo, PPT까지 이어지는 Quest가 시작됩니다."
            action={
              <Button variant="primary" icon={<Plus size={16} />} onClick={() => navigate("/projects/new")}>
                새 프로젝트 생성
              </Button>
            }
          />
        )}

        {projects && projects.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {projects.map((p) => {
              const status = statusFor(p);
              return (
                <Card
                  key={p.id}
                  className="p-5 cursor-pointer hover:shadow-elevated hover:-translate-y-0.5 transition-all duration-150 group"
                  onClick={() => navigate(`/projects/${p.id}`)}
                >
                  <div className="flex items-start justify-between mb-2.5">
                    <span className="text-[11px] font-medium text-slate-400">
                      Level {Math.ceil((p.progress.steps.findIndex((s) => s.id === p.progress.currentStepId) + 1) / 2)} · {p.progress.progressPct}%
                    </span>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-[15px] font-semibold text-navy-900 leading-snug">{p.name}</h3>
                    <ArrowUpRight size={16} className="flex-none text-slate-300 group-hover:text-accent-500 transition-colors mt-0.5" />
                  </div>
                  <p className="text-[13px] text-slate-500 mt-1">
                    {p.client} · {p.org || "조직 미지정"}
                  </p>
                  <Progress value={p.progress.progressPct} className="my-3" />
                  <div className="flex items-center justify-between text-[12px] text-slate-400">
                    <span>현재 Quest: {p.progress.currentStepLabel}</span>
                    <span>{new Date(p.updatedAt).toLocaleDateString("ko-KR")}</span>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
