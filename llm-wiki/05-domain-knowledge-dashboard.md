# 05. "도메인 지식" 대시보드 생성 기능

- 시각: 2026-08-21 08:15
- 커밋: `184d3b2` feat(domain-knowledge): 자료 분석 기반 도메인 지식 대시보드 생성 기능 추가
- Claude 세션: `session_01DQkUwd8Q8muRfjTWbPha5k`

## 무엇을 추가했나

자료 수집 & 분석 단계 이후, 대상 기업의 사업/추진 부서/사업 내용/도메인을 컨설팅에 필요한
수준으로 정리하는 **"도메인 지식" 단계**를 신설. Demo UI 생성 패턴을 그대로 따라 LLM(+휴리스틱
폴백)으로 생성하고 self-contained HTML 대시보드로 렌더링, iframe 미리보기 및 다운로드 제공.

- Quest 파이프라인에 `domain_knowledge` 단계 추가 (`docs`와 `interview_questions` 사이) —
  [01-project-overview.md](01-project-overview.md)의 데이터 흐름 다이어그램 참고.
- 자료 수집 & 분석 화면에 "1차 인터뷰 질의서 생성" 좌측 버튼 및 좌측 탭 추가.
- 상세 화면에서 생성된 HTML 대시보드를 미리보기(iframe)하고 다운로드 가능.

## 구현 위치

- 서비스: `server/src/services/domainKnowledgeGeneration.ts` (생성 로직, agent-runtime 기반)
- 라우트: `server/src/routes/domainKnowledge.ts`
- 화면: `pages/DomainKnowledge*.tsx`

## 설계 패턴

기존 `agentDemoGeneration`(Demo UI 생성)과 동일한 패턴을 재사용:
1. 자료 분석 결과(`DocumentAnalysis[]`)를 입력으로 LLM 에이전트 루프 실행
2. `submit_result` tool로 구조화된 `DomainKnowledgeContent` 제출
3. LLM 불가 시 문서 grounded 휴리스틱 생성기로 폴백
4. 결과를 self-contained HTML로 렌더링해 iframe 미리보기 + 다운로드 제공

이 기능은 이후 미커밋 작업([06](06-wip-tool-rollout-and-doc-structure-parsing.md))에서
Planning + Filesystem tool(스크래치 워크스페이스, 프로젝트 문서 조회)이 통합됨 — 최초 커밋
시점에는 아직 Phase 2 tool 없이 `submit_result`만 사용하는 상태였음.
