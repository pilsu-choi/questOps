# 09. dev 서버 "빈 화면" 원인 조사 — tsx watch 재시작 + 프론트 에러 처리 누락

**상태: 2026-08-21 기준 워킹 트리에 아직 커밋되지 않은 변경사항.** 대상 파일:
`server/package.json`, `web/src/pages/DocumentsAnalysis.tsx`. 커밋되면 이 문서 상단에
해시/메시지를 추가하고 상태를 갱신할 것.

## 배경 (사용자 리포트)

사용자가 "자료 수집" 단계에서 문서 8개를 한꺼번에 업로드한 뒤 "자료 수집 & 분석" 화면에
들어가니 빈 화면이 나온다고 보고. "서버가 터지는 것 같다", "큐 시스템을 넣어야 하나"라고 질문.

## 조사 결과

1. 업로드 API(`routes/documents.ts`)는 파일마다 텍스트 추출만 순차 `await`하고, 실제 LLM
   분석(`runAnalysis`)은 `await` 없는 fire-and-forget이라 **문서 간 동시 실행 수 제한이
   없음** — [07-fanout-parallelization.md](07-fanout-parallelization.md)가 "문서 여러 건을
   한꺼번에 업로드하는 케이스에서 문서 간 무제한 병렬성 × 문서 내부 fan-out(최대 3)이 겹쳐
   provider rate limit(429)에 더 잘 걸릴 가능성 — 아직 실측 안 됨"으로 이미 플래그해 둔 지점과
   정확히 같은 코드 경로.
2. 하지만 이번 "빈 화면" 재현의 **1차 원인은 fan-out/rate-limit이 아니라 개발 서버 자체의
   재시작**으로 확인됨. `server/package.json`의 `dev` 스크립트(`tsx watch`)가 `--ignore`/
   `--exclude` 없이 기본 설정으로 돌아, 업로드 파일 저장 위치(`server/uploads/`)와 SQLite
   DB(`server/data/`, WAL 모드) 변경까지 "소스 코드 변경"으로 오인해 프로세스를 재시작함.
   파일 8개를 한꺼번에 올리면 파일 쓰기 + 문서 상태(`analyzing→analyzed`) DB 갱신이 몰려
   재시작이 잦아지고, 재시작 도중이던 요청은 끊기며 진행 중이던 fire-and-forget 분석도 함께
   유실됨.
3. 부가 원인: `web/src/pages/DocumentsAnalysis.tsx`의 `load()`에 에러 처리가 없어, 위 재시작
   등으로 `GET /documents` 요청이 한 번 실패하면 `docs` state가 계속 `null`로 남아 에러 표시
   없이 무한 로딩 스피너만 보임 — 사용자에게는 "빈 화면"으로 보이는 직접 원인.

## 수정

- `server/package.json`: dev 스크립트에 `--exclude "**/uploads/**" --exclude "**/data/**"`
  추가. 로컬에서 별도 포트(8799)로 서버를 띄운 뒤 두 디렉터리에 실제로 파일을 써서 재시작이
  더 이상 발생하지 않음을 확인(로그에 `listening` 라인이 한 번만 찍힘).
- `web/src/pages/DocumentsAnalysis.tsx`: `load()`를 try/catch로 감싸고 `loadError` state를
  추가. 실패 시 "문서 목록을 불러오지 못했습니다: ..." 에러 배너 + "다시 시도" 버튼을
  렌더링하도록 변경(기존에는 `docs === null`일 때 무조건 스피너만 표시).

## 아직 남은 것

- [07](07-fanout-parallelization.md)이 플래그한 "문서 간 동시성 무제한" 자체는 이번에 손대지
  않음 — 여전히 유효한 개선 여지(큐/세마포어로 문서 간 동시 분석 수 제한). 사용자에게는 이번
  "빈 화면" 재현의 근본 원인은 아니라고 설명했고, 필요 시 별도 작업으로 진행하기로 함.
- 이번 수정은 dev 환경(`npm run dev`/`tsx watch`) 한정. 프로덕션 빌드(`npm start` →
  `node dist/index.js`)는 애초에 파일 watch를 하지 않으므로 영향 없음.
