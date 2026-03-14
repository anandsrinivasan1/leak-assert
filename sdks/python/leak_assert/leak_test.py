"""LeakTest context manager and runner for Python."""
from __future__ import annotations

import math
import time
from collections.abc import Generator
from typing import Any

from .assertions import (
    assert_ceiling,
    assert_growth_rate,
    assert_no_retained_types,
    assert_stable,
    ols_slope,
    parse_bytes,
)
from .reporters import Report, ReportAssertion
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
        self._type_baseline: dict[str, int] = {}
        self._start_time: float = 0.0
        self._end_time:   float = 0.0
        self._report_assertions: list[ReportAssertion] = []

    # ── Context manager ───────────────────────────────────────────────────────

    def __enter__(self) -> "LeakTest":
        start_sampling()
        self.samples = []
        self._iter_count = 0
        self._in_warmup  = True
        self._type_baseline = {}
        self._report_assertions = []
        self._start_time = time.monotonic()
        # Snapshot object counts for assert_no_retained (after warmup in __iter__)
        return self

    def __exit__(self, *_: Any) -> None:
        self._end_time = time.monotonic()
        stop_sampling()

    # ── Iteration protocol ────────────────────────────────────────────────────

    def __iter__(self) -> Generator[int, None, None]:
        # warmup phase
        for i in range(self.warmup):
            yield i

        self._in_warmup = False
        self.samples    = []

        # Capture object-type baseline after warmup (for assert_no_retained)
        try:
            import gc as _gc
            import objgraph  # type: ignore
            _gc.collect()
            self._type_baseline = dict(objgraph.typestats())
        except ImportError:
            self._type_baseline = {}

        for i in range(1, self.iterations + 1):
            yield i
            self._iter_count = i

            if self._force_gc and i % self.sample_every == 0:
                force_gc()

            if i % self.sample_every == 0:
                self.samples.append(take_sample(i))

    # ── Assertions ────────────────────────────────────────────────────────────

    def assert_growth_rate(self, max: str | int) -> "LeakTest":  # noqa: A002
        limit = parse_bytes(max)
        slope = ols_slope(self.samples)
        passed = slope <= limit
        self._report_assertions.append(ReportAssertion(
            name="growth_rate",
            passed=passed,
            actual=f"{slope:.1f} bytes/iter",
            expected=f"< {limit} bytes/iter",
        ))
        assert_growth_rate(self.samples, max)
        return self

    def assert_stable(self, tolerance: str | int) -> "LeakTest":
        tol = parse_bytes(tolerance)
        delta = abs(self.samples[-1].heap_used - self.samples[0].heap_used) if self.samples else 0
        passed = delta <= tol
        self._report_assertions.append(ReportAssertion(
            name="stable",
            passed=passed,
            actual=f"+{delta / 1024 / 1024:.2f} MB retained",
            expected=f"< {tol / 1024 / 1024:.2f} MB",
        ))
        assert_stable(self.samples, tolerance)
        return self

    def assert_ceiling(self, max: str | int) -> "LeakTest":  # noqa: A002
        limit = parse_bytes(max)
        peak = 0
        for s in self.samples:
            if s.heap_used > peak:
                peak = s.heap_used
        passed = peak <= limit
        self._report_assertions.append(ReportAssertion(
            name="ceiling",
            passed=passed,
            actual=f"{peak / 1024 / 1024:.2f} MB peak",
            expected=f"< {limit / 1024 / 1024:.2f} MB",
        ))
        assert_ceiling(self.samples, max)
        return self

    def assert_no_retained(self, types: list[str]) -> "LeakTest":
        assert_no_retained_types(types, self._type_baseline)
        return self

    # ── Reporting ─────────────────────────────────────────────────────────────

    def get_report(self) -> Report:
        """Build a Report from collected samples and recorded assertion results."""
        slope = ols_slope(self.samples) if self.samples else 0.0
        delta = (
            self.samples[-1].heap_used - self.samples[0].heap_used
            if len(self.samples) >= 2 else 0
        )
        duration_ms = (self._end_time - self._start_time) * 1000
        passed = all(a.passed for a in self._report_assertions)
        return Report(
            name=self.name,
            passed=passed,
            slope=slope,
            delta=delta,
            duration_ms=duration_ms,
            samples=list(self.samples),
            assertions=list(self._report_assertions),
        )

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
