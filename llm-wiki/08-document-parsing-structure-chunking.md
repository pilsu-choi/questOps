# 08. (미커밋, 진행 중) 자료 수집 파이프라인 — 문서 구조 보존 & 청킹 개선

**상태: 2026-08-21 기준 워킹 트리에 아직 커밋되지 않은 변경사항.** 작업 시점 HEAD는
`184d3b2 feat(domain-knowledge): 자료 분석 기반 도메인 지식 대시보드 생성 기능 추가`
(요청자: pschoi@agilesoda.ai). 커밋되면 이 문서 상단에 해시/메시지를 추가하고 상태를 갱신할 것.

[06](06-wip-tool-rollout-and-doc-structure-parsing.md)의 "변경 3 — `fileParsing.ts`: DOCX/PPTX
구조 보존 파싱"과 같은 파일을 다루며 DOCX/PPTX 부분 내용이 겹친다. 이 문서는 그 작업을 포함해
PDF Layout Analysis까지 더 넓게 정리한 버전 — 06의 DOCX/PPTX 섹션이 요약이라면 아래 2)절이
같은 변경의 상세 버전.

## 배경

기존 `documentAnalysis`(문서 분석) 파이프라인은 파일 종류에 관계없이 "원본 → 순수 텍스트 → 글자수 고정 슬라이스" 구조였다.

- `read_document_chunk`/`read_project_document_chunk` tool: `text.slice(offset, offset+chunkSize)` — 문자 인덱스 고정 분할, overlap 없음
- `completeJSON` 폴백 경로: `text.slice(0, 24000)` — 앞 24,000자만 사용
- 파싱 단계(`fileParsing.ts`)도 DOCX는 `mammoth.extractRawText`, PPTX는 슬라이드 XML에서 `<a:t>` 텍스트 런만 이어붙이는 식으로 제목/문단/표/리스트 구조를 전혀 보존하지 않았고, PDF(`pdf-parse`)도 좌표 정보 없이 텍스트만 추출했다.
- OCR/스캔 문서 처리는 전무 (이미지 PDF는 "20자 미만이면 분석 스킵"으로만 우회).

사용자가 제시한 이상적 파이프라인(구조 분석 → Semantic Chunking → Overlap, Layout Analysis → Document Tree → Hierarchical Chunking)에 맞춰 단계적으로 적용 가능성을 평가한 뒤, 비용 대비 효과가 큰 순서로 3단계까지 구현했다. (4단계 OCR은 이번 세션에서 보류)

## 구현 범위

### 1) Overlap + 문단 경계 인식 청킹

**파일**: `server/src/agent-runtime/tools.ts` (`readTextChunk`, `createReadTextChunkTool`), `server/src/agent-runtime/projectDocumentTools.ts`

- 청크 끝을 하드컷 대신, chunkSize 근처(15% 범위 내) 마지막 `\n\n` 문단 경계에서 자르도록 변경. 경계가 청크를 절반 미만으로 줄일 만큼 너무 이르면 하드컷 유지.
- 다음 offset을 청크 끝에서 `overlap`(기본 200자)만큼 당겨서 안내 — 문맥 연속성 확보.
- `read_document_chunk`(documentAnalysis), `read_transcript_chunk`(interviewAnswerMapping), `read_project_document_chunk`(projectDocumentTools) 전부 공용 함수라 자동 적용됨.
- **검증**: 8턴 연속 읽기에서 매 청크가 정확히 200자씩 겹치고 문단 경계에서 잘리는 것 확인.

### 2) DOCX/PPTX 구조 보존

**파일**: `server/src/services/fileParsing.ts`

