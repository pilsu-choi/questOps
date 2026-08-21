# 01. Quest Ops 프로젝트 개요

- 관련 커밋: `d8670ff` (Initial commit: Quest Ops baseline)
- 상세 문서: `/README.md` (본 문서는 그 요약 + 배경)

## 무엇인가

AI Agent 구축 프로젝트를 위한 **Discovery → Design → Demo → Proposal** 워크스페이스.
자료 수집·분석 → 1차 인터뷰 질의서 생성(예시 답변 포함, 파일 업로드로 답변 수집 가능) →
인터뷰 결과 기반 암묵지(Tacit Knowledge) 추출 → 다운로드 가능한 AI Agent Demo UI(HTML) 생성 →
슬라이드 형태 발표자료(HTML) 생성까지 실제로 동작하는 end-to-end 파이프라인.

`ref_projects/ProjectOps/Mockup.dc.html`의 화면 구성/워크플로우를 참고했지만 디자인은 새로
구성 (Dark Navy 사이드바 + 밝은 워크스페이스 + Indigo accent, enterprise SaaS 톤).

## 아키텍처

```
app/
  server/   Express + TypeScript API, SQLite(node:sqlite), 문서 파싱, LLM 연동, DOCX/HTML 생성
  web/      React + TypeScript + Vite + Tailwind CSS 프론트엔드
```

- 새 프로젝트라 기존 framework 없이, 요청서 4장의 권장 스택(React/TS/Vite, Node/docx)을 채택.
- Demo UI와 발표자료는 pptx/전용 포맷이 아닌 **다운로드 가능한 self-contained HTML**로 생성
  (피드백 반영).
- DB는 파일 하나(SQLite)로 동작하도록 Node 24 내장 `node:sqlite` 사용 (별도 네이티브 빌드
  도구 불필요).
- LLM 연동은 `server/src/llm/provider.ts` 단일 어댑터를 통함. `ANTHROPIC_API_KEY`가 있으면
  Claude로 실제 생성, 없으면 각 서비스의 **문서 grounded 휴리스틱 생성기**로 자동 폴백.
  즉 API 키 없이도 앱 전체가 동작함 (품질은 LLM 모드가 더 높음).

## 데이터 흐름 (Quest 파이프라인)

```
Project → Document(+분석결과) → DomainKnowledge → InterviewQuestion(+Evidence/예시답변)
        → InterviewAnswer(+추출된 Insight) → TacitKnowledge
        → Agent(Concept/Workflow) → Demo(Screens/Scenario, HTML) → Presentation(Slides, HTML)
```

(`DomainKnowledge` 단계는 이후 추가됨 — [05-domain-knowledge-dashboard.md](05-domain-knowledge-dashboard.md) 참고)

각 단계는 이전 단계의 산출물을 입력으로 사용. 예: 인터뷰 질문은 문서 분석에서 추출된
Grounded Fact(business rule, decision point, exception 등)를 근거(evidence)로 생성되고,
Demo UI와 PPT는 인터뷰 답변에서 추출된 Tacit Knowledge를 반영.

## 핵심 기능 구현 위치

| 기능 | 서버 | 화면 |
|---|---|---|
| 문서 업로드/파싱(PDF/DOCX/PPTX/XLSX/TXT) | `services/fileParsing.ts` | `web/src/pages/DocumentsAnalysis.tsx` |
| 구조화된 문서 분석 | `services/documentAnalysis.ts` | 위와 동일 |
| 도메인 지식 대시보드 생성 | `services/domainKnowledgeGeneration.ts` | `pages/DomainKnowledge*.tsx` |
| 1차 인터뷰 질의서 생성 (Grounded Fact 기반) | `services/factExtraction.ts`, `services/interviewGeneration.ts` | `pages/InterviewQuestionnaire.tsx` |
| 실제 DOCX 생성 | `services/docxGeneration.ts` | 다운로드 버튼 |
| 인터뷰 답변 → Tacit Knowledge 추출 | `services/tacitExtraction.ts` | `pages/InterviewAnswers.tsx` |
| Agent Concept / Workflow / Demo UI 생성 | `services/agentDemoGeneration.ts`, `services/demoHtmlGeneration.ts` | `pages/DemoBuilder.tsx` |
| 발표자료 생성 (슬라이드 HTML) | `services/pptGeneration.ts`, `services/pptHtmlGeneration.ts` | `pages/PresentationBuilder.tsx` |
| 인터뷰 결과 파일 업로드 → 질문 자동 매칭 | `services/interviewAnswerMapping.ts` | `pages/InterviewAnswers.tsx` |

요구사항 확정/PRD/WBS 단계는 데이터 모델과 Quest 흐름만 연결(`pages/StubStage.tsx`), 완전한
기능으로 구현하지 않음 (요청서 1장 명시 사항).

## 병행 개발 (git worktree)

`git worktree`로 완전히 격리된 작업 사본을 만들 수 있음 — `node_modules`, SQLite DB,
uploads까지 독립. 포트는 `server/.env`/`web/.env`의 `PORT`/`API_PORT`로 조정
(`node --env-file-if-exists`, `vite.config.ts`의 `loadEnv`). 자세한 절차는
[02-baseline-and-infra-fixes.md](02-baseline-and-infra-fixes.md) 참고.

**주의**: 같은 SQLite 파일을 두 프로세스가 동시에 열지 않을 것 (WAL 모드에서 비정상 종료 시
커밋되지 않은 데이터 유실 가능).
