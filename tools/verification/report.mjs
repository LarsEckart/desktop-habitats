import { readFile } from 'node:fs/promises';

export const REPORT_SCHEMA_VERSION = 1;
export const FEEDBACK_VERSION = 1;

export function feedbackStorageKey(runId = 'unknown') {
  const safe = String(runId).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120) || 'unknown';
  return `habitats-verification-feedback:v${FEEDBACK_VERSION}:${safe}`;
}

export function serializeReport(report) {
  return JSON.stringify(report, null, 2);
}

export function deserializeReport(text) {
  const value = typeof text === 'string' ? JSON.parse(text) : text;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Report must be an object');
  if (value.schemaVersion !== REPORT_SCHEMA_VERSION) throw new Error(`Unsupported report schema: ${value.schemaVersion}`);
  if (!Array.isArray(value.scenarios)) throw new TypeError('Report scenarios must be an array');
  return value;
}

export function parseFeedback(text) {
  if (!text) return {};
  const value = typeof text === 'string' ? JSON.parse(text) : text;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const feedback = value.feedback && typeof value.feedback === 'object' ? value.feedback : value;
  return Object.fromEntries(Object.entries(feedback).filter(([id, item]) =>
    typeof id === 'string' && item && typeof item === 'object' &&
    ['looks-right', 'needs-work', 'cant-tell', null].includes(item.verdict) &&
    typeof (item.note ?? '') === 'string'));
}

export function serializeFeedback(feedback) {
  return JSON.stringify({ version: FEEDBACK_VERSION, updatedAt: new Date().toISOString(), feedback: parseFeedback(feedback) }, null, 2);
}

export function withFeedback(report, feedback) {
  const clean = parseFeedback(feedback);
  return { ...report, feedback: clean };
}

export function statusLabel(status) {
  return ({ passed: 'Passed', failed: 'Failed', 'needs-judgment': 'Needs judgment', 'not-exercised': 'Not exercised' })[status] || 'Unknown';
}

