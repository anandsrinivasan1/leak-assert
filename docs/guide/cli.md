# CLI

```sh
cargo install leak-assert
```

## Commands

### `run` — YAML config

```sh
leak-assert run --config leak-assert.yaml
```

```yaml
# leak-assert.yaml
name: checkout-api
target:
  http:
    url:    http://localhost:3000/api/checkout
    method: POST
workload:
  warmup:      200
  iterations:  10_000
assertions:
  - type: growth_rate
    max: "0.5kb/iter"
  - type: stable
    tolerance_mb: 5.0
```

Generates `leak-assert-checkout-api.html` and `.xml` automatically.

### `http` — quick one-liner

```sh
leak-assert http http://localhost:3000/ping \
  --iters 5000 --warmup 100 --assert-growth "1kb/iter"
```

### `watch` — live monitoring

```sh
leak-assert watch \
  --url http://localhost:9123/__leak_assert__/heap \
  --interval 5 \
  --threshold "2kb/iter" \
  --window 20
```

Polls every 5 seconds, keeps a 20-sample rolling window, exits 1 when slope > threshold.

### `diff` — compare two runs

```sh
leak-assert diff before.json after.json
# Exits 1 if slope increased by > 1kb/iter
```
