# Vitest Integration

The `vitest-leak-assert` package provides a `leakTest()` helper and an optional reporter that writes HTML + JUnit reports after each run.

## Install

```sh
npm install --save-dev vitest-leak-assert
```

## Quick start

```ts
import { leakTest } from 'vitest-leak-assert'

leakTest('request handler does not leak', async (run) => {
  await run(async () => {
    await handleRequest({ method: 'GET', url: '/api/users' })
  })
}, { growthRate: '1kb/iter', iterations: 500 })
```

`leakTest` is a drop-in replacement for Vitest's `test()`. It:

1. Runs the workload for `iterations` (default 500) cycles after `warmup` (default 50)
2. Samples heap usage throughout
3. Evaluates the assertions you provide
4. Throws a Vitest assertion error on failure so CI goes red

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `warmup` | `number` | `50` | Iterations before sampling |
| `iterations` | `number` | `500` | Total measured iterations |
| `sampleEvery` | `number` | auto | Sample every N iterations |
| `growthRate` | `string \| number` | — | Max bytes/iter e.g. `"1kb/iter"` |
| `stable` | `string \| number` | — | Max total heap delta e.g. `"5mb"` |
| `ceiling` | `string \| number` | — | Absolute heap ceiling e.g. `"400mb"` |

## Plugin + reporter (optional)

For HTML and JUnit reports, register the plugin and reporter in `vitest.config.ts`:

```ts
import { defineConfig }       from 'vitest/config'
import leakAssert             from 'vitest-leak-assert'
import { LeakAssertReporter } from 'vitest-leak-assert'

export default defineConfig({
  plugins: [leakAssert({ outputDir: './leak-reports' })],
  test: {
    reporters: ['verbose', new LeakAssertReporter()],
  },
})
```

After the run, `./leak-reports/` will contain one `.html` and one `.xml` file per `leakTest` call.

## Example

```ts
import { leakTest } from 'vitest-leak-assert'
import { createServer } from './server'

const server = createServer()

leakTest('POST /api/items does not leak', async (run) => {
  await run(async () => {
    await server.inject({ method: 'POST', url: '/api/items', body: { name: 'x' } })
  })
}, {
  warmup:      100,
  iterations:  1000,
  growthRate:  '500',    // < 500 bytes/iter
  stable:      '10mb',
})
```

## Comparison with Jest plugin

Both `jest-leak-assert` and `vitest-leak-assert` expose the same `leakTest()` API. Choose based on your test runner:

| | `jest-leak-assert` | `vitest-leak-assert` |
|---|---|---|
| Test runner | Jest ≥ 29 | Vitest ≥ 1.0 |
| Reporter type | Jest `Reporter` class | Vitest `Reporter` interface |
| Config location | `jest.config.ts` reporters | `vitest.config.ts` reporters |
