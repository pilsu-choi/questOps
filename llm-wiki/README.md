# Quest Ops — llm-wiki

`AGENTS.md` 지침("모든 작업 내용은 llm-wiki에 내용을 정리해서 히스토리를 보존해라")에 따라
작업 히스토리를 주제/시기 단위로 정리한 위키입니다. 세션이 바뀌어도 git log를 처음부터
다시 읽지 않고 이 폴더만으로 지금까지의 결정과 이유를 파악할 수 있게 하는 것이 목적입니다.

새 작업을 마치면 관련 문서를 갱신하거나 새 번호로 문서를 추가하세요. 커밋 해시를 인용해두면
필요할 때 `git show <hash>`로 상세 diff를 바로 확인할 수 있습니다.

## 목차

| 문서 | 범위 |
|---|---|
| [01-project-overview.md](01-project-overview.md) | Quest Ops 프로젝트 개요 — 목적, 아키텍처, 데이터 흐름 |
| [02-baseline-and-infra-fixes.md](02-baseline-and-infra-fixes.md) | 초기 커밋(베이스라인) + 인프라/버그 수정 (worktree 포트, 파일명 mojibake, LLM 출력 잘림) |
| [03-agent-runtime-reliability-phase1.md](03-agent-runtime-reliability-phase1.md) | agent-runtime 도입 + Phase 1 고도화 (재시도/백오프, 검증 예산, 구제 턴, 컨텍스트 안전장치, fan-out) |
| [04-agent-runtime-planning-filesystem-phase2.md](04-agent-runtime-planning-filesystem-phase2.md) | agent-runtime Phase 2 — Planning(`update_plan`) + Filesystem(스크래치 워크스페이스, 프로젝트 문서 조회) tool, documentAnalysis/pptGeneration 파일럿 |
| [05-domain-knowledge-dashboard.md](05-domain-knowledge-dashboard.md) | "도메인 지식" 대시보드 생성 기능 (신규 파이프라인 단계) |
| [06-wip-tool-rollout-and-doc-structure-parsing.md](06-wip-tool-rollout-and-doc-structure-parsing.md) | **(미커밋, 진행 중)** Phase 2 tool을 나머지 4개 서비스로 확산 + plan 이력 저장 + 청크 문단 경계 개선 + DOCX/PPTX 구조 보존 파싱 |
| [07-fanout-parallelization.md](07-fanout-parallelization.md) | **(미커밋, 진행 중)** 5개 생성 파이프라인(인터뷰/도메인지식/Demo UI/PPT/문서분석)을 통짜 순차 생성에서 그룹별 fan-out 병렬 생성으로 전환, 실LLM 검증 |
| [08-document-parsing-structure-chunking.md](08-document-parsing-structure-chunking.md) | **(미커밋, 진행 중)** 자료 수집 파이프라인 — 청킹 문단 경계/overlap, DOCX/PPTX 구조 보존(06과 일부 중복), PDF Layout Analysis(`pdfjs-dist`), 목차 탐지 + 오프셋 구조 맵 자동 추출 |
| [09-dev-watch-restart-and-frontend-error-handling.md](09-dev-watch-restart-and-frontend-error-handling.md) | **(미커밋, 진행 중)** 다중 파일 업로드 시 "빈 화면" 원인 조사 — tsx watch가 uploads/DB 변경에 반응해 재시작하던 문제 + 프론트 에러 처리 누락 수정 |

## 빠른 타임라인

```
2026-08-20 21:05  초기 커밋 (Quest Ops 베이스라인, React+Vite / Express+SQLite)
2026-08-20 21:06~21:18  worktree 병행 개발 지원, 파일명 mojibake 수정
2026-08-20 21:26~21:28  LLM JSON 출력 잘림 수정, max_tokens 상향
2026-08-21 00:46~01:26  agent-runtime 도입 + Phase1(재시도/구제턴/컨텍스트 안전장치/fan-out)
2026-08-21 06:30        Phase1 머지
2026-08-21 06:59~07:36  agent-runtime Phase2(Planning+Filesystem tool, documentAnalysis/pptGeneration 파일럿)
2026-08-21 07:40        Phase2 머지
2026-08-21 08:15        도메인 지식 대시보드 생성 기능 추가
(미커밋)                 Phase2 tool을 나머지 4개 서비스로 확산 + 문서 구조 보존 파싱
(미커밋)                 5개 생성 파이프라인 fan-out 병렬화 (인터뷰→도메인지식/Demo UI/PPT/문서분석 순 확장) + 실LLM 검증
(미커밋)                 자료 수집 파이프라인 청킹/DOCX·PPTX/PDF Layout Analysis 심화 + 목차/오프셋 구조 맵 자동 추출 (별도 세션, fileParsing.ts/textUtils.ts)
(미커밋)                 dev 서버 "빈 화면" 원인 조사 — tsx watch 재시작 수정 + 프론트 에러 처리
```
