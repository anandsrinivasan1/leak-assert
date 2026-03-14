# Python SDK

## Install

```sh
pip install leak-assert
# optional: native Rust extension (faster analysis)
pip install maturin && maturin develop
```

## LeakTest

```python
from leak_assert import LeakTest, kb, mb

def test_handler_no_leak():
    with LeakTest(
        iterations=2000,
        warmup=100,
        sample_every=40,
        name="handler",
    ) as t:
        for _ in t:
            handle_request(fake_request())

    t.assert_growth_rate(max=kb(1))   # < 1024 bytes/iter
    t.assert_stable(tolerance=mb(5))  # heap within 5MB of start
    t.assert_ceiling(max=mb(200))     # never exceeds 200MB
    t.print_summary()
```

## pytest plugin

```sh
pip install pytest-leak-assert
```

```python
import pytest

@pytest.mark.leak_test(iterations=500, growth_rate="1kb/iter", stable="5mb")
def test_cache(leak_test):
    for _ in leak_test:
        cache.get("key")
```

## WSGI / FastAPI sidecar

```python
# FastAPI
from fastapi import FastAPI
from leak_assert.middleware import LeakAssertMiddleware
app = FastAPI()
app.add_middleware(LeakAssertMiddleware)

# Flask
from leak_assert.middleware import LeakAssertWSGIMiddleware
app.wsgi_app = LeakAssertWSGIMiddleware(app.wsgi_app)
```

## OTEL exporter

```python
from leak_assert.exporters import OtelExporter

exporter = OtelExporter(service_name="my-api")
with LeakTest(iterations=1000) as t:
    for _ in t:
        handle_request()
exporter.flush(t.samples)
```
