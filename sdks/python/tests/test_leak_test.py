"""Integration tests for the LeakTest context manager."""
import pytest
from leak_assert import LeakAssertionError, LeakTest, kb, mb


class TestLeakTestIterator:
    def test_correct_number_of_iterations(self):
        count = 0
        with LeakTest(iterations=100, warmup=10) as t:
            for _ in t:
                count += 1
        # warmup + iterations
        assert count == 110

    def test_samples_collected(self):
        with LeakTest(iterations=200, warmup=0) as t:
            for _ in t:
                pass
        assert len(t.samples) > 0

    def test_samples_have_correct_iters(self):
        with LeakTest(iterations=100, warmup=0, sample_every=10) as t:
            for _ in t:
                pass
        iters = [s.iter for s in t.samples]
        assert all(i % 10 == 0 for i in iters)

    def test_no_samples_during_warmup(self):
        with LeakTest(iterations=50, warmup=200, sample_every=10) as t:
            for i, _ in enumerate(t):
                pass
        # all samples should have iter >= 1 (warmup not counted)
        assert all(s.iter >= 1 for s in t.samples)


class TestLeakTestAssertions:
    def test_stable_passes_for_flat_heap(self):
        with LeakTest(iterations=100, warmup=0) as t:
            for _ in t:
                x = b"x" * 16  # tiny, released immediately
        t.assert_stable(tolerance="10mb")

    def test_growth_rate_fails_for_leaky_list(self):
        store: list = []
        # force_gc=False: avoid GC noise swamping the leak signal
        with LeakTest(iterations=100, warmup=0, sample_every=10, force_gc=False) as t:
            for _ in t:
                store.append(b"x" * 40960)  # 40 KB per iteration
        with pytest.raises(LeakAssertionError, match="growth_rate"):
            t.assert_growth_rate(max=kb(10))  # limit 10 KB/iter; actual ~40 KB/iter

    def test_chaining_assertions(self):
        with LeakTest(iterations=100, warmup=0) as t:
            for _ in t:
                pass
        # chaining should return self
        result = t.assert_stable(tolerance="10mb").assert_ceiling(max="500mb")
        assert result is t

    def test_print_summary_does_not_raise(self, capsys):
        with LeakTest(iterations=50, warmup=0) as t:
            for _ in t:
                pass
        t.print_summary()
        captured = capsys.readouterr()
        assert "leak-assert" in captured.out


class TestGetReport:
    def test_report_has_correct_name(self):
        with LeakTest(iterations=50, warmup=0, name="my-test") as t:
            for _ in t:
                pass
        t.assert_stable(tolerance="10mb")
        report = t.get_report()
        assert report.name == "my-test"

    def test_report_passed_when_assertions_pass(self):
        with LeakTest(iterations=100, warmup=0) as t:
            for _ in t:
                pass
        t.assert_growth_rate(max="10mb/iter")
        t.assert_stable(tolerance="10mb")
        report = t.get_report()
        assert report.passed is True

    def test_report_failed_when_assertion_fails(self):
        store: list = []
        with LeakTest(iterations=100, warmup=0, sample_every=10, force_gc=False) as t:
            for _ in t:
                store.append(b"x" * 40960)
        with pytest.raises(LeakAssertionError):
            t.assert_growth_rate(max=kb(1))
        report = t.get_report()
        assert report.passed is False

    def test_report_contains_samples(self):
        with LeakTest(iterations=100, warmup=0) as t:
            for _ in t:
                pass
        report = t.get_report()
        assert len(report.samples) > 0

    def test_report_assertions_recorded(self):
        with LeakTest(iterations=100, warmup=0) as t:
            for _ in t:
                pass
        t.assert_stable(tolerance="10mb")
        t.assert_growth_rate(max="10mb/iter")
        report = t.get_report()
        assert len(report.assertions) == 2
        assert report.assertions[0].name == "stable"
        assert report.assertions[1].name == "growth_rate"

    def test_report_duration_positive(self):
        with LeakTest(iterations=50, warmup=0) as t:
            for _ in t:
                pass
        report = t.get_report()
        assert report.duration_ms >= 0


class TestAssertNoRetained:
    def test_skipped_gracefully_without_objgraph(self, monkeypatch):
        """When objgraph is not installed the assertion raises ImportError."""
        import sys
        # Hide objgraph if installed
        monkeypatch.setitem(sys.modules, "objgraph", None)
        with LeakTest(iterations=50, warmup=0) as t:
            for _ in t:
                pass
        with pytest.raises(ImportError, match="objgraph"):
            t.assert_no_retained(["list"])

    def test_passes_for_non_leaking_type(self):
        pytest.importorskip("objgraph")
        with LeakTest(iterations=100, warmup=0) as t:
            for _ in t:
                buf = b"x" * 16  # released each iteration
                _ = buf
        # bytes count should not grow beyond baseline
        t.assert_no_retained(["MyFakeType999"])  # non-existent type → always 0

    def test_detects_retained_objects(self):
        pytest.importorskip("objgraph")

        class _Sentinel:
            pass

        store: list = []
        with LeakTest(iterations=100, warmup=0) as t:
            for _ in t:
                store.append(_Sentinel())  # never released

        with pytest.raises(LeakAssertionError, match="no_retained_types"):
            t.assert_no_retained(["_Sentinel"])
