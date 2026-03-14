/**
 * V8 heap snapshot diff — object-level retention tracking.
 * Requires Node.js >= 18 with --expose-gc.
 *
 * Usage:
 *   const baseline = await takeHeapSnapshot()
 *   // ... run workload ...
 *   const after    = await takeHeapSnapshot()
 *   const diff     = diffSnapshots(baseline, after)
 *   assertNoDiff(diff, { ignore: ['WeakRef'] })
 */

import * as v8 from 'v8'

export interface ObjectCount {
  type:  string
  count: number
  size:  number
}

export interface SnapshotSummary {
  totalCount: number
  totalSize:  number
  objects:    ObjectCount[]
}

export interface SnapshotDiff {
  grown:    ObjectCount[]   // types that increased
  shrunk:   ObjectCount[]   // types that decreased
  newTypes: ObjectCount[]   // types that appeared
}

export class HeapRetentionError extends Error {
  constructor(public readonly diff: SnapshotDiff) {
    const grown = diff.grown.map(o => `${o.type}(+${o.count})`).join(', ')
    super(`leak-assert [heap-diff]: retained object types: ${grown}`)
    this.name = 'HeapRetentionError'
  }
}

// ── Snapshot via v8.writeHeapSnapshot + parse ─────────────────────────────────

/**
 * Take an object-type count summary using v8.getHeapCodeStatistics
 * and process.memoryUsage as a lightweight approximation.
 *
 * For full heap snapshot diff, use takeDetailedSnapshot() which uses
 * v8.writeHeapSnapshot() — slower but exact.
 */
export function takeLightSnapshot(): Map<string, { count: number; size: number }> {
  // Force GC first for clean snapshot
  if (typeof (global as any).gc === 'function') {
    (global as any).gc()
  }

  // WeakRef-based object counter using FinalizationRegistry is not reliable.
  // Light mode uses a heuristic: track heap_used delta only.
  // Detailed mode (below) uses actual heap snapshots.
  const stats = v8.getHeapStatistics()
  const map   = new Map<string, { count: number; size: number }>()
  map.set('__heap_used__', { count: 1, size: stats.used_heap_size })
  return map
}

/**
 * Detailed snapshot using v8.writeHeapSnapshot().
 * Parses the .heapsnapshot JSON to get per-type counts.
 * This is the accurate but slower path.
 */
export async function takeDetailedSnapshot(): Promise<Map<string, { count: number; size: number }>> {
  const { tmpdir } = await import('os')
  const { join }   = await import('path')
  const { readFile, unlink } = await import('fs/promises')

  if (typeof (global as any).gc === 'function') (global as any).gc()

  const path = v8.writeHeapSnapshot(join(tmpdir(), `leak-assert-${Date.now()}.heapsnapshot`))

  try {
    const raw      = await readFile(path, 'utf8')
    const snapshot = JSON.parse(raw) as V8HeapSnapshot
    return parseSnapshot(snapshot)
  } finally {
    await unlink(path).catch(() => {})
  }
}

// ── Diff ──────────────────────────────────────────────────────────────────────

export function diffSnapshots(
  before: Map<string, { count: number; size: number }>,
  after:  Map<string, { count: number; size: number }>,
): SnapshotDiff {
  const grown:    ObjectCount[] = []
  const shrunk:   ObjectCount[] = []
  const newTypes: ObjectCount[] = []

  for (const [type, afterVal] of after) {
    const beforeVal = before.get(type)
    if (!beforeVal) {
      newTypes.push({ type, count: afterVal.count, size: afterVal.size })
    } else {
      const delta = afterVal.count - beforeVal.count
      if (delta > 0) {
        grown.push({ type, count: delta, size: afterVal.size - beforeVal.size })
      } else if (delta < 0) {
        shrunk.push({ type, count: Math.abs(delta), size: Math.abs(afterVal.size - beforeVal.size) })
      }
    }
  }

  grown.sort((a, b) => b.size - a.size)
  return { grown, shrunk, newTypes }
}

export function assertNoDiff(
  diff:    SnapshotDiff,
  options: { ignore?: string[]; maxGrown?: number } = {},
): void {
  const ignore   = new Set(options.ignore ?? [])
  const maxGrown = options.maxGrown ?? 0
  const leaking  = diff.grown.filter(o => !ignore.has(o.type) && o.count > maxGrown)
  if (leaking.length > 0) {
    throw new HeapRetentionError({ ...diff, grown: leaking })
  }
}

// ── V8 snapshot parser ────────────────────────────────────────────────────────

interface V8HeapSnapshot {
  snapshot: { meta: { node_fields: string[] } }
  nodes:    number[]
  strings:  string[]
}

function parseSnapshot(snapshot: V8HeapSnapshot): Map<string, { count: number; size: number }> {
  const fields    = snapshot.snapshot.meta.node_fields
  const typeIdx   = fields.indexOf('type')
  const nameIdx   = fields.indexOf('name')
  const sizeIdx   = fields.indexOf('self_size')
  const fieldLen  = fields.length
  const result    = new Map<string, { count: number; size: number }>()

  for (let i = 0; i < snapshot.nodes.length; i += fieldLen) {
    const name = snapshot.strings[snapshot.nodes[i + nameIdx]] ?? 'unknown'
    const size = snapshot.nodes[i + sizeIdx] ?? 0
    const existing = result.get(name)
    if (existing) {
      existing.count++
      existing.size += size
    } else {
      result.set(name, { count: 1, size })
    }
  }
  return result
}
