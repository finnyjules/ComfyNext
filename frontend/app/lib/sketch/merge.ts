import type { SketchDoc, SketchEntity, SketchConstraint, ConstraintKind } from './model'

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0

const CONSTRAINT_KINDS: ConstraintKind[] = [
  'coincident', 'pointOnLine', 'pointOnCircle', 'tangentLineCircle', 'tangentCircleCircle',
  'concentric', 'horizontal', 'vertical', 'distance', 'radius',
]
const NEEDS_VALUE = new Set<ConstraintKind>(['distance', 'radius'])

function mergeEntity(raw: any): SketchEntity | null {
  if (!raw || !isStr(raw.id)) return null
  const base = { id: raw.id, ...(raw.construction ? { construction: true } : {}) }
  if (raw.kind === 'point') {
    if (!isNum(raw.x) || !isNum(raw.y)) return null
    return { ...base, kind: 'point', x: raw.x, y: raw.y, ...(raw.fixed ? { fixed: true } : {}) }
  }
  if (raw.kind === 'line') {
    if (!isStr(raw.p1) || !isStr(raw.p2)) return null
    return { ...base, kind: 'line', p1: raw.p1, p2: raw.p2 }
  }
  if (raw.kind === 'circle') {
    if (!isStr(raw.center) || !isNum(raw.r)) return null
    return { ...base, kind: 'circle', center: raw.center, r: Math.max(0, raw.r) }
  }
  return null
}

export function mergeSketchDoc(raw: unknown): SketchDoc {
  const doc: SketchDoc = { entities: [], constraints: [] }
  if (!raw || typeof raw !== 'object') return doc
  const r = raw as any

  const seen = new Set<string>()
  if (Array.isArray(r.entities)) {
    for (const e of r.entities) {
      const m = mergeEntity(e)
      if (m && !seen.has(m.id)) { seen.add(m.id); doc.entities.push(m) }
    }
  }

  const ids = new Set(doc.entities.map(e => e.id))
  const seenK = new Set<string>()
  if (Array.isArray(r.constraints)) {
    for (const c of r.constraints) {
      if (!c || !isStr(c.id) || seenK.has(c.id)) continue
      if (!CONSTRAINT_KINDS.includes(c.kind)) continue
      if (!Array.isArray(c.refs) || !c.refs.every((x: unknown) => isStr(x) && ids.has(x as string))) continue
      if (NEEDS_VALUE.has(c.kind) && !isNum(c.value)) continue
      seenK.add(c.id)
      doc.constraints.push({ id: c.id, kind: c.kind, refs: [...c.refs], ...(isNum(c.value) ? { value: c.value } : {}) } as SketchConstraint)
    }
  }
  return doc
}
