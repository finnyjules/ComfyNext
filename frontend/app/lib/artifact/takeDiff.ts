/** Param diff between two takes — powers the Light Table's diff row. */
import type { Take } from '~/composables/useTakes'

const EXCLUDED = new Set(['draftRestore', 'nodeType'])

export function diffTakeParams(a: Take, b: Take): Array<{ key: string; a: any; b: any }> {
  const pa = a.params ?? {}
  const pb = b.params ?? {}
  const keys = [...new Set([...Object.keys(pa), ...Object.keys(pb)])].filter(k => !EXCLUDED.has(k))
  const rows: Array<{ key: string; a: any; b: any }> = []
  for (const key of keys) {
    if (JSON.stringify(pa[key]) !== JSON.stringify(pb[key])) rows.push({ key, a: pa[key], b: pb[key] })
  }
  return rows
}
