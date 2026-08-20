# Quest Ops

AI Agent 구축 프로젝트를 위한 Discovery → Design → Demo → Proposal 워크스페이스.

자료 수집·분석부터 1차 인터뷰 질의서 생성, 인터뷰 결과 기반 암묵지(Tacit Knowledge) 추출,
AI Agent Demo UI 생성, 발표 PPT 생성까지 실제로 동작하는 end-to-end 파이프라인입니다.
`Mockup.dc.html`의 화면 구성/워크플로우를 참고했지만 디자인은 새로 구성했습니다 (Dark Navy 사이드바 + 밝은 워크스페이스 + Indigo accent, enterprise SaaS 톤).

## 아키텍처

```
app/
  server/   Express + TypeScript API, SQLite(node:sqlite), 문서 파싱, LLM 연동, DOCX/PPTX 생성
  web/      React + TypeScript + Vite + Tailwind CSS 프론트엔드
```

- 새 프로젝트라 기존 framework가 없어, 요청서 4장의 권장 스택(React/TS/Vite, Node/docx, Node/pptxgenjs)을 그대로 채택했습니다.
- DB는 파일 하나(SQLite)로 동작하도록 Node 24의 내장 `node:sqlite`를 사용했습니다 (별도 네이티브 빌드 도구 불필요).
- LLM 연동은 `server/src/llm/provider.ts`의 단일 어댑터를 통하며, `ANTHROPIC_API_KEY`가 설정되어 있으면 Claude로 실제 생성하고,
  없으면 각 서비스(`documentAnalysis`, `interviewGeneration`, `tacitExtraction`, `agentDemoGeneration`)의 **문서 grounded 휴리스틱 생성기**로 자동 폴백합니다.
  즉 API 키 없이도 앱 전체가 실제로 동작합니다 (품질은 LLM 모드가 더 높습니다).

## 실행 방법

```bash
cd app
npm run install:all      # server, web 의존성 설치

# (선택) LLM 기반 고품질 생성을 사용하려면
cp server/.env.example server/.env
# server/.env 에 ANTHROPIC_API_KEY=sk-ant-... 입력

npm run dev               # server(:8787) + web(:5173) 동시 실행
```

브라우저에서 http://localhost:5173 접속. Vite dev server가 `/api`를 `:8787`로 프록시합니다.

## 데이터 흐름

```
Project → Document(+분석결과) → InterviewQuestion(+Evidence) → InterviewAnswer(+추출된 Insight)
        → TacitKnowledge → Agent(Concept/Workflow) → Demo(Screens/Scenario) → Presentation(Slides/PPTX)
```

각 단계는 이전 단계의 산출물을 입력으로 사용합니다. 예를 들어 인터뷰 질문은 문서 분석에서 추출된
Grounded Fact(business rule, decision point, exception 등)를 근거(evidence)로 삼아 생성되고,
Demo UI와 PPT는 인터뷰 답변에서 추출된 Tacit Knowledge를 반영합니다.

## 핵심 기능 구현 위치

| 기능 | 서버 | 화면 |
|---|---|---|
| 문서 업로드/파싱(PDF/DOCX/PPTX/XLSX/TXT) | `services/fileParsing.ts` | `web/src/pages/DocumentsAnalysis.tsx` |
| 구조화된 문서 분석 | `services/documentAnalysis.ts` | 위와 동일 (행 확장) |
| 1차 인터뷰 질의서 생성 (Grounded Fact 기반) | `services/factExtraction.ts`, `services/interviewGeneration.ts` | `pages/InterviewQuestionnaire.tsx` |
| 실제 DOCX 생성 (`docx` 패키지) | `services/docxGeneration.ts` | 다운로드 버튼 |
| 인터뷰 답변 → Tacit Knowledge 추출 | `services/tacitExtraction.ts` | `pages/InterviewAnswers.tsx` |
| Agent Concept / Workflow / Demo UI 생성 | `services/agentDemoGeneration.ts` | `pages/DemoBuilder.tsx` |
| PPT 생성 (`pptxgenjs`) | `services/pptGeneration.ts` | `pages/PresentationBuilder.tsx` |

요구사항 확정/PRD/WBS 단계는 데이터 모델과 Quest 흐름만 연결해두고(`pages/StubStage.tsx`),
이번 구현 범위에서는 완전한 기능으로 만들지 않았습니다 (요청서 1장 명시 사항).

## 참고

- `ref_projects/ProjectOps/Mockup.dc.html` — 원본 저해상도 디자인 프로토타입 (화면 구성 참고용, 디자인은 미사용)
- `ref_projects/{openworker,hermes-agent,openbot}` — 이번 구현과 직접 관련 없는 별도 레퍼런스 레포
