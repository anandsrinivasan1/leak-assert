use leak_assert_core::{run_assertions, Assertion, Sample};
use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;

/// analyse_json(samples_json: str, assertions_json: str) -> str
///
/// Both arguments are JSON strings.
/// Returns a JSON string of LeakTestResult.
/// Raises ValueError on parse errors.
#[pyfunction]
fn analyse_json(samples_json: &str, assertions_json: &str) -> PyResult<String> {
    let samples: Vec<Sample> = serde_json::from_str(samples_json)
        .map_err(|e| PyValueError::new_err(format!("invalid samples JSON: {e}")))?;

    let assertions: Vec<Assertion> = serde_json::from_str(assertions_json)
        .map_err(|e| PyValueError::new_err(format!("invalid assertions JSON: {e}")))?;

    let result = run_assertions(&samples, &assertions);

    serde_json::to_string(&result)
        .map_err(|e| PyValueError::new_err(format!("serialisation error: {e}")))
}

/// slope(samples_json: str) -> float
///
/// Fast path: compute only the OLS slope from a JSON samples array.
#[pyfunction]
fn slope(samples_json: &str) -> PyResult<f64> {
    let samples: Vec<Sample> = serde_json::from_str(samples_json)
        .map_err(|e| PyValueError::new_err(format!("invalid samples JSON: {e}")))?;

    if samples.len() < 2 {
        return Ok(0.0);
    }
    let n      = samples.len() as f64;
    let sum_x:  f64 = samples.iter().map(|s| s.iter as f64).sum();
    let sum_y:  f64 = samples.iter().map(|s| s.heap_used as f64).sum();
    let sum_xy: f64 = samples.iter().map(|s| s.iter as f64 * s.heap_used as f64).sum();
    let sum_xx: f64 = samples.iter().map(|s| (s.iter as f64).powi(2)).sum();
    let denom   = n * sum_xx - sum_x.powi(2);
    Ok(if denom.abs() < f64::EPSILON { 0.0 } else { (n * sum_xy - sum_x * sum_y) / denom })
}

#[pymodule]
fn leak_assert_native(_py: Python, m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(analyse_json, m)?)?;
    m.add_function(wrap_pyfunction!(slope, m)?)?;
    Ok(())
}
