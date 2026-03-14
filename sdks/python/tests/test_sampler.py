"""Unit tests for the Python memory sampler."""
import time

import pytest
from leak_assert.samplers import Sample, force_gc, start_sampling, stop_sampling, take_sample


class TestSampler:
    def setup_method(self):
        start_sampling()

    def teardown_method(self):
        stop_sampling()

    def test_take_sample_returns_sample(self):
        s = take_sample(1)
        assert isinstance(s, Sample)
        assert s.iter == 1
        assert s.heap_used >= 0
        assert s.ts > 0

    def test_timestamp_is_recent(self):
        before = int(time.time() * 1000)
        s = take_sample(1)
        after = int(time.time() * 1000)
        assert before <= s.ts <= after

    def test_iter_is_set(self):
        for i in [0, 1, 500, 99999]:
            assert take_sample(i).iter == i

    def test_label_is_set(self):
        s = take_sample(1, label="checkpoint")
        assert s.label == "checkpoint"

    def test_force_gc_returns_int(self):
        result = force_gc()
        assert isinstance(result, int)
        assert result >= 0

    def test_to_dict_has_required_keys(self):
        d = take_sample(1).to_dict()
        for key in ("ts", "iter", "heap_used", "heap_total", "rss", "gc_count"):
            assert key in d
