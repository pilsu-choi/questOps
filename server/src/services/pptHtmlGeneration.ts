import type { PresentationSlide } from "../types.js";

function esc(input: unknown): string {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderSlideBody(slide: PresentationSlide): string {
  switch (slide.layout) {
    case "title":
      return `<div class="slide-title-layout">
        <div class="kicker">QUEST OPS</div>
        <h1>${esc(slide.title)}</h1>
        ${slide.subtitle ? `<p class="subtitle">${esc(slide.subtitle)}</p>` : ""}
      </div>`;
    case "process":
      return `<h2>${esc(slide.title)}</h2>
      <div class="process-row">
        ${(slide.bullets || [])
          .map(
            (b, i) => `<div class="process-step">
              <div class="step-num">${i + 1}</div>
              <p>${esc(b)}</p>
            </div>${i < (slide.bullets || []).length - 1 ? '<div class="step-arrow">→</div>' : ""}`
          )
          .join("")}
      </div>`;
    case "table":
      return `<h2>${esc(slide.title)}</h2>
      <table class="slide-table">
        <thead><tr>${(slide.table?.headers || []).map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
        <tbody>${(slide.table?.rows || []).map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>`;
    case "two-column":
      return `<h2>${esc(slide.title)}</h2>
      <div class="two-col">
        ${(slide.columns || [])
          .map(
            (c) => `<div class="col-card">
              <h3>${esc(c.title)}</h3>
              <ul>${c.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
            </div>`
          )
          .join("")}
      </div>`;
    case "closing":
      return `<div class="slide-title-layout dark">
        <h1>${esc(slide.title)}</h1>
        <ul class="closing-list">${(slide.bullets || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
      </div>`;
    default:
      return `<h2>${esc(slide.title)}</h2>
      <ul class="bullet-list">${(slide.bullets || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`;
  }
}

export function renderPresentationHtml(meta: { projectName: string; client: string }, slides: PresentationSlide[]): string {
  const slideSections = slides
    .map(
      (s, i) => `<section class="slide${s.layout === "title" || s.layout === "closing" ? " dark-slide" : ""}" data-slide="${i}" ${i === 0 ? "" : "hidden"}>
        <div class="slide-inner">${renderSlideBody(s)}</div>
        <div class="slide-footer"><span>${esc(meta.projectName)}</span><span>${i + 1} / ${slides.length}</span></div>
      </section>`
    )
    .join("");

  const dots = slides.map((_, i) => `<button class="dot${i === 0 ? " active" : ""}" data-goto="${i}"></button>`).join("");

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.projectName)} · 발표자료</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root{--navy:#0A0F1E;--navy2:#0F172A;--accent:#5B62E8;--accent-light:#EEF1FF;--text:#14181F;--muted:#64748B;--border:#E2E8F0;}
  *{box-sizing:border-box}
  html,body{height:100%;margin:0}
  body{font-family:"Noto Sans KR","Pretendard",-apple-system,BlinkMacSystemFont,system-ui,sans-serif;background:#1E293B;color:var(--text);overflow:hidden}
  .stage{position:relative;width:100vw;height:100vh;display:flex;align-items:center;justify-content:center}
  .slide{position:absolute;inset:0;background:#fff;display:flex;flex-direction:column;padding:0}
  .slide.dark-slide{background:var(--navy)}
  .slide-inner{flex:1;padding:64px 80px;display:flex;flex-direction:column;justify-content:center;overflow:auto}
  .slide h1{font-size:40px;font-weight:800;margin:0 0 12px;color:inherit}
  .slide h2{font-size:24px;font-weight:800;margin:0 0 28px;color:var(--navy2)}
  .kicker{font-size:12px;font-weight:700;letter-spacing:.12em;color:var(--accent);margin-bottom:14px}
  .subtitle{font-size:17px;color:var(--muted);margin:0}
  .slide-title-layout{color:var(--navy2)}
  .slide-title-layout.dark{color:#fff}
  .slide-title-layout.dark h1{color:#fff}
  .bullet-list,.closing-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:14px}
  .bullet-list li,.closing-list li{font-size:17px;line-height:1.6;padding-left:20px;position:relative;color:#334155}
  .bullet-list li::before{content:'';position:absolute;left:0;top:9px;width:6px;height:6px;border-radius:50%;background:var(--accent)}
  .closing-list{color:#E2E8F0}
  .closing-list li{padding-left:24px}
  .closing-list li::before{content:'→';position:absolute;left:0;top:0;color:#818CF8;background:none;width:auto;height:auto;border-radius:0}
  .process-row{display:flex;align-items:stretch;gap:10px;flex-wrap:wrap}
  .process-step{flex:1;min-width:150px;background:#F8FAFC;border:1px solid var(--border);border-radius:12px;padding:16px}
  .step-num{width:26px;height:26px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;margin-bottom:10px}
  .process-step p{font-size:13.5px;line-height:1.5;margin:0;color:#334155}
  .step-arrow{display:flex;align-items:center;color:#CBD5E1;font-size:18px}
  .slide-table{width:100%;border-collapse:collapse;font-size:14px}
  .slide-table th{background:var(--navy2);color:#fff;text-align:left;padding:10px 12px;font-size:12.5px}
  .slide-table td{padding:10px 12px;border-bottom:1px solid var(--border);color:#334155}
  .two-col{display:grid;grid-template-columns:1fr 1fr;gap:22px}
  .col-card{background:#F8FAFC;border:1px solid var(--border);border-radius:12px;padding:20px}
  .col-card h3{font-size:15px;margin:0 0 10px;color:var(--accent)}
  .col-card ul{margin:0;padding-left:18px;font-size:13.5px;color:#334155;line-height:1.7}
  .slide-footer{flex:none;display:flex;justify-content:space-between;padding:14px 80px;font-size:11px;color:var(--muted);border-top:1px solid var(--border)}
  .slide.dark-slide .slide-footer{color:#64748B;border-top-color:#1E293B}
  .nav-btn{position:fixed;top:50%;transform:translateY(-50%);width:42px;height:42px;border-radius:50%;background:rgba(255,255,255,.9);border:1px solid var(--border);cursor:pointer;font-size:16px;color:var(--navy2);z-index:10;display:flex;align-items:center;justify-content:center}
  .nav-btn:hover{background:#fff}
  .nav-prev{left:20px}.nav-next{right:20px}
  .dots{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);display:flex;gap:6px;z-index:10}
  .dot{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.35);border:none;cursor:pointer;padding:0}
  .dot.active{background:#fff}
</style>
</head>
<body>
  <div class="stage">
    ${slideSections}
  </div>
  <button class="nav-btn nav-prev" data-nav="-1">‹</button>
  <button class="nav-btn nav-next" data-nav="1">›</button>
  <div class="dots">${dots}</div>

<script>
(function(){
  var slides = Array.prototype.slice.call(document.querySelectorAll('[data-slide]'));
  var dots = Array.prototype.slice.call(document.querySelectorAll('[data-goto]'));
  var current = 0;
  function show(i){
    current = Math.max(0, Math.min(slides.length - 1, i));
    slides.forEach(function(s, idx){ s.hidden = idx !== current; });
    dots.forEach(function(d, idx){ d.classList.toggle('active', idx === current); });
  }
  document.querySelectorAll('[data-nav]').forEach(function(btn){
    btn.addEventListener('click', function(){ show(current + parseInt(btn.getAttribute('data-nav'), 10)); });
  });
  dots.forEach(function(d){ d.addEventListener('click', function(){ show(parseInt(d.getAttribute('data-goto'), 10)); }); });
  window.addEventListener('keydown', function(e){
    if (e.key === 'ArrowRight' || e.key === ' ') show(current + 1);
    if (e.key === 'ArrowLeft') show(current - 1);
  });
  show(0);
})();
</script>
</body>
</html>`;
}
