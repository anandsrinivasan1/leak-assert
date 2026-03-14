package leakassert

import (
	"runtime"
	"time"
)

// Sample is the common memory envelope — matches spec/envelope.schema.json
type Sample struct {
	TS        int64  `json:"ts"`         // unix ms
	Iter      int    `json:"iter"`
	HeapUsed  uint64 `json:"heap_used"`  // bytes (HeapInuse)
	HeapTotal uint64 `json:"heap_total"` // bytes (HeapSys)
	RSS       uint64 `json:"rss"`        // bytes (Sys)
	External  uint64 `json:"external"`
	GCCount   uint32 `json:"gc_count"`
	Label     string `json:"label,omitempty"`
}

// TakeSample reads runtime.MemStats and returns a Sample.
// Call runtime.GC() before this for a clean snapshot.
func TakeSample(iter int, label string) Sample {
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	return Sample{
		TS:        time.Now().UnixMilli(),
		Iter:      iter,
		HeapUsed:  ms.HeapInuse,
		HeapTotal: ms.HeapSys,
		RSS:       ms.Sys,
		GCCount:   ms.NumGC,
		Label:     label,
	}
}

// ForceGC runs a garbage collection and waits for it to finish.
func ForceGC() {
	runtime.GC()
	runtime.Gosched()
}
