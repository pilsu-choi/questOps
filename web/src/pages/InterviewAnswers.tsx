import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, MessageSquareText, Check, Sparkles, ArrowRight, Upload, FileUp, Lightbulb, ChevronDown, ChevronUp } from "lucide-react";
import { api } from "../api/client";
import type { InterviewAnswer, InterviewQuestion, TacitKnowledgeItem } from "../types";
import { useProjectContext } from "../hooks/useProject";
import { Button } from "../components/ui/Button";
import { Card, CardBody, Kicker } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Textarea } from "../components/ui/Field";
import { EmptyState } from "../components/ui/EmptyState";
import { useToast } from "../components/ui/Toast";
import { cn } from "../lib/cn";

const TK_LABEL: Record<string, { label: string; tone: "accent" | "warning" | "danger" | "neutral" }> = {
  explicitRule: { label: "Explicit Rule", tone: "neutral" },
  explicitRules: { label: "Explicit Rule", tone: "neutral" },
  tacitRule: { label: "Tacit Rule", tone: "accent" },
  tacitRules: { label: "Tacit Rule", tone: "accent" },
  exception: { label: "Exception", tone: "warning" },
  exceptions: { label: "Exception", tone: "warning" },
  decisionCriteria: { label: "Decision Criteria", tone: "accent" },
  riskSignal: { label: "Risk Signal", tone: "danger" },
  riskSignals: { label: "Risk Signal", tone: "danger" },
  workaround: { label: "Workaround", tone: "warning" },
  workarounds: { label: "Workaround", tone: "warning" },
  constraint: { label: "Constraint", tone: "neutral" },
  constraints: { label: "Constraint", tone: "neutral" }
};

