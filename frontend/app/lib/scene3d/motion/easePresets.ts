import type { EaseRef } from './types'

type Cps = [number, number, number, number]
function bez(cps: Cps): EaseRef { return { kind: 'bezier', cps } }

export const EASE_PRESETS: { key: string; label: string; ease: EaseRef; editable: boolean }[] = [
  { key: 'linear', label: 'Linear', ease: bez([0, 0, 1, 1]), editable: true },
  { key: 'ease', label: 'Ease', ease: bez([0.25, 0.1, 0.25, 1]), editable: true },
  { key: 'ease-out', label: 'Ease out', ease: bez([0, 0, 0.58, 1]), editable: true },
  { key: 'ease-in-out', label: 'Ease in-out', ease: bez([0.42, 0, 0.58, 1]), editable: true },
  { key: 'back', label: 'Back', ease: bez([0.34, 1.56, 0.64, 1]), editable: true },
  { key: 'bounce', label: 'Bounce', ease: { kind: 'named', name: 'bounce' }, editable: false },
  { key: 'spring', label: 'Spring', ease: { kind: 'named', name: 'spring' }, editable: false },
  { key: 'elastic', label: 'Elastic', ease: { kind: 'named', name: 'elastic' }, editable: false },
]

const EPS = 1e-4
export function presetKeyForEaseRef(ease: EaseRef): string {
  for (const p of EASE_PRESETS) {
    if (p.ease.kind !== ease.kind) continue
    if (ease.kind === 'named' && p.ease.kind === 'named' && ease.name === p.ease.name) return p.key
    if (ease.kind === 'bezier' && p.ease.kind === 'bezier') {
      const pBez = p.ease as { kind: 'bezier'; cps: Cps }
      if (ease.cps.every((v, i) => Math.abs(v - pBez.cps[i]!) < EPS)) return p.key
    }
  }
  return 'custom'
}

export function easeRefForPresetKey(key: string): EaseRef {
  const p = EASE_PRESETS.find(x => x.key === key)
  if (!p) throw new Error(`no ease preset '${key}'`)
  return p.ease.kind === 'bezier' ? bez([...p.ease.cps] as Cps) : { ...p.ease }
}

export function easeRefToCurveString(ease: EaseRef): string | null {
  return ease.kind === 'bezier' ? `[${ease.cps.join(',')}]` : null
}

export function curveStringToEaseRef(str: string): EaseRef {
  try {
    const a = JSON.parse(str)
    if (Array.isArray(a) && a.length === 4 && a.every((n: unknown) => typeof n === 'number')) {
      return bez([a[0]!, a[1]!, a[2]!, a[3]!])
    }
  } catch { /* fall through */ }
  return bez([0.42, 0, 0.58, 1])
}
