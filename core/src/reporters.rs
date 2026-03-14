use crate::{AssertionResult, AssertionStatus, LeakTestResult};

// ── JUnit XML ─────────────────────────────────────────────────────────────────

pub fn to_junit(result: &LeakTestResult, test_name: &str) -> String {
    let failures = result.assertions.iter()
        .filter(|a| a.status != AssertionStatus::Pass)
        .count();

    let cases: String = result.assertions.iter().map(|a| {
        let status = match &a.status {
            AssertionStatus::Pass => String::new(),
            AssertionStatus::Fail { reason } => format!(
                r#"      <failure message="{}">{}</failure>"#,
                xml_escape(reason),
                xml_escape(reason),
            ),
        };
        format!(
            r#"    <testcase name="{assertion}" classname="leak-assert">
      <system-out>actual: {actual} | expected: {expected}</system-out>
{status}    </testcase>"#,
            assertion = xml_escape(&a.assertion),
            actual    = xml_escape(&a.actual),
            expected  = xml_escape(&a.expected),
            status    = if status.is_empty() { String::new() } else { format!("{}\n", status) },
        )
    }).collect::<Vec<_>>().join("\n");

    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="{name}" tests="{tests}" failures="{failures}" errors="0">
{cases}
  </testsuite>
</testsuites>"#,
        name     = xml_escape(test_name),
        tests    = result.assertions.len(),
        failures = failures,
        cases    = cases,
    )
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
     .replace('<', "&lt;")
     .replace('>', "&gt;")
     .replace('"', "&quot;")
}

// ── HTML ──────────────────────────────────────────────────────────────────────

