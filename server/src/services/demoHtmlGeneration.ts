import type { AgentConcept, DemoScreen, DemoScenario } from "../types.js";

function esc(input: unknown): string {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const STATUS_LABEL: Record<string, string> = {
  confirmed: "Confirmed",
  ai_inferred: "AI Inferred",
  need_confirmation: "Need Confirmation"
};
const STATUS_CLASS: Record<string, string> = {
  confirmed: "badge-neutral",
  ai_inferred: "badge-accent",
  need_confirmation: "badge-outline"
};
const ACTOR_LABEL: Record<string, string> = { agent: "AGENT", human: "HUMAN", system: "SYSTEM" };

function renderMockValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `<ul class="mock-list">${value.map((v) => `<li>${esc(v)}</li>`).join("")}</ul>`;
  }
  return `<div class="mock-value">${esc(value)}</div>`;
}

function renderScreenPanel(screen: DemoScreen): string {
  const rows = Object.entries(screen.mockData || {})
    .map(([k, v]) => `<div class="mock-row"><div class="mock-key">${esc(k)}</div>${renderMockValue(v)}</div>`)
    .join("");
  const decisionButtons =
    screen.kind === "decision"
      ? `<div class="decision-actions" data-decision-root>
           <button class="btn btn-primary" data-decision="approve">승인</button>
           <button class="btn btn-danger" data-decision="reject">반려</button>
           <button class="btn btn-secondary" data-decision="hold">보류 (추가확인)</button>
           <div class="decision-result" data-decision-result hidden></div>
         </div>`
      : "";
  return `<section class="screen-panel" id="panel-${esc(screen.id)}" data-panel hidden>
    <div class="panel-head">
      <div>
        <div class="panel-title">${esc(screen.title)}</div>
        <p class="panel-desc">${esc(screen.description)}</p>
      </div>
      <span class="badge ${STATUS_CLASS[screen.status] || "badge-neutral"}">${STATUS_LABEL[screen.status] || screen.status}</span>
    </div>
    <div class="mock-grid">${rows}</div>
    ${decisionButtons}
  </section>`;
}

function renderScenario(scenario: DemoScenario | null): string {
  if (!scenario) return "";
  const steps = scenario.steps
    .map((s) => {
      const icon = s.status === "pass" ? "✓" : s.status === "warn" ? "!" : "✕";
      const cls = s.status === "pass" ? "step-pass" : s.status === "warn" ? "step-warn" : "step-fail";
      return `<div class="scenario-step">
        <span class="step-icon ${cls}">${icon}</span>
        <div><div class="step-label">${esc(s.label)}</div><div class="step-detail">${esc(s.detail)}</div></div>
      </div>`;
    })
    .join("");
  const outcomeCls =
    scenario.decision.outcome === "approve" ? "outcome-approve" : scenario.decision.outcome === "reject" ? "outcome-reject" : "outcome-review";
  const outcomeLabel =
    scenario.decision.outcome === "approve" ? "자동 승인 가능" : scenario.decision.outcome === "reject" ? "반려 권고" : "담당자 확인 필요";
  return `<aside class="scenario-card">
    <div class="scenario-kicker">SCENARIO · ${esc(scenario.caseId)}</div>
    <div class="scenario-agent">${esc(scenario.agentName)}</div>
    <div class="scenario-steps">${steps}</div>
    <div class="outcome-box ${outcomeCls}">
      <div class="outcome-head"><span>${outcomeLabel}</span><span class="outcome-conf">신뢰도 ${Math.round(scenario.decision.confidence * 100)}%</span></div>
      <p>${esc(scenario.decision.reason)}</p>
    </div>
  </aside>`;
}

