import type { AssertionOptions } from '../assertions'
import type { Sample } from '../samplers/v8'
import { olsSlope, parseBytes, AssertionError } from '../assertions'

export interface ReportAssertion {
  name:     string
  passed:   boolean
  actual:   string
  expected: string
  reason?:  string
}

export interface Report {
  name:       string
  passed:     boolean
  slope:      number
  delta:      number
  samples:    Sample[]
  assertions: ReportAssertion[]
  durationMs: number
}

// ── JUnit XML ─────────────────────────────────────────────────────────────────

export function toJUnit(report: Report): string {
  const failures = report.assertions.filter(a => !a.passed).length
  const cases = report.assertions.map(a => {
    const failure = a.passed ? '' :
      `      <failure message="${xmlEsc(a.reason ?? a.actual)}">${xmlEsc(a.reason ?? a.actual)}</failure>\n`
    return [
      `    <testcase name="${xmlEsc(a.name)}" classname="leak-assert" time="0">`,
      `      <system-out>actual: ${xmlEsc(a.actual)} | expected: ${xmlEsc(a.expected)}</system-out>`,
      failure,
      `    </testcase>`,
    ].filter(Boolean).join('\n')
  }).join('\n')

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<testsuites>`,
    `  <testsuite name="${xmlEsc(report.name)}" tests="${report.assertions.length}" failures="${failures}" time="${(report.durationMs / 1000).toFixed(3)}">`,
    cases,
    `  </testsuite>`,
    `</testsuites>`,
  ].join('\n')
}

// ── HTML ──────────────────────────────────────────────────────────────────────

export function toHTML(report: Report): string {
  const badge = report.passed
    ? `<span class="badge pass">PASS</span>`
    : `<span class="badge fail">FAIL</span>`

  const rows = report.assertions.map(a => {
    const icon = a.passed ? '✓' : '✗'
    const cls  = a.passed ? 'pass' : 'fail'
    return `<tr class="${cls}"><td>${icon}</td><td>${esc(a.name)}</td><td>${esc(a.actual)}</td><td>${esc(a.expected)}</td></tr>`
  }).join('\n')

  const sampleData = JSON.stringify(report.samples.map(s => ({
    iter: s.iter, heap_used: s.heap_used,
  })))

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>leak-assert — ${esc(report.name)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;background:#0f0f12;color:#e2e8f0;padding:2rem}
    h1{font-size:1.4rem;margin-bottom:.5rem}
    .summary{display:flex;gap:1.5rem;margin:1rem 0 2rem;flex-wrap:wrap}
    .stat{background:#1e1e2e;border:1px solid #2d2d42;border-radius:8px;padding:.75rem 1.2rem;min-width:140px}
    .stat label{font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8}
    .stat .value{font-size:1.4rem;font-weight:700;margin-top:.2rem}
    .badge{padding:.25rem .75rem;border-radius:4px;font-weight:700;font-size:.85rem}
    .badge.pass{background:#064e3b;color:#6ee7b7}.badge.fail{background:#450a0a;color:#fca5a5}
    table{width:100%;border-collapse:collapse;margin-top:1rem;background:#1e1e2e;border-radius:8px;overflow:hidden}
    th{background:#2d2d42;padding:.6rem 1rem;text-align:left;font-size:.8rem;text-transform:uppercase;color:#94a3b8}
    td{padding:.6rem 1rem;border-bottom:1px solid #2d2d42;font-size:.9rem}
    tr.pass td:first-child{color:#6ee7b7}tr.fail td:first-child{color:#fca5a5}
    tr:last-child td{border-bottom:none}
    .chart-wrap{background:#1e1e2e;border:1px solid #2d2d42;border-radius:8px;padding:1.5rem;margin:2rem 0}
    h2{font-size:1rem;color:#94a3b8;margin-bottom:1rem}
  </style>
</head>
<body>
  <h1>leak-assert &mdash; ${esc(report.name)} ${badge}</h1>
  <div class="summary">
    <div class="stat"><label>Slope</label><div class="value">${report.slope.toFixed(1)} B/iter</div></div>
    <div class="stat"><label>Total Delta</label><div class="value">${fmtBytes(report.delta)}</div></div>
    <div class="stat"><label>Duration</label><div class="value">${(report.durationMs / 1000).toFixed(1)}s</div></div>
    <div class="stat"><label>Failures</label><div class="value">${report.assertions.filter(a=>!a.passed).length}</div></div>
  </div>
  <div class="chart-wrap">
    <h2>Heap over iterations</h2>
    <canvas id="chart" width="900" height="220"></canvas>
  </div>
  <h2>Assertions</h2>
  <table>
    <thead><tr><th></th><th>Assertion</th><th>Actual</th><th>Expected</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <script>
  (function(){
    const samples=${sampleData};
    if(!samples||samples.length<2)return;
    const canvas=document.getElementById('chart');
    const ctx=canvas.getContext('2d');
    const W=canvas.width,H=canvas.height,PAD=50;
    const xs=samples.map(s=>s.iter),ys=samples.map(s=>s.heap_used);
    const minX=Math.min(...xs),maxX=Math.max(...xs);
    const minY=Math.min(...ys)*0.99,maxY=Math.max(...ys)*1.01;
    const scX=x=>(x-minX)/(maxX-minX||1)*(W-PAD*2)+PAD;
    const scY=y=>H-PAD-(y-minY)/(maxY-minY||1)*(H-PAD*2);
    ctx.strokeStyle='#1e293b';ctx.lineWidth=1;
    for(let i=0;i<=4;i++){
      const y=PAD+i*(H-PAD*2)/4;
      ctx.beginPath();ctx.moveTo(PAD,y);ctx.lineTo(W-PAD,y);ctx.stroke();
      const v=maxY-(maxY-minY)*i/4;
      ctx.fillStyle='#64748b';ctx.font='11px system-ui';
      ctx.fillText((v/1024/1024).toFixed(2)+'MB',2,y+4);
    }
    const grad=ctx.createLinearGradient(0,PAD,0,H-PAD);
    grad.addColorStop(0,'rgba(56,189,248,0.3)');grad.addColorStop(1,'rgba(56,189,248,0)');
    ctx.fillStyle=grad;ctx.beginPath();
    ctx.moveTo(scX(samples[0].iter),H-PAD);
    samples.forEach(s=>ctx.lineTo(scX(s.iter),scY(s.heap_used)));
    ctx.lineTo(scX(samples[samples.length-1].iter),H-PAD);ctx.closePath();ctx.fill();
    ctx.strokeStyle='#38bdf8';ctx.lineWidth=2;ctx.beginPath();
    samples.forEach((s,i)=>i===0?ctx.moveTo(scX(s.iter),scY(s.heap_used)):ctx.lineTo(scX(s.iter),scY(s.heap_used)));
    ctx.stroke();
  })();
  </script>
</body>
</html>`
}

function xmlEsc(s: string) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }
function esc(s: string)    { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }
function fmtBytes(b: number) {
  const abs = Math.abs(b), sign = b >= 0 ? '+' : '-'
  if (abs >= 1024*1024) return `${sign}${(abs/1024/1024).toFixed(2)}MB`
  if (abs >= 1024)      return `${sign}${(abs/1024).toFixed(1)}KB`
  return `${sign}${abs}B`
}
