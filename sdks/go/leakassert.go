// Package leakassert provides memory leak regression testing for Go.
// It integrates directly with testing.T so it works with go test.
//
// Usage:
//
//	func TestHandlerNoLeak(t *testing.T) {
//	    lt := leakassert.New(t, leakassert.Config{Iterations: 2000})
//	    lt.Run(func() { myHandler(w, r) })
//	    lt.Assert(leakassert.GrowthRate("1kb/iter"), leakassert.Stable(2*leakassert.MB))
//	}
package leakassert

import (
	"fmt"
	"runtime"
	"testing"
)

// ── Config ────────────────────────────────────────────────────────────────────

// Config controls how the leak test runs.
type Config struct {
	// Iterations to run before sampling. Excluded from analysis.
	Warmup int
	// Total test iterations (after warmup).
	Iterations int
	// Sample heap every N iterations.
	SampleEvery int
	// Force GC before each sample.
	ForceGC bool
}

func (c *Config) defaults() {
	if c.Iterations == 0 {
		c.Iterations = 1000
	}
	if c.SampleEvery == 0 {
		n := c.Iterations / 50
		if n < 1 {
			n = 1
		}
		c.SampleEvery = n
	}
	if !c.ForceGC {
		c.ForceGC = true // default on
	}
}

// ── AnalysisResult ────────────────────────────────────────────────────────────

// AnalysisResult holds computed statistics from the sample set.
type AnalysisResult struct {
	SlopeBytesPerIter float64
	BaselineDelta     int64
	SuspectRegion     *[2]int // iter range where a step was detected
}

// ── LeakTest ──────────────────────────────────────────────────────────────────

// LeakTest runs a workload and collects heap samples.
type LeakTest struct {
	t       *testing.T
	cfg     Config
	samples []Sample
	goroutinesAtStart int
}

// New creates a LeakTest bound to a *testing.T.
func New(t *testing.T, cfg Config) *LeakTest {
	t.Helper()
	cfg.defaults()
	return &LeakTest{t: t, cfg: cfg}
}

// Run executes fn for Warmup + Iterations times, collecting samples.
func (lt *LeakTest) Run(fn func()) *LeakTest {
	lt.t.Helper()

	// warmup
	for i := 0; i < lt.cfg.Warmup; i++ {
		fn()
	}

	lt.goroutinesAtStart = runtime.NumGoroutine()
	lt.samples           = nil

	for i := 1; i <= lt.cfg.Iterations; i++ {
		fn()
		if i%lt.cfg.SampleEvery == 0 {
			if lt.cfg.ForceGC {
				ForceGC()
			}
			lt.samples = append(lt.samples, TakeSample(i, ""))
		}
	}
	return lt
}

// Assert evaluates each Assertion against the collected samples.
// Calls t.Errorf for each failure (non-fatal — reports all failures).
func (lt *LeakTest) Assert(assertions ...Assertion) *LeakTest {
	lt.t.Helper()

	if len(lt.samples) == 0 {
		lt.t.Error("leak-assert: no samples collected — did you call Run()?")
		return lt
	}

	result := &AnalysisResult{
		SlopeBytesPerIter: OLSSlope(lt.samples),
		BaselineDelta:     int64(lt.samples[len(lt.samples)-1].HeapUsed) - int64(lt.samples[0].HeapUsed),
	}

	allPassed := true
	for _, a := range assertions {
		if err := a.check(result, lt.samples); err != nil {
			lt.t.Errorf("%s", err)
			allPassed = false
		}
		// Goroutine assertion handled specially
		if _, ok := a.(*goroutineAssertion); ok {
			current := runtime.NumGoroutine()
			if current > lt.goroutinesAtStart+2 { // +2 tolerance
				lt.t.Errorf(
					"leak-assert [GoroutinesStable]: %d goroutines leaked (started with %d)",
					current-lt.goroutinesAtStart, lt.goroutinesAtStart,
				)
				allPassed = false
			}
		}
	}

	if allPassed {
		lt.t.Logf("leak-assert: PASS — slope %.1f bytes/iter over %d samples",
			result.SlopeBytesPerIter, len(lt.samples))
	}

	return lt
}

// PrintSummary logs a human-readable summary via t.Log.
func (lt *LeakTest) PrintSummary() *LeakTest {
	if len(lt.samples) == 0 {
		return lt
	}
	slope := OLSSlope(lt.samples)
	delta := int64(lt.samples[len(lt.samples)-1].HeapUsed) - int64(lt.samples[0].HeapUsed)
	lt.t.Logf(
		"\n── leak-assert ──\n  samples:     %d\n  growth:      %.1f bytes/iter\n  total delta: %s\n──────────────────",
		len(lt.samples),
		slope,
		formatBytes(delta),
	)
	return lt
}

func formatBytes(b int64) string {
	abs := b
	if abs < 0 { abs = -abs }
	sign := ""
	if b < 0 { sign = "-" }
	switch {
	case abs >= 1024*1024:
		return fmt.Sprintf("%s%.2f MB", sign, float64(abs)/1024/1024)
	case abs >= 1024:
		return fmt.Sprintf("%s%.1f KB", sign, float64(abs)/1024)
	default:
		return fmt.Sprintf("%s%d B", sign, abs)
	}
}
