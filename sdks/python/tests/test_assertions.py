"""Unit tests for the pure-Python assertion layer."""
import pytest
from leak_assert.assertions import (
    LeakAssertionError,
    assert_ceiling,
    assert_growth_rate,
    assert_stable,
    kb,
    mb,
    ols_slope,
    parse_bytes,
)
from leak_assert.samplers import Sample


def make_samples(pairs: list[tuple[int, int]]) -> list[Sample]:
    return [Sample(ts=0, iter=i, heap_used=h, heap_total=h, rss=0) for i, h in pairs]


# ── parse_bytes ───────────────────────────────────────────────────────────────

class TestParseBytes:
    def test_raw_int(self):
        assert parse_bytes(1024) == 1024

    def test_kb_string(self):
        assert parse_bytes("1kb") == 1024

    def test_mb_string(self):
        assert parse_bytes("2mb") == 2 * 1024 * 1024

    def test_with_per_iter_suffix(self):
        assert parse_bytes("1kb/iter") == 1024

    def test_with_lt_prefix(self):
        assert parse_bytes("< 512") == 512

    def test_helpers(self):
        assert kb(1) == 1024
        assert mb(1) == 1024 * 1024

    def test_invalid_raises(self):
        with pytest.raises(ValueError):
            parse_bytes("not-a-number")


# ── ols_slope ─────────────────────────────────────────────────────────────────

class TestOLSSlope:
    def test_flat_is_zero(self):
        samples = make_samples([(i * 100, 50_000_000) for i in range(10)])
        assert abs(ols_slope(samples)) < 1.0

    def test_linear_growth(self):
        # heap = 50MB + 200 * iter
        samples = make_samples([(i * 100, 50_000_000 + 200 * i * 100) for i in range(10)])
        slope = ols_slope(samples)
        assert abs(slope - 200.0) < 5.0, f"expected ~200, got {slope}"

    def test_too_few_samples_returns_zero(self):
        assert ols_slope(make_samples([(0, 1000)])) == 0.0


# ── assert_growth_rate ────────────────────────────────────────────────────────

class TestAssertGrowthRate:
    def test_passes_when_within_limit(self):
        samples = make_samples([(i * 100, 50_000_000 + 50 * i * 100) for i in range(20)])
        assert_growth_rate(samples, max=kb(1))  # 50 bytes/iter < 1024

    def test_fails_when_exceeded(self):
        # 2000 bytes/iter
        samples = make_samples([(i * 100, 50_000_000 + 2000 * i * 100) for i in range(20)])
        with pytest.raises(LeakAssertionError, match="growth_rate"):
            assert_growth_rate(samples, max=kb(1))


# ── assert_stable ─────────────────────────────────────────────────────────────

class TestAssertStable:
    def test_passes_within_tolerance(self):
        samples = make_samples([(0, 50_000_000), (1000, 51_000_000)])
        assert_stable(samples, tolerance=mb(2))  # 1MB delta < 2MB tolerance

    def test_fails_when_delta_too_large(self):
        samples = make_samples([(0, 50_000_000), (1000, 70_000_000)])  # +20MB
        with pytest.raises(LeakAssertionError, match="stable"):
            assert_stable(samples, tolerance=mb(2))


# ── assert_ceiling ────────────────────────────────────────────────────────────

class TestAssertCeiling:
    def test_passes_when_under(self):
        samples = make_samples([(i, 50_000_000 + i * 100) for i in range(100)])
        assert_ceiling(samples, max=mb(100))

    def test_fails_when_over(self):
        samples = make_samples([(0, 500_000_000)])  # 500MB
        with pytest.raises(LeakAssertionError, match="ceiling"):
            assert_ceiling(samples, max=mb(100))
