"""Assertion evaluators for the Python SDK.

Uses the native Rust extension (leak_assert_native) when available for
faster analysis.  Falls back to pure Python if the extension is not installed.
"""
from __future__ import annotations

import json
import re
from typing import Sequence

from .samplers import Sample

# Try native Rust module (built with maturin)
try:
    import leak_assert_native as _native  # type: ignore
    _HAS_NATIVE = True
except ImportError:
    _native      = None
    _HAS_NATIVE  = False


# ── Parse helpers ─────────────────────────────────────────────────────────────

_UNITS = {"k": 1024, "kb": 1024, "m": 1024**2, "mb": 1024**2, "g": 1024**3, "gb": 1024**3}


def parse_bytes(value: str | int | float) -> int:
    if isinstance(value, (int, float)):
        return int(value)
    s = re.sub(r"^<\s*", "", str(value).strip().lower())
    s = re.sub(r"/iter$", "", s).strip()
    m = re.match(r"^([\d.]+)\s*([a-z]*)$", s)
    if not m:
        raise ValueError(f"leak-assert: cannot parse bytes value '{value}'")
    n    = float(m.group(1))
    unit = m.group(2)
    return int(n * _UNITS.get(unit, 1))


def kb(n: float) -> int:
    return int(n * 1024)


def mb(n: float) -> int:
    return int(n * 1024 * 1024)


# ── OLS slope ─────────────────────────────────────────────────────────────────

def ols_slope(samples: Sequence[Sample]) -> float:
    """Bytes gained per iteration.  Uses Rust core when available."""
    if _HAS_NATIVE and len(samples) >= 2:
        try:
            return _native.slope(json.dumps([s.to_dict() for s in samples]))
        except Exception:
            pass
    # pure Python fallback
    n     = len(samples)
    if n < 2:
        return 0.0
    sum_x  = sum(s.iter      for s in samples)
    sum_y  = sum(s.heap_used for s in samples)
    sum_xy = sum(s.iter * s.heap_used for s in samples)
    sum_xx = sum(s.iter ** 2          for s in samples)
    denom  = n * sum_xx - sum_x ** 2
    return 0.0 if denom == 0 else (n * sum_xy - sum_x * sum_y) / denom


# ── Assertion error ───────────────────────────────────────────────────────────

class LeakAssertionError(AssertionError):
    def __init__(self, assertion: str, actual: str, expected: str) -> None:
        super().__init__(
            f"leak-assert [{assertion}]: {actual} — expected {expected}"
        )
        self.assertion = assertion
        self.actual    = actual
        self.expected  = expected


# ── Assertion functions ───────────────────────────────────────────────────────

def assert_growth_rate(samples: Sequence[Sample], max: int | str) -> None:  # noqa: A002
    limit = parse_bytes(max)
    slope = ols_slope(samples)
    if slope > limit:
        raise LeakAssertionError(
            "growth_rate",
            f"{slope:.1f} bytes/iter",
            f"< {limit} bytes/iter",
        )


def assert_stable(samples: Sequence[Sample], tolerance: int | str) -> None:
    tol   = parse_bytes(tolerance)
    delta = abs(samples[-1].heap_used - samples[0].heap_used)
    if delta > tol:
        raise LeakAssertionError(
            "stable",
            f"+{delta / 1024 / 1024:.2f} MB retained",
            f"< {tol / 1024 / 1024:.2f} MB",
        )


def assert_ceiling(samples: Sequence[Sample], max: int | str) -> None:  # noqa: A002
    limit = parse_bytes(max)
    peak  = max(s.heap_used for s in samples)
    if peak > limit:
        raise LeakAssertionError(
            "ceiling",
            f"{peak / 1024 / 1024:.2f} MB peak",
            f"< {limit / 1024 / 1024:.2f} MB",
        )


def assert_no_retained_types(type_names: list[str]) -> None:
    """Check that object counts for given type names haven't grown.
    Requires objgraph: pip install objgraph
    """
    try:
        import objgraph  # type: ignore
    except ImportError:
        raise ImportError("assert_no_retained_types requires: pip install objgraph")

    for name in type_names:
        count = objgraph.count(name)
        if count > 0:
            raise LeakAssertionError(
                "no_retained_types",
                f"{count} live {name} objects",
                "0 retained",
            )
