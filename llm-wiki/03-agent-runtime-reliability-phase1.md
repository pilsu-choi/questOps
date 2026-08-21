# 03. agent-runtime 도입 + Phase 1 고도화 (신뢰성/재시도/fan-out)

- 기간: 2026-08-21 00:46 ~ 06:30
- 관련 스펙: `docs/superpowers/specs/2026-08-21-agent-runtime-advanced-techniques-design.md`
- 관련 계획: `docs/superpowers/plans/2026-08-21-agent-runtime-advanced-techniques.md`
- 병합 커밋: `213cd0e`

## `b1619de` — 구조화 출력 생성 서비스에 agentic tool-calling 루프 도입

기존 단발성 `completeJSON` 방식(→ [02](02-baseline-and-infra-fixes.md)의 땜질들)을 대체/보완하기
위해 최소 agent-runtime 도입:

- `agent-runtime/loop.ts`, `types.ts`, `tools.ts`, `log.ts` 신설. openClaw(`ref_projects/openclaw`)의
  agent-loop 패턴을 참고했지만, steering/서브에이전트/컨텍스트 컴팩션 없이 **명시적 maxTurns
  상한만 둔 최소 구현**.
- `submit_result` tool(zod 스키마 기반 자기교정) + 청크 단위 텍스트 읽기 tool.
- 6개 생성 서비스(demo, interview, answer mapping, ppt, tacit extraction, document analysis)에
  기존 단일턴 `completeJSON` 플로우와 **나란히 opt-in 경로**로 연결.
- 구조화 실행 로깅(`agent_run_logs` 테이블) + debug 레벨 로거 추가.

## Phase 1 스펙 배경 (advanced-techniques-design.md)

`agent-runtime/`은 최소 구현(`loop.ts` 138줄, `types.ts` 47줄, `tools.ts` 49줄, `log.ts` 27줄)
이었음. 실제 호출부는 6곳 모두 3~6턴 안에 `submit_result`로 끝나는 단발성 구조화 출력
생성기라, openClaw(상시 세션·멀티채널·동적 서브에이전트 스폰을 가진 완성형 플랫폼)를 통째로
이식하지 않고 QuestOps의 "유한 턴·구조화 출력" 특성에 맞는 3가지 기법만 적용:

1. 자기교정/재시도 정교화
2. 서브에이전트 fan-out (프리미티브만 추가, 실제 서비스 적용은 후속 작업)
3. 컨텍스트 관리 안전장치

**비목표**(의도적으로 안 한 것): 모델이 스스로 서브에이전트를 동적 스폰하는 tool(비용/턴수
예측 불가 위험), 요약 기반 컨텍스트 컴팩션(3~6턴 루프에는 비용 대비 이득 낮음), steering 큐/상시
세션/멀티채널.

## 개별 커밋

- `5a29aed` — Task 8 계획 결함 수정 (`runAgentLoop` 헤더 주석 관련 사전 스캔 오류 발견 후 정정).
- `8e86941` — `submit_result` 검증 실패를 `isValidationError` 플래그로 표시.
- `b9333ae` — tool-calling 요청에 재시도 가능한 전송 오류(429/500/502/503/504, timeout) 백오프
  재시도 추가. `stepWithTools` 내부에 캡슐화, `loop.ts`의 턴 카운트/결과 형태는 불변. 지수
  백오프+지터(`base=500ms`, `jitterMs=250ms`, 최대 3회 시도).
- `6e99a0b` — `stepWithTools`에 `forceTool`(강제 `tool_choice`) 파라미터 추가.
- `1fe2ae4` — 누적 히스토리 크기 안전장치: 오래된 tool 결과부터 축소. `MAX_HISTORY_CHARS`
  초과 시 트리거, 계획/스크래치 확인처럼 이미 짧은 결과(`MIN_SHRINKABLE_CONTENT_CHARS` 미만)는
  건드리지 않음 — 1턴째 계획이 제일 먼저 지워지는 걸 방지.
- `8a72552` — `submit_result` 연속 검증 실패 예산을 턴 예산과 분리 (`MAX_CONSECUTIVE_VALIDATION_FAILURES`).
- `23aaf03` — 턴/검증 예산 소진 직전 강제 제출 "구제 턴"(rescue turn) 1회 추가
  (`RESCUE_NUDGE`: "더 이상 조사를 진행할 수 없다. 지금까지 확인한 내용을 바탕으로 최선을 다해
  submit_result를 호출해 제출하라").
- `ce78de9` — 정적 서브에이전트 fan-out 프리미티브(`runFanOutAgents`, `agent-runtime/fanOut.ts`)
  추가. 호출부(서비스 코드)가 항상 정적으로 병렬 서브태스크를 선언 — 모델이 스스로 스폰하지 않음.
- `27806f4` — 헤더 주석을 fan-out/재시도/구제 턴 도입 이후 상태로 갱신.
- `348d25a` — 최종 리뷰 대응: 재시도 로깅, 구제 턴 컨텍스트 가드, 구제 턴 에러 가시성.

## 그 외 알아둘 안전장치 (loop.ts)

- `MAX_CONSECUTIVE_NO_TOOL_CALL_TURNS = 2` — 일부 OpenRouter 모델이 tool 지원을 광고하면서도
  reasoning에서만 "tool 호출하겠다"고 말하고 실제로는 안 하는 경우, maxTurns까지 기다리지 않고
  조기 종료.
- `MAX_ASSISTANT_TEXT_CHARS_IN_HISTORY = 2000` — 어시스턴트 텍스트는 히스토리에 2000자로 잘려
  저장됨 (이 제약이 이후 Phase 2 스크래치 워크스페이스 도입의 직접적 동기가 됨 →
  [04](04-agent-runtime-planning-filesystem-phase2.md)).
- `RUNAWAY_RESPONSE_CHARS = 100_000` — 일부 OpenRouter 라우팅이 `max_tokens`를 사실상 무시하고
  수십만~수백만 자 응답을 낼 때, 정상적인 tool-calling 응답일 리 없다는 신호로 즉시 종료.

## 병합 — `213cd0e`

8-task 구현, `docs/superpowers/plans/2026-08-21-agent-runtime-advanced-techniques.md` 기준,
subagent-driven-development로 태스크별 리뷰 + 전체 브랜치 최종 리뷰(Important 3건, 모두 수정 후
재검토 통과) 거쳐 main 병합.
