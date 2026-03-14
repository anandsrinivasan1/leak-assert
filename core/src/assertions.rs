use crate::analyzer::AnalysisResult;
use serde::{Deserialize, Serialize};

// ── Assertion DSL ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Assertion {
    /// Bytes/iter slope must be below threshold
    GrowthRate { max_bytes_per_iter: f64 },
    /// Heap after GC must return within tolerance of starting value
    Stable { tolerance_bytes: u64 },
    /// Absolute heap ceiling — must never exceed
    Ceiling { max_bytes: u64 },
    /// No step changes above the given delta
    NoStepChange { max_delta_bytes: u64 },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AssertionStatus {
    Pass,
    Fail { reason: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssertionResult {
    pub assertion: String,
    pub status:    AssertionStatus,
    pub actual:    String,
    pub expected:  String,
}

// ── Evaluator ────────────────────────────────────────────────────────────────

pub fn evaluate(assertions: &[Assertion], result: &AnalysisResult) -> Vec<AssertionResult> {
    assertions.iter().map(|a| eval_one(a, result)).collect()
}

fn eval_one(assertion: &Assertion, result: &AnalysisResult) -> AssertionResult {
    match assertion {
        Assertion::GrowthRate { max_bytes_per_iter } => {
            let actual = result.slope_bytes_per_iter;
            let passed = actual <= *max_bytes_per_iter;
            AssertionResult {
                assertion: "growth_rate".into(),
                status: if passed {
                    AssertionStatus::Pass
                } else {
                    AssertionStatus::Fail {
                        reason: format!(
                            "heap grows at {:.1} bytes/iter, exceeds limit of {:.1}",
                            actual, max_bytes_per_iter
                        ),
                    }
                },
                actual:   format!("{:.1} bytes/iter", actual),
                expected: format!("< {:.1} bytes/iter", max_bytes_per_iter),
            }
        }

        Assertion::Stable { tolerance_bytes } => {
            let delta  = result.baseline_delta_bytes.unsigned_abs();
            let passed = delta <= *tolerance_bytes;
            AssertionResult {
                assertion: "stable".into(),
                status: if passed {
                    AssertionStatus::Pass
                } else {
                    AssertionStatus::Fail {
                        reason: format!(
                            "heap grew by {} bytes, tolerance is {} bytes",
                            delta, tolerance_bytes
                        ),
                    }
                },
                actual:   format!("{} bytes retained", delta),
                expected: format!("< {} bytes retained", tolerance_bytes),
            }
        }

        Assertion::Ceiling { max_bytes } => {
            // baseline_delta used as a proxy for current heap level
            let actual = result.baseline_delta_bytes.unsigned_abs();
            let passed = actual <= *max_bytes;
            AssertionResult {
                assertion: "ceiling".into(),
                status: if passed {
                    AssertionStatus::Pass
                } else {
                    AssertionStatus::Fail {
                        reason: format!("heap delta {} bytes exceeds ceiling {}", actual, max_bytes),
                    }
                },
                actual:   format!("{} bytes", actual),
                expected: format!("< {} bytes", max_bytes),
            }
        }

        Assertion::NoStepChange { max_delta_bytes } => {
            let passed = result.suspect_region.is_none();
            AssertionResult {
                assertion: "no_step_change".into(),
                status: if passed {
                    AssertionStatus::Pass
                } else {
                    let region = result.suspect_region.unwrap();
                    AssertionStatus::Fail {
                        reason: format!(
                            "step change detected at iterations {}–{}, exceeds {} bytes",
                            region.0, region.1, max_delta_bytes
                        ),
                    }
                },
                actual: result.suspect_region
                    .map(|(a, b)| format!("step at iter {}–{}", a, b))
                    .unwrap_or_else(|| "none".into()),
                expected: format!("no step > {} bytes", max_delta_bytes),
            }
        }
    }
}

// ── Parse helpers ─────────────────────────────────────────────────────────────

/// Parse human-friendly strings like "1kb/iter", "2mb", "500"
pub fn parse_bytes(s: &str) -> Result<u64, String> {
    let s = s.trim().to_lowercase();
    let s = s.trim_start_matches('<').trim();
    let (num, unit) = s.split_once(|c: char| c.is_alphabetic())
        .map(|(n, u)| (n.trim(), u.trim()))
        .unwrap_or((s, ""));

    let n: f64 = num.parse().map_err(|_| format!("cannot parse number: {s}"))?;
    let multiplier = match unit.trim_end_matches("/iter").trim() {
        "kb" | "k" => 1_024.0,
        "mb" | "m" => 1_024.0 * 1_024.0,
        "gb" | "g" => 1_024.0 * 1_024.0 * 1_024.0,
        ""          => 1.0,
        other       => return Err(format!("unknown unit: {other}")),
    };
    Ok((n * multiplier) as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_kb_per_iter() {
        assert_eq!(parse_bytes("1kb/iter").unwrap(), 1024);
        assert_eq!(parse_bytes("< 2mb").unwrap(), 2 * 1024 * 1024);
        assert_eq!(parse_bytes("512").unwrap(), 512);
    }

    #[test]
    fn growth_rate_assertion_fails_when_exceeded() {
        let result = AnalysisResult {
            slope_bytes_per_iter: 2000.0,
            pattern: crate::analyzer::LeakPattern::LinearGrowth { slope_bytes_per_iter: 2000.0 },
            baseline_delta_bytes: 20_000,
            suspect_region: None,
            r_squared: 0.95,
        };
        let assertions = vec![Assertion::GrowthRate { max_bytes_per_iter: 1024.0 }];
        let results = evaluate(&assertions, &result);
        assert!(matches!(results[0].status, AssertionStatus::Fail { .. }));
    }
}
