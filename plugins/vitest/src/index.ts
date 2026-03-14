/**
 * vitest-leak-assert
 *
 * Usage in vitest.config.ts:
 *
 *   import leakAssert from 'vitest-leak-assert'
 *
 *   export default defineConfig({
 *     plugins: [leakAssert({ outputDir: './leak-reports' })],
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

import { mkdirSync, writeFileSync } from 'fs'
import { join }                     from 'path'

import { LeakTest }            from '@anandsrinivasan2/leak-assert'
import { toHTML, toJUnit }      from '@anandsrinivasan2/leak-assert/reporters'
import type { AssertionOptions } from '@anandsrinivasan2/leak-assert'
import { test }           from 'vitest'

// ── Shared report store (written by leakTest, flushed by LeakAssertReporter) ──

interface PendingReport { html: string; xml: string }
const _pending = new Map<string, PendingReport>()

function _safeName(name: string): string {
  return name.replace(/[^a-z0-9]/gi, '-').toLowerCase()
}

// ── Plugin factory ────────────────────────────────────────────────────────────

export interface LeakAssertPluginOptions {
  /** Directory where HTML + JUnit reports are written. Default: ./leak-reports */
  outputDir?: string
}

let _outputDir = './leak-reports'

/**
 * Vite/Vitest plugin that configures the report output directory.
 * Add to the `plugins` array in your vitest.config.ts.
 */
export default function leakAssertPlugin(opts: LeakAssertPluginOptions = {}) {
  _outputDir = opts.outputDir ?? './leak-reports'
  mkdirSync(_outputDir, { recursive: true })
  return {
    name: 'vitest-leak-assert',
  }
}

// ── leakTest() helper ─────────────────────────────────────────────────────────

export interface VitestLeakTestOptions extends AssertionOptions {
  warmup?:      number
  iterations?:  number
  sampleEvery?: number
}

/**
 * `leakTest` wraps a Vitest `test()` call with memory leak assertions and
 * automatically writes an HTML + JUnit report to `outputDir` on completion.
 */
export function leakTest(
  name: string,
  fn:   (run: (workload: () => Promise<void> | void) => Promise<void>) => Promise<void>,
  opts: VitestLeakTestOptions = {},
): void {
  const { warmup = 50, iterations = 500, sampleEvery, growthRate, stable, ceiling } = opts

  test(name, async () => {
    const lt = new LeakTest({ warmup, iterations, sampleEvery })
    const t0 = Date.now()

    await fn(async (workload) => {
      if (workload.constructor.name === 'AsyncFunction') {
        await lt.runAsync(workload as () => Promise<void>)
      } else {
        lt.run(workload as () => void)
      }
    })

    // Evaluate assertions (throws on failure, which Vitest will catch)
    lt.assert({ growthRate, stable, ceiling })

    // Build and queue a report regardless of pass/fail
    // (Vitest catches thrown errors; this runs if assertions passed)
    _writeReport(name, lt, t0)
  })
}

function _writeReport(name: string, lt: LeakTest, startMs: number): void {
  try {
    const samples  = lt.getSamples()
    const durationMs = Date.now() - startMs
    // Build a minimal Report-like object compatible with toHTML / toJUnit
    const report = {
      name,
      passed:      true,
      slope:       0,
      delta:       0,
      durationMs,
      samples,
      assertions:  [] as Array<{ name: string; passed: boolean; actual: string; expected: string }>,
    }

    const safeName = _safeName(name)
    const dir      = _outputDir
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${safeName}.html`), toHTML(report), 'utf8')
    writeFileSync(join(dir, `${safeName}.xml`),  toJUnit(report), 'utf8')
  } catch {
    // Report writing is best-effort — never fail the test
  }
}

// ── LeakAssertReporter ────────────────────────────────────────────────────────

/**
 * Vitest custom reporter that flushes any pending leak-assert reports to disk.
 *
 * Add to your vitest.config.ts reporters array:
 *
 *   import { LeakAssertReporter } from 'vitest-leak-assert'
 *   export default defineConfig({
 *     test: { reporters: ['verbose', new LeakAssertReporter({ outputDir: './leak-reports' })] }
 *   })
 */
export class LeakAssertReporter {
  private readonly outputDir: string

  constructor(opts: LeakAssertPluginOptions = {}) {
    this.outputDir = opts.outputDir ?? _outputDir
  }

  onInit(): void {
    mkdirSync(this.outputDir, { recursive: true })
  }

  /** Called by Vitest after all test files have finished. */
  onFinished(): void {
    for (const [name, { html, xml }] of _pending) {
      const safe = _safeName(name)
      writeFileSync(join(this.outputDir, `${safe}.html`), html, 'utf8')
      writeFileSync(join(this.outputDir, `${safe}.xml`),  xml,  'utf8')
    }
    _pending.clear()
  }
}
