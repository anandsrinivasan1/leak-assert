/**
 * leak-assert — Deno example
 *
 * Prerequisites:
 *   cd sdks/node && npm run build:wasm:web
 *
 * Run:
 *   deno run --allow-read examples/deno/main.ts
 */

// Load the wasm-bindgen "web" target output.
// wasm-pack --target web generates ESM with an `init(url?)` default export.
import init, { analyze_json, slope_json } from '../../sdks/node/wasm/web-pkg/leak_assert_wasm.js'

// In Deno, we resolve the .wasm binary path using import.meta.resolve.
const wasmUrl = new URL('../../sdks/node/wasm/web-pkg/leak_assert_wasm_bg.wasm', import.meta.url)
await init(wasmUrl)

console.log('leak-assert WASM loaded ✓\n')

// ── Build synthetic samples ───────────────────────────────────────────────────

type Sample = { ts: number; iter: number; heap_used: number }

function buildSamples(heapFn: (iter: number) => number, count = 10): Sample[] {
  return Array.from({ length: count }, (_, i) => ({
    ts:        Date.now() + i * 100,
    iter:      i * 100,
    heap_used: heapFn(i * 100),
  }))
}

// ── Test 1: flat heap (should PASS) ──────────────────────────────────────────

const flatSamples  = buildSamples(() => 50_000_000)
const flatSlope    = slope_json(JSON.stringify(flatSamples))
console.log(`[flat heap]   slope = ${flatSlope.toFixed(1)} bytes/iter`)

const flatResult = JSON.parse(analyze_json(
  JSON.stringify(flatSamples),
  JSON.stringify([{ type: 'growth_rate', max_bytes_per_iter: 1024 }]),
))
console.log(`[flat heap]   ${flatResult.passed ? 'PASS ✓' : 'FAIL ✗'}  ${flatResult.summary}\n`)

// ── Test 2: leaky heap (should FAIL) ─────────────────────────────────────────

// 2000 bytes/iter growth — exceeds 1KB/iter limit
const leakySamples = buildSamples((iter) => 50_000_000 + iter * 2000)
const leakySlope   = slope_json(JSON.stringify(leakySamples))
console.log(`[leaky heap]  slope = ${leakySlope.toFixed(1)} bytes/iter`)

const leakyResult = JSON.parse(analyze_json(
  JSON.stringify(leakySamples),
  JSON.stringify([{ type: 'growth_rate', max_bytes_per_iter: 1024 }]),
))
console.log(`[leaky heap]  ${leakyResult.passed ? 'PASS ✓' : 'FAIL ✗'}  ${leakyResult.summary}\n`)

// Exit non-zero if the leaky test incorrectly passed (sanity check)
if (leakyResult.passed) {
  console.error('ERROR: leaky test should have failed')
  Deno.exit(1)
}

console.log('Demo complete.')
