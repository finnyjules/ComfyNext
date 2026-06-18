/**
 * Pure layout helpers for the Elastic effect. No Three.js — unit-tested in node.
 * The effect's buildScene consumes these to position one plane per text line.
 */

/**
 * Y center of each line, ordered top→bottom, centered on the origin.
 * lineHeight = per-line world height; leading = extra gap added between lines.
 */
export function stackPositions(count: number, lineHeight: number, leading: number): number[] {
  const step = lineHeight + leading
  const total = step * count
  const top = total / 2 - step / 2
  const out: number[] = []
  for (let i = 0; i < count; i++) out.push(top - i * step)
  return out
}

/** Per-line horizontal offset for the stagger control, centered so the stack stays balanced. */
export function lineStaggerOffsets(count: number, stagger: number): number[] {
  if (stagger === 0) return Array(count).fill(0)
  const mid = (count - 1) / 2
  const out: number[] = []
  for (let i = 0; i < count; i++) out.push((i - mid) * stagger)
  return out
}
