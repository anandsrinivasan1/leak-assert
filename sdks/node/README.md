# @anandsrinivasan2/leak-assert

**Memory leak regression testing for Node.js — write assertions, not profiler reports.**

[![npm](https://img.shields.io/npm/v/@anandsrinivasan2/leak-assert)](https://www.npmjs.com/package/@anandsrinivasan2/leak-assert)
[![CI](https://github.com/anandsrinivasan1/leak-assert/actions/workflows/ci.yml/badge.svg)](https://github.com/anandsrinivasan1/leak-assert/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../../LICENSE)

## Install

```sh
npm install --save-dev @anandsrinivasan2/leak-assert
```

## Quick start

```ts
import { LeakTest, kb, mb } from '@anandsrinivasan2/leak-assert'

const lt = new LeakTest({ iterations: 500, warmup: 50 })

await lt.runAsync(async () => {
  await handleRequest({ method: 'GET', url: '/api/users' })
})

lt.assert({
  growthRate: kb(1),   // heap must not grow faster than 1 KB/iter
  stable:     mb(5),   // total heap delta must stay under 5 MB
})
```

## Jest plugin

```ts
import { leakTest } from 'jest-leak-assert'

leakTest('handler does not leak', async (run) => {
  await run(() => handleRequest(req))
}, { growthRate: '1kb/iter' })
```

## Vitest plugin

```ts
import { leakTest } from 'vitest-leak-assert'

leakTest('handler does not leak', async (run) => {
  await run(() => handleRequest(req))
}, { growthRate: '1kb/iter' })
```

## Assertions

| Assertion | Description | Example |
|-----------|-------------|---------|
| `growthRate` | Max heap bytes added per iteration (OLS slope) | `"1kb/iter"`, `kb(1)` |
| `stable` | Max total heap delta over the whole run | `"5mb"`, `mb(5)` |
| `ceiling` | Absolute heap must never exceed this | `"400mb"` |

## Heap snapshot diff

```ts
import { takeDetailedSnapshot, diffSnapshots, assertNoDiff } from '@anandsrinivasan2/leak-assert'

const before = await takeDetailedSnapshot()
// ... run workload ...
const after  = await takeDetailedSnapshot()
assertNoDiff(diffSnapshots(before, after), { ignore: ['WeakRef'] })
```

## Reporters

```ts
import { toHTML, toJUnit } from '@anandsrinivasan2/leak-assert/reporters'
import { writeFileSync } from 'fs'

// build report from LeakTest result...
writeFileSync('leak-report.html', toHTML(report))
writeFileSync('leak-report.xml',  toJUnit(report))
```

## Browser / Deno

Build the web WASM target, then wrap it:

```sh
npm run build:wasm:web
```

```ts
import init, { analyze_json, slope_json } from './wasm/web-pkg/leak_assert_wasm.js'
import { LeakAssert } from '@anandsrinivasan2/leak-assert/browser'

await init()
const la = new LeakAssert({ analyze_json, slope_json })
const result = la.analyze(samples, [{ type: 'growth_rate', max_bytes_per_iter: 1024 }])
```

## Full documentation

See the [project README](../../README.md) and [docs](../../docs/).
