import { takeSample, forceGC, trackGC, resetGCCount, Sample } from './samplers/v8'
import { runAssertions, AssertionOptions, olsSlope } from './assertions'

// ── Config ────────────────────────────────────────────────────────────────────

export interface LeakTestConfig {
  /** Iterations to run before sampling begins (not counted in analysis) */
  warmup?: number
  /** Total iterations including warmup */
  iterations: number
  /** How often to take a heap snapshot (every N iterations) */
  sampleEvery?: number
  /** Force GC before each sample */
  gc?: { force: boolean; between: 'iteration' | 'sample' }
  /** Label shown in reports */
  name?: string
}

// ── LeakTest class ────────────────────────────────────────────────────────────

export class LeakTest {
  private samples: Sample[] = []
  private stopGCTracking: (() => void) | null = null
  private cfg: Required<LeakTestConfig>

  constructor(config: LeakTestConfig) {
    this.cfg = {
      warmup:      config.warmup      ?? 0,
      iterations:  config.iterations,
      sampleEvery: config.sampleEvery ?? Math.max(1, Math.floor(config.iterations / 50)),
      gc:          config.gc          ?? { force: true, between: 'sample' },
      name:        config.name        ?? 'LeakTest',
    }
  }

  /** Run a synchronous workload for `iterations` times */
  run(fn: () => void): this {
    this.setup()
    const { warmup, iterations, sampleEvery, gc } = this.cfg

    for (let i = 0; i < warmup; i++) {
      fn()
    }

    // reset samples — warmup excluded
    this.samples = []
    resetGCCount()

    for (let i = 1; i <= iterations; i++) {
      fn()
      if (gc.between === 'iteration' && gc.force) forceGC()

      if (i % sampleEvery === 0) {
        if (gc.between === 'sample' && gc.force) forceGC()
        this.samples.push(takeSample(i))
      }
    }

    this.teardown()
    return this
  }

  /** Run an async workload for `iterations` times */
  async runAsync(fn: () => Promise<void>): Promise<this> {
    this.setup()
    const { warmup, iterations, sampleEvery, gc } = this.cfg

    for (let i = 0; i < warmup; i++) await fn()

    this.samples = []
    resetGCCount()

    for (let i = 1; i <= iterations; i++) {
      await fn()
      if (gc.between === 'iteration' && gc.force) forceGC()

      if (i % sampleEvery === 0) {
        if (gc.between === 'sample' && gc.force) forceGC()
        this.samples.push(takeSample(i))
      }
    }

    this.teardown()
    return this
  }

  /** Assert on collected samples. Throws AssertionError on failure. */
  assert(opts: AssertionOptions): this {
    if (this.samples.length === 0) {
      throw new Error('leak-assert: call .run() before .assert()')
    }
    runAssertions(this.samples, opts)
    return this
  }

  /** Return raw samples for custom analysis */
  getSamples(): Readonly<Sample[]> {
    return this.samples
  }

  /** Print a summary to stdout */
  printSummary(): this {
    const slope = olsSlope(this.samples)
    const first = this.samples[0]?.heap_used ?? 0
    const last  = this.samples[this.samples.length - 1]?.heap_used ?? 0
    const delta = last - first
    console.log([
      `\n── leak-assert: ${this.cfg.name} ──`,
      `  samples:    ${this.samples.length}`,
      `  growth:     ${slope.toFixed(1)} bytes/iter`,
      `  total delta: ${(delta / 1024 / 1024).toFixed(2)} MB`,
      `──────────────────────────────────\n`,
    ].join('\n'))
    return this
  }

  private setup() {
    this.stopGCTracking = trackGC()
  }

  private teardown() {
    this.stopGCTracking?.()
    this.stopGCTracking = null
  }
}
