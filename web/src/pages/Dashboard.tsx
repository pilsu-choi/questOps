import { useNavigate } from "react-router-dom";
import { Check, Circle, Lock, ArrowRight, FileStack, MessagesSquare, CheckSquare2, HelpCircle } from "lucide-react";
import { useProjectContext } from "../hooks/useProject";
import { Card, CardBody, Kicker } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { cn } from "../lib/cn";

const NEXT_ACTION: Record<string, { title: string; desc: string; cta: string; path: string }> = {
  docs: { title: "자료 수집 & 분석", desc: "프로젝트 관련 문서를 업로드하고 AI 분석을 완료하세요.", cta: "자료 업로드", path: "docs" },
  interview_questions: { title: "1차 인터뷰 질의서 생성", desc: "분석된 자료를 근거로 인터뷰 질문을 생성하세요.", cta: "질의서 생성", path: "interview" },
  interview_answers: { title: "인터뷰 결과 입력", desc: "현업 인터뷰 답변을 입력하고 암묵지를 추출하세요.", cta: "답변 입력", path: "interview/answers" },
  demo: { title: "Demo UI 생성", desc: "인터뷰 결과를 기반으로 AI Agent Demo를 생성하세요.", cta: "Demo 생성", path: "demo" },
  presentation: { title: "발표 PPT 생성", desc: "Demo와 인터뷰 결과를 담은 제안 PPT를 생성하세요.", cta: "PPT 생성", path: "presentation" },
  requirements: { title: "요구사항 확정", desc: "확정 사항을 정리하고 REQ 항목을 구조화하세요.", cta: "요구사항 보기", path: "requirements" },
  prd: { title: "PRD 작성", desc: "확정된 요구사항을 기반으로 PRD를 생성하세요.", cta: "PRD 보기", path: "prd" },
  wbs: { title: "WBS / TODO", desc: "요구사항을 Epic → Feature → Task로 분해하세요.", cta: "WBS 보기", path: "wbs" }
};

export default function Dashboard() {
  const { project } = useProjectContext();
  const navigate = useNavigate();
  const next = NEXT_ACTION[project.progress.currentStepId];
  const stats = project.progress.stats;

  return (
    <div>
      <h1 className="text-[26px] font-bold text-navy-900 tracking-tight mb-1">프로젝트 대시보드</h1>
      <p className="text-[14px] text-slate-500 mb-7">현재 프로젝트 상태와 다음 Quest를 한눈에 확인합니다.</p>

      <Card className="mb-7 p-6 bg-navy-950 border-none">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Badge tone="accent" className="bg-accent-500/20 text-accent-300">
                {project.progress.progressPct}% 진행
              </Badge>
              <span className="text-[11px] text-slate-400">현재 Quest</span>
            </div>
            <h2 className="text-[19px] font-semibold text-white mb-1.5">{next.title}</h2>
            <p className="text-[13px] text-slate-400 max-w-lg leading-relaxed">{next.desc}</p>
          </div>
          <Button variant="primary" size="lg" icon={<ArrowRight size={16} />} className="flex-none" onClick={() => navigate(next.path)}>
            {next.cta}
          </Button>
        </div>
      </Card>

      <div className="grid grid-cols-4 gap-3.5 mb-8">
        <StatCard icon={<FileStack size={15} />} label="분석 완료 문서" value={`${stats.analyzedCount}/${stats.documentCount}`} />
        <StatCard icon={<MessagesSquare size={15} />} label="인터뷰 질문" value={stats.questionCount} />
        <StatCard icon={<CheckSquare2 size={15} />} label="답변 완료" value={`${stats.answeredCount}/${stats.questionCount || 0}`} />
        <StatCard icon={<HelpCircle size={15} />} label="추출된 암묵지" value={stats.tacitKnowledgeCount} accent />
      </div>

      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-3">Quest Progress</div>
      <Card>
        <CardBody className="p-2">
          {project.progress.steps.map((step) => (
            <button
              key={step.id}
              onClick={() => navigate(NEXT_ACTION[step.id].path)}
              className="w-full flex items-center gap-3 px-3 py-3 border-b border-slate-100 last:border-none hover:bg-slate-50 rounded-lg transition-colors text-left"
            >
              <span
                className={cn(
                  "flex-none w-6 h-6 rounded-full flex items-center justify-center",
                  step.status === "done" && "bg-accent-100 text-accent-700",
                  step.status === "current" && "bg-accent-600 text-white",
                  step.status === "pending" && "bg-slate-100 text-slate-400"
                )}
              >
                {step.status === "done" ? <Check size={13} /> : step.status === "pending" ? <Lock size={11} /> : <Circle size={9} fill="currentColor" />}
              </span>
              <span className={cn("flex-1 text-[14px]", step.status === "pending" ? "text-slate-400" : "text-navy-900 font-medium")}>{step.label}</span>
              <Badge tone={step.status === "done" ? "neutral" : step.status === "current" ? "accent" : "outline"}>
                {step.status === "done" ? "완료" : step.status === "current" ? "진행중" : "대기"}
              </Badge>
            </button>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

function StatCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-1.5 text-slate-400 mb-2">
        {icon}
        <span className="text-[11px] font-medium">{label}</span>
      </div>
      <div className={cn("text-[24px] font-bold tracking-tight", accent ? "text-accent-600" : "text-navy-900")}>{value}</div>
    </Card>
  );
}