pub fn to_html(result: &LeakTestResult, test_name: &str, samples_json: &str) -> String {
    let status_badge = if result.passed {
        r#"<span class="badge pass">PASS</span>"#
    } else {
        r#"<span class="badge fail">FAIL</span>"#
    };

    let assertion_rows: String = result.assertions.iter().map(|a| {
        let (icon, cls) = match &a.status {
            AssertionStatus::Pass         => ("✓", "pass"),
            AssertionStatus::Fail { .. }  => ("✗", "fail"),
        };
        format!(
            r#"<tr class="{cls}"><td>{icon}</td><td>{}</td><td>{}</td><td>{}</td></tr>"#,
            html_escape(&a.assertion),
            html_escape(&a.actual),
            html_escape(&a.expected),
        )
    }).collect::<Vec<_>>().join("\n");

    format!(r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>leak-assert — {name}</title>
  <style>
    *{{box-sizing:border-box;margin:0;padding:0}}
    body{{font-family:system-ui,sans-serif;background:#0f0f12;color:#e2e8f0;padding:2rem}}
    h1{{font-size:1.4rem;margin-bottom:.5rem;color:#f8fafc}}
    .summary{{display:flex;gap:1.5rem;margin:1rem 0 2rem;flex-wrap:wrap}}
    .stat{{background:#1e1e2e;border:1px solid #2d2d42;border-radius:8px;padding:.75rem 1.2rem;min-width:140px}}
    .stat label{{font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8}}
    .stat .value{{font-size:1.4rem;font-weight:700;margin-top:.2rem}}
    .badge{{padding:.25rem .75rem;border-radius:4px;font-weight:700;font-size:.85rem}}
    .badge.pass{{background:#064e3b;color:#6ee7b7}}.badge.fail{{background:#450a0a;color:#fca5a5}}
    table{{width:100%;border-collapse:collapse;margin-top:1rem;background:#1e1e2e;border-radius:8px;overflow:hidden}}
    th{{background:#2d2d42;padding:.6rem 1rem;text-align:left;font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8}}
    td{{padding:.6rem 1rem;border-bottom:1px solid #2d2d42;font-size:.9rem}}
    tr.pass td:first-child{{color:#6ee7b7}} tr.fail td:first-child{{color:#fca5a5}}
    tr:last-child td{{border-bottom:none}}
    .chart-wrap{{background:#1e1e2e;border:1px solid #2d2d42;border-radius:8px;padding:1rem;margin:2rem 0}}
    h2{{font-size:1rem;color:#94a3b8;margin-bottom:1rem}}
    svg text{{font-family:system-ui,sans-serif}}
  </style>
</head>
<body>
  <h1>leak-assert &mdash; {name} {badge}</h1>

  <div class="summary">
    <div class="stat"><label>Slope</label><div class="value">{slope:.1} B/iter</div></div>
    <div class="stat"><label>Total Delta</label><div class="value">{delta}</div></div>
    <div class="stat"><label>Assertions</label><div class="value">{total}</div></div>
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
    const samples = {samples};
    if(!samples||samples.length<2)return;
    const canvas=document.getElementById('chart');
    const ctx=canvas.getContext('2d');
    const W=canvas.width,H=canvas.height,PAD=40;
    const xs=samples.map(s=>s.iter), ys=samples.map(s=>s.heap_used);
    const minX=Math.min(...xs),maxX=Math.max(...xs);
    const minY=Math.min(...ys),maxY=Math.max(...ys);
    const scX=x=>(x-minX)/(maxX-minX||1)*(W-PAD*2)+PAD;
    const scY=y=>H-PAD-(y-minY)/(maxY-minY||1)*(H-PAD*2);
    ctx.strokeStyle='#334155';ctx.lineWidth=1;
    for(let i=0;i<5;i++){{
      const y=PAD+i*(H-PAD*2)/4;
      ctx.beginPath();ctx.moveTo(PAD,y);ctx.lineTo(W-PAD,y);ctx.stroke();
      const v=maxY-(maxY-minY)*i/4;
      ctx.fillStyle='#64748b';ctx.font='11px system-ui';
      ctx.fillText((v/1024/1024).toFixed(1)+'MB',2,y+4);
    }}
    ctx.strokeStyle='#38bdf8';ctx.lineWidth=2;
    ctx.beginPath();
    samples.forEach((s,i)=>{{i===0?ctx.moveTo(scX(s.iter),scY(s.heap_used)):ctx.lineTo(scX(s.iter),scY(s.heap_used))}});
    ctx.stroke();
    ctx.fillStyle='#38bdf8';
    samples.forEach(s=>{{ctx.beginPath();ctx.arc(scX(s.iter),scY(s.heap_used),3,0,Math.PI*2);ctx.fill()}});
  }})();
  </script>
</body>
</html>"#,
        name     = html_escape(test_name),
        badge    = status_badge,
        slope    = result.analysis.slope_bytes_per_iter,
        delta    = format_bytes(result.analysis.baseline_delta_bytes),
        total    = result.assertions.len(),
        failures = result.assertions.iter().filter(|a| a.status != AssertionStatus::Pass).count(),
        rows     = assertion_rows,
        samples  = samples_json,
    )
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
     .replace('<', "&lt;")
     .replace('>', "&gt;")
}

fn format_bytes(b: i64) -> String {
    let abs = b.unsigned_abs();
    let sign = if b < 0 { "-" } else { "+" };
    if abs >= 1024 * 1024 {
        format!("{}{:.2}MB", sign, abs as f64 / 1024.0 / 1024.0)
    } else if abs >= 1024 {
        format!("{}{:.1}KB", sign, abs as f64 / 1024.0)
    } else {
        format!("{}{}B", sign, abs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{analyzer::{AnalysisResult, LeakPattern}, AssertionStatus};

    fn dummy_result(passed: bool) -> LeakTestResult {
        LeakTestResult {
            passed,
            summary: "test".into(),
            analysis: AnalysisResult {
                slope_bytes_per_iter: 100.0,
                pattern: LeakPattern::Stable,
                baseline_delta_bytes: 1024,
                suspect_region: None,
                r_squared: 0.9,
            },
            assertions: vec![AssertionResult {
                assertion: "growth_rate".into(),
                status:    if passed { AssertionStatus::Pass } else {
                    AssertionStatus::Fail { reason: "too fast".into() }
                },
                actual:   "200 bytes/iter".into(),
                expected: "< 100 bytes/iter".into(),
            }],
        }
    }

    #[test]
    fn junit_contains_testsuite() {
        let xml = to_junit(&dummy_result(true), "my-test");
        assert!(xml.contains("<testsuite"));
        assert!(xml.contains("growth_rate"));
    }

    #[test]
    fn junit_marks_failure() {
        let xml = to_junit(&dummy_result(false), "my-test");
        assert!(xml.contains("<failure"));
    }

    #[test]
    fn html_contains_chart_canvas() {
        let html = to_html(&dummy_result(true), "my-test", "[]");
        assert!(html.contains("<canvas"));
        assert!(html.contains("PASS"));
    }
}
