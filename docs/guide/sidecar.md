# HTTP Sidecar

The sidecar exposes `/__leak_assert__/heap` on your running process so the CLI can poll heap metrics without modifying your test code.

## Endpoints

| Method | Path | Response |
|--------|------|----------|
| `GET`  | `/__leak_assert__/heap` | `{ ts, heap_used, heap_total, rss, gc_count }` |
| `POST` | `/__leak_assert__/gc`   | `{ ok, collected }` — triggers GC |

All endpoints are **localhost-only** by default (403 for remote IPs).

## Mount in one line

::: code-group

```ts [Express]
import { leakAssertSidecar } from 'leak-assert/middleware'
app.use(leakAssertSidecar())
```

```ts [Standalone (no framework)]
import { startSidecarServer } from 'leak-assert/middleware'
startSidecarServer({ port: 9123 })
```

```python [FastAPI]
from leak_assert.middleware import LeakAssertMiddleware
app.add_middleware(LeakAssertMiddleware)
```

```python [Flask]
from leak_assert.middleware import LeakAssertWSGIMiddleware
app.wsgi_app = LeakAssertWSGIMiddleware(app.wsgi_app)
```

```go [Go stdlib]
leakassert.MountSidecar(mux, leakassert.SidecarOptions{})
```

:::

## Then poll with the CLI

```sh
leak-assert watch --url http://localhost:9123/__leak_assert__/heap
```
