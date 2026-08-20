import { useCallback, useEffect, useState } from "react";
import { Loader2, BookOpen, Sparkles, RotateCw, Download, Maximize2, Building2 } from "lucide-react";
import { api } from "../api/client";
import type { DomainKnowledgeState } from "../types";
import { useProjectContext } from "../hooks/useProject";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";
import { useToast } from "../components/ui/Toast";

export default function DomainKnowledge() {
  const { project, refresh } = useProjectContext();
  const toast = useToast();
  const [dk, setDk] = useState<DomainKnowledgeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [eligibility, setEligibility] = useState<{ eligible: boolean; reason: string } | null>(null);

  const load = useCallback(async () => {
    const [data, elig] = await Promise.all([api.getDomainKnowledge(project.id), api.domainKnowledgeEligibility(project.id)]);
    setDk(data);
    setEligibility(elig);
    setLoading(false);
  }, [project.id]);

  useEffect(() => {
    load();
  }, [load]);

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await api.generateDomainKnowledge(project.id);
      setDk(res);
      refresh();
      toast.push("success", "도메인 지식이 생성되었습니다.");
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

  if (!dk || dk.status !== "ready" || !dk.content) {
    return (
      <div>
        <h1 className="text-[26px] font-bold text-navy-900 tracking-tight mb-1">도메인 지식 생성</h1>
        <p className="text-[14px] text-slate-500 mb-7">자료 분석 결과를 근거로 대상 기업의 사업, 추진 부서, 사업 도메인에 대한 컨설팅용 도메인 지식을 정리합니다.</p>
        <EmptyState
          icon={<BookOpen size={28} />}
          title={dk?.status === "generating" ? "도메인 지식을 생성하는 중입니다..." : "아직 생성된 도메인 지식이 없습니다"}
          description={
            eligibility && !eligibility.eligible
              ? eligibility.reason
              : "자료 수집 & 분석 화면에서 문서를 업로드하고 분석을 완료하면 도메인 지식을 생성할 수 있습니다."
          }
          action={
            <Button variant="primary" icon={<Sparkles size={16} />} loading={generating} disabled={!eligibility?.eligible} onClick={generate}>
              도메인 지식 생성
            </Button>
          }
        />
      </div>
    );
  }

  const { content } = dk;

  return (
    <div>
      <div className="flex items-end justify-between mb-1 flex-wrap gap-3">
        <h1 className="text-[26px] font-bold text-navy-900 tracking-tight">도메인 지식</h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" icon={<RotateCw size={14} />} loading={generating} onClick={generate}>
            재생성
          </Button>
          <a href={api.domainKnowledgeDownloadUrl(dk.id)} target="_blank" rel="noreferrer">
            <Button variant="primary" size="sm" icon={<Download size={14} />}>
              HTML 다운로드
            </Button>
          </a>
        </div>
      </div>
      <p className="text-[14px] text-slate-500 mb-7 max-w-2xl">
        분석된 문서를 근거로 정리된 컨설팅용 도메인 지식입니다. 확정 사항뿐 아니라 인터뷰로 검증이 필요한 항목도 함께 표시됩니다.
      </p>

      <Card className="mb-7 p-5">
        <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1 flex items-center gap-1.5">
              <Building2 size={12} /> 사업 개요
            </div>
            <h2 className="text-[15px] font-bold text-navy-900 mb-1">{project.name}</h2>
          </div>
          {content.openQuestions.length > 0 && <Badge tone="warning">추가 확인 필요 {content.openQuestions.length}건</Badge>}
        </div>
        <p className="text-[13.5px] text-navy-700 leading-relaxed">{content.companyOverview}</p>
      </Card>

      <div className="flex items-center justify-between mb-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">도메인 지식 대시보드 미리보기</div>
        <a
          href={api.domainKnowledgeHtmlUrl(dk.id)}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-[12px] text-accent-600 hover:text-accent-700 font-medium"
        >
          <Maximize2 size={12} /> 새 탭에서 열기
        </a>
      </div>
      <Card className="overflow-hidden p-0">
        <iframe
          key={dk.id}
          src={api.domainKnowledgeHtmlUrl(dk.id)}
          title="도메인 지식 대시보드 미리보기"
          className="w-full border-0"
          style={{ height: "900px" }}
        />
      </Card>
      <p className="text-[12px] text-slate-400 mt-2">위 대시보드는 실제로 다운로드되는 HTML과 동일합니다.</p>
    </div>
  );
}
