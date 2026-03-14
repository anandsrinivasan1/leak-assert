"""LeakTest context manager and runner for Python."""
from __future__ import annotations

import math
from collections.abc import Callable, Generator
from contextlib import contextmanager
from typing import Any

from .assertions import (
    assert_ceiling,
    assert_growth_rate,
    assert_no_retained_types,
    assert_stable,
    ols_slope,
    parse_bytes,
)
from .samplers import Sample, force_gc, start_sampling, stop_sampling, take_sample


class LeakTest:
    """
    Usage::

        with LeakTest(iterations=1000, warmup=50) as t:
            for _ in t:
                my_workload()

        t.assert_growth_rate(max="1kb/iter")
        t.assert_stable(tolerance="5mb")
    """

    def __init__(
        self,
        *,
        iterations:   int,
        warmup:       int = 0,
        sample_every: int | None = None,
        force_gc:     bool = True,
        name:         str = "LeakTest",
    ) -> None:
        self.iterations   = iterations
        self.warmup       = warmup
        self.sample_every = sample_every or max(1, iterations // 50)
        self._force_gc    = force_gc
        self.name         = name
        self.samples:    list[Sample] = []
        self._iter_count = 0
        self._in_warmup  = True

    # ── Context manager ───────────────────────────────────────────────────────

    def __enter__(self) -> "LeakTest":
        start_sampling()
        self.samples = []
        self._iter_count = 0
        self._in_warmup  = True
        return self

    def __exit__(self, *_: Any) -> None:
        stop_sampling()

    # ── Iteration protocol ────────────────────────────────────────────────────

    def __iter__(self) -> Generator[int, None, None]:
        # warmup phase
        for i in range(self.warmup):
            yield i

        self._in_warmup = False
        self.samples    = []

        for i in range(1, self.iterations + 1):
            yield i
            self._iter_count = i

            if self._force_gc and i % self.sample_every == 0:
                force_gc()

            if i % self.sample_every == 0:
                self.samples.append(take_sample(i))

    # ── Assertions ────────────────────────────────────────────────────────────

    def assert_growth_rate(self, max: str | int) -> "LeakTest":
        assert_growth_rate(self.samples, max)
        return self

    def assert_stable(self, tolerance: str | int) -> "LeakTest":
        assert_stable(self.samples, tolerance)
        return self

    def assert_ceiling(self, max: str | int) -> "LeakTest":
        assert_ceiling(self.samples, max)
        return self

    def assert_no_retained(self, types: list[str]) -> "LeakTest":
        assert_no_retained_types(types)
        return self

    # ── Reporting ─────────────────────────────────────────────────────────────

    def print_summary(self) -> "LeakTest":
        if not self.samples:
            print(f"leak-assert [{self.name}]: no samples collected")
            return self
        slope = ols_slope(self.samples)
        delta = self.samples[-1].heap_used - self.samples[0].heap_used
        print(
            f"\n── leak-assert: {self.name} ──\n"
            f"  samples:     {len(self.samples)}\n"
            f"  growth:      {slope:.1f} bytes/iter\n"
            f"  total delta: {delta / 1024 / 1024:.2f} MB\n"
            f"──────────────────────────────────\n"
        )
        return self
