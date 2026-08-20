import type { DomainKnowledgeContent } from "../types.js";

function esc(input: unknown): string {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function list(items: string[]): string {
  if (!items.length) return `<div class="empty">확인된 내용이 없습니다.</div>`;
  return `<ul class="item-list">${items.map((v) => `<li>${esc(v)}</li>`).join("")}</ul>`;
}

function chips(items: string[]): string {
  if (!items.length) return `<div class="empty">확인된 내용이 없습니다.</div>`;
  return `<div class="chip-row">${items.map((v) => `<span class="chip">${esc(v)}</span>`).join("")}</div>`;
}

export function renderDomainKnowledgeHtml(
  meta: { projectName: string; client: string },
  content: DomainKnowledgeContent
): string {
  const departments = content.drivingDepartments.length
    ? `<div class="dept-grid">${content.drivingDepartments
        .map((d) => `<div class="dept-card"><div class="dept-name">${esc(d.name)}</div><p class="dept-role">${esc(d.role)}</p></div>`)
        .join("")}</div>`
    : `<div class="empty">확인된 내용이 없습니다.</div>`;

  const glossary = content.glossary.length
    ? `<div class="glossary-grid">${content.glossary
        .map((g) => `<div class="gloss-item"><div class="gloss-term">${esc(g.term)}</div><p class="gloss-def">${esc(g.definition)}</p></div>`)
        .join("")}</div>`
    : `<div class="empty">확인된 내용이 없습니다.</div>`;

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.projectName)} · 도메인 지식 대시보드</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root{--navy:#0A0F1E;--accent:#5B62E8;--accent-light:#EEF1FF;--text:#14181F;--muted:#64748B;--border:#E2E8F0;--bg:#F6F7FB;}
  *{box-sizing:border-box}
  body{margin:0;font-family:"Noto Sans KR","Pretendard",-apple-system,BlinkMacSystemFont,system-ui,sans-serif;background:var(--bg);color:var(--text)}
  .topbar{background:var(--navy);color:#fff;padding:14px 28px;display:flex;align-items:center;justify-content:space-between}
  .topbar .brand{font-weight:800;font-size:13px;letter-spacing:.02em}
  .topbar .meta{font-size:12px;color:#94A3B8}
  .wrap{max-width:1120px;margin:0 auto;padding:28px}
  .hero{background:#fff;border:1px solid var(--border);border-radius:14px;padding:22px 24px;margin-bottom:22px;box-shadow:0 1px 2px rgba(15,23,42,.04)}
  .hero-kicker{font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--muted);text-transform:uppercase;margin-bottom:8px}
  .hero-title{font-size:20px;font-weight:800;margin-bottom:10px}
  .hero-body{font-size:14px;color:#334155;line-height:1.75;max-width:78ch}
  .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:18px;margin-bottom:18px}
  @media(max-width:820px){.grid{grid-template-columns:1fr}}
  .card{background:#fff;border:1px solid var(--border);border-radius:12px;padding:18px 20px}
  .card-title{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:0 0 12px;display:flex;align-items:center;gap:8px}
  .card.wide{grid-column:1/-1}
  .card.warn{background:#FFFBEB;border-color:#FDE68A}
  .item-list{margin:0;padding-left:18px;font-size:13.5px;color:#1E293B;line-height:1.8}
  .item-list li{margin-bottom:2px}
  .empty{font-size:13px;color:#94A3B8}
  .chip-row{display:flex;flex-wrap:wrap;gap:6px}
  .chip{background:var(--accent-light);color:#3D3CB5;font-size:12.5px;font-weight:600;padding:5px 11px;border-radius:999px}
  .dept-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
  .dept-card{background:#F8FAFC;border-radius:10px;padding:12px 14px}
  .dept-name{font-size:13.5px;font-weight:700;margin-bottom:4px}
  .dept-role{font-size:12.5px;color:var(--muted);line-height:1.6;margin:0}
  .glossary-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}
  .gloss-item{background:#F8FAFC;border-radius:10px;padding:12px 14px}
  .gloss-term{font-size:13px;font-weight:700;color:#3D3CB5;margin-bottom:3px}
  .gloss-def{font-size:12.5px;color:#334155;line-height:1.6;margin:0}
  .footer-note{margin-top:20px;font-size:11.5px;color:#94A3B8;text-align:center}
</style>
</head>
<body>
  <div class="topbar">
    <span class="brand">QUEST OPS · DOMAIN KNOWLEDGE</span>
    <span class="meta">${esc(meta.projectName)} · ${esc(meta.client)}</span>
  </div>
  <div class="wrap">
    <div class="hero">
      <div class="hero-kicker">사업 개요 (Company Overview)</div>
      <div class="hero-title">${esc(meta.projectName)}</div>
      <p class="hero-body">${esc(content.companyOverview)}</p>
    </div>

    <div class="grid">
      <div class="card">
        <div class="card-title">사업 도메인 (Business Domain)</div>
        <p class="hero-body" style="font-size:13.5px">${esc(content.businessDomain)}</p>
      </div>
      <div class="card">
        <div class="card-title">핵심 도메인 키워드</div>
        ${chips(content.domainKeywords)}
      </div>

      <div class="card wide">
        <div class="card-title">사업 추진 부서 (Driving Departments)</div>
        ${departments}
      </div>

      <div class="card">
        <div class="card-title">사업 내용 / 추진 범위</div>
        ${list(content.businessScope)}
      </div>
      <div class="card">
        <div class="card-title">관련 시스템</div>
        ${chips(content.keySystems)}
      </div>

      <div class="card wide">
        <div class="card-title">용어집 (Glossary)</div>
        ${glossary}
      </div>

      <div class="card">
        <div class="card-title">도메인 규칙 / 기준</div>
        ${list(content.domainRules)}
      </div>
      <div class="card">
        <div class="card-title">이해관계자</div>
        ${chips(content.stakeholders)}
      </div>

      <div class="card wide">
        <div class="card-title">리스크 및 고려사항</div>
        ${list(content.risksAndConsiderations)}
      </div>

      <div class="card wide warn">
        <div class="card-title">추가 확인 필요 (Open Questions)</div>
        ${list(content.openQuestions)}
      </div>
    </div>

    <div class="footer-note">Quest Ops에서 자동 생성된 도메인 지식 대시보드입니다. 문서 분석 결과를 근거로 하며, 확정 전 인터뷰로 검증이 필요합니다.</div>
  </div>
</body>
</html>`;
}
