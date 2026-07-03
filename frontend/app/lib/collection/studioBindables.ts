import type { Bindable } from './bindables'
import type { VariableType } from './types'
import { HEX_RE } from './types'

export interface StudioControlDesc {
  key: string
  label: string
  kind: string
  min?: number
  max?: number
  step?: number
  options?: string[]
}

export function controlKindToVariableType(kind: string): VariableType | null {
  switch (kind) {
    case 'slider': return 'number'
    case 'color': return 'color'
    case 'select':
    case 'segmented': return 'select'
    case 'text':
    case 'textList': return 'text'
    case 'font': return 'font'
    default: return null
  }
}

export function studioBindableFor(control: StudioControlDesc): Bindable | null {
  const type = controlKindToVariableType(control.kind)
  if (!type) return null
  return { path: `params.${control.key}`, label: control.label, type }
}

export function listStudioBindables(controls: StudioControlDesc[]): Bindable[] {
  const out = new Map<string, Bindable>()
  for (const c of controls) {
    const b = studioBindableFor(c)
    if (b && !out.has(b.path)) out.set(b.path, b)
  }
  return [...out.values()]
}

export function clampForControl(control: StudioControlDesc, value: string | number): string | number {
  if (control.kind === 'slider') {
    const n = typeof value === 'number' ? value : Number(value)
    if (Number.isNaN(n)) return control.min ?? 0
    return Math.min(control.max ?? n, Math.max(control.min ?? n, n))
  }
  if (control.kind === 'select' || control.kind === 'segmented') {
    const opts = control.options ?? []
    return opts.includes(String(value)) ? String(value) : (opts[0] ?? '')
  }
  if (control.kind === 'color') {
    return HEX_RE.test(String(value)) ? String(value) : ''
  }
  return value
}
