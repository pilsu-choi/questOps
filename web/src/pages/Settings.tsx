import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Cpu, Loader2, Plus, Sparkles, Pencil, Trash2, CheckCircle2 } from "lucide-react";
import { api, ApiError } from "../api/client";
import type { LlmActiveInfo, LlmModel, LlmProviderId, LlmProviderInfo } from "../types";
import { Button } from "../components/ui/Button";
import { Card, CardBody } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";
import { Modal } from "../components/ui/Modal";
import { Field, Input, Select } from "../components/ui/Field";
import { useToast } from "../components/ui/Toast";

const PROVIDER_META: Record<LlmProviderId, { presets: string[]; modelHint: string; keyPlaceholder: string; keyHint: string }> = {
  anthropic: {
    presets: ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5-20251001", "claude-fable-5"],
    modelHint: "예: claude-sonnet-5",
    keyPlaceholder: "sk-ant-...",
    keyHint: "Anthropic 콘솔에서 발급한 API 키"
  },
  openai: {
    presets: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "o3-mini"],
    modelHint: "예: gpt-4o (예시입니다, 정확한 모델명은 OpenAI 문서에서 확인하세요)",
    keyPlaceholder: "sk-...",
    keyHint: "OpenAI 플랫폼에서 발급한 API 키"
  },
  openrouter: {
    presets: ["anthropic/claude-sonnet-4.5", "openai/gpt-4o", "google/gemini-2.0-flash-exp", "meta-llama/llama-3.3-70b-instruct"],
    modelHint: "vendor/model 형식 (예: openai/gpt-4o)",
    keyPlaceholder: "sk-or-...",
    keyHint: "OpenRouter에서 발급한 API 키"
  },
  google: {
    presets: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
    modelHint: "예: gemini-2.0-flash (예시입니다, 정확한 모델명은 Google AI 문서에서 확인하세요)",
    keyPlaceholder: "AIza...",
    keyHint: "Google AI Studio에서 발급한 API 키"
  }
};

interface FormState {
  provider: LlmProviderId;
  name: string;
  modelId: string;
  apiKey: string;
}

const EMPTY_FORM: FormState = { provider: "anthropic", name: "", modelId: "", apiKey: "" };

