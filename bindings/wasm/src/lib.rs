use leak_assert_core::{run_assertions, Assertion, Sample};
use wasm_bindgen::prelude::*;

/// Analyse samples and evaluate assertions.
/// Both arguments are JSON strings matching the spec/envelope.schema.json format.
/// Returns a JSON string of LeakTestResult.
#[wasm_bindgen]
pub fn analyze_json(samples_json: &str, assertions_json: &str) -> Result<String, JsValue> {
    let samples: Vec<Sample> = serde_json::from_str(samples_json)
        .map_err(|e| JsValue::from_str(&format!("invalid samples JSON: {e}")))?;

    let assertions: Vec<Assertion> = serde_json::from_str(assertions_json)
        .map_err(|e| JsValue::from_str(&format!("invalid assertions JSON: {e}")))?;

    let result = run_assertions(&samples, &assertions);

    serde_json::to_string(&result)
        .map_err(|e| JsValue::from_str(&format!("serialisation error: {e}")))
}

/// Compute OLS slope only — lightweight path for streaming analysis.
#[wasm_bindgen]
pub fn slope_json(samples_json: &str) -> Result<f64, JsValue> {
    let samples: Vec<Sample> = serde_json::from_str(samples_json)
        .map_err(|e| JsValue::from_str(&format!("invalid samples JSON: {e}")))?;

    if samples.len() < 2 {
        return Ok(0.0);
    }

    let n = samples.len() as f64;
    let sum_x:  f64 = samples.iter().map(|s| s.iter as f64).sum();
    let sum_y:  f64 = samples.iter().map(|s| s.heap_used as f64).sum();
    let sum_xy: f64 = samples.iter().map(|s| s.iter as f64 * s.heap_used as f64).sum();
    let sum_xx: f64 = samples.iter().map(|s| (s.iter as f64).powi(2)).sum();
    let denom   = n * sum_xx - sum_x.powi(2);
    Ok(if denom.abs() < f64::EPSILON { 0.0 } else { (n * sum_xy - sum_x * sum_y) / denom })
}
