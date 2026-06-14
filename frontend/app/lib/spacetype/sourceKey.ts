import type { Params } from './effect'

export interface SourceKeyInput {
  effectId: string
  params: Params
  fps: number
  loopDuration: number
  W: number
  H: number
}

/** Sort object keys so serialization is order-independent. */
function stable(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(o).sort()) out[k] = stable(o[k])
    return out
  }
  return value
}

/** FNV-1a over a stable serialization — mirrors lib/engine/motionClipBake's key. */
export function spaceTypeSourceKey(input: SourceKeyInput): string {
  const s = JSON.stringify(stable(input))
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}
