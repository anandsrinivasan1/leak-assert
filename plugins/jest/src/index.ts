/**
 * jest-leak-assert
 *
 * A Jest reporter that writes leak-assert HTML + JUnit reports after each run.
 *
 * Usage in jest.config.ts:
 *
 *   reporters: [
 *     'default',
 *     ['jest-leak-assert', { outputDir: './leak-reports' }]
 *   ]
 *
 * Also exports `leakTest()` — a convenience wrapper around LeakTest that
 * integrates with Jest's expect() and auto-names the test from the current
 * Jest test context.
 */

import type { AggregatedResult, Reporter, ReporterOnStartOptions, Test, TestResult } from '@jest/reporters'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

// ── Reporter ──────────────────────────────────────────────────────────────────

export interface JestLeakAssertOptions {
  outputDir?: string
}

export default class LeakAssertReporter implements Reporter {
  private readonly outputDir: string

  constructor(_globalConfig: unknown, options: JestLeakAssertOptions = {}) {
    this.outputDir = options.outputDir ?? './leak-reports'
  }

  onRunStart(_results: AggregatedResult, _options: ReporterOnStartOptions): void {
    mkdirSync(this.outputDir, { recursive: true })
  }

  onTestResult(_test: Test, testResult: TestResult): void {
    // Collect test results that have leak-assert metadata attached
    for (const r of testResult.testResults) {
      const meta = (r as any).__leakAssertMeta
      if (!meta) continue

      const { report, toHTML, toJUnit } = meta
      const safeName = r.fullName.replace(/[^a-z0-9]/gi, '-').toLowerCase()

      writeFileSync(join(this.outputDir, `${safeName}.html`), toHTML(report), 'utf8')
      writeFileSync(join(this.outputDir, `${safeName}.xml`),  toJUnit(report), 'utf8')
    }
  }

  onRunComplete(): void {}
  getLastError(): void {}
}

// ── leakTest() helper ─────────────────────────────────────────────────────────

import { LeakTest } from '@anandsrinivasan2/leak-assert'
import type { AssertionOptions } from '@anandsrinivasan2/leak-assert'
import { toHTML, toJUnit } from '@anandsrinivasan2/leak-assert/reporters'

export interface LeakTestOptions extends AssertionOptions {
  warmup?:      number
  iterations?:  number
  sampleEvery?: number
}

/**
 * Drop-in replacement for `it()` / `test()` that wraps the workload in
 * a LeakTest and runs assertions after the body completes.
 *
 * Usage:
 *   import { leakTest } from 'jest-leak-assert'
 *
 *   leakTest('handler does not leak', async (run) => {
 *     await run(async () => { await handler(req, res) })
 *   }, { growthRate: '1kb/iter', iterations: 500 })
 */
export function leakTest(
  name:    string,
  fn:      (run: (workload: () => Promise<void> | void) => Promise<void>) => Promise<void>,
  opts:    LeakTestOptions = {},
): void {
  const { warmup = 50, iterations = 500, sampleEvery, growthRate, stable, ceiling } = opts

  test(name, async () => {
    const lt = new LeakTest({ warmup, iterations, sampleEvery })

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
