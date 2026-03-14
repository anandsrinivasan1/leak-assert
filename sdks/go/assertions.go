package leakassert

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
)

// ── Types ─────────────────────────────────────────────────────────────────────

// Assertion is a single constraint on the memory profile.
type Assertion interface {
	check(result *AnalysisResult, samples []Sample) error
}

// AssertionError is returned when an assertion fails.
type AssertionError struct {
	Name     string
	Actual   string
	Expected string
}

func (e *AssertionError) Error() string {
	return fmt.Sprintf("leak-assert [%s]: %s — expected %s", e.Name, e.Actual, e.Expected)
}

// ── Assertion constructors ────────────────────────────────────────────────────

// GrowthRate fails if heap growth per iteration exceeds max.
// max accepts "1kb/iter", "500", 1024, etc.
func GrowthRate(max string) Assertion {
	return &growthRateAssertion{maxBytesPerIter: mustParseBytes(max)}
}

// Stable fails if total heap delta exceeds tolerance after the run.
func Stable(toleranceBytes uint64) Assertion {
	return &stableAssertion{toleranceBytes: toleranceBytes}
}

// Ceiling fails if peak heap exceeds the absolute limit.
func Ceiling(maxBytes uint64) Assertion {
	return &ceilingAssertion{maxBytes: maxBytes}
}

// GoroutinesStable fails if goroutine count increases.
// (Goroutine tracking handled separately — see goroutines.go)
func GoroutinesStable() Assertion {
	return &goroutineAssertion{}
}

// NoRetainedTypes fails if the live heap-object count increased by more than
// maxDelta between the start and end of the run.
//
// Note: Go's runtime does not expose per-type object counts. This assertion
// checks the total live-object delta (runtime.MemStats.HeapObjects) instead.
// Use a small maxDelta (e.g. 100) to catch unbounded retention.
func NoRetainedTypes(maxDelta uint64) Assertion {
	return &noRetainedTypesAssertion{maxDelta: maxDelta}
}

// ── Implementations ───────────────────────────────────────────────────────────

type growthRateAssertion struct{ maxBytesPerIter float64 }

func (a *growthRateAssertion) check(result *AnalysisResult, _ []Sample) error {
	if result.SlopeBytesPerIter > a.maxBytesPerIter {
		return &AssertionError{
			Name:     "GrowthRate",
			Actual:   fmt.Sprintf("%.1f bytes/iter", result.SlopeBytesPerIter),
			Expected: fmt.Sprintf("< %.1f bytes/iter", a.maxBytesPerIter),
		}
	}
	return nil
}

type stableAssertion struct{ toleranceBytes uint64 }

func (a *stableAssertion) check(_ *AnalysisResult, samples []Sample) error {
	if len(samples) < 2 {
		return nil
	}
	first := samples[0].HeapUsed
	last  := samples[len(samples)-1].HeapUsed
	delta := absDiff(last, first)
	if delta > a.toleranceBytes {
		return &AssertionError{
			Name:     "Stable",
			Actual:   fmt.Sprintf("+%.2f MB retained", float64(delta)/1024/1024),
			Expected: fmt.Sprintf("< %.2f MB", float64(a.toleranceBytes)/1024/1024),
		}
	}
	return nil
}

type ceilingAssertion struct{ maxBytes uint64 }

func (a *ceilingAssertion) check(_ *AnalysisResult, samples []Sample) error {
	var peak uint64
	for _, s := range samples {
		if s.HeapUsed > peak {
			peak = s.HeapUsed
		}
	}
	if peak > a.maxBytes {
		return &AssertionError{
			Name:     "Ceiling",
			Actual:   fmt.Sprintf("%.2f MB peak", float64(peak)/1024/1024),
			Expected: fmt.Sprintf("< %.2f MB", float64(a.maxBytes)/1024/1024),
		}
	}
	return nil
}

type goroutineAssertion struct{}

func (a *goroutineAssertion) check(_ *AnalysisResult, _ []Sample) error {
	// Goroutine check handled in LeakTest.Assert via runtime.NumGoroutine()
	return nil
}

type noRetainedTypesAssertion struct{ maxDelta uint64 }

func (a *noRetainedTypesAssertion) check(result *AnalysisResult, _ []Sample) error {
	if result.HeapObjectsDelta > int64(a.maxDelta) {
		return &AssertionError{
			Name:     "NoRetainedTypes",
			Actual:   fmt.Sprintf("+%d live heap objects retained", result.HeapObjectsDelta),
			Expected: fmt.Sprintf("≤ %d additional live objects", a.maxDelta),
		}
	}
	return nil
}

// ── Math ──────────────────────────────────────────────────────────────────────

// OLSSlope computes bytes gained per iteration via ordinary least squares.
func OLSSlope(samples []Sample) float64 {
	n := float64(len(samples))
	if n < 2 {
		return 0
	}
	var sumX, sumY, sumXY, sumXX float64
	for _, s := range samples {
		x := float64(s.Iter)
		y := float64(s.HeapUsed)
		sumX  += x
		sumY  += y
		sumXY += x * y
		sumXX += x * x
	}
	denom := n*sumXX - sumX*sumX
	if math.Abs(denom) < 1e-10 {
		return 0
	}
	return (n*sumXY - sumX*sumY) / denom
}

func absDiff(a, b uint64) uint64 {
	if a > b {
		return a - b
	}
	return b - a
}

// ── Parse helpers ─────────────────────────────────────────────────────────────

var bytesRe = regexp.MustCompile(`(?i)^<?\s*([\d.]+)\s*(kb?|mb?|gb?)?(\/iter)?$`)

func ParseBytes(s string) (uint64, error) {
	s = strings.TrimSpace(s)
	m := bytesRe.FindStringSubmatch(s)
	if m == nil {
		return 0, fmt.Errorf("leak-assert: cannot parse bytes value %q", s)
	}
	n, err := strconv.ParseFloat(m[1], 64)
	if err != nil {
		return 0, err
	}
	unit := strings.TrimSuffix(strings.ToLower(m[2]), "b")
	mult := map[string]float64{"k": 1024, "m": 1024 * 1024, "g": 1024 * 1024 * 1024, "": 1}[unit]
	return uint64(n * mult), nil
}

func mustParseBytes(s string) float64 {
	v, err := ParseBytes(s)
	if err != nil {
		panic(err)
	}
	return float64(v)
}

// Convenience constants
const (
	KB = uint64(1024)
	MB = uint64(1024 * 1024)
	GB = uint64(1024 * 1024 * 1024)
)
