import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle2,
  XCircle,
  RotateCw,
  Trash2,
  ChevronDown,
  ChevronUp,
  Sparkles,
  BookOpen,
  AlertTriangle,
  CircleDashed
} from "lucide-react";
import { api } from "../api/client";
import type { ProjectDocument, DocumentStatus } from "../types";
import { useProjectContext } from "../hooks/useProject";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";
import { useToast } from "../components/ui/Toast";
import { cn } from "../lib/cn";

const STATUS_META: Record<DocumentStatus, { label: string; tone: "neutral" | "accent" | "outline" | "danger"; icon: React.ComponentType<any> }> = {
  uploaded: { label: "대기", tone: "outline", icon: FileText },
  analyzing: { label: "분석중", tone: "accent", icon: Loader2 },
  analyzed: { label: "분석완료", tone: "neutral", icon: CheckCircle2 },
  failed: { label: "실패", tone: "danger", icon: XCircle }
};

const ANALYSIS_SECTIONS: { key: keyof NonNullable<ProjectDocument["analysisResult"]>; label: string }[] = [
  { key: "businessContext", label: "Business Context" },
  { key: "keyUsers", label: "Key Users" },
  { key: "process", label: "Process" },
  { key: "systems", label: "Systems" },
  { key: "businessRules", label: "Business Rules" },
  { key: "decisionPoints", label: "Decision Points" },
  { key: "exceptions", label: "Exceptions" },
  { key: "painPoints", label: "Pain Points" },
  { key: "aiOpportunities", label: "Potential AI Agent Opportunities" },
  { key: "unknowns", label: "Unknown / Missing Knowledge" }
];

