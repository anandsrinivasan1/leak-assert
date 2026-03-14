"""Memory samplers for Python — uses tracemalloc + gc module."""
from __future__ import annotations

import gc
import time
import tracemalloc
from dataclasses import dataclass, field


@dataclass
class Sample:
    ts:         int    # unix ms
    iter:       int
    heap_used:  int    # bytes (tracemalloc current)
    heap_total: int    # bytes (tracemalloc peak)
    rss:        int    # bytes (process RSS)
    external:   int = 0
    gc_count:   int = 0
    label:      str = ""

    def to_dict(self) -> dict:
        return {
            "ts":         self.ts,
            "iter":       self.iter,
            "heap_used":  self.heap_used,
            "heap_total": self.heap_total,
            "rss":        self.rss,
            "external":   self.external,
            "gc_count":   self.gc_count,
            "label":      self.label,
        }


def _rss_bytes() -> int:
    """Read RSS from /proc/self/status on Linux, fall back to 0."""
    try:
        import resource
        return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024
    except Exception:
        return 0


def start_sampling() -> None:
    if not tracemalloc.is_tracing():
        tracemalloc.start()


def stop_sampling() -> None:
    if tracemalloc.is_tracing():
        tracemalloc.stop()


def force_gc() -> int:
    """Run a full GC collection, return number of objects collected."""
    return sum(gc.collect(i) for i in range(3))


def take_sample(iter_: int, label: str = "") -> Sample:
    current, peak = tracemalloc.get_traced_memory()
    return Sample(
        ts=int(time.time() * 1000),
        iter=iter_,
        heap_used=current,
        heap_total=peak,
        rss=_rss_bytes(),
        gc_count=sum(gc.get_count()),
        label=label,
    )
