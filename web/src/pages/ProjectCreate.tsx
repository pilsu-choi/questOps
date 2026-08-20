import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Sparkles } from "lucide-react";
import { api } from "../api/client";
import { Button } from "../components/ui/Button";
import { Field, Input, Select, Textarea } from "../components/ui/Field";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { useToast } from "../components/ui/Toast";

const RECOMMENDED_DOCS = ["제안서", "사업계획서", "RFP", "업무지침", "기존 시스템 문서", "업무 프로세스 문서", "회의자료", "기존 요구사항", "기타 참고자료"];

export default function ProjectCreate() {
  const navigate = useNavigate();
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: "",
    client: "",
    owner: "",
    org: "",
    projectType: "AI Agent 구축",
    startDate: "",
    endDate: "",
    description: "",
    goal: ""
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const canSubmit = form.name.trim() && form.client.trim();

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const project = await api.createProject(form);
      toast.push("success", "프로젝트가 생성되었습니다. 자료 수집을 시작하세요.");
      navigate(`/projects/${project.id}/docs`);
    } catch (err) {
      toast.push("error", (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F6F7FB]">
      <div className="max-w-3xl mx-auto px-8 py-10">
        <button onClick={() => navigate("/")} className="flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-navy-900 mb-6">
          <ArrowLeft size={14} /> 프로젝트 목록
        </button>

        <h1 className="text-[26px] font-bold text-navy-900 tracking-tight mb-1">새 프로젝트 생성</h1>
        <p className="text-[14px] text-slate-500 mb-8">AI Agent 프로젝트의 기본 정보를 입력하세요. 생성 후 관련 자료 수집부터 시작됩니다.</p>

        <div className="grid grid-cols-2 gap-5 mb-5">
          <Field label="프로젝트명" required>
            <Input value={form.name} onChange={set("name")} placeholder="예: 외환중계 AI Agent 구축" />
          </Field>
          <Field label="고객사" required>
            <Input value={form.client} onChange={set("client")} placeholder="예: OO은행" />
          </Field>
          <Field label="담당자 / 팀">
            <Input value={form.owner} onChange={set("owner")} placeholder="예: 외환중계팀" />
          </Field>
          <Field label="관련 조직">
            <Input value={form.org} onChange={set("org")} placeholder="예: 외환사업부" />
          </Field>
          <Field label="시작일">
            <Input type="date" value={form.startDate} onChange={set("startDate")} />
          </Field>
          <Field label="종료일">
            <Input type="date" value={form.endDate} onChange={set("endDate")} />
          </Field>
          <Field label="프로젝트 유형" className="col-span-2">
            <Select value={form.projectType} onChange={set("projectType")}>
              <option>AI Agent 구축</option>
              <option>고도화</option>
              <option>컨설팅</option>
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-5 mb-8">
          <Field label="프로젝트 설명">
            <Textarea rows={3} value={form.description} onChange={set("description")} placeholder="이 프로젝트가 다루는 업무와 범위를 설명하세요." />
          </Field>
          <Field label="프로젝트 목표">
            <Textarea rows={2} value={form.goal} onChange={set("goal")} placeholder="이 프로젝트로 달성하고자 하는 목표를 입력하세요." />
          </Field>
        </div>

        <Button variant="primary" size="lg" className="mb-8 w-full sm:w-auto" loading={submitting} disabled={!canSubmit} onClick={submit}>
          프로젝트 생성하기
        </Button>

        <Card className="p-5 bg-accent-50/40 border-accent-100">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={15} className="text-accent-600" />
            <span className="text-[13px] font-semibold text-accent-900">안내</span>
          </div>
          <p className="text-[13px] text-navy-700 mb-3">프로젝트가 생성되면 먼저 관련 자료를 모두 수집해주세요. 자료가 많고 구체적일수록 인터뷰 질문의 품질이 높아집니다.</p>
          <div className="flex flex-wrap gap-1.5">
            {RECOMMENDED_DOCS.map((d) => (
              <Badge key={d} tone="outline">
                {d}
              </Badge>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
