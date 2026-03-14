package example_test

import (
	"testing"

	leakassert "github.com/leak-assert/leak-assert-go"
)

// ── Example 1: Leaky map is caught ───────────────────────────────────────────

var leakyMap = make(map[int][]byte)

func TestLeakyMapIsCaught(t *testing.T) {
	i := 0
	lt := leakassert.New(t, leakassert.Config{
		Warmup:     50,
		Iterations: 500,
	})

	lt.Run(func() {
		// Bug: never deletes — map grows forever
		leakyMap[i] = make([]byte, 1024)
		i++
	})

	// This assertion WILL fail — demonstrating leak detection
	// In real tests, remove the t.Skip and expect the assertion to fail CI
	t.Skip("intentional leak demo — remove skip to see failure")
	lt.Assert(leakassert.GrowthRate("512"))
}

// ── Example 2: Clean handler passes ─────────────────────────────────────────

func TestCleanHandlerNoLeak(t *testing.T) {
	lt := leakassert.New(t, leakassert.Config{
		Warmup:     100,
		Iterations: 2000,
		ForceGC:    true,
	})

	lt.Run(func() {
		// Allocate and release — GC will collect
		buf := make([]byte, 4096)
		_ = len(buf)
	})

	lt.PrintSummary()

	lt.Assert(
		leakassert.GrowthRate("1kb/iter"),
		leakassert.Stable(5*leakassert.MB),
		leakassert.Ceiling(200*leakassert.MB),
	)
}

// ── Example 3: Goroutine leak detected ──────────────────────────────────────

func TestNoGoroutineLeak(t *testing.T) {
	lt := leakassert.New(t, leakassert.Config{
		Iterations: 200,
		Warmup:     20,
	})

	lt.Run(func() {
		// Correctly waits for goroutine — no leak
		done := make(chan struct{})
		go func() {
			close(done)
		}()
		<-done
	})

	lt.Assert(
		leakassert.GrowthRate("1kb/iter"),
		leakassert.GoroutinesStable(),
	)
}
