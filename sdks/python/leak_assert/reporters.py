"""HTML and JUnit reporters for leak-assert Python SDK."""
from __future__ import annotations

import html
import json
from dataclasses import dataclass, field
from typing import Any

from .samplers import Sample


@dataclass
class ReportAssertion:
    name:     str
    passed:   bool
    actual:   str
    expected: str
    reason:   str = ""


@dataclass
class Report:
    name:        str
    passed:      bool
    slope:       float
    delta:       int
    duration_ms: float
    samples:     list[Sample] = field(default_factory=list)
    assertions:  list[ReportAssertion] = field(default_factory=list)


# ── JUnit XML ─────────────────────────────────────────────────────────────────

def to_junit(report: Report) -> str:
    failures = sum(1 for a in report.assertions if not a.passed)
    cases = []
    for a in report.assertions:
        failure = (
            f'      <failure message="{_xe(a.reason or a.actual)}">'
            f"{_xe(a.reason or a.actual)}</failure>\n"
            if not a.passed else ""
        )
        cases.append(
            f'    <testcase name="{_xe(a.name)}" classname="leak-assert" time="0">\n'
            f'      <system-out>actual: {_xe(a.actual)} | expected: {_xe(a.expected)}</system-out>\n'
            f"{failure}"
            f"    </testcase>"
        )

    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        "<testsuites>\n"
        f'  <testsuite name="{_xe(report.name)}" tests="{len(report.assertions)}" '
        f'failures="{failures}" time="{report.duration_ms/1000:.3f}">\n'
        + "\n".join(cases) + "\n"
        "  </testsuite>\n"
        "</testsuites>"
    )


# ── HTML ──────────────────────────────────────────────────────────────────────

def to_html(report: Report) -> str:
    badge = (
        '<span class="badge pass">PASS</span>'
        if report.passed else
        '<span class="badge fail">FAIL</span>'
    )
    rows = "\n".join(
        f'<tr class="{"pass" if a.passed else "fail"}">'
        f'<td>{"✓" if a.passed else "✗"}</td>'
        f"<td>{html.escape(a.name)}</td>"
        f"<td>{html.escape(a.actual)}</td>"
        f"<td>{html.escape(a.expected)}</td></tr>"
        for a in report.assertions
    )
    sample_data = json.dumps([
        {"iter": s.iter, "heap_used": s.heap_used} for s in report.samples
    ])
    failures = sum(1 for a in report.assertions if not a.passed)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>leak-assert &mdash; {html.escape(report.name)}</title>
  <style>
    *{{box-sizing:border-box;margin:0;padding:0}}
    body{{font-family:system-ui,sans-serif;background:#0f0f12;color:#e2e8f0;padding:2rem}}
    h1{{font-size:1.4rem;margin-bottom:.5rem}}
    .summary{{display:flex;gap:1.5rem;margin:1rem 0 2rem;flex-wrap:wrap}}
    .stat{{background:#1e1e2e;border:1px solid #2d2d42;border-radius:8px;padding:.75rem 1.2rem;min-width:140px}}
    .stat label{{font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8}}
    .stat .value{{font-size:1.4rem;font-weight:700;margin-top:.2rem}}
    .badge{{padding:.25rem .75rem;border-radius:4px;font-weight:700;font-size:.85rem}}
    .badge.pass{{background:#064e3b;color:#6ee7b7}}.badge.fail{{background:#450a0a;color:#fca5a5}}
    table{{width:100%;border-collapse:collapse;margin-top:1rem;background:#1e1e2e;border-radius:8px;overflow:hidden}}
    th{{background:#2d2d42;padding:.6rem 1rem;text-align:left;font-size:.8rem;text-transform:uppercase;color:#94a3b8}}
    td{{padding:.6rem 1rem;border-bottom:1px solid #2d2d42;font-size:.9rem}}
    tr.pass td:first-child{{color:#6ee7b7}}tr.fail td:first-child{{color:#fca5a5}}
    tr:last-child td{{border-bottom:none}}
    .chart-wrap{{background:#1e1e2e;border:1px solid #2d2d42;border-radius:8px;padding:1.5rem;margin:2rem 0}}
    h2{{font-size:1rem;color:#94a3b8;margin-bottom:1rem}}
  </style>
</head>
<body>
  <h1>leak-assert &mdash; {html.escape(report.name)} {badge}</h1>
  <div class="summary">
    <div class="stat"><label>Slope</label><div class="value">{report.slope:.1f} B/iter</div></div>
    <div class="stat"><label>Total Delta</label><div class="value">{_fmt_bytes(report.delta)}</div></div>
    <div class="stat"><label>Duration</label><div class="value">{report.duration_ms/1000:.1f}s</div></div>
    <div class="stat"><label>Failures</label><div class="value">{failures}</div></div>
  </div>
  <div class="chart-wrap">
    <h2>Heap over iterations</h2>
    <canvas id="chart" width="900" height="220"></canvas>
  </div>
  <h2>Assertions</h2>
  <table>
    <thead><tr><th></th><th>Assertion</th><th>Actual</th><th>Expected</th></tr></thead>
    <tbody>{rows}</tbody>
  </table>
  <script>
  (function(){{
    const samples={sample_data};
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
    for(let i=0;i<=4;i++){{
      const y=PAD+i*(H-PAD*2)/4;
      ctx.beginPath();ctx.moveTo(PAD,y);ctx.lineTo(W-PAD,y);ctx.stroke();
      const v=maxY-(maxY-minY)*i/4;
      ctx.fillStyle='#64748b';ctx.font='11px system-ui';
      ctx.fillText((v/1024/1024).toFixed(2)+'MB',2,y+4);
    }}
    ctx.strokeStyle='#38bdf8';ctx.lineWidth=2;ctx.beginPath();
    samples.forEach((s,i)=>i===0?ctx.moveTo(scX(s.iter),scY(s.heap_used)):ctx.lineTo(scX(s.iter),scY(s.heap_used)));
    ctx.stroke();
  }})();
  </script>
</body>
</html>"""


def _xe(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def _fmt_bytes(b: int) -> str:
    sign = "+" if b >= 0 else "-"
    a = abs(b)
    if a >= 1024 * 1024:
        return f"{sign}{a/1024/1024:.2f}MB"
    if a >= 1024:
        return f"{sign}{a/1024:.1f}KB"
    return f"{sign}{a}B"
