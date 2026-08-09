import { stripAlpha } from '~/lib/color/convert'

export type SpinePreset = 'custom' | 'helix' | 'wave' | 'arch' | 's-curve' | 'loop'

export interface LoftStop {
  id: string
  x: number; y: number; z: number
  width: number; height: number
  roll: number
  color: string
  ta?: number
  hlf?: number
  hlb?: number
  manual?: boolean
}

let _idSeq = 0
// No Date.now()/Math.random() (banned in some contexts and non-deterministic for tests): a
// monotonic counter is enough for local uniqueness within one editing session.
function newId(): string { _idSeq += 1; return `s${_idSeq.toString(36)}` }

function num(v: unknown, fallback: number): number {
  const n = Number(v); return Number.isFinite(n) ? n : fallback
}
function clamp(n: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, n)) }
function hex6(v: unknown): string {
  const s = typeof v === 'string' ? stripAlpha(v) : '#ffffff'
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : '#ffffff'
}

function sanitizeStop(raw: any): LoftStop {
  return {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : newId(),
    x: clamp(num(raw?.x, 0.5), 0, 1),
    y: clamp(num(raw?.y, 0.5), 0, 1),
    z: clamp(num(raw?.z, 0), -1, 1),
    width: clamp(num(raw?.width, 1), 0.01, 8),
    height: clamp(num(raw?.height, 1), 0.01, 8),
    roll: num(raw?.roll, 0),
    color: hex6(raw?.color),
    ...(raw?.ta !== undefined ? { ta: num(raw.ta, 0) } : {}),
    ...(raw?.hlf !== undefined ? { hlf: num(raw.hlf, 0) } : {}),
    ...(raw?.hlb !== undefined ? { hlb: num(raw.hlb, 0) } : {}),
    ...(raw?.manual ? { manual: true } : {}),
  }
}

export function serializeStops(stops: LoftStop[]): string { return JSON.stringify(stops) }

export function parseStops(json: unknown): LoftStop[] {
  let arr: any
  try { arr = typeof json === 'string' ? JSON.parse(json) : json } catch { return DEFAULT_STOPS.map(s => ({ ...s })) }
  if (!Array.isArray(arr) || arr.length === 0) return DEFAULT_STOPS.map(s => ({ ...s }))

  // Sanitize stops and enforce unique ids
  const seenIds = new Set<string>()
  return arr.map(raw => {
    const stop = sanitizeStop(raw)
    if (seenIds.has(stop.id)) {
      stop.id = newId()
    }
    seenIds.add(stop.id)
    return stop
  })
}

const RAINBOW = ['#3b5bff', '#ff2ea6', '#ff5a1f', '#ffd23f', '#2ec7a0', '#8a5bff']

export function presetStops(preset: SpinePreset): LoftStop[] {
  const N = 6
  const at = (i: number) => i / (N - 1)
  const mk = (i: number, x: number, y: number, z: number, roll = 0): LoftStop => ({
    id: newId(), x, y, z, width: 1, height: 1, roll,
    color: RAINBOW[i % RAINBOW.length]!,
  })
  const stops: LoftStop[] = []
  for (let i = 0; i < N; i++) {
    const t = at(i)
    switch (preset) {
      case 'helix':   stops.push(mk(i, 0.5 + 0.32 * Math.cos(t * Math.PI * 3), 0.15 + 0.7 * t, Math.sin(t * Math.PI * 3), t * 360)); break
      case 'wave':    stops.push(mk(i, 0.1 + 0.8 * t, 0.5 + 0.28 * Math.sin(t * Math.PI * 2), 0)); break
      case 'arch':    stops.push(mk(i, 0.1 + 0.8 * t, 0.8 - 0.6 * Math.sin(t * Math.PI), 0)); break
      case 's-curve': stops.push(mk(i, 0.5 + 0.35 * Math.sin(t * Math.PI * 2), 0.1 + 0.8 * t, 0)); break
      case 'loop':    stops.push(mk(i, 0.5 + 0.32 * Math.cos(t * Math.PI * 2), 0.5 + 0.32 * Math.sin(t * Math.PI * 2), 0.2 * Math.sin(t * Math.PI * 2))); break
      case 'custom':  stops.push(mk(i, 0.2 + 0.6 * t, 0.5, 0)); break
    }
  }
  return stops
}

export function applyToAllStops<K extends keyof LoftStop>(stops: LoftStop[], key: K, value: LoftStop[K]): LoftStop[] {
  return stops.map(s => ({ ...s, [key]: value }))
}

/** Derive smooth bezier tangents (angle + handle lengths, in x/y editor space) for every
 *  non-manual stop from its neighbours — a Catmull-Rom-equivalent auto-smooth. Manual stops keep
 *  their handles. Returns a new array. */
export function autoSmoothStops(stops: LoftStop[]): LoftStop[] {
  const n = stops.length
  return stops.map((s, i) => {
    if (s.manual) return { ...s }
    const prev = stops[(i - 1 + n) % n]!, next = stops[(i + 1) % n]!
    const p = i === 0 ? s : prev, q = i === n - 1 ? s : next
    const dx = q.x - p.x, dy = q.y - p.y
    const ta = Math.atan2(dy, dx)
    const dPrev = Math.hypot(s.x - prev.x, s.y - prev.y)
    const dNext = Math.hypot(next.x - s.x, next.y - s.y)
    const hlf = (i === n - 1 ? dPrev : dNext) / 3
    const hlb = (i === 0 ? dNext : dPrev) / 3
    return { ...s, ta, hlf, hlb }
  })
}

export const DEFAULT_STOPS: LoftStop[] = presetStops('helix')
export const DEFAULT_STOPS_JSON: string = serializeStops(DEFAULT_STOPS)
