/**
 * leak-assert — Node.js / TypeScript usage examples
 * Run with: node --expose-gc node_modules/.bin/jest
 */
import { LeakTest, kb, mb } from 'leak-assert'

// ── Example 1: Simple map that leaks ─────────────────────────────────────────

const leakyCache = new Map<string, Buffer>()

test('leaky cache is caught', async () => {
  const lt = new LeakTest({ warmup: 50, iterations: 500 })

  await lt.runAsync(async () => {
    // Bug: never evicts — this will fail the growth_rate assertion
    leakyCache.set(Math.random().toString(), Buffer.alloc(1024))
  })

  // Expect this test to FAIL — demonstrates the framework catching a leak
  expect(() => {
    lt.assert({ growthRate: kb(0.5) })
  }).toThrow('leak-assert [growthRate]')
})

// ── Example 2: Well-behaved function passes ───────────────────────────────────

test('clean function passes memory assertions', async () => {
  const lt = new LeakTest({
    name:       'clean-handler',
    warmup:     100,
    iterations: 1000,
    gc:         { force: true, between: 'sample' },
  })

  await lt.runAsync(async () => {
    // allocate and release — no retention
    const buf = Buffer.alloc(4096)
    buf.fill(0)
    // buf goes out of scope, GC can collect
  })

  lt.printSummary()

  lt.assert({
    growthRate: kb(1),   // < 1kb per iteration
    stable:     mb(5),   // heap returns within 5MB of start
    ceiling:    mb(200), // never exceeds 200MB absolute
  })
})

// ── Example 3: Async HTTP handler simulation ──────────────────────────────────

test('async handler does not leak event listeners', async () => {
  const { EventEmitter } = await import('events')
  const emitter          = new EventEmitter()

  const lt = new LeakTest({ iterations: 500, warmup: 50 })

  await lt.runAsync(async () => {
    const handler = () => {}
    emitter.on('data', handler)
    emitter.emit('data', { payload: 'test' })
    emitter.off('data', handler) // correct cleanup
  })

  lt.assert({
    growthRate: kb(1),
    stable:     mb(5),
  })
})
