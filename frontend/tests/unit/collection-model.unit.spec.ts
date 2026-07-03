import { describe, it, expect } from 'vitest'
import {
  createCollection, keyFromLabel, addColumn, addRow, setCell,
  removeColumn, removeRow, clampPreviewRow, rowLabel,
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
