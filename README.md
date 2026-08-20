# Quest Ops

AI Agent 구축 프로젝트를 위한 Discovery → Design → Demo → Proposal 워크스페이스.

자료 수집·분석부터 1차 인터뷰 질의서 생성(예시 답변 포함, 파일 업로드로도 답변 수집 가능),
인터뷰 결과 기반 암묵지(Tacit Knowledge) 추출, 다운로드 가능한 AI Agent Demo UI(HTML) 생성,
슬라이드 형태의 발표자료(HTML) 생성까지 실제로 동작하는 end-to-end 파이프라인입니다.
`Mockup.dc.html`의 화면 구성/워크플로우를 참고했지만 디자인은 새로 구성했습니다 (Dark Navy 사이드바 + 밝은 워크스페이스 + Indigo accent, enterprise SaaS 톤).

## 아키텍처

```
app/
  server/   Express + TypeScript API, SQLite(node:sqlite), 문서 파싱, LLM 연동, DOCX/HTML(Demo·발표자료) 생성
  web/      React + TypeScript + Vite + Tailwind CSS 프론트엔드
```

- 새 프로젝트라 기존 framework가 없어, 요청서 4장의 권장 스택(React/TS/Vite, Node/docx)을 그대로 채택했습니다.
  Demo UI와 발표자료는 피드백에 따라 pptx/전용 포맷이 아닌 **다운로드 가능한 self-contained HTML**로 생성합니다.
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
Project → Document(+분석결과) → InterviewQuestion(+Evidence/예시답변) → InterviewAnswer(+추출된 Insight)
        → TacitKnowledge → Agent(Concept/Workflow) → Demo(Screens/Scenario, HTML) → Presentation(Slides, HTML)
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
| Agent Concept / Workflow / Demo UI 생성 (다운로드 가능한 self-contained HTML) | `services/agentDemoGeneration.ts`, `services/demoHtmlGeneration.ts` | `pages/DemoBuilder.tsx` |
| 발표자료 생성 (슬라이드 형태의 self-contained HTML, 방향키로 넘기는 뷰어) | `services/pptGeneration.ts` (슬라이드 plan), `services/pptHtmlGeneration.ts` (렌더링) | `pages/PresentationBuilder.tsx` |
| 인터뷰 결과 파일 업로드 → 질문 자동 매칭 | `services/interviewAnswerMapping.ts` | `pages/InterviewAnswers.tsx` |

요구사항 확정/PRD/WBS 단계는 데이터 모델과 Quest 흐름만 연결해두고(`pages/StubStage.tsx`),
이번 구현 범위에서는 완전한 기능으로 만들지 않았습니다 (요청서 1장 명시 사항).

## 병행 개발 (여러 세션이 동시에 작업하기)

이 저장소는 git으로 관리되며, **git worktree**로 완전히 격리된 작업 사본을 만들 수 있습니다.
worktree는 소스 파일뿐 아니라 `node_modules`, `server/data/*.sqlite`(SQLite DB), `server/uploads`까지
전부 독립된 디렉토리를 가지므로, 같은 리포를 여러 세션이 동시에 건드려도 파일이 충돌하거나
서로의 dev 서버 포트·DB를 덮어쓰지 않습니다.

```bash
# 저장소 루트(app/)에서
git worktree add ../app-worktree-b -b session-b

cd ../app-worktree-b
npm run install:all

# 포트를 메인 체크아웃(8787/5173)과 겹치지 않게 지정
cp server/.env.example server/.env   # PORT=8788 로 수정
cp web/.env.example web/.env         # PORT=5174, API_PORT=8788 로 수정

npm run dev   # 이 worktree만의 API(:8788) + 프론트(:5174)
```

- `server/package.json`의 `dev` 스크립트는 `node --env-file-if-exists=.env`로 실행되어,
  `.env`가 있으면 자동으로 읽고 없으면(메인 체크아웃) 기본값(8787)을 그대로 씁니다.
- `web/vite.config.ts`도 같은 방식으로 `.env`의 `PORT`/`API_PORT`를 읽어 dev 서버 포트와
  `/api` 프록시 대상을 결정합니다.
- 각 worktree는 완전히 다른 디렉토리이므로 `server/data/questops.sqlite`도 worktree마다 따로
  생성됩니다 — **같은 SQLite 파일을 두 프로세스가 동시에 열지 않는 것**이 중요합니다 (WAL 모드에서
  서로 다른 프로세스가 겹쳐서 쓰다가 비정상 종료되면 커밋되지 않은 데이터가 유실될 수 있습니다).
- 작업이 끝나면 평소처럼 `git push` / PR 또는 `git merge`로 브랜치를 합치면 됩니다.
  worktree 자체를 정리하려면 `git worktree remove ../app-worktree-b`.

## 참고

- `ref_projects/ProjectOps/Mockup.dc.html` — 원본 저해상도 디자인 프로토타입 (화면 구성 참고용, 디자인은 미사용)
- `ref_projects/{openworker,hermes-agent,openbot}` — 이번 구현과 직접 관련 없는 별도 레퍼런스 레포