- **DOCX**: `mammoth.extractRawText` → `mammoth.convertToHtml`로 교체 후, 자체 정규식 변환기(`htmlToStructuredText`)로 `h1~h6 → "#"~"######"`, 목록 → `"- "`, 표 행 → `"| a | b |"`, 문단은 그대로. 서로 다른 블록 사이는 `\n\n`, 같은 목록/표 연속 항목은 `\n`. 이미지는 base64 embedding 없이 비움(`convertImage` 커스텀). 예상 밖 태그로 내용 유실 시를 대비해 순수 텍스트 폴백 안전망 포함.
- **PPTX**: 슬라이드 XML을 `<p:sp>` 도형 단위로 파싱(`shapeToLines`)해 title placeholder(`type="title"/"ctrTitle"`)는 `"# 제목"`, `<a:buChar>`/`<a:buAutoNum>` 있는 문단은 `"- 항목"`, 나머지는 일반 문단. `p:sp`가 없는 슬라이드(표/스마트아트 등)는 기존 방식(전체 텍스트 런 이어붙이기)으로 폴백.
- **검증**: `docx` 패키지로 만든 실제 문서(제목/문단/소제목/리스트)와 합성 PPTX XML(title/bullet/plain paragraph, `p:sp` 없는 표 전용 슬라이드)로 구조가 정확히 보존됨을 확인.

### 3) PDF Layout Analysis

**파일**: `server/src/services/fileParsing.ts` (`extractPdfLayout`, `extractPdfFallback`)

- `pdf-parse`(좌표 없음) → `pdfjs-dist`(신규 의존성, `^4.10.38`)로 교체. 각 텍스트 조각의 위치(x,y)와 폰트 크기(`transform`)를 확보.
- **줄 묶기**(`groupPdfLines`): y좌표가 비슷한 아이템을 한 줄로 클러스터링 (PDF 좌표계 y 증가=위쪽 → y 내림차순 정렬이 읽기 순서).
- **제목 감지**: 문서 내 최빈 폰트 크기(가중치=글자수, `estimateBodyFontSize`)를 본문으로 보고, 비율 1.15/1.4/1.8배 이상이면 `#`/`##`/`###`.
- **문단 병합**: 줄 간격이 본문 평균 줄간격의 1.6배를 넘을 때만 새 문단(`\n\n`)으로 끊음.
- **표 감지**(`splitLineIntoColumns` + `detectPdfTableLines`): 줄 안에서 fontSize 대비 확실히 큰 간격(≥1.8×fontSize)만 "칸 구분"으로 인정하고, 그 칸 구성이 연속된 줄에서 반복되면 표로 판정.
- 실패(암호화/손상 PDF) 시 기존 `pdf-parse` 기반 `extractPdfFallback`으로 폴백.
- 한글 PDF에서 흔한 CID 폰트 대응을 위해 `cMapUrl`/`cMapPacked: true` 설정 (pdfjs-dist 배포판 내 `cmaps/` 디렉토리를 `import.meta.resolve`로 런타임에 찾아 `file://` URL로 전달). `standardFontDataUrl`도 동일한 방식으로 설정. `verbosity: 0`으로 pdfjs 내부 경고가 콘솔에 새지 않게 함.

**설계 중 발견한 함정**: 처음엔 "한 줄에 text item이 2개 이상이면 표"로 판정했는데, 실제 PDF는 커닝 때문에 평범한 한 문장도 여러 item으로 쪼개져 나오는 경우가 흔해 거의 모든 문단이 표로 오탐될 뻔했다. 단어 사이 실제 간격(pdf-lib Helvetica 기준 ~3pt = fontSize×0.278)을 직접 측정해, "칸 구분"은 그보다 훨씬 큰 간격(fontSize×1.8 이상)일 때만 인정하도록 재설계. 이 과정에서 원래 공백 삽입 임계값(fontSize×0.3)이 실제 단어 간격보다 커서 단어가 붙어버리는(`"Thisisajustified..."`) 버그도 함께 발견해 0.15로 수정.

**검증**: 제목/섹션/문단/표를 섞은 합성 PDF, 한 문장을 단어별로 쪼개 실제 PDF 커닝 특성을 흉내낸 합성 PDF 둘 다 정확히 구조화됨을 확인. 손상된 PDF에 대한 폴백 경로도 확인.

### 4) 문서 구조 요약 자동 추출 (목차 탐지 + 오프셋 구조 맵)

**파일**: `server/src/services/textUtils.ts` (`buildDocumentOutline`), `server/src/services/documentAnalysis.ts` (`buildDocPreamble`)