export function renderDemoHtml(
  meta: { projectName: string; client: string },
  agent: AgentConcept,
  screens: DemoScreen[],
  scenario: DemoScenario | null
): string {
  const workflowCards = agent.workflow
    .map(
      (w, i) => `<div class="wf-card">
        <div class="wf-actor">${ACTOR_LABEL[w.actor] || w.actor}</div>
        <div class="wf-name">${esc(w.name)}</div>
        <p class="wf-desc">${esc(w.description)}</p>
      </div>${i < agent.workflow.length - 1 ? '<div class="wf-arrow">→</div>' : ""}`
    )
    .join("");

  const tabs = screens.map((s, i) => `<button class="tab-btn${i === 0 ? " active" : ""}" data-tab="${esc(s.id)}">${esc(s.title.split("·").pop()?.trim() || s.title)}</button>`).join("");
  const panels = screens.map(renderScreenPanel).join("");

  const usersChips = agent.users.map((u) => `<span class="chip">${esc(u)}</span>`).join("");
  const approvalPoints = (agent.humanApproval?.points || []).map((p) => `<li>${esc(p)}</li>`).join("");

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(agent.name)} · Demo UI</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root{--navy:#0A0F1E;--navy2:#0F172A;--accent:#5B62E8;--accent-light:#EEF1FF;--text:#14181F;--muted:#64748B;--border:#E2E8F0;--bg:#F6F7FB;}
  *{box-sizing:border-box}
  body{margin:0;font-family:"Noto Sans KR","Pretendard",-apple-system,BlinkMacSystemFont,system-ui,sans-serif;background:var(--bg);color:var(--text)}
  .topbar{background:var(--navy);color:#fff;padding:14px 28px;display:flex;align-items:center;justify-content:space-between}
  .topbar .brand{font-weight:800;font-size:13px;letter-spacing:.02em}
  .topbar .meta{font-size:12px;color:#94A3B8}
  .wrap{max-width:1080px;margin:0 auto;padding:28px}
  .agent-card{background:#fff;border:1px solid var(--border);border-radius:14px;padding:20px 22px;margin-bottom:24px;box-shadow:0 1px 2px rgba(15,23,42,.04)}
  .agent-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
  .agent-kicker{font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--muted);text-transform:uppercase;margin-bottom:4px}
  .agent-name{font-size:19px;font-weight:800}
  .agent-purpose{font-size:13.5px;color:#334155;margin:8px 0 14px;line-height:1.6;max-width:64ch}
  .agent-meta{display:flex;gap:32px;flex-wrap:wrap}
  .agent-meta h4{font-size:11px;color:var(--muted);margin:0 0 6px;font-weight:700}
  .chip{display:inline-block;background:#F1F5F9;color:#334155;font-size:12px;padding:3px 9px;border-radius:6px;margin:0 4px 4px 0}
  .agent-meta ul{margin:0;padding-left:16px;font-size:12.5px;color:#334155;line-height:1.7}
  .badge{display:inline-flex;align-items:center;gap:4px;border-radius:6px;padding:3px 9px;font-size:11px;font-weight:600;white-space:nowrap}
  .badge-neutral{background:#F1F5F9;color:#475569}
  .badge-accent{background:var(--accent-light);color:#3D3CB5}
  .badge-outline{background:transparent;color:#64748B;border:1px solid var(--border)}
  .section-kicker{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 12px}
  .workflow-row{display:flex;align-items:stretch;gap:8px;overflow-x:auto;padding-bottom:8px;margin-bottom:28px}
  .wf-card{flex:none;width:180px;background:#fff;border:1px solid var(--border);border-radius:12px;padding:12px}
  .wf-actor{font-size:10px;font-weight:700;color:var(--accent);letter-spacing:.04em;margin-bottom:4px}
  .wf-name{font-size:13px;font-weight:700;margin-bottom:4px}
  .wf-desc{font-size:11.5px;color:var(--muted);line-height:1.5;margin:0}
  .wf-arrow{flex:none;display:flex;align-items:center;color:#CBD5E1;font-size:14px}
  .main-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:24px;align-items:start}
  .tabs{display:flex;gap:2px;border-bottom:1px solid var(--border);margin-bottom:0}
  .tab-btn{background:none;border:none;padding:10px 14px;font-size:13px;font-weight:500;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent}
  .tab-btn.active{color:#3D3CB5;border-bottom-color:var(--accent)}
  .screen-panel{background:#fff;border:1px solid var(--border);border-top:none;border-radius:0 0 12px 12px;padding:20px}
  .panel-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;gap:12px}
  .panel-title{font-size:15px;font-weight:700}
  .panel-desc{font-size:12.5px;color:var(--muted);margin:3px 0 0}
  .mock-grid{display:flex;flex-direction:column;gap:12px}
  .mock-key{font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px}
  .mock-value,.mock-list li{font-size:13px;background:#F8FAFC;border-radius:6px;padding:7px 10px;color:#1E293B}
  .mock-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
  .decision-actions{margin-top:18px;padding-top:16px;border-top:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap}
  .btn{border-radius:8px;padding:9px 16px;font-size:13.5px;font-weight:600;cursor:pointer;border:1px solid transparent}
  .btn-primary{background:var(--accent);color:#fff}
  .btn-danger{background:#fff;color:#DC2626;border-color:#FECACA}
  .btn-secondary{background:#fff;color:#334155;border-color:var(--border)}
  .decision-result{font-size:13px;font-weight:600;padding:9px 12px;border-radius:8px;display:flex;align-items:center;gap:6px}
  .decision-result.approve{background:#ECFDF5;color:#047857}
  .decision-result.reject{background:#FEF2F2;color:#DC2626}
  .decision-result.hold{background:#FFFBEB;color:#B45309}
  .scenario-card{background:#fff;border:1px solid var(--border);border-radius:12px;padding:18px}
  .scenario-kicker{font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--muted);text-transform:uppercase;margin-bottom:4px}
  .scenario-agent{font-size:13.5px;font-weight:700;margin-bottom:14px}
  .scenario-steps{display:flex;flex-direction:column;gap:11px;margin-bottom:16px}
  .scenario-step{display:flex;gap:9px;align-items:flex-start}
  .step-icon{flex:none;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff}
  .step-pass{background:#10B981}.step-warn{background:#F59E0B}.step-fail{background:#EF4444}
  .step-label{font-size:12.5px;font-weight:600}
  .step-detail{font-size:11.5px;color:var(--muted);line-height:1.5}
  .outcome-box{border-radius:10px;padding:12px}
  .outcome-approve{background:#ECFDF5;color:#065F46}
  .outcome-reject{background:#FEF2F2;color:#991B1B}
  .outcome-review{background:#FFFBEB;color:#92400E}
  .outcome-head{display:flex;justify-content:space-between;font-size:12.5px;font-weight:700;margin-bottom:6px}
  .outcome-conf{font-weight:500;opacity:.75;font-size:11px}
  .outcome-box p{margin:0;font-size:12.5px;line-height:1.6}
  .footer-note{margin-top:24px;font-size:11.5px;color:#94A3B8;text-align:center}
  @media(max-width:860px){.main-grid{grid-template-columns:1fr}}
</style>
</head>
<body>
  <div class="topbar">
    <span class="brand">QUEST OPS · DEMO UI</span>
    <span class="meta">${esc(meta.projectName)} · ${esc(meta.client)}</span>
  </div>
  <div class="wrap">
    <div class="agent-card">
      <div class="agent-head">
        <div>
          <div class="agent-kicker">AI Agent</div>
          <div class="agent-name">${esc(agent.name)}</div>
        </div>
        <span class="badge badge-accent">Human-in-the-loop ${agent.humanApproval?.required ? "필수" : "선택"}</span>
      </div>
      <p class="agent-purpose">${esc(agent.purpose)}</p>
      <div class="agent-meta">
        <div><h4>사용자</h4>${usersChips}</div>
        <div><h4>Human Approval Point</h4><ul>${approvalPoints}</ul></div>
      </div>
    </div>

    <div class="section-kicker">Agent Workflow</div>
    <div class="workflow-row">${workflowCards}</div>

    <div class="main-grid">
      <div>
        <div class="tabs">${tabs}</div>
        ${panels}
      </div>
      ${renderScenario(scenario)}
    </div>

    <div class="footer-note">Quest Ops에서 자동 생성된 Demo UI 미리보기입니다. 실제 데이터가 아닌 인터뷰 기반 mock 시나리오입니다.</div>
  </div>

<script>
(function(){
  var tabs = document.querySelectorAll('[data-tab]');
  var panels = document.querySelectorAll('[data-panel]');
  function activate(id){
    panels.forEach(function(p){ p.hidden = p.id !== 'panel-' + id; });
    tabs.forEach(function(t){ t.classList.toggle('active', t.getAttribute('data-tab') === id); });
  }
  tabs.forEach(function(t){ t.addEventListener('click', function(){ activate(t.getAttribute('data-tab')); }); });
  if (tabs.length) activate(tabs[0].getAttribute('data-tab'));

  document.querySelectorAll('[data-decision-root]').forEach(function(root){
    var resultEl = root.querySelector('[data-decision-result]');
    root.querySelectorAll('[data-decision]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var kind = btn.getAttribute('data-decision');
        var msgs = { approve: '승인 처리되었습니다.', reject: '반려 처리되었습니다.', hold: '보류(추가확인)로 처리되었습니다.' };
        resultEl.textContent = msgs[kind] || '';
        resultEl.className = 'decision-result ' + kind;
        resultEl.hidden = false;
        root.querySelectorAll('[data-decision]').forEach(function(b){ b.style.display = 'none'; });
      });
    });
  });
})();
</script>
</body>
</html>`;
}
