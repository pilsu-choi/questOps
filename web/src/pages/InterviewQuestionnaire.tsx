import { useCallback, useEffect, useState } from "react";
import {
  Download,
  RotateCw,
  Pencil,
  Check,
  Trash2,
  Plus,
  Loader2,
  FileQuestion,
  ChevronDown,
  ChevronUp,
  Quote,
  MessageCircleMore
} from "lucide-react";
import { api } from "../api/client";
import type { InterviewQuestion, InterviewSet } from "../types";
import { useProjectContext } from "../hooks/useProject";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";
import { Field, Input, Select, Textarea } from "../components/ui/Field";
import { Modal } from "../components/ui/Modal";
import { useToast } from "../components/ui/Toast";
import { cn } from "../lib/cn";

const CATEGORIES = ["Business", "User", "Process", "System", "AI", "Operation"];
const TACIT_TYPES = ["boundary", "exception", "hidden_rule", "judgment", "failure", "workaround", "handoff", "trust_boundary"];

const TACIT_LABEL: Record<string, string> = {
  boundary: "Boundary",
  exception: "Exception",
  hidden_rule: "Hidden Rule",
  judgment: "Judgment",
  failure: "Failure",
  workaround: "Workaround",
  handoff: "Handoff",
  trust_boundary: "Trust Boundary"
};

