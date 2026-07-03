import { describe, it, expect } from 'vitest'
import {
  createCollection, keyFromLabel, addColumn, addRow, setCell,
  removeColumn, removeRow, clampPreviewRow, rowLabel,
  addSweepRows, keepRow,
} from '~/lib/collection/model'

describe('createCollection', () => {
  it('creates an empty named collection with previewRow 0', () => {
    const c = createCollection('Teams')
    expect(c.name).toBe('Teams')
    expect(c.columns).toEqual([])
    expect(c.rows).toEqual([])
    expect(c.previewRow).toBe(0)
    expect(c.id).toMatch(/^col_/)
  })
})

describe('keyFromLabel', () => {
  it('snake_cases labels', () => {
    expect(keyFromLabel('Fill color', [])).toBe('fill_color')
  })
  it('dedupes against existing keys with _2 suffix', () => {
    expect(keyFromLabel('Team', ['team'])).toBe('team_2')
    expect(keyFromLabel('Team', ['team', 'team_2'])).toBe('team_3')
  })
  it('falls back to "column" for empty labels', () => {
    expect(keyFromLabel('  ', [])).toBe('column')
  })
})

describe('rows and cells', () => {
  it('addColumn + addRow + setCell round-trips', () => {
    const c = createCollection('t')
    const col = addColumn(c, 'Team name', 'text')
    expect(col.key).toBe('team_name')
    const row = addRow(c)
    setCell(c, row.id, 'team_name', 'France')
    expect(c.rows[0].values.team_name).toBe('France')
  })
  it('removeColumn drops values from rows', () => {
    const c = createCollection('t')
    addColumn(c, 'a', 'text')
    const r = addRow(c)
    setCell(c, r.id, 'a', 'x')
    removeColumn(c, 'a')
    expect(c.columns).toEqual([])
    expect(c.rows[0].values.a).toBeUndefined()
  })
  it('removeRow + clampPreviewRow keeps previewRow in range', () => {
    const c = createCollection('t')
    addRow(c); addRow(c)
    c.previewRow = 1
    removeRow(c, c.rows[1].id)
    clampPreviewRow(c)
    expect(c.previewRow).toBe(0)
  })
})

describe('rowLabel', () => {
  it('uses first text column value, falls back to row number', () => {
    const c = createCollection('t')
    addColumn(c, 'team', 'text')
    const r = addRow(c)
    expect(rowLabel(c, 0)).toBe('Row 1')
    setCell(c, r.id, 'team', 'France')
    expect(rowLabel(c, 0)).toBe('France')
  })
})

describe('addSweepRows', () => {
  it('appends one row per value, copying the preview row and overriding columnKey', () => {
    const c = createCollection('t')
    addColumn(c, 'team', 'text')
    addColumn(c, 'intensity', 'number')
    const r = addRow(c)
    setCell(c, r.id, 'team', 'France')
    setCell(c, r.id, 'intensity', 5)
    c.previewRow = 0

    const added = addSweepRows(c, 'intensity', [1, 2, 3])

    expect(added).toHaveLength(3)
    expect(c.rows).toHaveLength(4)
    for (const [i, val] of [1, 2, 3].entries()) {
      const row = added[i]
      expect(row.sweep).toBe(true)
      expect(row.values.team).toBe('France')
      expect(row.values.intensity).toBe(val)
    }
  })

  it('clamps the preview row first, so an out-of-range previewRow still copies the last row', () => {
    const c = createCollection('t')
    addColumn(c, 'label', 'text')
    const r = addRow(c)
    setCell(c, r.id, 'label', 'only-row')
    c.previewRow = 99 // out of range

    const added = addSweepRows(c, 'label', ['x'])

    expect(added[0].values.label).toBe('x')
    // clamped preview row (0, the only row) was copied as the base before override
    expect(c.previewRow).toBe(0)
  })

  it('uses an empty values object as the base when the collection has no rows', () => {
    const c = createCollection('t')
    const added = addSweepRows(c, 'foo', ['a', 'b'])
    expect(added).toHaveLength(2)
    expect(added[0].values).toEqual({ foo: 'a' })
    expect(added[1].values).toEqual({ foo: 'b' })
    expect(added[0].sweep).toBe(true)
  })

  it('returns exactly the appended rows, in order', () => {
    const c = createCollection('t')
    addRow(c)
    const added = addSweepRows(c, 'col', [10, 20])
    expect(c.rows.slice(-2)).toEqual(added)
  })
})

describe('keepRow', () => {
  it('promotes the row values onto row 0 and removes all sweep rows including the kept one', () => {
    const c = createCollection('t')
    addColumn(c, 'intensity', 'number')
    const base = addRow(c)
    setCell(c, base.id, 'intensity', 5)
    const swept = addSweepRows(c, 'intensity', [1, 2, 3])
    const keepId = swept[1].id // intensity: 2

    keepRow(c, keepId)

    expect(c.rows).toHaveLength(1)
    expect(c.rows[0].values.intensity).toBe(2)
    expect(c.rows[0].sweep).toBeFalsy()
    expect(c.rows.some(r => r.sweep)).toBe(false)
  })

  it('creates row 0 via addRow when the collection is empty', () => {
    const c = createCollection('t')
    // No rows exist yet, but call keepRow with a fabricated id — since there are no
    // rows, the target row lookup fails and values stay {}; row 0 is still created.
    keepRow(c, 'nonexistent')
    expect(c.rows).toHaveLength(1)
    expect(c.rows[0].sweep).toBeFalsy()
  })

  it('keepRow on a non-sweep row still copies its values to row 0 and clears sweep rows', () => {
    const c = createCollection('t')
    addColumn(c, 'label', 'text')
    const base = addRow(c)
    setCell(c, base.id, 'label', 'base-row')
    const swept = addSweepRows(c, 'label', ['sweep-1', 'sweep-2'])
    expect(c.rows).toHaveLength(3)

    keepRow(c, base.id)

    expect(c.rows).toHaveLength(1)
    expect(c.rows[0].values.label).toBe('base-row')
    expect(c.rows[0].sweep).toBeFalsy()
    expect(swept.every(r => !c.rows.includes(r))).toBe(true)
  })

  it('clamps the preview row after removing sweep rows', () => {
    const c = createCollection('t')
    addColumn(c, 'n', 'number')
    const base = addRow(c)
    setCell(c, base.id, 'n', 1)
    const swept = addSweepRows(c, 'n', [2, 3])
    c.previewRow = 2 // pointing at a sweep row

    keepRow(c, swept[0].id)

    expect(c.previewRow).toBe(0)
  })
})
