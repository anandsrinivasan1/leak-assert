//! C-compatible FFI layer consumed by the Go SDK via cgo.
//! All functions take/return null-terminated C strings (JSON).
//! Caller must free strings returned by this library with la_free_string().

use leak_assert_core::{run_assertions, Assertion, Sample};
use std::ffi::{CStr, CString};
use std::os::raw::c_char;

// ── Helpers ───────────────────────────────────────────────────────────────────

fn cstr_to_str<'a>(ptr: *const c_char) -> Option<&'a str> {
    if ptr.is_null() {
        return None;
    }
    unsafe { CStr::from_ptr(ptr).to_str().ok() }
}

fn str_to_cstring(s: String) -> *mut c_char {
    CString::new(s)
        .map(|cs| cs.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Analyse samples and evaluate assertions.
/// Returns a JSON string of LeakTestResult on success, or an error JSON on failure.
/// The returned pointer MUST be freed with la_free_string().
#[allow(clippy::not_unsafe_ptr_arg_deref)]
#[no_mangle]
pub extern "C" fn la_analyze(
    samples_json: *const c_char,
    assertions_json: *const c_char,
) -> *mut c_char {
    let samples_str = match cstr_to_str(samples_json) {
        Some(s) => s,
        None => return error("null samples_json"),
    };
    let assertions_str = match cstr_to_str(assertions_json) {
        Some(s) => s,
        None => return error("null assertions_json"),
    };

    let samples: Vec<Sample> = match serde_json::from_str(samples_str) {
        Ok(v) => v,
        Err(e) => return error(&format!("invalid samples JSON: {e}")),
    };
    let assertions: Vec<Assertion> = match serde_json::from_str(assertions_str) {
        Ok(v) => v,
        Err(e) => return error(&format!("invalid assertions JSON: {e}")),
    };

    let result = run_assertions(&samples, &assertions);
    match serde_json::to_string(&result) {
        Ok(json) => str_to_cstring(json),
        Err(e) => error(&format!("serialisation error: {e}")),
    }
}

/// Compute OLS slope only.  Returns the slope as a JSON number string.
#[allow(clippy::not_unsafe_ptr_arg_deref)]
#[no_mangle]
pub extern "C" fn la_slope(samples_json: *const c_char) -> *mut c_char {
    let s = match cstr_to_str(samples_json) {
        Some(s) => s,
        None => return error("null samples_json"),
    };
    let samples: Vec<Sample> = match serde_json::from_str(s) {
        Ok(v) => v,
        Err(e) => return error(&format!("invalid samples JSON: {e}")),
    };
    if samples.len() < 2 {
        return str_to_cstring("0.0".into());
    }
    let n = samples.len() as f64;
    let sum_x: f64 = samples.iter().map(|s| s.iter as f64).sum();
    let sum_y: f64 = samples.iter().map(|s| s.heap_used as f64).sum();
    let sum_xy: f64 = samples
        .iter()
        .map(|s| s.iter as f64 * s.heap_used as f64)
        .sum();
    let sum_xx: f64 = samples.iter().map(|s| (s.iter as f64).powi(2)).sum();
    let denom = n * sum_xx - sum_x.powi(2);
    let slope = if denom.abs() < f64::EPSILON {
        0.0
    } else {
        (n * sum_xy - sum_x * sum_y) / denom
    };
    str_to_cstring(slope.to_string())
}

/// Free a string previously returned by this library.
#[allow(clippy::not_unsafe_ptr_arg_deref)]
#[no_mangle]
pub extern "C" fn la_free_string(ptr: *mut c_char) {
    if ptr.is_null() {
        return;
    }
    unsafe { drop(CString::from_raw(ptr)) }
}

fn error(msg: &str) -> *mut c_char {
    str_to_cstring(format!(r#"{{"error":"{msg}"}}"#))
}
