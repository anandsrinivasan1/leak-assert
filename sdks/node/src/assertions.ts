import { Sample } from './samplers/v8'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AssertionOptions {
  /** Max heap growth per iteration e.g. "1kb/iter" or bytes number */
  growthRate?: string | number
  /** Max total heap increase over the test e.g. "5mb" or bytes */
  stable?: string | number
  /** Absolute heap ceiling e.g. "400mb" */
  ceiling?: string | number
  /** Object types that must not increase in count */
  noRetainedTypes?: string[]
}

export class AssertionError extends Error {
  constructor(
    public readonly assertion: string,
    public readonly actual:    string,
    public readonly expected:  string,
  ) {
    super(`leak-assert [${assertion}]: ${actual} — expected ${expected}`)
    this.name = 'AssertionError'
  }
}

// ── Assertion runner ──────────────────────────────────────────────────────────

export function runAssertions(samples: Sample[], opts: AssertionOptions): void {
  if (samples.length < 3) return

  if (opts.growthRate !== undefined) {
    assertGrowthRate(samples, parseBytes(opts.growthRate))
  }
  if (opts.stable !== undefined) {
    assertStable(samples, parseBytes(opts.stable))
  }
  if (opts.ceiling !== undefined) {
    assertCeiling(samples, parseBytes(opts.ceiling))
  }
}

// ── Individual assertions ─────────────────────────────────────────────────────

function assertGrowthRate(samples: Sample[], maxBytesPerIter: number): void {
  const slope = olsSlope(samples)
  if (slope > maxBytesPerIter) {
    throw new AssertionError(
      'growthRate',
      `${slope.toFixed(1)} bytes/iter`,
      `< ${maxBytesPerIter} bytes/iter`,
    )
  }
}

function assertStable(samples: Sample[], toleranceBytes: number): void {
  const first = samples[0].heap_used
  const last  = samples[samples.length - 1].heap_used
  const delta = Math.abs(last - first)
  if (delta > toleranceBytes) {
    throw new AssertionError(
      'stable',
      `+${(delta / 1024 / 1024).toFixed(2)} MB retained`,
      `< ${(toleranceBytes / 1024 / 1024).toFixed(2)} MB`,
    )
  }
}

function assertCeiling(samples: Sample[], maxBytes: number): void {
  const peak = Math.max(...samples.map(s => s.heap_used))
  if (peak > maxBytes) {
    throw new AssertionError(
      'ceiling',
      `${(peak / 1024 / 1024).toFixed(2)} MB peak`,
      `< ${(maxBytes / 1024 / 1024).toFixed(2)} MB`,
    )
  }
}

// ── Math helpers ──────────────────────────────────────────────────────────────

/** OLS slope: bytes gained per iteration */
export function olsSlope(samples: Sample[]): number {
  const n      = samples.length
  const sumX   = samples.reduce((a, s) => a + s.iter,               0)
  const sumY   = samples.reduce((a, s) => a + s.heap_used,          0)
  const sumXY  = samples.reduce((a, s) => a + s.iter * s.heap_used, 0)
  const sumXX  = samples.reduce((a, s) => a + s.iter * s.iter,      0)
  const denom  = n * sumXX - sumX * sumX
  return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom
}

/** Parse "1kb/iter", "2mb", or raw number (bytes) */
export function parseBytes(input: string | number): number {
  if (typeof input === 'number') return input
  const s    = input.toLowerCase().replace(/\/iter$/, '').replace(/^<\s*/, '').trim()
  const match = s.match(/^([\d.]+)\s*(kb?|mb?|gb?)?$/)
  if (!match) throw new Error(`leak-assert: cannot parse bytes value "${input}"`)
  const n   = parseFloat(match[1])
  const unit = (match[2] ?? '').replace('b', '')
  const mult: Record<string, number> = { k: 1024, m: 1024 ** 2, g: 1024 ** 3, '': 1 }
  return n * (mult[unit] ?? 1)
}

// ── Convenience constants ─────────────────────────────────────────────────────
export const kb = (n: number) => n * 1024
export const mb = (n: number) => n * 1024 * 1024
