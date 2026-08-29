export interface Vec2 { x: number; y: number }

export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y })
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k })
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x
export const len = (a: Vec2): number => Math.hypot(a.x, a.y)
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y)

// Signed perpendicular distance from p to the infinite line through a→b.
// Positive when p is to the left of a→b. Returns 0 for a degenerate line.
export function distPointToLine(p: Vec2, a: Vec2, b: Vec2): number {
  const d = sub(b, a)
  const L = len(d)
  if (L < 1e-12) return 0
  return cross(d, sub(p, a)) / L
}
