import { AssertionError, kb, mb, olsSlope, parseBytes } from '../assertions'
import type { Sample } from '../samplers/v8'

function makeSamples(pairs: [number, number][]): Sample[] {
  return pairs.map(([iter, heap_used]) => ({
    ts: Date.now(), iter, heap_used,
    heap_total: heap_used, rss: heap_used, external: 0, gc_count: 0,
  }))
}

// ── parseBytes ────────────────────────────────────────────────────────────────

describe('parseBytes', () => {
  it('parses raw numbers', () => expect(parseBytes(1024)).toBe(1024))
  it('parses kb string',   () => expect(parseBytes('1kb')).toBe(1024))
  it('parses mb string',   () => expect(parseBytes('2mb')).toBe(2 * 1024 * 1024))
  it('strips /iter suffix',() => expect(parseBytes('1kb/iter')).toBe(1024))
  it('strips < prefix',    () => expect(parseBytes('< 512')).toBe(512))
  it('kb() helper',        () => expect(kb(2)).toBe(2048))
  it('mb() helper',        () => expect(mb(1)).toBe(1024 * 1024))
  it('throws on bad input',() => expect(() => parseBytes('xyz')).toThrow())
})

// ── olsSlope ──────────────────────────────────────────────────────────────────

describe('olsSlope', () => {
  it('returns 0 for flat heap', () => {
    const s = makeSamples([[100, 50_000_000], [200, 50_000_000], [300, 50_000_000]])
    expect(olsSlope(s)).toBeCloseTo(0, 0)
  })

  it('computes linear growth accurately', () => {
    // heap = 50MB + 200 * iter
    const s = makeSamples([[0, 50_000_000], [100, 50_020_000], [200, 50_040_000], [300, 50_060_000]])
    expect(olsSlope(s)).toBeCloseTo(200, 0)
  })

  it('returns 0 for fewer than 2 samples', () => {
    expect(olsSlope(makeSamples([[0, 1000]]))).toBe(0)
    expect(olsSlope([])).toBe(0)
  })
})

// ── runAssertions (via imports) ───────────────────────────────────────────────

import { runAssertions } from '../assertions'

describe('growthRate assertion', () => {
  it('passes when slope is within limit', () => {
    // 50 bytes/iter
    const s = makeSamples([[0, 50_000_000], [100, 50_005_000], [200, 50_010_000], [300, 50_015_000]])
    expect(() => runAssertions(s, { growthRate: kb(1) })).not.toThrow()
  })

  it('throws AssertionError when limit exceeded', () => {
    // 2000 bytes/iter
    const s = makeSamples([[0, 50_000_000], [100, 50_200_000], [200, 50_400_000], [300, 50_600_000]])
    expect(() => runAssertions(s, { growthRate: kb(0.5) }))
      .toThrow(AssertionError)
  })
})

describe('stable assertion', () => {
  it('passes when delta within tolerance', () => {
    const s = makeSamples([[0, 50_000_000], [1000, 51_000_000]])
    expect(() => runAssertions(s, { stable: mb(2) })).not.toThrow()
  })

  it('throws when delta exceeds tolerance', () => {
    const s = makeSamples([[0, 50_000_000], [1000, 70_000_000]])
    expect(() => runAssertions(s, { stable: mb(2) })).toThrow(AssertionError)
  })
})

describe('ceiling assertion', () => {
  it('passes when peak is under ceiling', () => {
    const s = makeSamples([[0, 50_000_000], [500, 60_000_000]])
    expect(() => runAssertions(s, { ceiling: mb(100) })).not.toThrow()
  })

  it('throws when peak exceeds ceiling', () => {
    const s = makeSamples([[0, 200_000_000]])
    expect(() => runAssertions(s, { ceiling: mb(100) })).toThrow(AssertionError)
  })
})
