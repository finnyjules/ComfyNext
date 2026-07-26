// frontend/tests/unit/studio-var-bindings.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { applyParamsPreview, writeThroughEdit, promoteControl, boundColumnLabel } from '~/composables/useStudioVarBindings'
import { COLLECTION_PROP, BINDINGS_PROP } from '~/lib/collection/types'
import { createCollection, addColumn, addRow, setCell } from '~/lib/collection/model'

function scene() {
  const c = createCollection('Vars')
  addColumn(c, 'intensity', 'number')
  const r = addRow(c); setCell(c, r.id, 'intensity', 42)
  const colNode = { id: '1', data: { nodeType: 'Collection', properties: { [COLLECTION_PROP]: c } } }
  const studio = { id: '2', data: { nodeType: 'GradientStudio', properties: {
    [BINDINGS_PROP]: { 'params.flow.intensity': { collectionId: c.id, columnKey: 'intensity' } },
  } } }
  const edges = [{ source: '1', sourceHandle: 'output-0', target: '2', targetHandle: 'input-3', data: { dataType: 'VARS' } }]
  return { c, colNode, studio, edges, nodes: [colNode, studio] }
}

describe('applyParamsPreview', () => {
  it('applies clamped values for known controls only', () => {
    const applied: Record<string, unknown> = {}
    const keys = applyParamsPreview(
      { params: { 'flow.intensity': 250, 'unknown.key': 1 } },
      [{ key: 'flow.intensity', label: 'I', kind: 'slider', min: 0, max: 100 }],
      (k, v) => { applied[k] = v },
    )
    expect(applied).toEqual({ 'flow.intensity': 100 })
    expect(keys).toEqual(['flow.intensity'])
  })
  it('skips invalid color values', () => {
    const applied: Record<string, unknown> = {}
    applyParamsPreview(
      { params: { 'bg': 'not-a-hex' } },
      [{ key: 'bg', label: 'B', kind: 'color' }],
      (k, v) => { applied[k] = v },
    )
    expect(applied).toEqual({})
  })
})

describe('writeThroughEdit', () => {
  it('writes a bound control edit into the collection preview-row cell', () => {
    const { c, nodes, edges } = scene()
    const ok = writeThroughEdit(() => nodes, () => edges, '2', 'params.flow.intensity', 77)
    expect(ok).toBe(true)
    expect(c.rows[0]!.values.intensity).toBe(77)
  })
  it('returns false for unbound paths', () => {
    const { nodes, edges } = scene()
    expect(writeThroughEdit(() => nodes, () => edges, '2', 'params.nope', 1)).toBe(false)
  })

  it('converges on repeated writes of the same value without touching the collection again', () => {
    const { c, nodes, edges } = scene()
    const first = writeThroughEdit(() => nodes, () => edges, '2', 'params.flow.intensity', 77)
    expect(first).toBe(true)
    const snapshotAfterFirst = JSON.parse(JSON.stringify(c.rows))

    const second = writeThroughEdit(() => nodes, () => edges, '2', 'params.flow.intensity', 77)
    expect(second).toBe(true)
    expect(JSON.parse(JSON.stringify(c.rows))).toEqual(snapshotAfterFirst)
  })
})

describe('promoteControl', () => {
  it('adds a typed column seeded with the current value and writes the binding', () => {
    const { c, nodes, edges, studio } = scene()
    const res = promoteControl(() => nodes, () => edges, '2',
      { key: 'canvas.background', label: 'Background', kind: 'color' }, '#112233', () => { throw new Error('should reuse wired collection') })
    expect(res?.columnKey).toBe('background')
    expect(c.columns.find(x => x.key === 'background')?.type).toBe('color')
    expect(c.rows[0]!.values.background).toBe('#112233')
    expect((studio.data.properties as any)[BINDINGS_PROP]['params.canvas.background']).toMatchObject({ columnKey: 'background', lastLiteral: '#112233' })
  })

  it('clamps a stale out-of-range previewRow to the existing row instead of appending an orphan row', () => {
    const { c, nodes, edges } = scene()
    c.previewRow = 5 // stale — only 1 row exists
    const res = promoteControl(() => nodes, () => edges, '2',
      { key: 'canvas.background', label: 'Background', kind: 'color' }, '#112233', () => { throw new Error('should reuse wired collection') })
    expect(res?.columnKey).toBe('background')
    expect(c.rows.length).toBe(1)
    expect(c.previewRow).toBe(0)
    expect(c.rows[0]!.values.background).toBe('#112233')
  })
})

