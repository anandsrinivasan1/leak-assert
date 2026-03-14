"""
leak-assert — Python usage examples
Run with: pytest examples/python/test_example.py -v
"""
import pytest
from leak_assert import LeakTest, LeakAssertionError, mb, kb


# ── Example 1: Leaky cache is caught ─────────────────────────────────────────

leaky_store: list = []


def test_leaky_list_is_caught():
    """Demonstrates the framework catching a real leak."""
    with LeakTest(iterations=500, warmup=50) as t:
        for _ in t:
            # Bug: appending but never clearing
            leaky_store.append(b"x" * 1024)

    with pytest.raises(LeakAssertionError, match="growth_rate"):
        t.assert_growth_rate(max=kb(0.5))


# ── Example 2: Clean function passes ─────────────────────────────────────────

def test_clean_function_passes():
    """A well-behaved function passes all assertions."""
    with LeakTest(iterations=1000, warmup=100, name="clean-fn") as t:
        for _ in t:
            data = b"x" * 4096
            _ = len(data)
            # data goes out of scope — no retention

    t.print_summary()
    t.assert_growth_rate(max="1kb/iter")
    t.assert_stable(tolerance="5mb")


# ── Example 3: Dict that grows then stabilises ────────────────────────────────

def test_bounded_cache_passes():
    """A bounded LRU-style cache should not trigger leak assertions."""
    from collections import OrderedDict

    cache: OrderedDict = OrderedDict()
    MAX = 100

    with LeakTest(iterations=2000, warmup=50) as t:
        for i in t:
            cache[i % MAX] = b"v" * 256  # bounded — overwrites old keys

    t.assert_stable(tolerance="2mb")
    t.assert_growth_rate(max="512")      # < 512 bytes/iter


# ── Example 4: Async example (pytest-asyncio) ────────────────────────────────

async def fetch_fake(url: str) -> bytes:
    """Simulates an async HTTP fetch."""
    return b"response body" * 10


async def test_async_handler_no_leak():
    results = []

    with LeakTest(iterations=500, warmup=50, name="async-fetch") as t:
        for _ in t:
            data = await fetch_fake("http://example.com")
            # process and release
            _ = len(data)

    t.assert_growth_rate(max="1kb/iter")
    t.assert_stable(tolerance="5mb")
