import type { CollectionColumn, CollectionData, CollectionRow, VariableType } from './types'

let seq = 0
function uid(prefix: string): string {
  seq = (seq + 1) % 1_000_000
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}`
}

export function createCollection(name = 'Collection'): CollectionData {
  return { id: uid('col'), name, columns: [], rows: [], previewRow: 0 }
}

export function keyFromLabel(label: string, existing: string[]): string {
  let base = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!base) base = 'column'
  if (!existing.includes(base)) return base
  let n = 2
  while (existing.includes(`${base}_${n}`)) n++
  return `${base}_${n}`
}

export function addColumn(c: CollectionData, label: string, type: VariableType): CollectionColumn {
  const col: CollectionColumn = {
    key: keyFromLabel(label, c.columns.map(x => x.key)),
    label: label.trim() || 'Column',
    type,
  }
  c.columns.push(col)
  return col
}

export function removeColumn(c: CollectionData, key: string): void {
  c.columns = c.columns.filter(x => x.key !== key)
  for (const r of c.rows) delete r.values[key]
}

export function addRow(c: CollectionData): CollectionRow {
  const row: CollectionRow = { id: uid('row'), values: {} }
  c.rows.push(row)
  return row
}

export function removeRow(c: CollectionData, rowId: string): void {
  c.rows = c.rows.filter(r => r.id !== rowId)
}

export function setCell(c: CollectionData, rowId: string, key: string, value: string | number): void {
  const row = c.rows.find(r => r.id === rowId)
  if (row) row.values[key] = value
}

export function clampPreviewRow(c: CollectionData): void {
  c.previewRow = Math.min(Math.max(0, c.previewRow), Math.max(0, c.rows.length - 1))
}

export function rowLabel(c: CollectionData, index: number): string {
  const row = c.rows[index]
  if (row) {
    const textCol = c.columns.find(col => col.type === 'text')
    const v = textCol ? row.values[textCol.key] : undefined
    if (v !== undefined && String(v).trim()) return String(v)
  }
  return `Row ${index + 1}`
}

/** Appends one new row per value: each copies the CURRENT preview row's values
 * (preview clamped first; {} if the collection has no rows), overrides `columnKey`
 * with that value, and is flagged `sweep: true`. Returns the newly appended rows. */
export function addSweepRows(c: CollectionData, columnKey: string, values: (string | number)[]): CollectionRow[] {
  clampPreviewRow(c)
  const baseValues = c.rows[c.previewRow]?.values ?? {}
  const added: CollectionRow[] = []
  for (const v of values) {
    const row: CollectionRow = { id: uid('row'), sweep: true, values: { ...baseValues, [columnKey]: v } }
    c.rows.push(row)
    added.push(row)
  }
  return added
}

/** Promotes a sweep (or any) row's values onto row 0 — creating row 0 via addRow
 * if the collection is empty — then removes ALL `sweep: true` rows (including the
 * kept row itself, since it was one), and clamps the preview row into range. */
export function keepRow(c: CollectionData, rowId: string): void {
  const source = c.rows.find(r => r.id === rowId)
  const values = source ? { ...source.values } : {}
  let row0 = c.rows[0]
  if (!row0) row0 = addRow(c)
  row0.values = values
  delete row0.sweep
  c.rows = c.rows.filter(r => r === row0 || !r.sweep)
  clampPreviewRow(c)
}
