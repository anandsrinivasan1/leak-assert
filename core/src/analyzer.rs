use crate::sampler::Sample;
use serde::{Deserialize, Serialize};

// ── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum LeakPattern {
    /// Heap stable — no significant growth
    Stable,
    /// Constant rate increase — classic leak
    LinearGrowth { slope_bytes_per_iter: f64 },
    /// Growth rate itself increasing — worse than linear
    AcceleratingLeak { slope_bytes_per_iter: f64 },
    /// Sudden jump at a specific iteration
    StepChange { at_iter: u64, delta_bytes: i64 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisResult {
    /// Bytes added per iteration (OLS slope)
    pub slope_bytes_per_iter: f64,
    /// Classified leak pattern
    pub pattern: LeakPattern,
    /// Heap delta after a forced GC marker (if present)
    pub baseline_delta_bytes: i64,
    /// Iteration where a sudden step was detected, and the delta in bytes
    pub suspect_region: Option<(u64, i64)>,
    /// R² of the linear fit (0.0–1.0)
    pub r_squared: f64,
}

// ── Public API ───────────────────────────────────────────────────────────────

/// Analyse a sequence of samples and return a result.
/// Samples must be ordered by `iter` ascending.
pub fn analyze(samples: &[Sample]) -> AnalysisResult {
    if samples.len() < 3 {
        return AnalysisResult {
            slope_bytes_per_iter: 0.0,
            pattern: LeakPattern::Stable,
            baseline_delta_bytes: 0,
            suspect_region: None,
            r_squared: 0.0,
        };
    }

    let slope = ols_slope(samples);
    let r2    = r_squared(samples, slope);
    let log_slope = log_fit_slope(samples);

    let pattern = classify(samples, slope, log_slope, r2);
    let baseline_delta = compute_baseline_delta(samples);
    let suspect_region = detect_step_change(samples);

    AnalysisResult { slope_bytes_per_iter: slope, pattern, baseline_delta_bytes: baseline_delta, suspect_region, r_squared: r2 }
}

// ── Regression ───────────────────────────────────────────────────────────────

/// Ordinary least-squares slope: bytes / iteration
fn ols_slope(samples: &[Sample]) -> f64 {
    let n = samples.len() as f64;
    let sum_x:  f64 = samples.iter().map(|s| s.iter as f64).sum();
    let sum_y:  f64 = samples.iter().map(|s| s.heap_used as f64).sum();
    let sum_xy: f64 = samples.iter().map(|s| s.iter as f64 * s.heap_used as f64).sum();
    let sum_xx: f64 = samples.iter().map(|s| (s.iter as f64).powi(2)).sum();
    let denom = n * sum_xx - sum_x.powi(2);
    if denom.abs() < f64::EPSILON { 0.0 } else { (n * sum_xy - sum_x * sum_y) / denom }
}

/// Slope when x = ln(iter) — models logarithmic / bounded growth
fn log_fit_slope(samples: &[Sample]) -> f64 {
    let log_samples: Vec<Sample> = samples.iter()
        .filter(|s| s.iter > 0)
        .map(|s| Sample { iter: (s.iter as f64).ln() as u64, ..s.clone() })
        .collect();
    ols_slope(&log_samples)
}

/// Coefficient of determination for the linear fit
fn r_squared(samples: &[Sample], slope: f64) -> f64 {
    let n    = samples.len() as f64;
    let mean = samples.iter().map(|s| s.heap_used as f64).sum::<f64>() / n;
    let intercept = mean - slope * (samples.iter().map(|s| s.iter as f64).sum::<f64>() / n);

    let ss_res: f64 = samples.iter()
        .map(|s| {
            let predicted = slope * s.iter as f64 + intercept;
            (s.heap_used as f64 - predicted).powi(2)
        }).sum();
    let ss_tot: f64 = samples.iter()
        .map(|s| (s.heap_used as f64 - mean).powi(2))
        .sum();

    if ss_tot.abs() < f64::EPSILON { 1.0 } else { 1.0 - ss_res / ss_tot }
}

// ── Pattern Classification ───────────────────────────────────────────────────

fn classify(samples: &[Sample], slope: f64, log_slope: f64, r2: f64) -> LeakPattern {
    const STABLE_SLOPE_THRESHOLD: f64 = 10.0; // < 10 bytes/iter → stable

    if slope.abs() < STABLE_SLOPE_THRESHOLD {
        return LeakPattern::Stable;
    }

    // Check for step change first
    if let Some((at_iter, delta)) = detect_step_change(samples) {
        if delta.abs() > 1_000_000 {
            return LeakPattern::StepChange { at_iter, delta_bytes: delta };
        }
    }

    // Linear fit explains data better than log → accelerating
    if r2 > 0.85 && slope > log_slope * 1.5 {
        LeakPattern::AcceleratingLeak { slope_bytes_per_iter: slope }
    } else {
        LeakPattern::LinearGrowth { slope_bytes_per_iter: slope }
    }
}

// ── Baseline Delta ───────────────────────────────────────────────────────────

/// Compares first and last sample heap to estimate net retention
fn compute_baseline_delta(samples: &[Sample]) -> i64 {
    let first = samples.first().unwrap().heap_used as i64;
    let last  = samples.last().unwrap().heap_used as i64;
    last - first
}

// ── Step Change Detection ────────────────────────────────────────────────────

/// Find the iteration where heap made an unusually large single jump
fn detect_step_change(samples: &[Sample]) -> Option<(u64, i64)> {
    if samples.len() < 4 { return None; }

    let deltas: Vec<i64> = samples.windows(2)
        .map(|w| w[1].heap_used as i64 - w[0].heap_used as i64)
        .collect();

    let max_delta = deltas.iter().copied().max().unwrap_or(0);

    // Must be at least 1 MB to count as a step change
    if max_delta < 1_000_000 { return None; }

    // Must be an outlier: at least 10x the median delta
    let mut sorted = deltas.clone();
    sorted.sort_unstable();
    let median = sorted[sorted.len() / 2];
    if max_delta < 10 * median.max(1) { return None; }

    deltas.iter().enumerate()
        .find(|(_, &d)| d == max_delta)
        .map(|(i, &d)| (samples[i].iter, d))
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_samples(values: &[(u64, u64)]) -> Vec<Sample> {
        values.iter().map(|&(iter, heap)| Sample::new(iter, heap)).collect()
    }

    #[test]
    fn stable_heap_is_classified_stable() {
        let samples = make_samples(&[
            (100, 50_000_000), (200, 50_001_000), (300, 50_000_500),
            (400, 50_002_000), (500, 50_000_800),
        ]);
        let result = analyze(&samples);
        assert!(matches!(result.pattern, LeakPattern::Stable));
    }

    #[test]
    fn constant_growth_is_linear() {
        // +10kb every 100 iterations = 100 bytes/iter
        let samples = make_samples(&[
            (100, 50_000_000), (200, 50_010_000), (300, 50_020_000),
            (400, 50_030_000), (500, 50_040_000), (600, 50_050_000),
        ]);
        let result = analyze(&samples);
        assert!(matches!(result.pattern, LeakPattern::LinearGrowth { .. }));
        assert!(result.slope_bytes_per_iter > 50.0);
    }

    #[test]
    fn slope_calculation_is_accurate() {
        // Exact linear: heap = 50MB + 200 * iter
        let samples = make_samples(&[
            (0,   50_000_000),
            (100, 50_020_000),
            (200, 50_040_000),
            (300, 50_060_000),
        ]);
        let slope = ols_slope(&samples);
        // slope should be ~200 bytes/iter
        assert!((slope - 200.0).abs() < 1.0, "slope was {slope}");
    }

    #[test]
    fn step_change_is_detected() {
        let samples = make_samples(&[
            (100, 50_000_000), (200, 50_001_000), (300, 50_002_000),
            (400, 55_000_000), // sudden +5MB jump
            (500, 55_001_000), (600, 55_002_000),
        ]);
        let result = analyze(&samples);
        assert!(result.suspect_region.is_some());
    }
}