export async function readChecklist(path) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.rows)) return value.rows;
    if (Array.isArray(value?.checks)) return value.checks;
    return [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function scriptJson(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
}

export function renderReportHtml(report) {
  const data = scriptJson(report);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Riverscape verification review</title>
<style>
:root{color-scheme:dark;--bg:#081311;--panel:#10221e;--panel2:#142b25;--line:#2c5146;--text:#e9f4ed;--muted:#9cb8ab;--good:#70dc9c;--bad:#ff8c7a;--warn:#f7ca70;--accent:#78c9ff;font:15px/1.45 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 8% 0,#16382e 0,#081311 36rem);color:var(--text)}main{max-width:1280px;margin:0 auto;padding:32px 24px 64px}header{display:flex;gap:20px;justify-content:space-between;align-items:flex-start;margin-bottom:24px}h1,h2,h3,p{margin:0}h1{font-size:clamp(25px,4vw,42px);letter-spacing:-.03em}h2{font-size:20px}h3{font-size:17px}.eyebrow{color:var(--good);font-weight:700;letter-spacing:.12em;text-transform:uppercase;font-size:11px;margin-bottom:8px}.lede{color:var(--muted);max-width:720px;margin-top:8px}.actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}button{border:1px solid var(--line);background:var(--panel2);color:var(--text);border-radius:8px;padding:9px 12px;font:inherit;cursor:pointer}button:hover{border-color:var(--accent)}button.selected{outline:2px solid var(--accent);background:#194537}.summary{display:grid;grid-template-columns:repeat(5,minmax(120px,1fr));gap:10px;margin:22px 0}.metric,.coverage,.notice,.card{background:linear-gradient(145deg,#122820,#0d1d1a);border:1px solid var(--line);border-radius:12px}.metric{padding:14px}.metric strong{display:block;font-size:26px}.metric span{color:var(--muted);font-size:12px}.notice{padding:13px 15px;color:var(--muted);margin:16px 0}.notice b{color:var(--text)}section{margin-top:24px}.coverage{overflow:auto}.coverage table{border-collapse:collapse;width:100%;min-width:700px}.coverage th,.coverage td{text-align:left;padding:10px 12px;border-bottom:1px solid #254339;vertical-align:top}.coverage th{color:var(--muted);font-size:12px;font-weight:600}.coverage td{font-size:13px}.status{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700}.status:before{content:"";width:8px;height:8px;border-radius:50%;background:var(--muted)}.status.passed{color:var(--good)}.status.passed:before{background:var(--good)}.status.failed{color:var(--bad)}.status.failed:before{background:var(--bad)}.status.needs-judgment,.status.not-exercised{color:var(--warn)}.status.needs-judgment:before{background:var(--warn)}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,390px),1fr));gap:14px}.card{padding:16px;display:flex;flex-direction:column;gap:13px}.card-top{display:flex;justify-content:space-between;gap:12px}.card-title{display:flex;gap:9px;align-items:baseline}.id{color:var(--accent);font:12px ui-monospace,monospace}.desc{color:var(--muted);font-size:13px}.evidence{display:grid;grid-template-columns:1fr 1fr;gap:8px}.evidence-item{min-width:0}.evidence img,.evidence video{display:block;width:100%;aspect-ratio:16/10;object-fit:cover;background:#06100e;border-radius:7px;border:1px solid #24463c}.evidence-links{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:5px;font-size:11px}.evidence-links a{color:var(--accent)}.evidence-links span{color:var(--muted)}.scenario-meta{border:1px solid #254339;border-radius:7px;padding:9px;color:var(--muted);font-size:12px;display:grid;gap:4px}.scenario-meta b{color:var(--text)}.persistence-warning{border:1px solid var(--warn);color:var(--warn);background:#352c14;padding:10px 12px;border-radius:8px;margin:12px 0}.empty{display:grid;place-items:center;color:var(--muted);min-height:120px;border:1px dashed var(--line);border-radius:7px;font-size:12px}.assertions{display:grid;gap:5px}.assertion{display:flex;gap:8px;font-size:12px;color:var(--muted)}.assertion b{font-weight:700}.assertion .passed{color:var(--good)}.assertion .failed{color:var(--bad)}.assertion .not-exercised{color:var(--warn)}.review{border-top:1px solid var(--line);padding-top:12px}.review-label{color:var(--muted);font-size:12px;margin-bottom:7px}.verdicts{display:flex;gap:6px;flex-wrap:wrap}.verdicts button{font-size:12px;padding:7px 9px}.notes{width:100%;margin-top:8px;min-height:58px;resize:vertical;border:1px solid var(--line);border-radius:7px;padding:8px;background:#091613;color:var(--text);font:13px/1.4 inherit}.notes:focus{outline:2px solid var(--accent);outline-offset:1px}.meta{color:var(--muted);font:12px ui-monospace,monospace;white-space:pre-wrap}.small{color:var(--muted);font-size:12px}.hidden{display:none!important}@media(max-width:700px){main{padding:22px 14px 42px}header{display:block}.actions{justify-content:flex-start;margin-top:16px}.summary{grid-template-columns:repeat(2,1fr)}.evidence{grid-template-columns:1fr}}
</style>
</head>
<body><main>
<header><div><div class="eyebrow">Desktop Habitats · evidence workbench</div><h1>Riverscape review</h1><p class="lede">Automated checks are evidence, not approval. Review each real screenshot and normal-speed recording, then leave a human verdict.</p></div><div class="actions"><button id="export">Export review</button><button id="clear">Clear saved feedback</button></div></header>
<div id="persistence-warning" class="persistence-warning" hidden></div>
<div id="app"></div>
<script type="application/json" id="report-data">${data}</script>
<script>
(() => {
  const report = JSON.parse(document.getElementById('report-data').textContent);
  const key = ${JSON.stringify(feedbackStorageKey(report.run?.id))};
  let persistenceWarning = '';
  const read = () => { try { return JSON.parse(localStorage.getItem(key) || '{}').feedback || {}; } catch { persistenceWarning = 'Browser storage is unavailable; feedback remains exportable for this page, but cannot persist locally.'; return {}; } };
  let feedback = read();
  const showPersistenceWarning = () => { const node = document.getElementById('persistence-warning'); if (node) { node.textContent = persistenceWarning; node.hidden = !persistenceWarning; } };
  const save = () => { try { localStorage.setItem(key, JSON.stringify({version:1,updatedAt:new Date().toISOString(),feedback})); } catch { persistenceWarning = 'Browser storage is unavailable; feedback remains exportable for this page, but cannot persist locally.'; showPersistenceWarning(); } };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const status = s => '<span class="status '+esc(s)+'">'+esc(({passed:'Passed',failed:'Failed','needs-judgment':'Needs judgment','not-exercised':'Not exercised'}[s]||'Unknown'))+'</span>';
  const counts = report.scenarios.reduce((a,s)=>(a[s.status]=(a[s.status]||0)+1,a),{});
  const metric = (n,l) => '<div class="metric"><strong>'+n+'</strong><span>'+l+'</span></div>';
  let html = '<div class="summary">'+metric(report.scenarios.length,'scenarios')+metric(counts.passed||0,'automated pass')+metric(counts.failed||0,'automated fail')+metric(counts['needs-judgment']||0,'needs judgment')+metric(Object.values(feedback).filter(x=>x?.verdict).length,'human reviews')+'</div>';
  html += '<div class="notice"><b>Run:</b> '+esc(report.run?.id)+' · <b>Commit:</b> '+esc(report.commit?.sha?.slice(0,12)||'unknown')+(report.commit?.dirty?' <b>(dirty)</b>':'')+' · <b>Mode:</b> '+esc(report.run?.mode)+'<br><span class="meta">'+esc(JSON.stringify(report.environment||{},null,2))+'</span>'+(report.verificationChecks?' <br><b>Repo checks:</b> '+esc(report.verificationChecks.status)+' from '+esc(report.verificationChecks.source)+' (logs copied beside this report)':'')+'</div>';
  html += '<section><h2>Scenario evidence</h2><div class="cards">';
  for (const s of report.scenarios) {
    const f = feedback[s.id] || {};
    const shots = (s.captures?.screenshots||[]).filter(x=>x.path);
    const rec = s.captures?.recording;
    const meta = s.metadata || {};
    const overrides = Object.entries(meta.fixtureOverrides || {}).map(([k,v]) => esc(k)+': '+esc(Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : v)).join(' · ');
    const stimuli = (meta.controlledStimuli || []).map(item => '<li>'+esc(item)+'</li>').join('');
    html += '<article class="card" data-id="'+esc(s.id)+'"><div class="card-top"><div><div class="card-title"><h3>'+esc(s.title||s.id)+'</h3><span class="id">'+esc(s.id)+'</span></div><p class="desc">'+esc(s.description)+'</p></div>'+status(s.status)+'</div>';
    html += '<div class="scenario-meta"><div><b>Fixture:</b> '+esc(meta.class || 'unspecified')+' · <b>Natural timing:</b> '+(meta.naturalBehavior === true ? 'yes' : 'no / prepared condition')+'</div>'+(meta.pacing ? '<div><b>Pacing:</b> '+esc(meta.pacing)+'</div>' : '')+(overrides ? '<div><b>Overrides:</b> '+overrides+'</div>' : '')+(stimuli ? '<div><b>Controlled stimuli:</b><ul>'+stimuli+'</ul></div>' : '')+(meta.note ? '<div><b>Note:</b> '+esc(meta.note)+'</div>' : '')+'</div>';
    html += '<div class="evidence">';
    if (shots.length) html += '<div class="evidence-item"><img loading="lazy" src="'+esc(shots[0].path)+'" alt="'+esc(s.title||s.id)+' screenshot"><div class="evidence-links"><a href="'+esc(shots[0].path)+'" target="_blank" rel="noopener">Open full-size screenshot ↗</a></div></div>'; else html += '<div class="empty">Screenshot unavailable</div>';
    if (rec?.path) html += '<div class="evidence-item"><video controls playsinline preload="metadata" src="'+esc(rec.path)+'"></video><div class="evidence-links"><a href="'+esc(rec.path)+'" target="_blank" rel="noopener">Open clip ↗</a><span>normal speed · sim/wall '+esc(rec.simulationToWallRatio == null ? 'unavailable' : Number(rec.simulationToWallRatio).toFixed(2)+'×')+'</span></div></div>'; else html += '<div class="empty">'+esc(rec?.reason||'Recording unavailable')+'</div>';
    html += '</div>';
    html += '<div class="assertions">'+(s.assertions||[]).map(a=>'<div class="assertion"><b class="'+esc(a.status)+'">'+esc(a.status)+'</b><span>'+esc(a.label||a.id)+(a.detail?' — '+esc(a.detail):'')+'</span></div>').join('')+'</div>';
    html += '<div class="review"><div class="review-label">Human review</div><div class="verdicts">'+[['looks-right','Looks right'],['needs-work','Needs work'],["cant-tell","Can't tell"]].map(([v,l])=>'<button data-verdict="'+v+'" class="'+(f.verdict===v?'selected':'')+'">'+l+'</button>').join('')+'</div><textarea class="notes" placeholder="Optional note…">'+esc(f.note||'')+'</textarea></div></article>';
  }
  html += '</div></section>';
  if (report.coverage?.length) {
    html += '<section><h2>Acceptance coverage</h2><p class="small" style="margin:6px 0 10px">Checklist rows stay at their source status. A completed scenario does not mark a product claim passed.</p><details class="coverage"><summary style="padding:12px;cursor:pointer">Show '+report.coverage.length+' acceptance rows</summary><table><thead><tr><th>Row</th><th>Claim</th><th>Method</th><th>Status</th></tr></thead><tbody>';
    for (const row of report.coverage) html += '<tr><td>'+esc(row.id)+'</td><td>'+esc(row.claim||row.title)+'</td><td>'+esc(row.method)+'</td><td>'+esc(row.status||'not-exercised')+'</td></tr>';
    html += '</tbody></table></details></section>';
  }
  html += '<section class="small">Generated '+esc(report.generatedAt)+' · Evidence files are local artifacts from the dedicated renderer.</section>';
  document.getElementById('app').innerHTML = html;
  showPersistenceWarning();
  const updateMetric = () => { const m = document.querySelector('.metric:last-child strong'); if(m)m.textContent=Object.values(feedback).filter(x=>x?.verdict).length; };
  document.querySelectorAll('.card').forEach(card => {
    const id=card.dataset.id;
    card.querySelectorAll('[data-verdict]').forEach(button => button.addEventListener('click', () => { feedback[id]={...(feedback[id]||{}),verdict:button.dataset.verdict}; save(); card.querySelectorAll('[data-verdict]').forEach(b=>b.classList.toggle('selected',b===button)); updateMetric(); }));
    card.querySelector('.notes').addEventListener('input', e => { feedback[id]={...(feedback[id]||{}),note:e.target.value}; save(); });
  });
  document.getElementById('clear').addEventListener('click', () => { if(confirm('Clear all saved review notes and verdicts?')) { try { localStorage.removeItem(key); } catch { persistenceWarning = 'Browser storage is unavailable; cleared feedback only for this page.'; showPersistenceWarning(); } feedback={}; document.querySelectorAll('[data-verdict]').forEach(button=>button.classList.remove('selected')); document.querySelectorAll('.notes').forEach(note=>note.value=''); updateMetric(); } });
  document.getElementById('export').addEventListener('click', () => { const blob=new Blob([JSON.stringify({report,feedback,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'}); const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='riverscape-review.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000); });
})();
</script></main></body></html>`;
}

export default { serializeReport, deserializeReport, parseFeedback, serializeFeedback, withFeedback, renderReportHtml, feedbackStorageKey };
