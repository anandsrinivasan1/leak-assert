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
