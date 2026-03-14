package leakassert

import (
	"runtime"
	"testing"
)

// HeapObjectSnapshot captures goroutine count and key runtime stats
// that can be used to detect goroutine and resource leaks.
type HeapObjectSnapshot struct {
	Goroutines int
	HeapObjects uint64
	HeapAlloc   uint64
}

// TakeObjectSnapshot captures the current runtime object counts.
func TakeObjectSnapshot() HeapObjectSnapshot {
	var ms runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&ms)
	return HeapObjectSnapshot{
		Goroutines:  runtime.NumGoroutine(),
		HeapObjects: ms.HeapObjects,
		HeapAlloc:   ms.HeapAlloc,
	}
}

// ObjectDiff is the delta between two snapshots.
type ObjectDiff struct {
	GoroutinesDelta  int
	HeapObjectsDelta int64
	HeapAllocDelta   int64
}

// Diff returns the difference from before to after.
func (before HeapObjectSnapshot) Diff(after HeapObjectSnapshot) ObjectDiff {
	return ObjectDiff{
		GoroutinesDelta:  after.Goroutines - before.Goroutines,
		HeapObjectsDelta: int64(after.HeapObjects) - int64(before.HeapObjects),
		HeapAllocDelta:   int64(after.HeapAlloc) - int64(before.HeapAlloc),
	}
}

// ObjectLeakChecker wraps before/after snapshots and asserts on the diff.
type ObjectLeakChecker struct {
	t      *testing.T
	before HeapObjectSnapshot
}

// NewObjectLeakChecker takes a baseline snapshot. Call Check() after the workload.
func NewObjectLeakChecker(t *testing.T) *ObjectLeakChecker {
	t.Helper()
	return &ObjectLeakChecker{t: t, before: TakeObjectSnapshot()}
}

// Check compares current state to the baseline and fails t if limits exceeded.
func (c *ObjectLeakChecker) Check(opts ObjectCheckOptions) {
	c.t.Helper()
	after := TakeObjectSnapshot()
	diff  := c.before.Diff(after)

	maxGoroutines := opts.MaxGoroutinesDelta
	if maxGoroutines == 0 {
		maxGoroutines = 2 // small tolerance for background goroutines
	}

	if diff.GoroutinesDelta > maxGoroutines {
		c.t.Errorf(
			"leak-assert [goroutines]: +%d goroutines leaked (threshold: %d)",
			diff.GoroutinesDelta, maxGoroutines,
		)
	}

	if opts.MaxHeapObjectsDelta > 0 && diff.HeapObjectsDelta > int64(opts.MaxHeapObjectsDelta) {
		c.t.Errorf(
			"leak-assert [heap-objects]: +%d heap objects leaked (threshold: %d)",
			diff.HeapObjectsDelta, opts.MaxHeapObjectsDelta,
		)
	}
}

// ObjectCheckOptions configures the object leak check.
type ObjectCheckOptions struct {
	// Maximum allowed goroutine increase (default: 2)
	MaxGoroutinesDelta int
	// Maximum allowed heap object increase (0 = no check)
	MaxHeapObjectsDelta uint64
}
