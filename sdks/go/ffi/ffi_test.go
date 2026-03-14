package ffi_test

import (
	"encoding/json"
	"testing"

	"github.com/leak-assert/leak-assert-go/ffi"
)

// sample is a minimal JSON-serialisable heap sample matching the Rust Sample struct.
type sample struct {
	TS       uint64 `json:"ts"`
	Iter     uint64 `json:"iter"`
	HeapUsed uint64 `json:"heap_used"`
}

func samplesJSON(pairs [][2]uint64) []byte {
	ss := make([]sample, len(pairs))
	for i, p := range pairs {
		ss[i] = sample{TS: uint64(i) * 100, Iter: p[0], HeapUsed: p[1]}
	}
	b, _ := json.Marshal(ss)
	return b
}

// ── Slope ──────────────────────────────────────────────────────────────────────

func TestFFISlope_flat(t *testing.T) {
	b := samplesJSON([][2]uint64{
		{100, 50_000_000},
		{200, 50_000_000},
		{300, 50_000_000},
	})
	slope, err := ffi.Slope(b)
	if err != nil {
		t.Fatalf("Slope() error: %v", err)
	}
	if slope > 10 {
		t.Errorf("expected ≈0 slope for flat heap, got %.2f", slope)
	}
}

func TestFFISlope_linear(t *testing.T) {
	// heap = 50 MB + 200 * iter
	b := samplesJSON([][2]uint64{
		{0, 50_000_000},
		{100, 50_020_000},
		{200, 50_040_000},
		{300, 50_060_000},
	})
	slope, err := ffi.Slope(b)
	if err != nil {
		t.Fatalf("Slope() error: %v", err)
	}
	if slope < 190 || slope > 210 {
		t.Errorf("expected slope ≈200 bytes/iter, got %.2f", slope)
	}
}

func TestFFISlope_tooFewSamples(t *testing.T) {
	b, _ := json.Marshal([]sample{{TS: 0, Iter: 0, HeapUsed: 1000}})
	slope, err := ffi.Slope(b)
	if err != nil {
		t.Fatalf("Slope() error: %v", err)
	}
	if slope != 0 {
		t.Errorf("expected 0 for single sample, got %.2f", slope)
	}
}

// ── Analyze ───────────────────────────────────────────────────────────────────

func TestFFIAnalyze_growthRate_passes(t *testing.T) {
	// ~50 bytes/iter slope — well within 1 KB/iter limit
	samples := samplesJSON([][2]uint64{
		{0, 50_000_000},
		{100, 50_005_000},
		{200, 50_010_000},
		{300, 50_015_000},
	})
	assertions, _ := json.Marshal([]map[string]any{
		{"type": "growth_rate", "max_bytes_per_iter": 1024.0},
	})
	result, err := ffi.Analyze(samples, assertions)
	if err != nil {
		t.Fatalf("Analyze() error: %v", err)
	}
	if !result.Passed {
		t.Errorf("expected PASS; summary: %s", result.Summary)
	}
}

func TestFFIAnalyze_growthRate_fails(t *testing.T) {
	// ~2000 bytes/iter — exceeds 512 bytes/iter limit
	samples := samplesJSON([][2]uint64{
		{0, 50_000_000},
		{100, 50_200_000},
		{200, 50_400_000},
		{300, 50_600_000},
	})
	assertions, _ := json.Marshal([]map[string]any{
		{"type": "growth_rate", "max_bytes_per_iter": 512.0},
	})
	result, err := ffi.Analyze(samples, assertions)
	if err != nil {
		t.Fatalf("Analyze() error: %v", err)
	}
	if result.Passed {
		t.Errorf("expected FAIL; summary: %s", result.Summary)
	}
}

func TestFFIAnalyze_stable_passes(t *testing.T) {
	// delta < 1 MB — within 10 MB tolerance
	samples := samplesJSON([][2]uint64{
		{0, 50_000_000},
		{500, 50_500_000},
		{1000, 50_800_000},
	})
	assertions, _ := json.Marshal([]map[string]any{
		{"type": "stable", "tolerance_bytes": uint64(10 * 1024 * 1024)},
	})
	result, err := ffi.Analyze(samples, assertions)
	if err != nil {
		t.Fatalf("Analyze() error: %v", err)
	}
	if !result.Passed {
		t.Errorf("expected PASS; summary: %s", result.Summary)
	}
}

func TestFFIAnalyze_statsPopulated(t *testing.T) {
	samples := samplesJSON([][2]uint64{
		{0, 50_000_000},
		{100, 50_020_000},
		{200, 50_040_000},
	})
	assertions, _ := json.Marshal([]map[string]any{
		{"type": "growth_rate", "max_bytes_per_iter": 1024.0},
	})
	result, err := ffi.Analyze(samples, assertions)
	if err != nil {
		t.Fatalf("Analyze() error: %v", err)
	}
	if result.Analysis.SlopeBytesPerIter < 100 || result.Analysis.SlopeBytesPerIter > 300 {
		t.Errorf("expected slope ≈200, got %.2f", result.Analysis.SlopeBytesPerIter)
	}
	if result.Analysis.RSquared < 0.9 {
		t.Errorf("expected high R² for linear data, got %.3f", result.Analysis.RSquared)
	}
}
