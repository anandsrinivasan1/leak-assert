# leak-assert (Python)

**Memory leak regression testing for Python — write assertions, not profiler reports.**

[![PyPI](https://img.shields.io/pypi/v/leak-assert)](https://pypi.org/project/leak-assert/)
[![CI](https://github.com/anandsrinivasan1/leak-assert/actions/workflows/ci.yml/badge.svg)](https://github.com/anandsrinivasan1/leak-assert/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../../LICENSE)

## Install

```sh
pip install leak-assert
```

## Quick start

```python
from leak_assert import LeakTest, kb, mb

def test_handler_does_not_leak():
    with LeakTest(iterations=500, warmup=50) as t:
        for _ in t:
            handle_request()

    t.assert_growth_rate(max=kb(1))   # heap must not grow faster than 1 KB/iter
    t.assert_stable(tolerance=mb(5))  # total heap delta must stay under 5 MB
```

## pytest plugin

```python
import pytest

@pytest.mark.leak_test(max="1kb/iter")
def test_handler_memory(leak_test):
    for _ in leak_test:
        handle_request()
```

## Assertions

| Method | Description | Example |
|--------|-------------|---------|
| `assert_growth_rate(max=)` | OLS slope must be below limit | `max="1kb/iter"` |
| `assert_stable(tolerance=)` | Total heap delta must stay within tolerance | `tolerance="5mb"` |
| `assert_ceiling(max=)` | Peak heap must not exceed absolute limit | `max="400mb"` |
| `assert_no_retained(types=)` | Named object types must not accumulate | `types=["MyClass"]` |

## Reporters

```python
from leak_assert import to_html, to_junit

with LeakTest(iterations=500, warmup=50, name="my-test") as t:
    for _ in t:
        handle_request()

t.assert_growth_rate(max="1kb/iter")
report = t.get_report()

with open("leak-report.html", "w") as f:
    f.write(to_html(report))

with open("leak-report.xml", "w") as f:
    f.write(to_junit(report))
```

## Native Rust extension (optional)

For faster OLS analysis, install the native extension:

```sh
pip install maturin
maturin develop --manifest-path ../../bindings/python/Cargo.toml
```

The pure-Python fallback is used automatically when the extension is not available.

## Full documentation

See the [project README](../../README.md) and [docs](../../docs/).
