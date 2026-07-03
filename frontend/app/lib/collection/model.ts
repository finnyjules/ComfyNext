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
