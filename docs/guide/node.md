# Node / TypeScript SDK

## Install

```sh
npm install --save-dev leak-assert
# optional: build WASM for Rust-powered analysis
npm run build:wasm
```

## LeakTest

```ts
import { LeakTest, kb, mb } from 'leak-assert'

const lt = new LeakTest({
  warmup:      100,    // iterations before sampling begins
  iterations:  2000,   // total workload iterations
  sampleEvery: 40,     // sample heap every N iterations
  gc: { force: true, between: 'sample' },
  name: 'my-test',
})

// Sync workload
lt.run(() => processItem(item))

// Async workload
await lt.runAsync(async () => {
  await fetch('/api/data')
})

// Assertions (throw AssertionError on failure)
lt.assert({
  growthRate: kb(1),    // < 1kb/iter slope
  stable:     mb(5),    // heap returns within 5MB of start
  ceiling:    mb(200),  // never exceeds 200MB absolute
})

lt.printSummary()
```

## Heap snapshot diff

```ts
import { takeDetailedSnapshot, diffSnapshots, assertNoDiff } from 'leak-assert/heap-snapshot'

const before = await takeDetailedSnapshot()
for (let i = 0; i < 1000; i++) runWorkload()
const after  = await takeDetailedSnapshot()

const diff = diffSnapshots(before, after)
assertNoDiff(diff, { ignore: ['WeakRef', 'FinalizationRegistry'] })
```

## HTTP sidecar

```ts
import express from 'express'
import { leakAssertSidecar } from 'leak-assert/middleware'

const app = express()
app.use(leakAssertSidecar())
// → GET /__leak_assert__/heap returns heap JSON
```

## OTEL exporter

```ts
import { OtelExporter } from 'leak-assert/exporters/otel'

const exporter = new OtelExporter({ serviceName: 'my-api' })
// attach to LeakTest and call exporter.push(sample) in your sampler
```
