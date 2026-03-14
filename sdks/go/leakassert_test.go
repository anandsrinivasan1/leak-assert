package leakassert_test

import (
	"testing"

	leakassert "github.com/leak-assert/leak-assert-go"
)

// ── OLSSlope ──────────────────────────────────────────────────────────────────

func TestOLSSlope_flat(t *testing.T) {
	samples := []leakassert.Sample{
		{Iter: 100, HeapUsed: 50_000_000},
		{Iter: 200, HeapUsed: 50_000_000},
		{Iter: 300, HeapUsed: 50_000_000},
	}
	slope := leakassert.OLSSlope(samples)
	if slope > 10 {
		t.Errorf("expected ~0 slope for flat heap, got %.2f", slope)
	}
}

func TestOLSSlope_linear(t *testing.T) {
	// heap = 50MB + 200 * iter
	samples := []leakassert.Sample{
		{Iter: 0, HeapUsed: 50_000_000},
		{Iter: 100, HeapUsed: 50_020_000},
		{Iter: 200, HeapUsed: 50_040_000},
		{Iter: 300, HeapUsed: 50_060_000},
	}
	slope := leakassert.OLSSlope(samples)
	if slope < 190 || slope > 210 {
		t.Errorf("expected slope ~200, got %.2f", slope)
	}
}

func TestOLSSlope_tooFewSamples(t *testing.T) {
	if leakassert.OLSSlope(nil) != 0 {
		t.Error("expected 0 for nil samples")
	}
	if leakassert.OLSSlope([]leakassert.Sample{{Iter: 0, HeapUsed: 1000}}) != 0 {
		t.Error("expected 0 for single sample")
	}
}

// ── ParseBytes ────────────────────────────────────────────────────────────────

func TestParseBytes(t *testing.T) {
	cases := []struct {
		input    string
		expected uint64
	}{
		{"1kb",      1024},
		{"1KB",      1024},
		{"2mb",      2 * 1024 * 1024},
		{"1kb/iter", 1024},
		{"< 512",    512},
		{"1024",     1024},
	}
	for _, c := range cases {
		got, err := leakassert.ParseBytes(c.input)
		if err != nil {
			t.Errorf("ParseBytes(%q) error: %v", c.input, err)
			continue
		}
		if got != c.expected {
			t.Errorf("ParseBytes(%q) = %d, want %d", c.input, got, c.expected)
		}
	}
}

// ── GrowthRate assertion ──────────────────────────────────────────────────────

func TestGrowthRateAssertion_passes(t *testing.T) {
	lt := leakassert.New(t, leakassert.Config{Iterations: 100, Warmup: 0})
	lt.Run(func() {
		buf := make([]byte, 64)
		_ = len(buf)
	})
	lt.Assert(leakassert.GrowthRate("10kb/iter"))
}

func TestStableAssertion_passes(t *testing.T) {
	lt := leakassert.New(t, leakassert.Config{Iterations: 50, Warmup: 0})
	lt.Run(func() {
		buf := make([]byte, 128)
		_ = buf
	})
	lt.Assert(leakassert.Stable(10 * leakassert.MB))
}

func TestGoroutinesStable_passes(t *testing.T) {
	lt := leakassert.New(t, leakassert.Config{Iterations: 50, Warmup: 0})
	lt.Run(func() {
		done := make(chan struct{})
		go func() { close(done) }()
		<-done
	})
	lt.Assert(leakassert.GoroutinesStable())
}

// ── ForceGC ───────────────────────────────────────────────────────────────────

func TestForceGC_doesNotPanic(t *testing.T) {
	leakassert.ForceGC()
}

// ── TakeSample ────────────────────────────────────────────────────────────────

func TestTakeSample_fields(t *testing.T) {
	s := leakassert.TakeSample(42, "test")
	if s.Iter != 42 {
		t.Errorf("iter: want 42, got %d", s.Iter)
	}
	if s.Label != "test" {
		t.Errorf("label: want 'test', got %q", s.Label)
	}
	if s.TS == 0 {
		t.Error("timestamp should not be zero")
	}
}
