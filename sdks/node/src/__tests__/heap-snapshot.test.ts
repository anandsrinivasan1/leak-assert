import { diffSnapshots, assertNoDiff, HeapRetentionError } from '../heap-snapshot'

type ObjMap = Map<string, { count: number; size: number }>

function map(entries: Record<string, [number, number]>): ObjMap {
  return new Map(Object.entries(entries).map(([k, [count, size]]) => [k, { count, size }]))
}

// ── diffSnapshots ─────────────────────────────────────────────────────────────

describe('diffSnapshots', () => {
  it('reports grown types', () => {
    const before = map({ MyClass: [10, 1000], Other: [5, 500] })
    const after  = map({ MyClass: [15, 1500], Other: [5, 500] })
    const diff   = diffSnapshots(before, after)
    expect(diff.grown).toHaveLength(1)
    expect(diff.grown[0].type).toBe('MyClass')
    expect(diff.grown[0].count).toBe(5)
  })

  it('reports new types', () => {
    const before = map({ Existing: [1, 100] })
    const after  = map({ Existing: [1, 100], NewType: [3, 300] })
    const diff   = diffSnapshots(before, after)
    expect(diff.newTypes).toHaveLength(1)
    expect(diff.newTypes[0].type).toBe('NewType')
  })

  it('reports shrunk types', () => {
    const before = map({ Big: [20, 2000] })
    const after  = map({ Big: [10, 1000] })
    const diff   = diffSnapshots(before, after)
    expect(diff.shrunk).toHaveLength(1)
    expect(diff.shrunk[0].type).toBe('Big')
    expect(diff.shrunk[0].count).toBe(10)
  })

  it('ignores types with no count change', () => {
    const before = map({ Stable: [5, 500] })
    const after  = map({ Stable: [5, 600] })  // size changed but count same
    const diff   = diffSnapshots(before, after)
    expect(diff.grown).toHaveLength(0)
    expect(diff.shrunk).toHaveLength(0)
  })

  it('returns empty diff for identical snapshots', () => {
    const snap = map({ A: [1, 100], B: [2, 200] })
    const diff = diffSnapshots(snap, snap)
    expect(diff.grown).toHaveLength(0)
    expect(diff.shrunk).toHaveLength(0)
    expect(diff.newTypes).toHaveLength(0)
  })

  it('sorts grown by size descending', () => {
    const before = map({ Small: [1, 100], Large: [1, 100] })
    const after  = map({ Small: [3, 500], Large: [3, 10_000] })
    const diff   = diffSnapshots(before, after)
    expect(diff.grown[0].type).toBe('Large')
    expect(diff.grown[1].type).toBe('Small')
  })
})

// ── assertNoDiff ─────────────────────────────────────────────────────────────

describe('assertNoDiff', () => {
  it('passes when nothing grew', () => {
    const diff = { grown: [], shrunk: [], newTypes: [] }
    expect(() => assertNoDiff(diff)).not.toThrow()
  })

  it('throws HeapRetentionError when types grew', () => {
    const diff = {
      grown:    [{ type: 'MyClass', count: 5, size: 500 }],
      shrunk:   [],
      newTypes: [],
    }
    expect(() => assertNoDiff(diff)).toThrow(HeapRetentionError)
  })

  it('ignores types in the ignore list', () => {
    const diff = {
      grown:    [{ type: 'WeakRef', count: 3, size: 300 }],
      shrunk:   [],
      newTypes: [],
    }
    expect(() => assertNoDiff(diff, { ignore: ['WeakRef'] })).not.toThrow()
  })

  it('respects maxGrown threshold', () => {
    const diff = {
      grown:    [{ type: 'Cache', count: 2, size: 200 }],
      shrunk:   [],
      newTypes: [],
    }
    // count=2 is within maxGrown=5 — should pass
    expect(() => assertNoDiff(diff, { maxGrown: 5 })).not.toThrow()
    // count=2 exceeds maxGrown=1 — should fail
    expect(() => assertNoDiff(diff, { maxGrown: 1 })).toThrow(HeapRetentionError)
  })

  it('error message lists leaking types', () => {
    const diff = {
      grown:    [{ type: 'Listener', count: 10, size: 1000 }],
      shrunk:   [],
      newTypes: [],
    }
    try {
      assertNoDiff(diff)
      fail('expected throw')
    } catch (e) {
      expect(e).toBeInstanceOf(HeapRetentionError)
      expect((e as HeapRetentionError).message).toContain('Listener')
    }
  })
})