export default function Settings() {
  const navigate = useNavigate();
  const toast = useToast();

  const [models, setModels] = useState<LlmModel[] | null>(null);
  const [providers, setProviders] = useState<LlmProviderInfo[]>([]);
  const [llmAvailable, setLlmAvailable] = useState(false);
  const [active, setActive] = useState<LlmActiveInfo | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<LlmModel | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => {
    api.listLlmModels().then((res) => {
      setModels(res.models);
      setProviders(res.providers);
      setLlmAvailable(res.llmAvailable);
      setActive(res.active);
    });
  };

  useEffect(load, []);

  const providerLabel = (id: LlmProviderId) => providers.find((p) => p.id === id)?.label || id;

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (m: LlmModel) => {
    setEditing(m);
    setForm({ provider: m.provider, name: m.name, modelId: m.modelId, apiKey: "" });
    setModalOpen(true);
  };

  const submit = async () => {
    if (!form.name.trim() || !form.modelId.trim()) {
      toast.push("error", "모델 별칭과 모델 ID는 필수입니다.");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.updateLlmModel(editing.id, {
          name: form.name.trim(),
          provider: form.provider,
          modelId: form.modelId.trim(),
          ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {})
        });
        toast.push("success", "모델 정보를 수정했습니다.");
      } else {
        await api.createLlmModel({
          name: form.name.trim(),
          provider: form.provider,
          modelId: form.modelId.trim(),
          apiKey: form.apiKey.trim() || undefined
        });
        toast.push("success", "새 모델을 등록했습니다.");
      }
      setModalOpen(false);
      load();
    } catch (err) {
      toast.push("error", err instanceof ApiError ? err.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const activate = async (id: string) => {
    setBusyId(id);
    try {
      await api.activateLlmModel(id);
      toast.push("success", "활성 모델을 변경했습니다.");
      load();
    } catch (err) {
      toast.push("error", err instanceof ApiError ? err.message : "활성화에 실패했습니다.");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (m: LlmModel) => {
    if (!window.confirm(`"${m.name}" 모델을 삭제할까요? 등록된 API 키도 함께 삭제됩니다.`)) return;
    setBusyId(m.id);
    try {
      await api.deleteLlmModel(m.id);
      toast.push("success", "모델을 삭제했습니다.");
      load();
    } catch (err) {
      toast.push("error", err instanceof ApiError ? err.message : "삭제에 실패했습니다.");
    } finally {
      setBusyId(null);
    }
  };

  const meta = PROVIDER_META[form.provider];

  return (
    <div className="min-h-screen bg-[#F6F7FB]">
      <div className="max-w-4xl mx-auto px-8 py-10">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-navy-900 transition-colors mb-5"
        >
          <ChevronLeft size={14} /> 프로젝트 목록
        </button>

        <div className="flex items-end justify-between mb-1">
          <h1 className="text-[26px] font-bold text-navy-900 tracking-tight">LLM 모델 설정</h1>
          <Button variant="primary" icon={<Plus size={16} />} onClick={openCreate}>
            모델 등록
          </Button>
        </div>
        <p className="text-[14px] text-slate-500 mb-6">
          문서 분석, 인터뷰 질의서, Tacit Knowledge 추출, Demo/PPT 생성에 사용할 LLM Provider·모델·API 키를 등록하고 전환합니다.
          (Anthropic / OpenAI / OpenRouter / Google Gemini 지원)
        </p>

        <Card className="mb-6">
          <CardBody className="flex items-center gap-3 pt-5">
            <div
              className={`w-9 h-9 rounded-lg flex items-center justify-center flex-none ${
                llmAvailable ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"
              }`}
            >
              <Sparkles size={16} />
            </div>
            <div className="flex-1">
              <div className="text-[13px] font-medium text-navy-900">
                {llmAvailable && active
                  ? `현재 활성 모델: [${providerLabel(active.provider)}] ${active.modelName}`
                  : "LLM 미설정 — 휴리스틱(정규식) 폴백 생성기 사용 중"}
              </div>
              <div className="text-[12px] text-slate-400 mt-0.5">
                {llmAvailable
                  ? active?.source === "env"
                    ? "server/.env의 ANTHROPIC_API_KEY를 기본값으로 사용하고 있습니다. 아래에서 모델을 등록하면 그 모델이 우선됩니다."
                    : "등록된 모델의 API 키로 실제 LLM 호출을 수행합니다."
                  : "모델을 등록하면 즉시 LLM 기반 생성으로 전환됩니다 (재시작 불필요)."}
              </div>
            </div>
          </CardBody>
        </Card>

        {!models && (
          <div className="flex justify-center py-20">
            <Loader2 className="animate-spin text-accent-500" size={22} />
          </div>
        )}

        {models && models.length === 0 && (
          <EmptyState
            icon={<Cpu size={28} />}
            title="등록된 모델이 없습니다"
            description="Provider를 선택하고 모델 별칭·모델 ID·API 키를 등록하면 이 프로젝트의 모든 생성 단계에서 해당 모델을 사용합니다."
            action={
              <Button variant="primary" icon={<Plus size={16} />} onClick={openCreate}>
                모델 등록
              </Button>
            }
          />
        )}

        {models && models.length > 0 && (
          <div className="flex flex-col gap-3">
            {models.map((m) => (
              <Card key={m.id} className="p-4">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge tone="outline">{providerLabel(m.provider)}</Badge>
                      <span className="text-[14px] font-semibold text-navy-900 truncate">{m.name}</span>
                      {m.isActive && (
                        <Badge tone="success">
                          <CheckCircle2 size={11} /> 활성
                        </Badge>
                      )}
                      {!m.hasApiKey && <Badge tone="warning">API 키 없음</Badge>}
                    </div>
                    <div className="text-[12px] text-slate-500 mt-1 font-mono">{m.modelId}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{m.apiKeyPreview || "키 미등록"}</div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-none">
                    {!m.isActive && (
                      <Button size="sm" variant="outline" loading={busyId === m.id} onClick={() => activate(m.id)}>
                        활성화
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" icon={<Pencil size={14} />} onClick={() => openEdit(m)} aria-label="수정" />
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Trash2 size={14} />}
                      loading={busyId === m.id}
                      onClick={() => remove(m)}
                      className="text-red-500 hover:bg-red-50"
                      aria-label="삭제"
                    />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "모델 수정" : "모델 등록"}>
        <div className="flex flex-col gap-4">
          <Field label="Provider" required>
            <Select value={form.provider} onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value as LlmProviderId }))}>
              {(providers.length ? providers : [
                { id: "anthropic", label: "Anthropic" },
                { id: "openai", label: "OpenAI" },
                { id: "openrouter", label: "OpenRouter" },
                { id: "google", label: "Google (Gemini)" }
              ] as LlmProviderInfo[]
              ).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="모델 별칭" required hint="목록에서 구분하기 위한 이름입니다 (예: 기본 Sonnet, 저비용 GPT).">
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="예: 기본 Sonnet" autoFocus />
          </Field>
          <Field label="모델 ID" required hint={meta.modelHint}>
            <Input
              value={form.modelId}
              onChange={(e) => setForm((f) => ({ ...f, modelId: e.target.value }))}
              placeholder={meta.presets[0]}
              list="model-id-presets"
            />
            <datalist id="model-id-presets">
              {meta.presets.map((id) => (
                <option key={id} value={id} />
              ))}
            </datalist>
          </Field>
          <Field
            label="API 키"
            hint={editing ? "비워두면 기존 키를 유지합니다. 키를 지우려면 공백 한 칸을 입력한 뒤 저장하세요." : meta.keyHint}
          >
            <Input
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
              placeholder={editing?.apiKeyPreview ? `현재: ${editing.apiKeyPreview}` : meta.keyPlaceholder}
              autoComplete="off"
            />
          </Field>
          <div className="flex justify-end gap-2 mt-1">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              취소
            </Button>
            <Button variant="primary" loading={saving} onClick={submit}>
              {editing ? "저장" : "등록"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
