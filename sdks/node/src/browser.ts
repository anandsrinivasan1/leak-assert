/**
 * Browser / Deno entry point for leak-assert.
 *
 * Provides typed wrappers around the wasm-bindgen "web" target output from
 * `wasm-pack build --target web`.
 *
 * Usage:
 *   // 1. Build the web WASM target:
 *   //    npm run build:wasm:web
 *   //
 *   // 2. Serve wasm/web-pkg/ alongside your app.
 *   //
 *   // 3. In your browser JS (ESM):
 *   //    import init, { analyze_json, slope_json } from './wasm/web-pkg/leak_assert_wasm.js'
 *   //    await init()  // loads the .wasm binary
 *   //    import { LeakAssert } from '@anandsrinivasan2/leak-assert/browser'
 *   //    const la = new LeakAssert({ analyze_json, slope_json })
 *   //    const result = la.analyze(samples, [{ type: 'growth_rate', max_bytes_per_iter: 1024 }])
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BrowserSample {
  ts:          number
  iter:        number
  heap_used:   number
  heap_total?: number
  rss?:        number
  external?:   number
  gc_count?:   number
}

export type BrowserAssertion =
  | { type: 'growth_rate'; max_bytes_per_iter: number }
  | { type: 'stable';      tolerance_bytes: number }
  | { type: 'ceiling';     max_bytes: number }

export interface BrowserLeakTestResult {
  passed:   boolean
  summary:  string
  analysis: {
    slope_bytes_per_iter: number
    r_squared:            number
    baseline_delta_bytes: number
  }
  assertions: Array<{
    assertion: string
    actual:    string
    expected:  string
    status:    { Pass: null } | { Fail: { reason: string } }
  }>
}

/** Raw wasm-bindgen module interface produced by wasm-pack --target web */
export interface RawWasmModule {
  analyze_json(samplesJson: string, assertionsJson: string): string
  slope_json(samplesJson: string): number
}

// ── LeakAssert wrapper ────────────────────────────────────────────────────────

/**
 * Typed wrapper for the leak-assert WASM module.
 * Accepts the exports of the wasm-bindgen-generated module after init().
 */
export class LeakAssert {
  constructor(private readonly wasm: RawWasmModule) {}

  /**
   * Analyse a set of heap samples against the provided assertions.
   * Returns a structured result — throws never; check result.passed instead.
   */
  analyze(samples: BrowserSample[], assertions: BrowserAssertion[]): BrowserLeakTestResult {
    const json = this.wasm.analyze_json(
      JSON.stringify(samples),
      JSON.stringify(assertions),
    )
    return JSON.parse(json) as BrowserLeakTestResult
  }

  /** Compute the OLS heap-growth slope in bytes/iteration. */
  slope(samples: BrowserSample[]): number {
    return this.wasm.slope_json(JSON.stringify(samples))
  }
}

// ── Convenience: OLS slope (pure TS, no WASM required) ───────────────────────

/**
 * Compute OLS slope without loading WASM — useful for lightweight dashboards.
 */
export function olsSlope(samples: BrowserSample[]): number {
  const n = samples.length
  if (n < 2) return 0
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0
  for (const s of samples) {
    sumX  += s.iter
    sumY  += s.heap_used
    sumXY += s.iter * s.heap_used
    sumXX += s.iter * s.iter
  }
  const denom = n * sumXX - sumX * sumX
  return Math.abs(denom) < Number.EPSILON ? 0 : (n * sumXY - sumX * sumY) / denom
}
