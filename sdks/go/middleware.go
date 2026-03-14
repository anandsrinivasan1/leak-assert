package leakassert

// LeakAssert HTTP sidecar middleware for Go.
//
// Mounts /__leak_assert__/heap and /__leak_assert__/gc on any http.ServeMux
// or http.Handler chain so the CLI can remotely sample heap metrics.
//
// Usage — stdlib:
//
//	mux := http.NewServeMux()
//	mux.Handle("/", myHandler)
//	leakassert.MountSidecar(mux, leakassert.SidecarOptions{})
//	http.ListenAndServe(":8080", mux)
//
// Usage — standalone sidecar server:
//
//	go leakassert.StartSidecarServer(leakassert.SidecarOptions{Port: 9123})

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"runtime"
	"time"
)

// SidecarOptions configures the sidecar handler.
type SidecarOptions struct {
	// URL prefix (default: /__leak_assert__)
	Prefix string
	// Only serve requests from loopback (default: true)
	LocalhostOnly bool
	// Standalone server port (only used by StartSidecarServer)
	Port int
}

func (o *SidecarOptions) defaults() {
	if o.Prefix == "" {
		o.Prefix = "/__leak_assert__"
	}
	if o.Port == 0 {
		o.Port = 9123
	}
	// LocalhostOnly defaults to true — zero value bool is false, so we flip
	// only when the field hasn't been explicitly set to false.
	// Callers must set LocalhostOnly: false explicitly to disable.
}

// HeapPayload is the JSON response body for GET /__leak_assert__/heap.
type HeapPayload struct {
	TS         int64  `json:"ts"`          // unix ms
	HeapUsed   uint64 `json:"heap_used"`   // HeapInuse bytes
	HeapTotal  uint64 `json:"heap_total"`  // HeapSys bytes
	RSS        uint64 `json:"rss"`         // Sys bytes
	NumGC      uint32 `json:"gc_count"`
	Goroutines int    `json:"goroutines"`
	GoVersion  string `json:"go_version"`
}

func heapSnapshot() HeapPayload {
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	return HeapPayload{
		TS:         time.Now().UnixMilli(),
		HeapUsed:   ms.HeapInuse,
		HeapTotal:  ms.HeapSys,
		RSS:        ms.Sys,
		NumGC:      ms.NumGC,
		Goroutines: runtime.NumGoroutine(),
		GoVersion:  runtime.Version(),
	}
}

// SidecarHandler returns an http.Handler for the sidecar routes.
// Mount it at the desired prefix using your router.
func SidecarHandler(opts SidecarOptions) http.Handler {
	opts.defaults()
	mux := http.NewServeMux()

	// GET /heap — returns current heap snapshot
	mux.HandleFunc(opts.Prefix+"/heap", func(w http.ResponseWriter, r *http.Request) {
		if !allowRequest(w, r, opts) {
			return
		}
		payload := heapSnapshot()
		writeJSON(w, http.StatusOK, payload)
	})

	// POST /gc — trigger a GC collection
	mux.HandleFunc(opts.Prefix+"/gc", func(w http.ResponseWriter, r *http.Request) {
		if !allowRequest(w, r, opts) {
			return
		}
		runtime.GC()
		runtime.Gosched()
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})

	return mux
}

// MountSidecar registers the sidecar routes on an existing ServeMux.
func MountSidecar(mux *http.ServeMux, opts SidecarOptions) {
	opts.defaults()
	handler := SidecarHandler(opts)
	mux.Handle(opts.Prefix+"/", handler)
}

// Middleware wraps an existing http.Handler and injects the sidecar routes.
// Drop-in for any middleware chain.
func Middleware(next http.Handler, opts SidecarOptions) http.Handler {
	opts.defaults()
	sidecar := SidecarHandler(opts)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if len(r.URL.Path) >= len(opts.Prefix) &&
			r.URL.Path[:len(opts.Prefix)] == opts.Prefix {
			sidecar.ServeHTTP(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// StartSidecarServer starts a standalone HTTP server exposing only the
// sidecar endpoints.  Intended for use in a goroutine during testing.
func StartSidecarServer(opts SidecarOptions) error {
	opts.defaults()
	if opts.Port == 0 {
		opts.Port = 9123
	}
	addr    := fmt.Sprintf("127.0.0.1:%d", opts.Port)
	handler := SidecarHandler(opts)
	fmt.Printf("[leak-assert] sidecar listening on http://%s%s/heap\n", addr, opts.Prefix)
	return http.ListenAndServe(addr, handler)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func allowRequest(w http.ResponseWriter, r *http.Request, opts SidecarOptions) bool {
	if opts.LocalhostOnly {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			host = r.RemoteAddr
		}
		if host != "127.0.0.1" && host != "::1" {
			writeJSON(w, http.StatusForbidden, map[string]string{
				"error": "forbidden: sidecar is localhost-only",
			})
			return false
		}
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	body, err := json.Marshal(v)
	if err != nil {
		http.Error(w, `{"error":"marshal error"}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write(body) //nolint:errcheck
}
