# 04. agent-runtime Phase 2 — Planning + Filesystem tool (documentAnalysis/pptGeneration 파일럿)

- 기간: 2026-08-21 06:59 ~ 07:40
- 관련 스펙: `docs/superpowers/specs/2026-08-21-agent-runtime-planning-filesystem-design.md`
- 관련 계획: `docs/superpowers/plans/2026-08-21-agent-runtime-planning-filesystem.md`
- 병합 커밋: `97b2103`

## 배경 (스펙에서)

Phase 1([03](03-agent-runtime-reliability-phase1.md))으로 신뢰성(재시도/자기교정/컨텍스트
안전장치)은 개선됐지만, 산출물 **품질**은 별개 문제로 남음. 6개 서비스 전부 "생성 품질이
균일하게 약함" — 청크 tool을 안 쓰는 짧은 입력 서비스(`tacitExtraction`, `interviewGeneration`)도
마찬가지로 약해서, 원인은 "원문이 길어서 다 못 담는다"가 아니라 **"제출 전에 계획하고 초안을
쓰고 다듬는 과정이 없다"**는 구조적 문제로 판단.

구체적 버그성 증상: `loop.ts`의 `truncateForHistory`가 assistant 텍스트를 히스토리에 2000자로
자름(`MAX_ASSISTANT_TEXT_CHARS_IN_HISTORY`) → 모델이 `submit_result` 전에 긴 초안을 텍스트로
쓰면 다음 턴엔 대부분 잘려 사라짐 — 품질 저하의 직접 원인 중 하나.

**참고**: openClaw(`ref_projects/openclaw`) 실제 소스에는 `read_file`/`write_file`/`todo_write`
tool 구현이 없음(외부 코딩 에이전트 CLI를 오케스트레이션하는 개인 비서 플랫폼). 따라서 이번
Planning/Filesystem tool은 openClaw 코드 참고가 아니라, Claude Code류 코딩 에이전트가 쓰는 표준
패턴(TodoWrite, Read/Write/Edit)을 QuestOps 사용 사례에 맞게 새로 설계한 것.

## 목표 (documentAnalysis, pptGeneration 파일럿 한정)

1. **Planning** — `update_plan` tool을 1턴째에 강제 호출시켜, 모델이 무엇을 할지 먼저 정리하고
   이후 턴에서 스스로 참조하게 함.
2. **Filesystem — 실행별 스크래치 워크스페이스** — `write_scratch_file`/`read_scratch_file`/
   `list_scratch_files`. `truncateForHistory`가 자르지 않는 별도 저장소에 초안을 쓰고 다시
   읽으며 다듬을 수 있음.
3. **Filesystem — 같은 프로젝트의 다른 문서 접근** — `list_project_documents`/
   `read_project_document_chunk`. 처음 프롬프트에 안 넣어준 같은 프로젝트 다른 자료를 모델이
   필요시 스스로 조회.

효과 검증되면 나머지 4개 서비스로 확산은 **이 스펙 밖의 후속 작업** → 실제로 미커밋 상태로
진행 중, [06-wip-tool-rollout-and-doc-structure-parsing.md](06-wip-tool-rollout-and-doc-structure-parsing.md) 참고.

## 비목표

- 모델의 동적 서브에이전트 스폰 (정적 fan-out으로 충분, Phase1에서 이미 추가).
- 요약 기반 컨텍스트 컴팩션.
- 임의 경로 파일시스템 접근(경로 파라미터 받는 범용 `read_file`) — 스크래치 워크스페이스는
  실행별 격리 디렉토리 안의 단순 파일명만 허용, 프로젝트 문서 접근은 경로가 아니라 `documents`
  테이블을 `project_id`로 스코프한 DB 조회로만 이뤄짐 (경로 탈출 위험 구조적으로 없음).
- documentAnalysis/pptGeneration 외 나머지 4개 서비스는 이 스펙에서 미수정.

## 개별 커밋

- `d638011` — Phase 2 스펙+계획 작성.
- `e9605e1` — 계획 결함 수정(Task 6 Step 3의 elided 코드 스니펫 → 완전한 before/after 블록).
- `0b3d29b` — `update_plan` tool 추가, tool 이름 상수화, `readTextChunk` 공유 함수로 추출
  (`createReadTextChunkTool`과 `read_project_document_chunk` 양쪽이 공유).
- `6c7259a` — 1턴째 `update_plan` 강제 호출, tool 이름 상수 사용.
- `3c700b2` — 실행별 스크래치 워크스페이스 tool(`write`/`read`/`list_scratch_file`) 추가.
- `fc07582` — `scratchTools.ts` execute 시그니처를 브리프대로 필수 인자로 되돌리는 수정.
- `6fe981f` — 프로젝트 범위 문서 목록/청크 조회 tool 추가 (`projectDocumentTools.ts`).
- `402d1db` — documentAnalysis에 planning/scratch/project-document tool 통합, maxTurns 8로 상향.
- `16267cc` — pptGeneration에 동일 통합, maxTurns 6으로 상향.
- `9526506` — 최종 리뷰 대응: 스크래치 tool 프롬프트 넛지, 1턴째 forceTool 폴백, plan을 보존하는
  shrink 임계값.

## 병합 — `97b2103`

6-task 구현, `docs/superpowers/plans/2026-08-21-agent-runtime-planning-filesystem.md` 기준,
subagent-driven-development로 태스크별 리뷰 + 전체 브랜치 최종 리뷰(Important 3건, 모두 수정 후
재검토 통과) 거쳐 main 병합.

## 관련 파일

`server/src/agent-runtime/{tools.ts, scratchTools.ts, projectDocumentTools.ts, loop.ts, fanOut.ts, log.ts, types.ts}`