**동기**: 위 1)~3)으로 원문 텍스트에 문단/제목/표 구조가 보존돼도, 에이전틱 경로가 프롬프트에
넣는 건 여전히 문서 앞부분 2000자 미리보기뿐이었다. 모델이 뒷부분 내용(예: 예외처리 절차,
전결기준)이 필요하면 `read_document_chunk`로 offset 0부터 순서대로 탐색해야 했고, 문서가 길면
turn 예산(에이전틱 8턴, [07](07-fanout-parallelization.md) 이후 fan-out 그룹당 5턴) 안에 관심
구간까지 못 미치고 소진될 수 있었다.

`buildDocumentOutline(text)`가 두 단계 폴백으로 "구조 요약"을 만들어 미리보기 옆에 함께 넣는다:

1. **목차 원문 발췌** (`extractTocSection`): `# 목차`/`# 차례`/`Table of Contents` 헤딩을 찾아
   그 뒤 항목들을 그대로 발췌. 다음 실제 섹션 헤딩이 나오거나 빈 줄이 2연속(문단 경계 2번)이면
   목차 블록이 끝난 것으로 판단. 실제 목차가 있는 정형 문서(매뉴얼/제안서)에서 가장 신뢰도
   높은 요약이지만, 항목별 문자 오프셋은 계산하지 않는다(아래 한계 참고).
2. **구조 맵 폴백** (`buildStructureMap`): 목차가 없으면, 위 1)~3)이 파싱 단계에서 이미 남겨둔
   구조 마커(`[[PAGE n]]` / `## Slide n` / `## Sheet: x` / `# 헤딩`)를 훑어
   `"1p (offset=44): 승인권자 및 전결기준"` 형태의 목록을 만든다. **문자 오프셋을 함께 제공**하는
   게 핵심 — 모델이 목록만 보고 `read_document_chunk({ offset: 44 })`로 청크를 순서대로
   탐색하지 않고 원하는 구간에 바로 점프할 수 있다. 문서 종류(페이지/슬라이드/시트/헤딩)에
   따라 마커 우선순위를 다르게 적용해 매체별로 자연스러운 단위를 쓴다. 둘 다 없는(구조 마커가
   전혀 없는) 순수 텍스트는 `undefined`를 반환해 기존처럼 미리보기만으로 진행.
3. 항목 수(60개)/전체 길이(2500자) 상한을 둬 아주 긴 문서에서 요약 자체가 비대해지는 걸 막음.

`documentAnalysis.ts`의 `buildDocPreamble(filename, text, outline)`가 이 결과를
`--- 문서 구조 요약 (자동 추출) ---` 블록으로 프롬프트에 넣고, 안내 문구도 "구조 요약에
offset이 있으면 바로 그 위치로 찾아가라"로 갱신. [07](07-fanout-parallelization.md)의
`documentAnalysis.ts` fan-out 3개 태스크가 이 `buildDocPreamble()`을 공유해 그룹마다 같은
미리보기/구조 요약을 본다.

**검증**: `buildDocumentOutline`을 TOC 있는 문서/페이지 마커 문서(TOC 없음)/슬라이드 문서/구조
없는 순수 텍스트 4가지 입력으로 직접 실행해 각각 목차 원문 발췌·오프셋 포함 구조 맵·오프셋
포함 구조 맵·`undefined`가 나오는 것을 확인. `tsc --noEmit` 통과.

## 공통 검증

- `npx tsc -p tsconfig.json --noEmit` 매 단계 통과.
- 모든 프로토타입/테스트는 `pdf-lib`로 생성한 합성 문서와 임시 스크립트(`src/_scratch_*.ts`)로 진행 후 삭제 — 저장소에 테스트 산출물 남기지 않음.

## 알려진 한계

