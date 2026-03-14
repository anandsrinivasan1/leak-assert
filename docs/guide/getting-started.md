# Getting Started

leak-assert runs your workload N times, samples the heap at checkpoints, fits a growth curve, and fails your test if the slope exceeds a threshold.

## Install

::: code-group

```sh [Node]
npm install --save-dev leak-assert
```

```sh [Python]
pip install leak-assert
```

```sh [Go]
go get github.com/leak-assert/leak-assert-go
```

```sh [CLI]
cargo install leak-assert
```

:::

## Write your first test

::: code-group

```ts [Node]
import { LeakTest, kb } from 'leak-assert'

test('handler does not leak', async () => {
  const lt = new LeakTest({ warmup: 100, iterations: 1000 })

  await lt.runAsync(async () => {
    await myHandler(fakeRequest())
  })

  lt.assert({ growthRate: kb(1) })   // fails if > 1kb/iter
})
```

```python [Python]
from leak_assert import LeakTest, kb

def test_handler_no_leak():
    with LeakTest(iterations=1000, warmup=100) as t:
        for _ in t:
            handle_request(fake_request())

    t.assert_growth_rate(max=kb(1))
```

```go [Go]
func TestHandlerNoLeak(t *testing.T) {
    lt := leakassert.New(t, leakassert.Config{
        Warmup: 100, Iterations: 1000,
    })
    lt.Run(func() { handler.ServeHTTP(w, fakeRequest()) })
    lt.Assert(leakassert.GrowthRate("1kb/iter"))
}
```

:::

## How it works

```
warmup (excluded) → iterations → sample every N → OLS regression → assert slope
```

1. **Warmup** — lets JIT, caches, and connection pools stabilise
2. **Iterations** — runs your workload and samples heap every N calls
3. **OLS slope** — fits a line to heap_used vs iteration number
4. **Assert** — fails if slope > threshold, heap delta > tolerance, or peak > ceiling

See [Node SDK](/guide/node), [Python SDK](/guide/python), or [Go SDK](/guide/go) for full API reference.
