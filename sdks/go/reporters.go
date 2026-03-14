package leakassert

import (
	"encoding/json"
	"fmt"
	"html"
	"math"
	"strings"
)

// ── Report types ──────────────────────────────────────────────────────────────

type ReportAssertion struct {
	Name     string
	Passed   bool
	Actual   string
	Expected string
	Reason   string
}

type Report struct {
	Name        string
	Passed      bool
	Slope       float64
	Delta       int64
	DurationMs  float64
	Samples     []Sample
	Assertions  []ReportAssertion
}

// ── JUnit XML ─────────────────────────────────────────────────────────────────

func (r *Report) ToJUnit() string {
	failures := 0
	for _, a := range r.Assertions {
		if !a.Passed {
			failures++
		}
	}

	var cases strings.Builder
	for _, a := range r.Assertions {
		failure := ""
		if !a.Passed {
			msg := a.Reason
			if msg == "" {
				msg = a.Actual
			}
			failure = fmt.Sprintf(
				"      <failure message=%q>%s</failure>\n",
				xmlEsc(msg), xmlEsc(msg),
			)
		}
		fmt.Fprintf(&cases,
			"    <testcase name=%q classname=\"leak-assert\" time=\"0\">\n"+
				"      <system-out>actual: %s | expected: %s</system-out>\n"+
				"%s    </testcase>\n",
			xmlEsc(a.Name),
			xmlEsc(a.Actual),
			xmlEsc(a.Expected),
			failure,
		)
	}

	return fmt.Sprintf(
		"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"+
			"<testsuites>\n"+
			"  <testsuite name=%q tests=\"%d\" failures=\"%d\" time=\"%.3f\">\n"+
			"%s"+
			"  </testsuite>\n"+
			"</testsuites>",
		xmlEsc(r.Name),
		len(r.Assertions),
		failures,
		r.DurationMs/1000,
		cases.String(),
	)
}

// ── HTML ──────────────────────────────────────────────────────────────────────

func (r *Report) ToHTML() string {
	badge := `<span class="badge pass">PASS</span>`
	if !r.Passed {
		badge = `<span class="badge fail">FAIL</span>`
	}

	var rows strings.Builder
	for _, a := range r.Assertions {
		icon, cls := "✓", "pass"
		if !a.Passed {
			icon, cls = "✗", "fail"
		}
		fmt.Fprintf(&rows,
			"<tr class=\"%s\"><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>\n",
			cls, icon,
			html.EscapeString(a.Name),
			html.EscapeString(a.Actual),
			html.EscapeString(a.Expected),
		)
	}

	type chartPoint struct {
		Iter     int    `json:"iter"`
		HeapUsed uint64 `json:"heap_used"`
	}
	points := make([]chartPoint, len(r.Samples))
	for i, s := range r.Samples {
		points[i] = chartPoint{Iter: s.Iter, HeapUsed: s.HeapUsed}
	}
	sampleData, _ := json.Marshal(points)
	failures := 0
	for _, a := range r.Assertions {
		if !a.Passed {
			failures++
		}
	}

	return fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>leak-assert — %s</title>
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
    table{width:100%%;border-collapse:collapse;margin-top:1rem;background:#1e1e2e;border-radius:8px;overflow:hidden}
    th{background:#2d2d42;padding:.6rem 1rem;text-align:left;font-size:.8rem;text-transform:uppercase;color:#94a3b8}
    td{padding:.6rem 1rem;border-bottom:1px solid #2d2d42;font-size:.9rem}
    tr.pass td:first-child{color:#6ee7b7}tr.fail td:first-child{color:#fca5a5}
    tr:last-child td{border-bottom:none}
    .chart-wrap{background:#1e1e2e;border:1px solid #2d2d42;border-radius:8px;padding:1.5rem;margin:2rem 0}
    h2{font-size:1rem;color:#94a3b8;margin-bottom:1rem}
  </style>
</head>
<body>
  <h1>leak-assert &mdash; %s %s</h1>
  <div class="summary">
    <div class="stat"><label>Slope</label><div class="value">%.1f B/iter</div></div>
    <div class="stat"><label>Total Delta</label><div class="value">%s</div></div>
    <div class="stat"><label>Duration</label><div class="value">%.1fs</div></div>
    <div class="stat"><label>Failures</label><div class="value">%d</div></div>
  </div>
  <div class="chart-wrap">
    <h2>Heap over iterations</h2>
    <canvas id="chart" width="900" height="220"></canvas>
  </div>
  <h2>Assertions</h2>
  <table>
    <thead><tr><th></th><th>Assertion</th><th>Actual</th><th>Expected</th></tr></thead>
    <tbody>%s</tbody>
  </table>
  <script>
  (function(){
    const samples=%s;
    if(!samples||samples.length<2)return;
    const canvas=document.getElementById('chart');
    const ctx=canvas.getContext('2d');
    const W=canvas.width,H=canvas.height,PAD=50;
    const xs=samples.map(s=>s.iter),ys=samples.map(s=>s.heap_used);
    const minX=Math.min(...xs),maxX=Math.max(...xs);
    const minY=Math.min(...ys)*.99,maxY=Math.max(...ys)*1.01;
    const scX=x=>(x-minX)/(maxX-minX||1)*(W-PAD*2)+PAD;
    const scY=y=>H-PAD-(y-minY)/(maxY-minY||1)*(H-PAD*2);
    ctx.strokeStyle='#38bdf8';ctx.lineWidth=2;ctx.beginPath();
    samples.forEach((s,i)=>i===0?ctx.moveTo(scX(s.iter),scY(s.heap_used)):ctx.lineTo(scX(s.iter),scY(s.heap_used)));
    ctx.stroke();
  })();
  </script>
</body>
</html>`,
		html.EscapeString(r.Name),
		html.EscapeString(r.Name), badge,
		r.Slope,
		formatBytes(r.Delta),
		r.DurationMs/1000,
		failures,
		rows.String(),
		string(sampleData),
	)
}

func xmlEsc(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, `"`, "&quot;")
	return s
}

func roundBytes(b int64) string { return formatBytes(b) }

func _ () { _ = math.Abs } // keep math import used