export default function DocumentsAnalysis() {
  const { project, refresh } = useProjectContext();
  const navigate = useNavigate();
  const toast = useToast();
  const [docs, setDocs] = useState<ProjectDocument[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatingDomainKnowledge, setGeneratingDomainKnowledge] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await api.listDocuments(project.id);
      setDocs(rows);
      setLoadError(null);
      return rows;
    } catch (err) {
      setLoadError((err as Error).message || "문서 목록을 불러오지 못했습니다.");
      return null;
    }
  }, [project.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const hasPending = docs?.some((d) => d.status === "analyzing" || d.status === "uploaded");
    if (hasPending) {
      pollRef.current = window.setTimeout(async () => {
        await load();
        refresh();
      }, 1800);
    }
    return () => {
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
  }, [docs, load, refresh]);

  const handleFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setUploading(true);
    try {
      await api.uploadDocuments(project.id, arr);
      await load();
      refresh();
      toast.push("success", `${arr.length}개 파일을 업로드했습니다. 분석을 시작합니다.`);
    } catch (err) {
      toast.push("error", (err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  const reanalyze = async (id: string) => {
    await api.reanalyzeDocument(id);
    await load();
    toast.push("info", "재분석을 시작했습니다.");
  };

  const remove = async (id: string) => {
    await api.deleteDocument(id);
    await load();
    refresh();
  };

  const analyzedCount = docs?.filter((d) => d.status === "analyzed").length ?? 0;
  const analyzingCount = docs?.filter((d) => d.status === "analyzing" || d.status === "uploaded").length ?? 0;
  const failedCount = docs?.filter((d) => d.status === "failed").length ?? 0;
  const totalCount = docs?.length ?? 0;
  const canGenerate = analyzedCount > 0 && analyzingCount === 0;

  const generateInterview = async () => {
    setGenerating(true);
    try {
      await api.generateInterview(project.id);
      refresh();
      toast.push("success", "1차 인터뷰 질의서가 생성되었습니다.");
      navigate(`/projects/${project.id}/interview`);
    } catch (err) {
      toast.push("error", (err as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const generateDomainKnowledge = async () => {
    setGeneratingDomainKnowledge(true);
    try {
      await api.generateDomainKnowledge(project.id);
      refresh();
      toast.push("success", "도메인 지식이 생성되었습니다.");
      navigate(`/projects/${project.id}/domain-knowledge`);
    } catch (err) {
      toast.push("error", (err as Error).message);
    } finally {
      setGeneratingDomainKnowledge(false);
    }
  };

  const analysisPct = totalCount === 0 ? 0 : Math.round((analyzedCount / totalCount) * 100);

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-1 flex-wrap">
        <h1 className="text-[26px] font-bold text-navy-900 tracking-tight">자료 수집 &amp; 분석</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            icon={<BookOpen size={16} />}
            loading={generatingDomainKnowledge}
            disabled={!canGenerate}
            onClick={generateDomainKnowledge}
            title={!canGenerate ? (analyzingCount > 0 ? "분석이 진행 중인 문서가 있습니다." : "분석 완료된 문서가 없습니다.") : undefined}
          >
            도메인 지식 생성
          </Button>
          <Button
            variant="primary"
            icon={<Sparkles size={16} />}
            loading={generating}
            disabled={!canGenerate}
            onClick={generateInterview}
            title={!canGenerate ? (analyzingCount > 0 ? "분석이 진행 중인 문서가 있습니다." : "분석 완료된 문서가 없습니다.") : undefined}
          >
            1차 인터뷰 질의서 생성
          </Button>
        </div>
      </div>
      <p className="text-[14px] text-slate-500 mb-7 max-w-2xl">프로젝트와 관련된 문서를 모두 제공해주세요. 제안서, RFP, 업무지침, 기존 시스템 문서 등.</p>

      <Card
        className={cn(
          "mb-7 border-2 border-dashed p-9 text-center transition-colors cursor-pointer",
          dragOver ? "border-accent-400 bg-accent-50/50" : "border-slate-200 hover:border-slate-300"
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          accept=".pdf,.docx,.doc,.pptx,.xlsx,.xls,.txt,.md,.csv"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
        <Upload className="mx-auto mb-3 text-slate-300" size={28} />
        <div className="text-[15px] font-medium text-navy-900 mb-1">파일을 드래그하거나 클릭해서 업로드</div>
        <p className="text-[13px] text-slate-500 mb-3">PDF · DOCX · PPTX · XLSX · TXT</p>
        <Button variant="secondary" loading={uploading} onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
          파일 선택
        </Button>
      </Card>

      {loadError && (
        <div className="mb-7 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-600">
          <div className="flex items-center gap-1.5">
            <AlertTriangle size={14} /> 문서 목록을 불러오지 못했습니다: {loadError}
          </div>
          <Button variant="secondary" onClick={() => load()}>
            다시 시도
          </Button>
        </div>
      )}

      {docs === null && !loadError && (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-accent-500" size={20} />
        </div>
      )}

      {docs?.length === 0 && (
        <EmptyState
          icon={<FileText size={28} />}
          title="아직 업로드된 자료가 없습니다"
          description="자료를 업로드하고 분석을 완료하면 1차 인터뷰 질의서를 생성할 수 있습니다."
        />
      )}

      {docs && docs.length > 0 && (
        <>
          <Card className="mb-7 overflow-hidden">
            <table className="w-full text-[13px]">
              <thead className="bg-slate-50 text-slate-500 text-left">
                <tr>
                  <th className="font-medium px-4 py-2.5">파일명</th>
                  <th className="font-medium px-4 py-2.5 w-24">유형</th>
                  <th className="font-medium px-4 py-2.5 w-32">등록일</th>
                  <th className="font-medium px-4 py-2.5 w-24">분석 상태</th>
                  <th className="font-medium px-4 py-2.5 w-24 text-right">작업</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => {
                  const meta = STATUS_META[d.status];
                  const isOpen = expanded === d.id;
                  return (
                    <Fragment key={d.id}>
                      <tr
                        className="border-t border-slate-100 hover:bg-slate-50/60 cursor-pointer"
                        onClick={() => d.status === "analyzed" && setExpanded(isOpen ? null : d.id)}
                      >
                        <td className="px-4 py-3 font-medium text-navy-900 flex items-center gap-2">
                          {d.status === "analyzed" && (isOpen ? <ChevronUp size={13} className="text-slate-400" /> : <ChevronDown size={13} className="text-slate-400" />)}
                          {d.filename}
                        </td>
                        <td className="px-4 py-3 text-slate-500">{d.fileType}</td>
                        <td className="px-4 py-3 text-slate-500">{new Date(d.uploadedAt).toLocaleDateString("ko-KR")}</td>
                        <td className="px-4 py-3">
                          <Badge tone={meta.tone}>
                            <meta.icon size={11} className={d.status === "analyzing" ? "animate-spin" : ""} />
                            {meta.label}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            {(d.status === "failed" || d.status === "analyzed") && (
                              <button onClick={() => reanalyze(d.id)} className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100 hover:text-accent-600" title="재분석">
                                <RotateCw size={13} />
                              </button>
                            )}
                            <button onClick={() => remove(d.id)} className="p-1.5 rounded-md text-slate-400 hover:bg-red-50 hover:text-red-500" title="삭제">
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isOpen && d.analysisResult && (
                        <tr>
                          <td colSpan={5} className="bg-slate-50/60 border-t border-slate-100 px-4 py-5">
                            <AnalysisDetail result={d.analysisResult} />
                          </td>
                        </tr>
                      )}
                      {d.status === "failed" && (
                        <tr>
                          <td colSpan={5} className="px-4 pb-3 -mt-1">
                            <div className="flex items-center gap-1.5 text-[12px] text-red-500">
                              <AlertTriangle size={12} /> {d.errorMessage || "분석 중 오류가 발생했습니다."}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </Card>

          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2.5">문서 분석 진행률 · {analysisPct}%</div>
          <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden mb-4">
            <div className="h-full bg-accent-500 rounded-full transition-all duration-500" style={{ width: `${analysisPct}%` }} />
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
            <StatusPill icon={<CheckCircle2 size={13} />} color="text-accent-700" label={`분석완료 ${analyzedCount}`} />
            <StatusPill
              icon={analyzingCount > 0 ? <Loader2 size={13} className="animate-spin" /> : <CircleDashed size={13} />}
              color="text-slate-500"
              label={`진행중 ${analyzingCount}`}
            />
            <StatusPill icon={<XCircle size={13} />} color="text-red-500" label={`실패 ${failedCount}`} />
          </div>
        </>
      )}
    </div>
  );
}

function StatusPill({ icon, color, label }: { icon: React.ReactNode; color: string; label: string }) {
  return (
    <span className={cn("flex items-center gap-1.5", color)}>
      {icon}
      {label}
    </span>
  );
}

function AnalysisDetail({ result }: { result: NonNullable<ProjectDocument["analysisResult"]> }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {ANALYSIS_SECTIONS.map(({ key, label }) => {
        const value = result[key];
        const isEmpty = Array.isArray(value) ? value.length === 0 : !value;
        return (
          <div key={key} className={cn("rounded-lg bg-white border border-slate-200 p-3.5", key === "unknowns" && "ring-1 ring-amber-200 bg-amber-50/40")}>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5 flex items-center gap-1.5">
              {label}
              {key === "unknowns" && !isEmpty && <Badge tone="warning">인터뷰 필요</Badge>}
            </div>
            {isEmpty && <div className="text-[12px] text-slate-300">—</div>}
            {!isEmpty && typeof value === "string" && <p className="text-[13px] text-navy-700 leading-relaxed">{value}</p>}
            {!isEmpty && Array.isArray(value) && (
              <ul className="space-y-1">
                {value.map((v, i) => (
                  <li key={i} className="text-[13px] text-navy-700 leading-relaxed flex gap-1.5">
                    <span className="text-slate-300 flex-none">·</span>
                    {v}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
