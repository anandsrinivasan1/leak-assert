// Package exporters provides OpenTelemetry metric export for leak-assert Go SDK.
//
// Usage:
//
//	exp := exporters.NewOtelExporter(exporters.Options{ServiceName: "my-api"})
//	lt  := leakassert.New(t, leakassert.Config{Iterations: 1000})
//	lt.Run(func() { handler.ServeHTTP(w, r) })
//	exp.Flush(lt.GetSamples())
//
// Requires: go.opentelemetry.io/otel go.opentelemetry.io/otel/metric
package exporters

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// Sample mirrors leakassert.Sample for use without importing the parent package.
type Sample struct {
	TS        int64  `json:"ts"`
	Iter      int    `json:"iter"`
	HeapUsed  uint64 `json:"heap_used"`
	HeapTotal uint64 `json:"heap_total"`
	RSS       uint64 `json:"rss"`
}

// Options configures the OTEL exporter.
type Options struct {
	ServiceName     string
	Prefix          string  // metric name prefix (default: "leak_assert")
	ConsoleFallback bool    // emit JSON to stdout if OTEL SDK unavailable (default: true)
}

// OtelExporter emits leak-assert samples as OTEL gauges.
// Falls back to JSON console output when the OTEL SDK is not configured.
type OtelExporter struct {
	opts     Options
	latest   *Sample
	recordFn RecordFunc // set by WithRecordFunc; nil = console fallback
}

// NewOtelExporter creates a new exporter.
func NewOtelExporter(opts Options) *OtelExporter {
	if opts.Prefix == "" {
		opts.Prefix = "leak_assert"
	}
	if opts.ServiceName == "" {
		opts.ServiceName = "unknown"
	}
	if !opts.ConsoleFallback {
		opts.ConsoleFallback = true
	}
	return &OtelExporter{opts: opts}
}

// Push emits a single sample.
func (e *OtelExporter) Push(s Sample) {
	e.latest = &s

	if !e.tryOtel(s) && e.opts.ConsoleFallback {
		b, _ := json.Marshal(map[string]any{
			"metric":      e.opts.Prefix + ".heap_used",
			"value":       s.HeapUsed,
			"iter":        s.Iter,
			"service":     e.opts.ServiceName,
			"ts":          s.TS,
			"otel_format": true,
		})
		fmt.Println(string(b))
	}
}

// Flush emits all samples (e.g. at end of a LeakTest run).
func (e *OtelExporter) Flush(samples []Sample) {
	for _, s := range samples {
		e.Push(s)
	}
}

// tryOtel attempts to record via a caller-supplied RecordFunc.
// Returns true when a RecordFunc is configured, false otherwise (triggering
// the console fallback).
func (e *OtelExporter) tryOtel(s Sample) bool {
	if e.recordFn == nil {
		return false
	}
	ctx := context.Background()
	prefix := e.opts.Prefix
	attrs := map[string]string{
		"service.name": e.opts.ServiceName,
		"iter":         fmt.Sprintf("%d", s.Iter),
	}
	e.recordFn(ctx, prefix+".heap_used",  int64(s.HeapUsed),  attrs)
	e.recordFn(ctx, prefix+".heap_total", int64(s.HeapTotal), attrs)
	e.recordFn(ctx, prefix+".rss",        int64(s.RSS),       attrs)
	return true
}

// RecordFunc is the signature of a function that records a metric observation.
// Provide this from your application's OTEL setup to avoid the console fallback.
type RecordFunc func(ctx context.Context, name string, value int64, attrs map[string]string)

// WithRecordFunc creates an exporter that calls fn for each metric observation.
// Use this to bridge to your existing OTEL MeterProvider without adding a hard
// dependency on go.opentelemetry.io/otel.
func WithRecordFunc(opts Options, fn RecordFunc) *OtelExporter {
	e := NewOtelExporter(opts)
	e.opts.ConsoleFallback = false
	e.recordFn = fn
	return e
}

// ConvertSamples converts leakassert.Sample-shaped maps to Sample slices.
// Useful when bridging from the leakassert package without circular imports.
func ConvertSamples(rawJSON []byte) ([]Sample, error) {
	var samples []Sample
	return samples, json.Unmarshal(rawJSON, &samples)
}

// Timestamp returns the current unix millisecond timestamp.
func Timestamp() int64 {
	return time.Now().UnixMilli()
}
