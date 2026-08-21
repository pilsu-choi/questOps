# 02. 베이스라인 + 초기 인프라/버그 수정

기간: 2026-08-20 21:05 ~ 21:28

## 초기 커밋 — `d8670ff` Initial commit: Quest Ops baseline

React/TS/Vite 프론트엔드 + Express/TS 백엔드로 Quest Ops 워크스페이스 전체를 구현:
문서 업로드/분석, grounded 인터뷰 질문 생성(DOCX export 포함), 인터뷰 답변 캡처 +
암묵지 추출, AI Agent Demo 생성(다운로드/뷰 가능한 HTML), HTML 슬라이드 발표자료 생성.
LLM 모델 설정 기능(SQLite에 등록 모델 저장, `/settings`에서 편집)도 동시에 포함.

## `46093ea` — worktree용 dev 서버 포트 설정 가능화

Vite가 `PORT`/`API_PORT`를 하드코딩(5173/8787) 대신 plain `.env`에서 `loadEnv`로 읽도록 변경.
git worktree가 각자 다른 포트에서 프론트+API 쌍을 띄울 수 있어 다른 checkout과 충돌하지 않음.

## `eb291c0` — `node --env-file-if-exists`로 `server/.env` 자동 로드

worktree가 코드 변경 없이 `server/.env`에서 자체 `PORT`를 설정할 수 있게 함. `.env`가 없는
메인 checkout은 영향 없음.

## `b704f3c` — 병행 개발 워크플로우 문서화 + README 갱신

git worktree 기반 병행 개발 방법을 README에 문서화하고, Demo/발표자료가 HTML 기반 파이프라인임을
반영해 README 갱신.

## `5b9e52e` — 업로드 시 한글/비ASCII 파일명 mojibake 수정

**증상**: multer/busboy가 multipart filename 헤더를 기본적으로 latin1로 디코드하는데, 브라우저는
UTF-8 바이트를 보냄 → 비ASCII 파일명이 깨짐 (예: `외환.docx` → `ì¸í.docx`).

**수정**: 업로드 시점에 `fixUploadedFilename()`으로 바이트를 UTF-8로 재해석. 문서 업로드와
인터뷰 답변 파일 업로드 양쪽에 적용.

## `0b28c8c` — LLM JSON 출력이 완성 전에 잘리는 문제 수정

- 문서 분석(4096→8192), 인터뷰 질문 생성(8192→16000) `max_tokens` 상향 — 둘 다 큰 구조화 JSON을
  반환하는데, 특히 OpenRouter의 토큰 효율이 낮은 모델에서 non-trivial 문서 처리 시 캡에 걸림.
- `completeJSON()`이 마지막 매칭 brace를 찾으려다 실패하면(잘린 응답에서 조용히 잘못된 슬라이스를
  만들거나 원본 문자열 전체 파싱으로 넘어가던 버그) 대신 첫 `{`/`[`부터 응답 끝까지 추출하도록 변경.
- 진짜로 잘린 응답을 위한 best-effort 복구 패스 추가: 열린 string/object/array를 닫아서
  부분적이지만 유효한 데이터(예: businessContext는 채워졌지만 이후 배열 필드가 잘린 경우)를
  완전 실패 대신 복구.

## `55b4abc` — 전체 생성 호출의 LLM `max_tokens`를 대폭 상향

- `documentAnalysis` 8192→16000, `interviewGeneration` 16000→24000, `tacitExtraction`
  2048→8000, `interviewAnswerMapping` 8192→16000, `agentDemoGeneration` 8192→16000.
- Anthropic 직접 호출 경로는 extended-output beta 헤더 없이 실질 상한이 8192이므로 그 값으로
  clamp — 활성 모델을 Anthropic 직접 호출로 되돌려도 400 에러가 나지 않게 함. OpenRouter/OpenAI/
  Google은 자체적으로 조용히 clamp하므로 uncapped로 둠.

**Why (배경)**: 초기 베이스라인은 단발성 `completeJSON` 호출 방식이었고, 위 수정들은 그 방식의
한계(출력 길이 초과, 파싱 실패)를 땜질한 것. 이 한계가 이후 agent-runtime(tool-calling 루프)
도입의 직접적 동기가 됨 → [03-agent-runtime-reliability-phase1.md](03-agent-runtime-reliability-phase1.md)
