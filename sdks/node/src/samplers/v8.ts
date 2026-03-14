import * as v8 from 'v8'

export interface Sample {
  ts:         number   // unix ms
  iter:       number
  heap_used:  number   // bytes
  heap_total: number   // bytes
  rss:        number   // bytes
  external:   number   // bytes
  gc_count:   number
  label?:     string
}

let gcCount = 0

/**
 * Register a PerformanceObserver to count GC events.
 * Call once at test setup.
 */
export function trackGC(): () => void {
  // Node >=16 supports PerformanceObserver for GC
  try {
    const { PerformanceObserver } = require('perf_hooks')
    const obs = new PerformanceObserver(() => { gcCount++ })
    obs.observe({ entryTypes: ['gc'] })
    return () => obs.disconnect()
  } catch {
    return () => {}
  }
}

/** Force a V8 garbage collection if --expose-gc is set, otherwise no-op */
export function forceGC(): void {
  if (typeof (global as any).gc === 'function') {
    (global as any).gc()
  }
}

/** Take a single memory snapshot */
export function takeSample(iter: number, label?: string): Sample {
  const stats  = v8.getHeapStatistics()
  const mem    = process.memoryUsage()
  return {
    ts:         Date.now(),
    iter,
    heap_used:  stats.used_heap_size,
    heap_total: stats.total_heap_size,
    rss:        mem.rss,
    external:   mem.external,
    gc_count:   gcCount,
    label,
  }
}

/** Reset GC counter — call before each test */
export function resetGCCount(): void {
  gcCount = 0
}
