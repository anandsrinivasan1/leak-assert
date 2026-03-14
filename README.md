# leak-assert

**Memory leak regression testing — write assertions, not profiler reports.**

[![CI](https://github.com/anandsrinivasan1/leak-assert/actions/workflows/ci.yml/badge.svg)](https://github.com/anandsrinivasan1/leak-assert/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@anandsrinivasan2/leak-assert)](https://www.npmjs.com/package/@anandsrinivasan2/leak-assert)
[![PyPI](https://img.shields.io/pypi/v/leak-assert)](https://pypi.org/project/leak-assert/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

Most memory profilers tell you *that* a leak exists after you've already shipped.
`leak-assert` lets you **embed assertions directly in your test suite** — the same
way you assert on return values — so leaks fail CI before they ever reach
production.

```js
// Node.js example
const t = new LeakTest({ iterations: 1000, warmup: 50 })
await t.runAsync(() => processRequest(req))
t.assert({ growthRate: '1kb/iter', stable: '10mb' })
```

```python
# Python example
with LeakTest(iterations=1000, warmup=50) as t:
    for _ in t:
        process_request(req)
t.assert_growth_rate(max="1kb/iter")
```

```go
// Go example
lt := leakassert.New(t, leakassert.Config{Iterations: 1000, Warmup: 50})
lt.Run(func() { processRequest(req) })
lt.Assert(leakassert.GrowthRate("1kb/iter"), leakassert.Stable(10*leakassert.MB))
```

---

## Why leak-assert?

| | Traditional profilers | leak-assert |
|---|---|---|
| When you find out | After the fact | In CI, on every PR |
| How you express limits | Not at all | `assert growthRate < 1kb/iter` |
| Integration | Manual, separate tool | Part of your test suite |
| Languages | Usually one | Node, Python, Go |
| CI-friendly | No (interactive) | Yes — exits non-zero on failure |

---

## Installation

**Node.js**
```bash
npm install --save-dev @anandsrinivasan2/leak-assert
```

**Python**
```bash
pip install leak-assert
```

**Go**
```bash
go get github.com/leak-assert/leak-assert-go
```

---

## Quick Start

### Node.js / TypeScript

```ts
import { LeakTest, mb, kb } from '@anandsrinivasan2/leak-assert'

describe('request handler memory', () => {
  it('does not leak', async () => {
    const t = new LeakTest({ iterations: 500, warmup: 50 })

    await t.runAsync(async () => {
      await handleRequest({ method: 'GET', url: '/api/users' })
    })

    t.assert({
      growthRate: kb(1),   // heap must not grow faster than 1 KB/iter
      stable:     mb(5),   // total heap delta must stay under 5 MB
    })
  })
})
```

**With Jest plugin:**
```ts
import { leakTest } from '@anandsrinivasan2/leak-assert/plugins/jest'

leakTest('handler does not leak', async () => {
  await handleRequest(req)
}, { growthRate: '1kb/iter' })
```

### Python

```python
import pytest
from leak_assert import LeakTest, kb, mb

def test_handler_does_not_leak():
    store = []
    with LeakTest(iterations=500, warmup=50) as t:
        for _ in t:
            store.append(handle_request())

    t.assert_growth_rate(max=kb(1))
    t.assert_stable(tolerance=mb(5))
```

**With pytest plugin:**
```python
import pytest

@pytest.mark.leak_test(max="1kb/iter")
def test_handler_memory(leak_test):
    for _ in leak_test:
        handle_request()
```

### Go

```go
import (
    leakassert "github.com/leak-assert/leak-assert-go"
    "testing"
)

func TestHandlerMemory(t *testing.T) {
    lt := leakassert.New(t, leakassert.Config{
        Iterations: 500,
        Warmup:     50,
    })
    lt.Run(func() {
        handleRequest(req)
    })
    lt.Assert(
        leakassert.GrowthRate("1kb/iter"),
        leakassert.Stable(5 * leakassert.MB),
    )
}
```

---

## Assertion Reference

All three SDKs support the same assertion types:

| Assertion | Description | Example |
|---|---|---|
| `growthRate` | Max heap bytes added per iteration (OLS slope) | `"1kb/iter"`, `1024` |
| `stable` | Max total heap delta over the whole run | `"5mb"`, `mb(5)` |
| `ceiling` | Absolute heap must never exceed this | `"400mb"` |
| `noRetainedTypes` | Object types must not accumulate | `["MyClass"]` |

**Byte string formats accepted:** `512`, `1kb`, `2mb`, `1gb`, `1kb/iter`, `< 2mb`

---

## HTTP Sidecar

For services you can't instrument directly, run the sidecar — it exposes a
`/__leak_assert__/heap` endpoint that the CLI polls:

```bash
# Start your service with the sidecar middleware enabled, then:
leak-assert watch --url http://localhost:3000 --threshold 1kb/iter
```

**Node.js middleware:**
```ts
import { leakAssertSidecar } from '@anandsrinivasan2/leak-assert/middleware'
app.use(leakAssertSidecar())
```

**Python ASGI middleware:**
```python
from leak_assert.middleware import LeakAssertMiddleware
app = LeakAssertMiddleware(app)
```

**Go:**
```go
leakassert.MountSidecar(mux)
```

---

## CI Integration

Add to your CI pipeline — the process exits `1` when a leak is detected:

```yaml
# GitHub Actions
- name: Run leak tests
  run: npm test   # or pytest / go test
```

The CLI also supports continuous watch mode during load testing:

```bash
leak-assert watch --url http://localhost:3000 --threshold 500b/iter --interval 5s
```

---

## OpenTelemetry

Export heap metrics to any OTEL-compatible backend:

```ts
import { OtelExporter } from '@anandsrinivasan2/leak-assert/exporters/otel'
const exporter = new OtelExporter({ serviceName: 'my-api' })
exporter.record(t.getSamples())
```

---

## Reporters

Generate HTML or JUnit XML reports after a run:

```ts
import { toHTML, toJUnit } from '@anandsrinivasan2/leak-assert/reporters'
fs.writeFileSync('leak-report.html', toHTML(result, 'my test'))
fs.writeFileSync('leak-report.xml',  toJUnit(result, 'my test'))
```

---

## Architecture

```
┌─────────────────────────────────────────┐
│  SDKs  (Node · Python · Go)             │
│  sample heap → assert → report          │
├─────────────────────────────────────────┤
│  Rust core  (leak-assert-core)          │
│  OLS slope · log fit · step detection   │
│  exposed via WASM · PyO3 · C FFI        │
├─────────────────────────────────────────┤
│  CLI  (leak-assert)                     │
│  run · watch · http · diff              │
└─────────────────────────────────────────┘
```

The Rust analysis engine runs in every SDK — either natively (Python via PyO3,
Go via CGO) or compiled to WebAssembly (Node.js). The pure-language fallback is
always available without native dependencies.

---

## Contributing

```bash
git clone https://github.com/anandsrinivasan1/leak-assert
cd leak-assert

# Rust core
cargo test

# Node SDK
cd sdks/node && npm install && npm test

# Python SDK
cd sdks/python && pip install -e ".[dev]" && pytest tests/

# Go SDK
cd sdks/go && go test ./...
```

---

## License

MIT © 2026 Anand Srinivasan
