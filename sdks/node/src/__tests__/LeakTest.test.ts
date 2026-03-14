import { LeakTest, AssertionError, kb, mb } from '../index'

describe('LeakTest.run()', () => {
  it('collects samples after run', () => {
    const lt = new LeakTest({ iterations: 100, warmup: 0 })
    lt.run(() => { const x = Buffer.alloc(16); void x })
    expect(lt.getSamples().length).toBeGreaterThan(0)
  })

  it('warmup iterations are excluded from samples', () => {
    const lt = new LeakTest({ iterations: 50, warmup: 100, sampleEvery: 10 })
    lt.run(() => {})
    // All sample iters should be between 1 and 50
    for (const s of lt.getSamples()) {
      expect(s.iter).toBeGreaterThanOrEqual(1)
      expect(s.iter).toBeLessThanOrEqual(50)
    }
  })

  it('samples are ordered by iter ascending', () => {
    const lt = new LeakTest({ iterations: 100, warmup: 0, sampleEvery: 10 })
    lt.run(() => {})
    const iters = lt.getSamples().map(s => s.iter)
    expect(iters).toEqual([...iters].sort((a, b) => a - b))
  })
})

describe('LeakTest.runAsync()', () => {
  it('works with async workloads', async () => {
    const lt = new LeakTest({ iterations: 50, warmup: 0 })
    await lt.runAsync(async () => {
      await Promise.resolve()
    })
    expect(lt.getSamples().length).toBeGreaterThan(0)
  })
})

describe('LeakTest.assert()', () => {
  it('passes for clean function', () => {
    const lt = new LeakTest({ iterations: 100, warmup: 0 })
    lt.run(() => { const b = Buffer.alloc(64); void b })
    expect(() => lt.assert({ growthRate: kb(10), stable: mb(5) })).not.toThrow()
  })

  it('throws if called before run()', () => {
    const lt = new LeakTest({ iterations: 100 })
    expect(() => lt.assert({ stable: mb(5) })).toThrow()
  })

  it('returns this for chaining', () => {
    const lt = new LeakTest({ iterations: 50, warmup: 0 })
    lt.run(() => {})
    expect(lt.assert({ stable: mb(10) })).toBe(lt)
  })
})

describe('LeakTest.printSummary()', () => {
  it('does not throw', () => {
    const lt = new LeakTest({ iterations: 50, warmup: 0 })
    lt.run(() => {})
    expect(() => lt.printSummary()).not.toThrow()
  })
})
