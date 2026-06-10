// Pure port-type compatibility helpers, shared by the canvas's connection
// logic (VueNodeCanvas.vue) and the port-intent popover (lib/portIntent.ts).
// No Vue/Nuxt imports — unit-testable.
//
// ComfyUI link-type rules implemented here:
//   • '*' (wildcard) matches anything.
//   • Comma-separated union types — e.g. the Timeline's clip inputs declare
//     "IMAGE,VIDEO" — are compatible when the two unions intersect.
//   • Everything else is exact string equality.
//
// These rules matter most for AUTO-PICKED ports (proximity snap, drop-on-node,
// wire splicing, port-intent wiring): picking by index 0 instead of by type is
// what wired a Timeline's IMAGE `frames` output into SaveVideo's VIDEO input.

/** Split a ComfyUI type string into its union members ("IMAGE,VIDEO" → 2). */
export function typeUnion(t: string | undefined | null): string[] {
  return String(t ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Can an output of type `a` legally connect to an input of type `b`? */
export function typesCompatible(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === '*' || b === '*') return true
  const ua = typeUnion(a)
  const ub = typeUnion(b)
  if (ua.includes('*') || ub.includes('*')) return true
  return ua.some((t) => ub.includes(t))
}

interface PortLike {
  type?: string
}

/**
 * Index of the port best matching `wantType`: exact type-string match first,
 * then any compatible (union / wildcard) port. -1 when nothing matches —
 * callers must treat that as "do not wire", never fall back to index 0.
 *
 * `isFree` (optional) marks ports that have no existing connection; free
 * ports are preferred within each tier (exact-free → compatible-free →
 * exact → compatible) so auto-wiring lands on an open slot — e.g. the
 * Timeline's grow-on-connect clip inputs — before stealing an occupied one.
 */
export function findCompatiblePortIndex(
  ports: PortLike[] | undefined | null,
  wantType: string,
  isFree?: (index: number) => boolean,
): number {
  if (!ports?.length || !wantType) return -1
  const exact = (p: PortLike) => String(p?.type ?? '') === wantType
  const compat = (p: PortLike) => typesCompatible(String(p?.type ?? ''), wantType)
  const passes: ((p: PortLike, i: number) => boolean)[] = isFree
    ? [
        (p, i) => exact(p) && isFree(i),
        (p, i) => compat(p) && isFree(i),
        (p) => exact(p),
        (p) => compat(p),
      ]
    : [(p) => exact(p), (p) => compat(p)]
  for (const pass of passes) {
    const idx = ports.findIndex((p, i) => pass(p, i))
    if (idx >= 0) return idx
  }
  return -1
}

/**
 * Best (output, input) port pair between a source node's outputs and a
 * candidate node's inputs — exact type matches win over union/wildcard ones.
 * Returns null when no pair connects. Used when a node dropped on a wire
 * can't be spliced inline but can still tap a DIFFERENT output of the same
 * source (SaveVideo dropped on a Timeline `frames` wire hooks to `video`).
 */
export function bestPortPair(
  outputs: PortLike[] | undefined | null,
  inputs: PortLike[] | undefined | null,
  isInputFree?: (index: number) => boolean,
): { outputIndex: number; inputIndex: number } | null {
  if (!outputs?.length || !inputs?.length) return null
  for (const exactOnly of [true, false]) {
    for (let o = 0; o < outputs.length; o++) {
      const ot = String(outputs[o]?.type ?? '')
      if (!ot) continue
      const idx = findCompatiblePortIndex(inputs, ot, isInputFree)
      if (idx < 0) continue
      if (exactOnly && String(inputs[idx]?.type ?? '') !== ot) continue
      return { outputIndex: o, inputIndex: idx }
    }
  }
  return null
}
