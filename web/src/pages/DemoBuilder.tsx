import { useCallback, useEffect, useState } from "react";
import { Loader2, LayoutPanelTop, Sparkles, RotateCw, ShieldCheck, User, Bot, Server, ArrowRight, Download, Maximize2 } from "lucide-react";
import { api } from "../api/client";
import type { AgentConcept, DemoState } from "../types";
import { useProjectContext } from "../hooks/useProject";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";
import { useToast } from "../components/ui/Toast";
import { cn } from "../lib/cn";

const ACTOR_ICON = { agent: Bot, human: User, system: Server };

export default function DemoBuilder() {
  const { project, refresh } = useProjectContext();
  const toast = useToast();
  const [demo, setDemo] = useState<DemoState | null>(null);
  const [agent, setAgent] = useState<AgentConcept | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [eligibility, setEligibility] = useState<{ eligible: boolean; reason: string } | null>(null);

  const load = useCallback(async () => {
    const [data, elig] = await Promise.all([api.getDemo(project.id), api.demoEligibility(project.id)]);
    setDemo(data.demo);
    setAgent(data.agent);
    setEligibility(elig);
    setLoading(false);
  }, [project.id]);

  useEffect(() => {
    load();
  }, [load]);

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await api.generateDemo(project.id);
      setDemo(res.demo);
      setAgent(res.agent);
      refresh();
      toast.push("success", "Demo UI가 생성되었습니다.");
    } catch (err) {
      toast.push("error", (err as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="animate-spin text-accent-500" size={22} />
      </div>
    );
  }

  if (!demo || demo.status !== "ready" || !agent) {
    return (
      <div>
        <h1 className="text-[26px] font-bold text-navy-900 tracking-tight mb-1">Demo UI 생성</h1>
        <p className="text-[14px] text-slate-500 mb-7">인터뷰 결과와 암묵지를 기반으로 실제 AI Agent Demo를 생성합니다.</p>
        <EmptyState
          icon={<LayoutPanelTop size={28} />}
          title="아직 생성된 Demo가 없습니다"
          description={eligibility && !eligibility.eligible ? eligibility.reason : "문서 분석 또는 인터뷰 답변을 기반으로 Demo UI를 생성할 수 있습니다."}
          action={
            <Button variant="primary" icon={<Sparkles size={16} />} loading={generating} disabled={!eligibility?.eligible} onClick={generate}>
              Demo UI 생성
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-end justify-between mb-1 flex-wrap gap-3">
        <h1 className="text-[26px] font-bold text-navy-900 tracking-tight">Demo UI</h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" icon={<RotateCw size={14} />} loading={generating} onClick={generate}>
            재생성
          </Button>
          <a href={api.demoDownloadUrl(demo.id)} target="_blank" rel="noreferrer">
            <Button variant="primary" size="sm" icon={<Download size={14} />}>
              HTML 다운로드
            </Button>
          </a>
        </div>
      </div>
      <p className="text-[14px] text-slate-500 mb-7 max-w-2xl">인터뷰에서 확인된 내용을 기반으로 생성되었습니다. 확정 사항뿐 아니라 검증이 필요한 가설도 함께 표시됩니다.</p>

      <Card className="mb-7 p-5">
        <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">AI Agent</div>
            <h2 className="text-[18px] font-bold text-navy-900">{agent.name}</h2>
          </div>
          <Badge tone={agent.humanApproval?.required ? "accent" : "outline"}>
            <ShieldCheck size={11} /> Human-in-the-loop {agent.humanApproval?.required ? "필수" : "선택"}
          </Badge>
        </div>
        <p className="text-[13.5px] text-navy-700 leading-relaxed mb-4">{agent.purpose}</p>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <div className="min-w-[180px]">
            <div className="text-[11px] font-semibold text-slate-400 mb-1">사용자</div>
            <div className="flex flex-wrap gap-1">
              {agent.users.map((u, i) => (
                <Badge key={i} tone="neutral">
                  {u}
                </Badge>
              ))}
            </div>
          </div>
          <div className="min-w-[220px] flex-1">
            <div className="text-[11px] font-semibold text-slate-400 mb-1">Human Approval Point</div>
            <ul className="text-[12.5px] text-navy-600 space-y-0.5">
              {agent.humanApproval?.points?.map((p, i) => (
                <li key={i}>· {p}</li>
              ))}
            </ul>
          </div>
        </div>
      </Card>

      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2.5">Agent Workflow</div>
      <div className="flex items-stretch gap-2 mb-8 overflow-x-auto pb-2">
        {agent.workflow.map((w, i) => {
          const Icon = ACTOR_ICON[w.actor];
          return (
            <div key={i} className="flex items-center gap-2 flex-none">
              <Card className="w-44 p-3 flex-none">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span
                    className={cn(
                      "w-5 h-5 rounded-full flex items-center justify-center",
                      w.actor === "agent" && "bg-accent-100 text-accent-700",
                      w.actor === "human" && "bg-amber-100 text-amber-700",
                      w.actor === "system" && "bg-slate-100 text-slate-600"
                    )}
                  >
                    <Icon size={11} />
                  </span>
                  <span className="text-[11px] font-semibold text-slate-400 uppercase">{w.actor}</span>
                </div>
                <div className="text-[13px] font-medium text-navy-900 mb-1">{w.name}</div>
                <p className="text-[11.5px] text-slate-500 leading-snug line-clamp-3">{w.description}</p>
              </Card>
              {i < agent.workflow.length - 1 && <ArrowRight size={14} className="text-slate-300 flex-none" />}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between mb-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Demo UI 미리보기</div>
        <a href={api.demoHtmlUrl(demo.id)} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[12px] text-accent-600 hover:text-accent-700 font-medium">
          <Maximize2 size={12} /> 새 탭에서 열기
        </a>
      </div>
      <Card className="overflow-hidden p-0">
        <iframe
          key={demo.id}
          src={api.demoHtmlUrl(demo.id)}
          title="Demo UI 미리보기"
          className="w-full border-0"
          style={{ height: "720px" }}
        />
      </Card>
      <p className="text-[12px] text-slate-400 mt-2">
        위 Demo UI는 실제로 다운로드되는 HTML과 동일합니다. 화면 내 승인/반려 버튼도 그대로 동작합니다.
      </p>
    </div>
  );
}