describe('boundColumnLabel', () => {
  it('returns the column current label, not the frozen key, when the column was renamed', () => {
    const { c, nodes, edges, studio } = scene()
    // The binding stores columnKey 'intensity' (frozen at creation). Rename the
    // column header — the key stays, the label changes. The studio must show the
    // new label, mirroring the user renaming a column to "Name of person".
    c.columns.find(col => col.key === 'intensity')!.label = 'Name of person'
    ;(studio.data.properties as any)[BINDINGS_PROP] = { 'params.flow.intensity': { collectionId: c.id, columnKey: 'intensity' } }
    const label = boundColumnLabel(nodes, edges, '2', (studio.data.properties as any)[BINDINGS_PROP], 'flow.intensity')
    expect(label).toBe('Name of person')
  })

  it('returns null for an unbound control', () => {
    const { nodes, edges, studio } = scene()
    expect(boundColumnLabel(nodes, edges, '2', (studio.data.properties as any)[BINDINGS_PROP], 'flow.notbound')).toBe(null)
  })

  it('falls back to the columnKey when the wired collection cannot be resolved (dangling binding)', () => {
    const { nodes, edges, studio } = scene()
    const bindings = { 'params.flow.intensity': { collectionId: 'gone', columnKey: 'intensity' } }
    expect(boundColumnLabel(nodes, edges, '2', bindings, 'flow.intensity')).toBe('intensity')
  })
})

describe('a swept column key round-trips through resolution', () => {
  it('resolves swept cells written under the column KEY, and misses under the LABEL', async () => {
    // Regression: applySweep passed boundColumnFor() — the display LABEL — into
    // addSweepRows, which writes row.values[thatString]. resolveBindings reads
    // row.values[column.key]. keyFromLabel lowercases and underscores, so "Jitter"
    // became key "jitter": every swept row missed and fell back to lastLiteral,
    // and a sweep silently baked N identical frames. All five studio surfaces
    // shared the copied bug.
    const { addColumn, addSweepRows } = await import('~/lib/collection/model')
    const { resolveBindings } = await import('~/lib/collection/resolve')

    const make = () => ({ id: 'c1', columns: [] as any[], rows: [{ id: 'r0', values: {} }], previewRow: 0 }) as any
    const path = 'params.shape.jitter'

    const good: any = make()
    const col = addColumn(good, 'Jitter', 'number')
    expect(col.key).toBe('jitter')
    expect(col.label).toBe('Jitter')
    expect(col.key).not.toBe(col.label) // the whole trap in one line

    const bindings: any = { [path]: { collectionId: 'c1', columnKey: col.key } }

    // Correct: rows keyed by col.key resolve to the distinct swept values.
    addSweepRows(good, col.key, [0, 50, 100])
    const resolved = good.rows.slice(1).map((_r: any, i: number) =>
      resolveBindings(good, bindings, i + 1).values[path])
    expect(resolved).toEqual([0, 50, 100])

    // The old behaviour: rows keyed by the LABEL resolve to nothing.
    const bad: any = make()
    addColumn(bad, 'Jitter', 'number')
    addSweepRows(bad, 'Jitter', [0, 50, 100])
    const missed = bad.rows.slice(1).map((_r: any, i: number) =>
      resolveBindings(bad, bindings, i + 1).values[path])
    expect(missed).toEqual([undefined, undefined, undefined])
  })
})
