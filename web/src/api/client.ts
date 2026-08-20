import type {
  Project,
  ProjectDocument,
  InterviewSet,
  InterviewQuestion,
  InterviewAnswer,
  TacitKnowledgeItem,
  DemoState,
  AgentConcept,
  PresentationState,
  LlmModel,
  LlmActiveInfo,
  LlmProviderInfo,
  LlmProviderId
} from "../types";

const BASE = "/api";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: options?.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json", ...options.headers } : options?.headers
  });
  if (!res.ok) {
    let message = `요청 실패 (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {}
    throw new ApiError(message, res.status);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

export const api = {
  listProjects: () => req<Project[]>("/projects"),
  getProject: (id: string) => req<Project>(`/projects/${id}`),
  createProject: (payload: Partial<Project>) => req<Project>("/projects", { method: "POST", body: JSON.stringify(payload) }),
  updateProject: (id: string, payload: Partial<Project>) =>
    req<Project>(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  getDashboard: (id: string) => req<{ project: Project; progress: Project["progress"] }>(`/projects/${id}/dashboard`),

  listDocuments: (projectId: string) => req<ProjectDocument[]>(`/projects/${projectId}/documents`),
  uploadDocuments: (projectId: string, files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    return req<ProjectDocument[]>(`/projects/${projectId}/documents`, { method: "POST", body: form });
  },
  reanalyzeDocument: (docId: string) => req<ProjectDocument>(`/documents/${docId}/reanalyze`, { method: "POST" }),
  deleteDocument: (docId: string) => req<void>(`/documents/${docId}`, { method: "DELETE" }),

  interviewEligibility: (projectId: string) =>
    req<{ eligible: boolean; analyzedCount: number; analyzingCount: number; totalCount: number; reason: string }>(
      `/projects/${projectId}/interview/eligibility`
    ),
  getInterview: (projectId: string) => req<{ set: InterviewSet | null; questions: InterviewQuestion[] }>(`/projects/${projectId}/interview`),
  generateInterview: (projectId: string) =>
    req<{ set: InterviewSet; questions: InterviewQuestion[] }>(`/projects/${projectId}/interview/generate`, { method: "POST" }),
  updateQuestion: (id: string, payload: Partial<InterviewQuestion>) =>
    req<InterviewQuestion>(`/interview/questions/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteQuestion: (id: string) => req<void>(`/interview/questions/${id}`, { method: "DELETE" }),
  addQuestion: (projectId: string, payload: Partial<InterviewQuestion>) =>
    req<InterviewQuestion>(`/projects/${projectId}/interview/questions`, { method: "POST", body: JSON.stringify(payload) }),
  interviewDocxUrl: (setId: string) => `${BASE}/interview/sets/${setId}/docx`,

  listAnswers: (projectId: string) => req<InterviewAnswer[]>(`/projects/${projectId}/interview/answers`),
  submitAnswer: (questionId: string, answerText: string, note?: string) =>
    req<InterviewAnswer>(`/interview/questions/${questionId}/answer`, { method: "POST", body: JSON.stringify({ answerText, note }) }),
  uploadAnswersFile: (projectId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return req<{ matchedCount: number; totalQuestions: number; filename: string }>(`/projects/${projectId}/interview/answers/upload`, {
      method: "POST",
      body: form
    });
  },
  listTacitKnowledge: (projectId: string) => req<TacitKnowledgeItem[]>(`/projects/${projectId}/tacit-knowledge`),

  demoEligibility: (projectId: string) =>
    req<{ eligible: boolean; answeredCount: number; analyzedDocCount: number; reason: string }>(`/projects/${projectId}/demo/eligibility`),
  getDemo: (projectId: string) => req<{ demo: DemoState | null; agent: AgentConcept | null }>(`/projects/${projectId}/demo`),
  generateDemo: (projectId: string) =>
    req<{ demo: DemoState; agent: AgentConcept }>(`/projects/${projectId}/demo/generate`, { method: "POST" }),
  demoHtmlUrl: (demoId: string) => `${BASE}/demos/${demoId}/html`,
  demoDownloadUrl: (demoId: string) => `${BASE}/demos/${demoId}/download`,

  getPresentation: (projectId: string) => req<PresentationState | null>(`/projects/${projectId}/presentation`),
  generatePresentation: (projectId: string) =>
    req<PresentationState>(`/projects/${projectId}/presentation/generate`, { method: "POST" }),
  presentationHtmlUrl: (presId: string) => `${BASE}/presentations/${presId}/html`,
  presentationDownloadUrl: (presId: string) => `${BASE}/presentations/${presId}/download`,

  listLlmModels: () =>
    req<{ models: LlmModel[]; providers: LlmProviderInfo[]; llmAvailable: boolean; active: LlmActiveInfo | null }>("/llm-models"),
  createLlmModel: (payload: { name: string; modelId: string; apiKey?: string; provider: LlmProviderId }) =>
    req<LlmModel>("/llm-models", { method: "POST", body: JSON.stringify(payload) }),
  updateLlmModel: (id: string, payload: { name?: string; modelId?: string; apiKey?: string; provider?: LlmProviderId }) =>
    req<LlmModel>(`/llm-models/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  activateLlmModel: (id: string) => req<LlmModel>(`/llm-models/${id}/activate`, { method: "POST" }),
  deleteLlmModel: (id: string) => req<void>(`/llm-models/${id}`, { method: "DELETE" })
};