export default function InterviewAnswers() {
  const { project, refresh } = useProjectContext();
  const navigate = useNavigate();
  const toast = useToast();
  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, InterviewAnswer>>({});
  const [tacit, setTacit] = useState<TacitKnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [expandedSample, setExpandedSample] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [interview, ans, tk] = await Promise.all([
      api.getInterview(project.id),
      api.listAnswers(project.id),
      api.listTacitKnowledge(project.id)
    ]);
    setQuestions(interview.questions);
    const map: Record<string, InterviewAnswer> = {};
    for (const a of ans) map[a.questionId] = a;
    setAnswers(map);
    setTacit(tk);
    setLoading(false);
  }, [project.id]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (questionId: string) => {
    const text = drafts[questionId] ?? answers[questionId]?.answerText ?? "";
    if (!text.trim()) return;
    setSavingId(questionId);
    try {
      const saved = await api.submitAnswer(questionId, text);
      setAnswers((prev) => ({ ...prev, [questionId]: saved }));
      const tk = await api.listTacitKnowledge(project.id);
      setTacit(tk);
      refresh();
      toast.push("success", "답변이 저장되고 암묵지가 추출되었습니다.");
    } catch (err) {
      toast.push("error", (err as Error).message);
    } finally {
      setSavingId(null);
    }
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const res = await api.uploadAnswersFile(project.id, file);
      await load();
      refresh();
      if (res.matchedCount > 0) {
        toast.push("success", `"${res.filename}"에서 ${res.matchedCount}개 질문에 대한 답변을 찾아 자동으로 채웠습니다.`);
      } else {
        toast.push("info", `"${res.filename}"에서 질문과 매칭되는 답변을 찾지 못했습니다. 직접 입력해주세요.`);
      }
    } catch (err) {
      toast.push("error", (err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const answeredCount = Object.keys(answers).length;
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of tacit) counts[t.type] = (counts[t.type] || 0) + 1;
    return counts;
  }, [tacit]);

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="animate-spin text-accent-500" size={22} />
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div>
        <h1 className="text-[26px] font-bold text-navy-900 tracking-tight mb-1">인터뷰 결과 입력</h1>
        <p className="text-[14px] text-slate-500 mb-7">인터뷰에서 받은 답변을 입력해주세요.</p>
        <EmptyState
          icon={<MessageSquareText size={28} />}
          title="아직 생성된 인터뷰 질문이 없습니다"
          description="1차 인터뷰 질의서를 먼저 생성해주세요."
          action={
            <Button variant="primary" onClick={() => navigate(`/projects/${project.id}/interview`)}>
              질의서 생성하러 가기
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-end justify-between mb-1 flex-wrap gap-3">
        <h1 className="text-[26px] font-bold text-navy-900 tracking-tight">인터뷰 결과 입력</h1>
        <Badge tone="accent">
          {answeredCount} / {questions.length} 답변 완료
        </Badge>
      </div>
      <p className="text-[14px] text-slate-500 mb-5 max-w-2xl">
        질문별로 현업 답변을 직접 입력하거나, 회의록·녹취 정리본 파일을 업로드하면 AI가 질문과 자동으로 매칭해 답변을 채웁니다.
        저장된 답변에서는 Explicit Rule / Tacit Rule / Exception / Decision Criteria / Risk Signal / Workaround / Constraint를 자동으로 추출합니다.
      </p>

      <Card
        className="mb-7 border-2 border-dashed border-slate-200 hover:border-slate-300 p-6 text-center cursor-pointer transition-colors"
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".pdf,.docx,.doc,.txt,.md"
          onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])}
        />
        <FileUp className="mx-auto mb-2 text-slate-300" size={24} />
        <div className="text-[13.5px] font-medium text-navy-900 mb-1">회의록 / 답변 파일 업로드</div>
        <p className="text-[12px] text-slate-500 mb-3">DOCX · PDF · TXT — 업로드하면 질문과 자동 매칭하여 답변을 채웁니다.</p>
        <Button variant="secondary" size="sm" loading={uploading} icon={<Upload size={13} />} onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
          파일 선택
        </Button>
      </Card>

      {tacit.length > 0 && (
        <Card className="mb-7 p-4 bg-accent-50/40 border-accent-100">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <Sparkles size={14} className="text-accent-600" />
              <span className="text-[13px] font-semibold text-accent-900">추출된 Tacit Knowledge · {tacit.length}건</span>
            </div>
            <Button variant="outline" size="sm" icon={<ArrowRight size={13} />} onClick={() => navigate(`/projects/${project.id}/demo`)}>
              Demo 생성하기
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(typeCounts).map(([type, count]) => (
              <Badge key={type} tone={TK_LABEL[type]?.tone || "neutral"}>
                {TK_LABEL[type]?.label || type} {count}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      <div className="space-y-4">
        {questions.map((q) => {
          const existing = answers[q.id];
          const draft = drafts[q.id] ?? existing?.answerText ?? "";
          const dirty = draft !== (existing?.answerText ?? "");
          return (
            <Card key={q.id} className="p-4">
              <div className="flex items-start gap-2 mb-2.5">
                <Badge tone="outline">{q.category}</Badge>
                {existing && (
                  <Badge tone="neutral">
                    <Check size={10} /> 답변완료
                  </Badge>
                )}
                {existing?.source === "upload" && (
                  <Badge tone="accent">
                    <FileUp size={10} /> {existing.sourceDocument || "파일"}에서 자동 매칭
                  </Badge>
                )}
              </div>
              <p className="text-[14px] font-medium text-navy-900 mb-2 leading-relaxed">{q.question}</p>
              {q.sampleAnswer && (
                <button
                  type="button"
                  onClick={() => setExpandedSample(expandedSample === q.id ? null : q.id)}
                  className="flex items-center gap-1 text-[12px] text-accent-600 hover:text-accent-700 font-medium mb-2.5"
                >
                  <Lightbulb size={12} />
                  예시 답변 보기
                  {expandedSample === q.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
              )}
              {expandedSample === q.id && q.sampleAnswer && (
                <div className="rounded-md bg-accent-50/60 border border-accent-100 p-2.5 mb-2.5 text-[12.5px] text-navy-700 italic leading-relaxed">
                  {q.sampleAnswer}
                </div>
              )}
              <Textarea
                rows={3}
                className="w-full mb-2"
                placeholder="답변 내용을 입력하세요..."
                value={draft}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [q.id]: e.target.value }))}
              />
              <div className="flex items-center justify-between">
                <div className="flex flex-wrap gap-1.5">
                  {existing?.extracted &&
                    Object.entries(existing.extracted)
                      .filter(([, v]) => (v as string[]).length > 0)
                      .map(([k]) => (
                        <Badge key={k} tone={TK_LABEL[k]?.tone || "neutral"}>
                          {TK_LABEL[k]?.label || k}
                        </Badge>
                      ))}
                </div>
                <Button variant="primary" size="sm" loading={savingId === q.id} disabled={!draft.trim() || !dirty} onClick={() => save(q.id)}>
                  {existing ? "답변 수정 저장" : "답변 저장"}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
