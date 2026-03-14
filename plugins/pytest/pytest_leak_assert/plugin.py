"""pytest-leak-assert plugin.

Provides:
  - @pytest.mark.leak_test(iterations=..., growth_rate=...) marker
  - leak_test fixture for programmatic use
  - HTML + JUnit report generation into leak-reports/

Usage — marker:

    @pytest.mark.leak_test(iterations=500, growth_rate="1kb/iter", stable="5mb")
    def test_handler(leak_test):
        for _ in leak_test:
            handle_request(fake_req())

Usage — fixture:

    def test_cache(leak_test):
        with leak_test(iterations=200, name="cache") as t:
            for _ in t:
                cache.get("key")
        t.assert_growth_rate(max="1kb/iter")
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import pytest
from leak_assert import LeakTest
from leak_assert.reporters import Report, ReportAssertion, to_html, to_junit


# ── Pytest marker ─────────────────────────────────────────────────────────────

def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers",
        "leak_test(iterations, warmup, growth_rate, stable, ceiling): "
        "run this test inside a leak-assert workload",
    )


# ── Fixture ───────────────────────────────────────────────────────────────────

class LeakTestFixture:
    """Returned by the `leak_test` fixture. Acts as a LeakTest factory."""

    def __init__(self, request: pytest.FixtureRequest) -> None:
        self._request = request
        self._tests:  list[LeakTest] = []

    def __call__(
        self,
        *,
        iterations:   int   = 500,
        warmup:       int   = 50,
        sample_every: int | None = None,
        name:         str | None = None,
    ) -> LeakTest:
        test_name = name or self._request.node.name
        lt = LeakTest(iterations=iterations, warmup=warmup,
                      sample_every=sample_every, name=test_name)
        self._tests.append(lt)
        return lt

    def __iter__(self):
        """Convenience: iterate directly for simple one-shot tests."""
        marker = self._request.node.get_closest_marker("leak_test")
        kw     = marker.kwargs if marker else {}
        lt     = self(
            iterations=int(kw.get("iterations", 500)),
            warmup=int(kw.get("warmup", 50)),
        )
        return lt.__enter__().__iter__()


@pytest.fixture
def leak_test(request: pytest.FixtureRequest) -> LeakTestFixture:  # type: ignore[return]
    fixture = LeakTestFixture(request)
    yield fixture  # type: ignore[misc]

    # After test: apply marker assertions + write reports
    marker = request.node.get_closest_marker("leak_test")
    if not marker:
        return

    kw = marker.kwargs
    out_dir = Path(request.config.rootdir) / "leak-reports"
    out_dir.mkdir(exist_ok=True)

    for lt in fixture._tests:
        if not lt.samples:
            continue
        try:
            if "growth_rate" in kw:
                lt.assert_growth_rate(max=kw["growth_rate"])
            if "stable" in kw:
                lt.assert_stable(tolerance=kw["stable"])
            if "ceiling" in kw:
                lt.assert_ceiling(max=kw["ceiling"])
            passed = True
        except AssertionError as e:
            passed = False
            pytest.fail(str(e), pytrace=False)

        _write_report(lt, passed, out_dir)


def _write_report(lt: LeakTest, passed: bool, out_dir: Path) -> None:
    from leak_assert.assertions import ols_slope

    slope = ols_slope(lt.samples)
    delta = lt.samples[-1].heap_used - lt.samples[0].heap_used if lt.samples else 0

    report = Report(
        name=lt.name,
        passed=passed,
        slope=slope,
        delta=delta,
        duration_ms=0,
        samples=lt.samples,
        assertions=[],
    )
    safe = lt.name.replace(" ", "-").lower()
    (out_dir / f"{safe}.html").write_text(to_html(report), encoding="utf-8")
    (out_dir / f"{safe}.xml").write_text(to_junit(report), encoding="utf-8")
