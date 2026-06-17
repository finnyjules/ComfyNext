import type { EffectDef } from './types'

export function parseParams(json: string): Record<string, number> {
  try {
    const v = JSON.parse(json)
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}

/** Defaults merged with overrides; clamped; unknown keys dropped. Mirrors Python resolve_params. */
export function resolveUniforms(eff: EffectDef, overrides: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const p of eff.params) {
    const raw = overrides[p.uniform]
    if (p.type === 'enum') {
      const values = (p.options ?? []).map(o => o.value)
      out[p.uniform] = typeof raw === 'number' && values.includes(raw) ? raw : p.default
    } else {
      const v = typeof raw === 'number' && Number.isFinite(raw) ? raw : p.default
      out[p.uniform] = Math.min(Math.max(v, p.min ?? -Infinity), p.max ?? Infinity)
    }
  }
  return out
}

/** Store only non-default values in the widget so workflows stay tidy. */
export function serializeParams(eff: EffectDef, uniforms: Record<string, number>): string {
  const out: Record<string, number> = {}
  for (const p of eff.params) {
    const v = uniforms[p.uniform]
    if (typeof v === 'number' && v !== p.default) out[p.uniform] = v
  }
  return JSON.stringify(out)
}
