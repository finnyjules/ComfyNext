import type { CollectionData, VariableType } from './types'
import { addColumn, addRow, clampPreviewRow, setCell } from './model'

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i
const IMG_RE = /(\.(png|jpe?g|webp|gif|svg)(\?|#|$))|(^\/view\?)/i
const NUM_RE = /^-?\d+(\.\d+)?$/

export function inferType(values: string[]): VariableType {
  const vs = values.map(v => v.trim()).filter(Boolean)
  if (!vs.length) return 'text'
  if (vs.every(v => HEX_RE.test(v))) return 'color'
  if (vs.every(v => NUM_RE.test(v))) return 'number'
  if (vs.every(v => IMG_RE.test(v) || (/^https?:\/\//i.test(v) && IMG_RE.test(v)))) return 'image'
  return 'text'
}

/** Parse CSV/TSV text into rows of cells. Tabs win when the first line has any. */
export function parseDelimited(text: string): string[][] {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'))
  const delim = firstLine.includes('\t') ? '\t' : ','
  const rows: string[][] = []
  let cell = '', row: string[] = [], inQuotes = false
  const src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++ } else inQuotes = false
      } else cell += ch
    } else if (ch === '"' && cell === '') {
      inQuotes = true
    } else if (ch === delim) {
      row.push(cell); cell = ''
    } else if (ch === '\n') {
      row.push(cell); cell = ''
      if (row.some(c => c.trim() !== '')) rows.push(row)
      row = []
    } else cell += ch
  }
  row.push(cell)
  if (row.some(c => c.trim() !== '')) rows.push(row)
  return rows
}

/** Replace the collection's columns+rows from pasted tabular text (first row = headers). */
export function importTable(c: CollectionData, text: string): void {
  const grid = parseDelimited(text)
  if (grid.length < 1) return
  const headers = grid[0]
  const body = grid.slice(1)
  c.columns = []
  c.rows = []
  const cols = headers.map((h, i) => {
    const values = body.map(r => String(r[i] ?? ''))
    return addColumn(c, h || `Column ${i + 1}`, inferType(values))
  })
  for (const src of body) {
    const row = addRow(c)
    cols.forEach((col, i) => {
      const raw = String(src[i] ?? '').trim()
      if (!raw) return
      setCell(c, row.id, col.key, col.type === 'number' && NUM_RE.test(raw) ? Number(raw) : raw)
    })
  }
  clampPreviewRow(c)
}