export default function InterviewQuestionnaire() {
  const { project, refresh } = useProjectContext();
  const toast = useToast();
  const [set, setSet] = useState<InterviewSet | null>(null);
  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [eligibility, setEligibility] = useState<{ eligible: boolean; reason: string } | null>(null);
  const [addCategory, setAddCategory] = useState<string | null>(null);
  const [addForm, setAddForm] = useState({ question: "", intent: "", expectedInsight: "", tacitKnowledgeType: "judgment", sampleAnswer: "" });
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const [data, elig] = await Promise.all([api.getInterview(project.id), api.interviewEligibility(project.id)]);
    setSet(data.set);
    setQuestions(data.questions);
    setEligibility(elig);
    setLoading(false);
  }, [project.id]);

  useEffect(() => {
    load();
  }, [load]);

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await api.generateInterview(project.id);
      setSet(res.set);
      setQuestions(res.questions);
      refresh();
      toast.push("success", `${res.questions.length}개 질문이 생성되었습니다.`);
    } catch (err) {
      toast.push("error", (err as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const updateQuestion = async (id: string, patch: Partial<InterviewQuestion>) => {
    const updated = await api.updateQuestion(id, patch);
    setQuestions((prev) => prev.map((q) => (q.id === id ? updated : q)));
  };

  const deleteQuestion = async (id: string) => {
    await api.deleteQuestion(id);
    setQuestions((prev) => prev.filter((q) => q.id !== id));
    if (set) setSet({ ...set, questionCount: set.questionCount - 1 });
  };

  const openAdd = (category: string) => {
    setAddForm({ question: "", intent: "", expectedInsight: "", tacitKnowledgeType: "judgment", sampleAnswer: "" });
    setAddCategory(category);
  };

  const submitAdd = async () => {
    if (!addCategory || !addForm.question.trim()) return;
    setAdding(true);
    try {
      const created = await api.addQuestion(project.id, { category: addCategory, ...addForm });
      setQuestions((prev) => [...prev, created]);
      if (set) setSet({ ...set, questionCount: set.questionCount + 1 });
      toast.push("success", "질문이 추가되었습니다.");
      setAddCategory(null);
    } catch (err) {
      toast.push("error", (err as Error).message);
    } finally {
      setAdding(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="animate-spin text-accent-500" size={22} />
      </div>
    );
  }

  if (!set || set.status !== "ready" || questions.length === 0) {
    return (
      <div>
        <h1 className="text-[26px] font-bold text-navy-900 tracking-tight mb-1">1차 인터뷰 질의서</h1>
        <p className="text-[14px] text-slate-500 mb-7">자료 분석 결과를 근거로 Tacit Knowledge 중심의 인터뷰 질문을 생성합니다.</p>
        <EmptyState
          icon={<FileQuestion size={28} />}
          title={set?.status === "generating" ? "질의서를 생성하는 중입니다..." : "아직 생성된 질의서가 없습니다"}
          description={
            eligibility && !eligibility.eligible
              ? eligibility.reason
              : "자료 수집 & 분석 화면에서 문서를 업로드하고 분석을 완료하면 질의서를 생성할 수 있습니다."
          }
          action={
            <Button variant="primary" icon={<Plus size={16} />} loading={generating} disabled={!eligibility?.eligible} onClick={generate}>
              1차 인터뷰 질의서 생성
            </Button>
          }
        />
      </div>
    );
  }

  const byCategory = new Map<string, InterviewQuestion[]>();
  for (const q of questions) {
    if (!byCategory.has(q.category)) byCategory.set(q.category, []);
    byCategory.get(q.category)!.push(q);
  }

  return (
    <div>
      <div className="flex items-end justify-between mb-1 flex-wrap gap-3">
        <h1 className="text-[26px] font-bold text-navy-900 tracking-tight">1차 인터뷰 질의서</h1>
        <div className="flex items-center gap-2">
          <Button variant={editMode ? "primary" : "ghost"} size="sm" icon={editMode ? <Check size={14} /> : <Pencil size={14} />} onClick={() => setEditMode((v) => !v)}>
            {editMode ? "수정 완료" : "수정"}
          </Button>
          <Button variant="ghost" size="sm" icon={<RotateCw size={14} />} loading={generating} onClick={generate}>
            재생성
          </Button>
          <a href={api.interviewDocxUrl(set.id)} target="_blank" rel="noreferrer">
            <Button variant="primary" size="sm" icon={<Download size={14} />}>
              다운로드
            </Button>
          </a>
        </div>
      </div>
      <p className="text-[14px] text-slate-500 mb-1">
        수집된 자료를 분석하여 <strong className="text-navy-900">{questions.length}개</strong>의 인터뷰 질문을 생성했습니다.
        {set.source === "heuristic" && <span className="text-amber-600"> (템플릿 기반 생성 — ANTHROPIC_API_KEY 설정 시 LLM 기반 고품질 생성으로 전환됩니다)</span>}
      </p>
      <p className="text-[12px] text-slate-400 mb-7">생성일 {new Date(set.createdAt).toLocaleString("ko-KR")}</p>

      {Array.from(byCategory.entries()).map(([category, qs]) => (
        <div key={category} className="mb-7">
          <div className="flex items-center gap-2 mb-2.5">
            <span className="text-[15px] font-bold text-navy-900">{category}</span>
            <Badge tone="outline">{qs.length}문항</Badge>
            {editMode && (
              <button
                onClick={() => openAdd(category)}
                className="ml-auto flex items-center gap-1 text-[12px] text-accent-600 hover:text-accent-700 font-medium"
              >
                <Plus size={12} /> 질문 추가
              </button>
            )}
          </div>
          <Card className="divide-y divide-slate-100 overflow-hidden">
            {qs.map((q) => (
              <QuestionRow
                key={q.id}
                q={q}
                editMode={editMode}
                expanded={expandedId === q.id}
                onToggle={() => setExpandedId(expandedId === q.id ? null : q.id)}
                onUpdate={(patch) => updateQuestion(q.id, patch)}
                onDelete={() => deleteQuestion(q.id)}
              />
            ))}
          </Card>
        </div>
      ))}

      {editMode && (
        <div className="flex items-center gap-1.5 mb-4">
          <span className="text-[12px] text-slate-400">새 카테고리에 질문 추가:</span>
          {CATEGORIES.filter((c) => !byCategory.has(c)).map((c) => (
            <button key={c} onClick={() => openAdd(c)} className="text-[12px] text-accent-600 hover:text-accent-700 font-medium">
              + {c}
            </button>
          ))}
        </div>
      )}

      <Modal open={addCategory !== null} onClose={() => setAddCategory(null)} title={`${addCategory} 질문 추가`}>
        <div className="flex flex-col gap-4">
          <Field label="질문" required>
            <Textarea rows={3} value={addForm.question} onChange={(e) => setAddForm((f) => ({ ...f, question: e.target.value }))} placeholder="Tacit Knowledge를 끌어내는 구체적인 질문을 입력하세요." />
          </Field>
          <Field label="Interview Intent">
            <Input value={addForm.intent} onChange={(e) => setAddForm((f) => ({ ...f, intent: e.target.value }))} placeholder="이 질문의 목적" />
          </Field>
          <Field label="Expected Insight">
            <Input value={addForm.expectedInsight} onChange={(e) => setAddForm((f) => ({ ...f, expectedInsight: e.target.value }))} placeholder="기대하는 답변의 성격" />
          </Field>
          <Field label="예시 답변 (Sample Answer)" hint="특정 시나리오를 가정한 구체적인 예시 답변을 작성하면 인터뷰 진행자가 참고할 수 있습니다.">
            <Textarea rows={3} value={addForm.sampleAnswer} onChange={(e) => setAddForm((f) => ({ ...f, sampleAnswer: e.target.value }))} placeholder="예: 실제로는 ~한 경우 담당자 재량으로 처리합니다..." />
          </Field>
          <Field label="Tacit Knowledge Type">
            <Select value={addForm.tacitKnowledgeType} onChange={(e) => setAddForm((f) => ({ ...f, tacitKnowledgeType: e.target.value }))}>
              {TACIT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TACIT_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setAddCategory(null)}>
              취소
            </Button>
            <Button variant="primary" loading={adding} disabled={!addForm.question.trim()} onClick={submitAdd}>
              추가
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function QuestionRow({
  q,
  editMode,
  expanded,
  onToggle,
  onUpdate,
  onDelete
}: {
  q: InterviewQuestion;
  editMode: boolean;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (patch: Partial<InterviewQuestion>) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(q.question);
  const [sampleDraft, setSampleDraft] = useState(q.sampleAnswer || "");

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <button onClick={onToggle} className="flex-none mt-0.5 text-slate-300 hover:text-slate-500">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        <div className="flex-1 min-w-0">
          {editMode ? (
            <Textarea
              rows={2}
              className="w-full text-[13.5px]"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => draft !== q.question && onUpdate({ question: draft })}
            />
          ) : (
            <button onClick={onToggle} className="text-[13.5px] text-navy-800 leading-relaxed text-left">
              {q.question}
            </button>
          )}
          {expanded && (
            <div className="mt-2.5 space-y-2 text-[12.5px] bg-slate-50 rounded-lg p-3">
              {q.intent && (
                <div>
                  <span className="font-semibold text-slate-500">Interview Intent · </span>
                  <span className="text-slate-600">{q.intent}</span>
                </div>
              )}
              {q.expectedInsight && (
                <div>
                  <span className="font-semibold text-slate-500">Expected Insight · </span>
                  <span className="text-slate-600">{q.expectedInsight}</span>
                </div>
              )}
              {q.evidence.length > 0 && (
                <div className="flex items-start gap-1.5">
                  <Quote size={11} className="text-slate-400 mt-0.5 flex-none" />
                  <div className="text-slate-500 space-y-0.5">
                    {q.evidence.map((e, i) => (
                      <div key={i}>
                        {e.document}
                        {e.page ? ` · p.${e.page}` : ""}
                        {e.section ? ` · ${e.section}` : ""}
                        {e.quote ? <span className="text-slate-400 italic"> — "{e.quote.slice(0, 80)}"</span> : null}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(q.sampleAnswer || editMode) && (
                <div className="rounded-md bg-accent-50/60 border border-accent-100 p-2.5">
                  <div className="flex items-center gap-1 font-semibold text-accent-700 mb-1">
                    <MessageCircleMore size={11} /> 예시 답변
                  </div>
                  {editMode ? (
                    <Textarea
                      rows={2}
                      className="w-full text-[12.5px] bg-white"
                      value={sampleDraft}
                      onChange={(e) => setSampleDraft(e.target.value)}
                      onBlur={() => sampleDraft !== q.sampleAnswer && onUpdate({ sampleAnswer: sampleDraft })}
                      placeholder="이 질문에 대한 구체적인 예시 답변을 입력하세요."
                    />
                  ) : (
                    <p className="text-navy-700 italic leading-relaxed">{q.sampleAnswer}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex-none flex items-center gap-2">
          {q.tacitKnowledgeType && <Badge tone="accent">{TACIT_LABEL[q.tacitKnowledgeType] || q.tacitKnowledgeType}</Badge>}
          {editMode && (
            <button onClick={onDelete} className="text-slate-300 hover:text-red-500 p-1">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
