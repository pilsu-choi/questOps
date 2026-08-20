import { useCallback, useEffect, useState } from "react";
import { Loader2, Presentation as PresentationIcon, Sparkles, RotateCw, Download, LayoutList, Maximize2 } from "lucide-react";
import { api } from "../api/client";
import type { PresentationState } from "../types";
import { useProjectContext } from "../hooks/useProject";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";
import { useToast } from "../components/ui/Toast";

const LAYOUT_LABEL: Record<string, string> = {
  title: "Title",
  bullets: "Bullets",
  process: "Process",
  table: "Table",
  "two-column": "Two Column",
  quote: "Quote",
  closing: "Closing"
};

export default function PresentationBuilder() {
  const { project, refresh } = useProjectContext();
  const toast = useToast();
  const [presentation, setPresentation] = useState<PresentationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    const data = await api.getPresentation(project.id);
    setPresentation(data);
    setLoading(false);
  }, [project.id]);

  useEffect(() => {
    load();
  }, [load]);

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await api.generatePresentation(project.id);
      setPresentation(res);
      refresh();
      toast.push("success", `${res.slides.length}장의 슬라이드로 PPT가 생성되었습니다.`);
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

  if (!presentation || presentation.status !== "ready") {
    return (
      <div>
        <h1 className="text-[26px] font-bold text-navy-900 tracking-tight mb-1">발표 자료 생성</h1>
        <p className="text-[14px] text-slate-500 mb-7">프로젝트 배경, 인터뷰 인사이트, Demo UI를 담은 슬라이드 형태의 HTML 발표자료를 생성합니다.</p>
        <EmptyState
          icon={<PresentationIcon size={28} />}
          title="아직 생성된 발표자료가 없습니다"
          description="문서 분석, 인터뷰 결과, Demo가 준비되어 있을수록 더 풍부한 발표자료가 생성됩니다. 지금 바로 생성해볼 수도 있습니다."
          action={
            <Button variant="primary" icon={<Sparkles size={16} />} loading={generating} onClick={generate}>
              발표자료 생성
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-end justify-between mb-1 flex-wrap gap-3">
        <h1 className="text-[26px] font-bold text-navy-900 tracking-tight">발표 자료</h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" icon={<RotateCw size={14} />} loading={generating} onClick={generate}>
            재생성
          </Button>
          <a href={api.presentationDownloadUrl(presentation.id)} target="_blank" rel="noreferrer">
            <Button variant="primary" size="sm" icon={<Download size={14} />}>
              HTML 다운로드
            </Button>
          </a>
        </div>
      </div>
      <p className="text-[14px] text-slate-500 mb-5 flex items-center gap-1.5">
        <LayoutList size={14} className="text-slate-400" /> 총 {presentation.slides.length}장의 슬라이드로 구성된 HTML 발표자료입니다. ←/→ 방향키로 넘길 수 있습니다.
      </p>

      <div className="flex items-center justify-between mb-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">미리보기</div>
        <a
          href={api.presentationHtmlUrl(presentation.id)}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-[12px] text-accent-600 hover:text-accent-700 font-medium"
        >
          <Maximize2 size={12} /> 새 탭에서 전체화면으로 열기
        </a>
      </div>
      <Card className="overflow-hidden p-0 mb-8">
        <iframe
          key={presentation.id}
          src={api.presentationHtmlUrl(presentation.id)}
          title="발표자료 미리보기"
          className="w-full border-0"
          style={{ height: "520px" }}
        />
      </Card>

      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2.5">슬라이드 목차</div>
      <div className="grid grid-cols-1 gap-3">
        {presentation.slides.map((slide) => (
          <Card key={slide.order} className="p-4">
            <div className="flex items-start gap-3">
              <span className="flex-none w-7 h-7 rounded-lg bg-navy-950 text-white text-[12px] font-bold flex items-center justify-center">{slide.order}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[14px] font-semibold text-navy-900">{slide.title}</span>
                  <Badge tone="outline">{LAYOUT_LABEL[slide.layout] || slide.layout}</Badge>
                </div>
                {slide.subtitle && <p className="text-[12.5px] text-slate-500 mb-1.5">{slide.subtitle}</p>}
                {slide.bullets && slide.bullets.length > 0 && (
                  <ul className="text-[12.5px] text-slate-600 space-y-0.5">
                    {slide.bullets.slice(0, 5).map((b, i) => (
                      <li key={i} className="flex gap-1.5">
                        <span className="text-slate-300 flex-none">·</span>
                        {b}
                      </li>
                    ))}
                  </ul>
                )}
                {slide.table && (
                  <div className="text-[12px] text-slate-500 mt-1">
                    {slide.table.rows.length}행 테이블 — {slide.table.headers.join(" / ")}
                  </div>
                )}
                {slide.columns && (
                  <div className="grid grid-cols-2 gap-3 mt-1.5">
                    {slide.columns.map((c, i) => (
                      <div key={i}>
                        <div className="text-[12px] font-semibold text-slate-600 mb-0.5">{c.title}</div>
                        <ul className="text-[12px] text-slate-500 space-y-0.5">
                          {c.bullets.slice(0, 3).map((b, j) => (
                            <li key={j}>· {b}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