- **PDF 볼드 감지 불가**: pdfjs-dist의 간이 텍스트 API(`content.styles`)는 폰트 굵기 정보를 안정적으로 주지 않음(서브셋 폰트는 `fontFamily: "sans-serif"` 같은 일반값만 옴). 폰트 크기 비율에만 의존.
- **PDF 회전 페이지 미대응**: `page.rotate` 미반영, 세로/가로 회전된 페이지는 읽기 순서가 깨질 수 있음.
- **PDF 표 병합 셀(rowspan/colspan) 미대응**: 컬럼 x-정렬 휴리스틱 한계.
- **DOCX 리스트**: ordered/unordered 구분 없이 전부 `"- "`로 인코딩(번호 유실). 중첩 리스트(다단계 들여쓰기)는 mammoth가 flat `<li>`를 낼 것으로 가정 — 실제로 깊이 중첩된 `<li>`가 나오면 정규식 파서가 바깥 `</li>`를 잘못 잡을 수 있음(비검증).
- **PPTX 표/스마트아트**: `<p:graphicFrame>` 등 `p:sp`가 아닌 슬라이드는 구조 없이 폴백 텍스트로만 처리.
- **OCR/스캔 문서 미지원**: 4번 항목, 이번 세션에서 보류.
- **목차 추출은 오프셋 없음**: `extractTocSection`은 원문을 그대로 발췌할 뿐, 항목별 문자
  오프셋을 계산하지 않는다(구조 맵 폴백과 달리). 목차가 있는 문서에서도 모델이 특정 장으로
  바로 점프하려면 결국 순차 `read_document_chunk`를 몇 번 더 타야 할 수 있음.
- 실제 프로덕션 문서(복잡한 표, 스캔 혼합 PDF, 실제 한글 폰트 임베딩 PDF)로는 아직 회귀 테스트하지 않음 — 전부 합성 문서/합성 텍스트 기반 검증.

## TODO (후속 작업)

1. **OCR/스캔 문서 지원** (보류된 4번 항목) — `tesseract.js` 자체 구현 vs 외부 OCR API(Upstage/Naver Clova/AWS Textract) 연동 중 선택 필요. 스캔 문서 비중을 먼저 파악하고 우선순위 결정.
2. **실제 문서로 회귀 테스트** — 지금까지는 `pdf-lib`로 만든 합성 문서만 사용. 실제 업로드되는 한글 PDF(임베딩 폰트, 스캔 혼합, 복잡한 표)로 `extractPdfLayout` 품질 확인 필요.
3. **PDF 표 병합 셀 대응** — rowspan/colspan이 있는 표는 현재 컬럼 정렬이 깨져 표로 인식되지 않거나 잘못 분리될 수 있음.
4. **PDF 회전 페이지 대응** — `page.rotate`를 반영해 좌표를 정규화하거나, 최소한 회전된 페이지는 안전하게 폴백하도록 처리.
5. **DOCX 리스트 번호 보존** — ordered list의 번호를 `"1. "`, `"2. "`로 살리는 것 검토 (현재는 전부 `"- "`).
6. **DOCX 중첩 리스트 검증** — 다단계 들여쓰기가 있는 실제 문서로 `htmlToStructuredText`의 `<li>` 정규식이 깨지지 않는지 확인.
7. **PPTX 표/스마트아트 구조화** — 현재 폴백(텍스트 런 이어붙이기)만 되는 `p:graphicFrame`(표) 슬라이드를 표 형태로 구조화할지 검토.
8. **completeJSON 폴백 경로 개선** — agentic 경로 실패 시에만 타는 `buildUserPrompt`의 `text.slice(0, 24000)` 하드컷은 여전히 구조 정보를 활용하지 않음. 우선순위는 낮음(agentic이 대부분 처리).
9. **xlsx 패키지 기존 취약점 트래킹** — `npm audit`에서 노출된 `xlsx`의 high severity 취약점(GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9, 패치 없음). 이번 작업과 무관하지만 별도로 다뤄야 함.
10. **PDF 헤딩 판정 임계값 튜닝** — 폰트 크기 비율 1.15/1.4/1.8 및 문단 줄간격 배수 1.6은 합성 문서 기준으로 정한 값. 실제 문서 다수로 검증 후 조정 필요.
11. **목차 항목에도 오프셋 부여 검토** — 위 4)절 한계의 목차-오프셋 미지원 문제 해결안. 목차 각
    줄의 제목 텍스트를 본문에서 재검색(`indexOf`)해 가장 가까운 위치를 오프셋으로 붙이는 방식
    검토 가능(단, 목차 제목과 본문 헤딩 표기가 다르면 매칭 실패 가능).
12. **`buildDocumentOutline`의 실제 문서 회귀 테스트** — 지금까지는 합성 텍스트 4종(TOC
    있음/페이지 마커만/슬라이드/구조 없음)으로만 검증. 실제 업로드 문서로 구조 요약 품질 확인
    필요(2번 항목과 함께 진행 가능).
