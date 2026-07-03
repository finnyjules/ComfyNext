import type { CollectionData, VarBindings } from './types'
import { HEX_RE } from './types'

export function resolveBindings(
  c: CollectionData,
  bindings: VarBindings,
  rowIndex: number,
): { values: Record<string, string | number>; missing: string[] } {
  const values: Record<string, string | number> = {}
  const missing: string[] = []
  const row = c.rows[rowIndex]
  for (const [path, b] of Object.entries(bindings || {})) {
    if (!b || b.collectionId !== c.id) continue
    const col = c.columns.find(x => x.key === b.columnKey)
    const cell = col && row ? row.values[col.key] : undefined
    if (cell !== undefined && String(cell).trim() !== '') {
      values[path] = cell
    } else if (b.lastLiteral !== undefined) {
      values[path] = b.lastLiteral
      missing.push(path)
    } else {
      missing.push(path)
    }
  }
  return { values, missing }
}

export function splitRenderOverrides(
  values: Record<string, string | number>,
): { props: Record<string, string>; brand: Record<string, string> } {
  const props: Record<string, string> = {}
  const brand: Record<string, string> = {}
  for (const [path, v] of Object.entries(values)) {
    if (path.startsWith('props.')) props[path.slice(6)] = String(v)
    else if (path.startsWith('brand.')) brand[path.slice(6)] = String(v)
  }
  return { props, brand }
}

export function validateRun(
  c: CollectionData,
  bindings: VarBindings,
): { rowIndex: number; path: string; message: string }[] {
  const issues: { rowIndex: number; path: string; message: string }[] = []
  for (const [path, b] of Object.entries(bindings || {})) {
    if (!b || b.collectionId !== c.id) continue
    const col = c.columns.find(x => x.key === b.columnKey)
    if (!col || col.type !== 'color') continue
    c.rows.forEach((row, rowIndex) => {
      const v = row.values[col.key]
      if (v !== undefined && String(v).trim() !== '' && !HEX_RE.test(String(v))) {
        issues.push({ rowIndex, path, message: `"${v}" isn't a hex color` })
      }
    })
  }
  return issues
}
