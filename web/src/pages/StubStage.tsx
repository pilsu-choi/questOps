import { CheckSquare, FileText, ListTree, Construction } from "lucide-react";
import { useProjectContext } from "../hooks/useProject";
import { EmptyState } from "../components/ui/EmptyState";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";

const CONFIG = {
  requirements: {
    title: "요구사항 확정",
    desc: "모든 산출물(문서 분석, 인터뷰 답변, Tacit Knowledge, Demo 피드백)을 근거로 최종 요구사항을 구조화하는 단계입니다.",
    icon: CheckSquare,
    inputs: ["Tacit Knowledge", "Demo 피드백", "인터뷰 답변"]
  },
  prd: {
    title: "PRD",
    desc: "확정된 요구사항을 기반으로 Product Requirements Document 초안을 생성하는 단계입니다.",
    icon: FileText,
    inputs: ["확정 요구사항", "Agent Concept", "Demo Scenario"]
  },
  wbs: {
    title: "WBS / TODO",
    desc: "확정된 요구사항을 Epic → Feature → Task로 분해하여 개발 착수 계획을 수립하는 단계입니다.",
    icon: ListTree,
    inputs: ["PRD", "Agent Workflow"]
  }
} as const;

export default function StubStage({ stage }: { stage: keyof typeof CONFIG }) {
  const { project } = useProjectContext();
  const cfg = CONFIG[stage];
  const Icon = cfg.icon;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-[26px] font-bold text-navy-900 tracking-tight">{cfg.title}</h1>
        <Badge tone="outline">준비 중</Badge>
      </div>
      <p className="text-[14px] text-slate-500 mb-7 max-w-2xl">{cfg.desc}</p>

      <EmptyState
        icon={<Construction size={28} />}
        title="이 단계는 다음 릴리스에서 제공됩니다"
        description="데이터 모델과 Quest 흐름은 이미 연결되어 있어, 이전 단계 산출물을 그대로 이어받아 자동 생성할 수 있도록 설계되어 있습니다."
      />

      <div className="mt-6">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2.5">이 단계가 이어받을 입력</div>
        <div className="flex flex-wrap gap-2">
          {cfg.inputs.map((i) => (
            <Card key={i} className="px-3.5 py-2.5 flex items-center gap-2">
              <Icon size={13} className="text-accent-500" />
              <span className="text-[13px] text-navy-700">{i}</span>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
