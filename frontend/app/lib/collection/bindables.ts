import type { CollectionColumn, VarBindings, VariableType } from './types'

export interface Bindable {
  path: string
  label: string
  type: VariableType
}

const BRAND_BINDABLES: Bindable[] = [
  { path: 'brand.primary', label: 'Brand primary', type: 'color' },
  { path: 'brand.secondary', label: 'Brand secondary', type: 'color' },
  { path: 'brand.accent', label: 'Brand accent', type: 'color' },
  { path: 'brand.accent2', label: 'Brand accent 2', type: 'color' },
  { path: 'brand.foreground', label: 'Brand foreground', type: 'color' },
  { path: 'brand.background', label: 'Brand background', type: 'color' },
  { path: 'brand.fontDisplay', label: 'Display font', type: 'font' },
  { path: 'brand.fontBody', label: 'Body font', type: 'font' },
  { path: 'brand.logo', label: 'Logo', type: 'image' },
]

const PROP_RE = /\{\{\s*props\.([a-z0-9_]+)\s*\}\}/gi

export function listSmartLayoutBindables(template: unknown): Bindable[] {
  const found = new Map<string, Bindable>()
  const json = (() => { try { return JSON.stringify(template ?? {}) } catch { return '' } })()
  let m: RegExpExecArray | null
  PROP_RE.lastIndex = 0
  while ((m = PROP_RE.exec(json))) {
    const name = m[1]!
    const type: VariableType = /^image_layer_/.test(name) ? 'image' : 'text'
    const path = `props.${name}`
    if (!found.has(path)) found.set(path, { path, label: name.replace(/_/g, ' '), type })
  }
  return [...found.values(), ...BRAND_BINDABLES]
}

export function readTemplateFromNode(
  node: { data?: { widgetDefs?: { name: string }[]; widgetsValues?: unknown[] } },
): unknown | null {
  const defs = node?.data?.widgetDefs ?? []
  const i = defs.findIndex(d => d?.name === 'layout')
  if (i < 0) return null
  const raw = String(node?.data?.widgetsValues?.[i] ?? '').trim()
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

export function typeCompatible(variable: VariableType, column: VariableType): boolean {
  switch (variable) {
    case 'text': return column === 'text' || column === 'number' || column === 'select'
    case 'color': return column === 'color'
    case 'image': return column === 'image' || column === 'text'
    case 'number': return column === 'number'
    case 'font': return column === 'font' || column === 'text'
    case 'select': return column === 'select' || column === 'text'
  }
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

export function autoAlign(
  bindables: Bindable[],
  columns: CollectionColumn[],
  collectionId: string,
): VarBindings {
  const out: VarBindings = {}
  for (const b of bindables) {
    const shortKey = b.path.split('.').pop()!
    const col = columns.find(c => c.key === shortKey && typeCompatible(b.type, c.type))
      ?? columns.find(c => norm(c.label) === norm(shortKey) && typeCompatible(b.type, c.type))
    if (col) out[b.path] = { collectionId, columnKey: col.key }
  }
  return out
}
