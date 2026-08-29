import type { SketchDoc } from './model'

// A fresh id not present on any entity or constraint in doc. Deterministic
// (scans the doc), no randomness — safe for the dependency-light tier.
export function freshId(doc: SketchDoc, prefix = 'e'): string {
  const has = (x: string) =>
    doc.entities.some(e => e.id === x) || doc.constraints.some(c => c.id === x)
  let n = doc.entities.length + doc.constraints.length + 1
  let id = `${prefix}${n}`
  while (has(id)) { n++; id = `${prefix}${n}` }
  return id
}
