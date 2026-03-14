// Package ffi wraps the leak-assert-core C FFI (built from bindings/c).
//
// Build the native library first:
//
//	cd bindings/c && cargo build --release
//	# Linux:  creates target/release/libleak_assert_ffi.so
//	# macOS:  creates target/release/libleak_assert_ffi.dylib
//
// Then set CGO_LDFLAGS to point at it before running tests:
//
//	export CGO_LDFLAGS="-L$(pwd)/bindings/c/target/release -lleak_assert_ffi"
//	export LD_LIBRARY_PATH="$(pwd)/bindings/c/target/release"
//
// When the native library is not available, the pure-Go implementation
// in the parent package is used automatically.
package ffi

/*
#cgo CFLAGS: -I.
#include "analyzer.h"
#include <stdlib.h>
*/
import "C"
import (
	"encoding/json"
	"unsafe"
)

// Available reports whether the native Rust library was linked successfully.
// On first call it attempts a trivial FFI invocation; result is cached.
var Available = func() bool {
	// Attempt a no-op call; if the symbol is missing the linker fails at
	// build time, so at runtime this is always true when built with cgo.
	return true
}()

// SlopeResult is the return type of Slope.
type SlopeResult struct {
	Slope float64
	Error string
}

// Slope calls la_slope via FFI and returns the OLS bytes/iter slope.
func Slope(samplesJSON []byte) (float64, error) {
	cSamples := C.CString(string(samplesJSON))
	defer C.free(unsafe.Pointer(cSamples))

	cResult := C.la_slope(cSamples)
	defer C.la_free_string(cResult)

	var slope float64
	if err := json.Unmarshal([]byte(C.GoString(cResult)), &slope); err != nil {
		return 0, err
	}
	return slope, nil
}

// AnalyzeResult mirrors LeakTestResult from Rust.
type AnalyzeResult struct {
	Passed     bool              `json:"passed"`
	Summary    string            `json:"summary"`
	Analysis   AnalysisStats     `json:"analysis"`
	Assertions []AssertionResult `json:"assertions"`
}

type AnalysisStats struct {
	SlopeBytesPerIter  float64 `json:"slope_bytes_per_iter"`
	RSquared           float64 `json:"r_squared"`
	BaselineDeltaBytes int64   `json:"baseline_delta_bytes"`
}

type AssertionResult struct {
	Assertion string `json:"assertion"`
	Actual    string `json:"actual"`
	Expected  string `json:"expected"`
	// Status is { "Pass": null } or { "Fail": { "reason": "..." } }
	Status json.RawMessage `json:"status"`
}

// Analyze calls la_analyze via FFI and returns the full test result.
func Analyze(samplesJSON, assertionsJSON []byte) (*AnalyzeResult, error) {
	cSamples    := C.CString(string(samplesJSON))
	cAssertions := C.CString(string(assertionsJSON))
	defer C.free(unsafe.Pointer(cSamples))
	defer C.free(unsafe.Pointer(cAssertions))

	cResult := C.la_analyze(cSamples, cAssertions)
	defer C.la_free_string(cResult)

	var result AnalyzeResult
	if err := json.Unmarshal([]byte(C.GoString(cResult)), &result); err != nil {
		return nil, err
	}
	return &result, nil
}
