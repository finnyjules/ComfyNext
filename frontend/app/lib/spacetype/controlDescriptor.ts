import type { ControlSpec, Params, ParamValue } from '~/lib/spacetype/effect'

/** A control normalized for the AI copilot. `path` equals the control key for
 *  Type/Texture (flat). A future Shader adapter will emit dotted paths here. */
export interface DescribedControl {
  path: string
  label: string
  kind: 'slider' | 'select' | 'color' | 'font'
  min?: number
  max?: number
  step?: number
  options?: string[]
  hint?: string
  current: ParamValue
}

const AI_EDITABLE_KINDS = new Set(['slider', 'select', 'color', 'font'])

function isEditable(c: ControlSpec): boolean {
  if (typeof c.aiEditable === 'boolean') return c.aiEditable
  return AI_EDITABLE_KINDS.has(c.kind)
}

/** Build the normalized, AI-editable-only descriptor for the active effect. */
export function describeControls(controls: ControlSpec[], params: Params): DescribedControl[] {
  const out: DescribedControl[] = []
  for (const c of controls) {
    if (!isEditable(c)) continue
    const current = params[c.key] ?? c.default
    const d: DescribedControl = { path: c.key, label: c.label, kind: c.kind as DescribedControl['kind'], current }
    if (c.hint) d.hint = c.hint
    if (c.kind === 'slider') { d.min = c.min; d.max = c.max; d.step = c.step }
    if (c.kind === 'select') d.options = c.options
    out.push(d)
  }
  return out
}

const HEX6 = /^#[0-9a-fA-F]{6}$/

/** Validate/clamp a raw patch against the descriptor. Unknown keys, out-of-enum
 *  selects, and malformed colors are dropped; sliders are coerced, clamped to
 *  [min,max] and snapped to step. The result is safe to apply to params. */
export function validatePatch(
  patch: Record<string, ParamValue>,
  described: DescribedControl[],
): Record<string, ParamValue> {
  const byPath = new Map(described.map(d => [d.path, d]))
  const out: Record<string, ParamValue> = {}
  for (const [key, raw] of Object.entries(patch ?? {})) {
    const d = byPath.get(key)
    if (!d) continue
    if (d.kind === 'slider') {
      const n = Number(raw)
      if (!Number.isFinite(n)) continue
      const snapped = Math.round((n - d.min!) / d.step!) * d.step! + d.min!
      const clamped = Math.min(d.max!, Math.max(d.min!, snapped))
      out[key] = Number(clamped.toFixed(6))
    }
    else if (d.kind === 'select') {
      if (typeof raw === 'string' && d.options!.includes(raw)) out[key] = raw
    }
    else if (d.kind === 'color') {
      if (typeof raw === 'string' && HEX6.test(raw)) out[key] = raw
    }
    else if (d.kind === 'font') {
      if (typeof raw === 'string' && raw.trim()) out[key] = raw
    }
  }
  return out
}
