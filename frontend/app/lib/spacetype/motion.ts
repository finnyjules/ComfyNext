/**
 * Scene-sequenced motion timing for Type Studio effects — the precise model first built for the
 * Corner Pin effect: cycle S "scenes" (poses) over the loop, each scene-beat split into a HOLD
 * (dwell on the scene) then an eased TRANSITION to the next. The studio loop length sets absolute
 * speed; hold/transition are relative weights; a cubic-bézier curve shapes every transition.
 *
 * Pure + framework-free so it can be unit-tested and shared across effects. (Corner Pin still has
 * its own local copies; it can adopt this module later.)
 */

/** Deterministic [-1,1] hash for auto-generating per-scene pose variation (varies with seed/scene). */
export function hash11(x: number): number {
  const s = Math.sin(x * 127.1 + 311.7) * 43758.5453
  return 2 * (s - Math.floor(s)) - 1
}

/** Evaluate a cubic-bézier easing y for time x∈[0,1]. P0=(0,0), P3=(1,1); cps = [x1,y1,x2,y2].
 *  Solves bx(t)=x for t (Newton + bisection fallback), returns by(t). Matches CSS cubic-bezier. */
export function bezierEase(x: number, cps: [number, number, number, number]): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const [x1, y1, x2, y2] = cps
  const bx = (t: number) => { const u = 1 - t; return 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t }
  const by = (t: number) => { const u = 1 - t; return 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t }
  const dbx = (t: number) => { const u = 1 - t; return 3 * u * u * x1 + 6 * u * t * (x2 - x1) + 3 * t * t * (1 - x2) }
  let t = x
  for (let i = 0; i < 8; i++) {           // Newton
    const d = dbx(t)
    if (Math.abs(d) < 1e-6) break
    t -= (bx(t) - x) / d
    t = Math.max(0, Math.min(1, t))
  }
  if (Math.abs(bx(t) - x) > 1e-4) {       // bisection fallback
    let lo = 0, hi = 1
    for (let i = 0; i < 24; i++) { t = (lo + hi) / 2; (bx(t) < x ? (lo = t) : (hi = t)) }
  }
  return by(t)
}

/** Parse the curve param "[x1,y1,x2,y2]" → tuple (falls back to ease-in-out). */
export function parseEase(raw: unknown): [number, number, number, number] {
  try {
    const a = JSON.parse(String(raw))
    if (Array.isArray(a) && a.length === 4 && a.every(v => typeof v === 'number')) return a as [number, number, number, number]
  } catch { /* */ }
  return [0.42, 0, 0.58, 1]
}

/** Hold fraction of a scene-beat, from relative hold/transition weights. */
export function holdFraction(holdTime: number, transitionTime: number): number {
  const h = Math.max(0, holdTime)
  const tr = Math.max(0.01, transitionTime)
  return h / (h + tr)
}

export interface SceneBlend { cur: number; nxt: number; e: number }

/**
 * Where the loop sits in the scene sequence at normalized loop time t01. Static (or <2 scenes)
 * freezes on scene 0 (cur=nxt=0, e=0). Otherwise S equal beats span [0,1); each beat holds for
 * `holdFrac` then eases through the remainder. Returns the bracketing scene indices and the 0..1
 * blend `e` between them. Pure in t01.
 */
export function sceneBlend(
  t01: number,
  scenes: number,
  holdFrac: number,
  cps: [number, number, number, number],
  isStatic: boolean,
): SceneBlend {
  const S = Math.max(1, Math.round(scenes))
  if (isStatic || S < 2) return { cur: 0, nxt: 0, e: 0 }
  const x = (t01 - Math.floor(t01)) * S
  const cur = Math.floor(x) % S
  const nxt = (cur + 1) % S
  const u = x - Math.floor(x)                                  // 0..1 within this beat
  const e = u < holdFrac ? 0 : bezierEase((u - holdFrac) / (1 - holdFrac), cps)
  return { cur, nxt, e }
}
