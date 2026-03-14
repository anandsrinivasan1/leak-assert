/**
 * vitest-leak-assert
 *
 * Usage in vitest.config.ts:
 *
 *   import leakAssert from 'vitest-leak-assert'
 *
 *   export default defineConfig({
 *     plugins: [leakAssert({ outputDir: './leak-reports' })],
 *     test: { reporters: ['verbose', 'vitest-leak-assert/reporter'] }
 *   })
 *
 * Usage in tests:
 *
 *   import { leakTest } from 'vitest-leak-assert'
 *
 *   leakTest('handler no leak', async (run) => {
 *     await run(() => handler(req, res))
 *   }, { growthRate: '1kb/iter' })
 */

import { LeakTest } from 'leak-assert'
import type { AssertionOptions } from 'leak-assert'
import { test } from 'vitest'

export interface VitestLeakTestOptions extends AssertionOptions {
  warmup?:     number
  iterations?: number
}

/**
 * `leakTest` wraps a Vitest `test()` call with memory leak assertions.
 */
export function leakTest(
  name: string,
  fn:   (run: (workload: () => Promise<void> | void) => Promise<void>) => Promise<void>,
  opts: VitestLeakTestOptions = {},
): void {
  const { warmup = 50, iterations = 500, growthRate, stable, ceiling } = opts

  test(name, async () => {
    const lt = new LeakTest({ warmup, iterations })

    await fn(async (workload) => {
      if (workload.constructor.name === 'AsyncFunction') {
        await lt.runAsync(workload as () => Promise<void>)
      } else {
        lt.run(workload as () => void)
      }
    })

    lt.assert({ growthRate, stable, ceiling })
  })
}

// ── Vitest plugin factory ─────────────────────────────────────────────────────

export interface LeakAssertPluginOptions {
  outputDir?: string
}

export default function leakAssertPlugin(_opts: LeakAssertPluginOptions = {}) {
  return {
    name: 'vitest-leak-assert',
    // Vitest plugin hooks can be added here as the API stabilises
  }
}
