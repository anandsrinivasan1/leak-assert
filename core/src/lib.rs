pub mod analyzer;
pub mod assertions;
pub mod reporters;
pub mod sampler;

pub use analyzer::{analyze, AnalysisResult, LeakPattern};
pub use assertions::{evaluate, parse_bytes, Assertion, AssertionResult, AssertionStatus};
pub use sampler::Sample;

use serde::{Deserialize, Serialize};

/// Top-level result returned to all language SDKs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeakTestResult {
    pub passed:     bool,
    pub analysis:   AnalysisResult,
    pub assertions: Vec<AssertionResult>,
    pub summary:    String,
}

/// Entry point for all SDK integrations.
/// Takes samples + assertions, returns a serialisable result.
pub fn run_assertions(samples: &[Sample], assertions: &[Assertion]) -> LeakTestResult {
    let analysis    = analyze(samples);
    let results     = evaluate(assertions, &analysis);
    let passed      = results.iter().all(|r| r.status == AssertionStatus::Pass);
    let fails: Vec<_> = results.iter().filter(|r| r.status != AssertionStatus::Pass).collect();

    let summary = if passed {
        format!(
            "PASS — slope {:.1} bytes/iter, {} assertions checked",
            analysis.slope_bytes_per_iter,
            results.len()
        )
    } else {
        format!(
            "FAIL — {} of {} assertions failed: {}",
            fails.len(),
            results.len(),
            fails.iter()
                .map(|r| r.assertion.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        )
    };

    LeakTestResult { passed, analysis, assertions: results, summary }
}
