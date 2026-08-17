export type TornEdgeStyle = 'ripped' | 'deckle' | 'shredded'

export const TORN_EDGE_STYLES: readonly TornEdgeStyle[] = ['ripped', 'deckle', 'shredded']

export interface TornEdgeSpec {
  style: TornEdgeStyle
  amount: number        // tear depth into the element (px)
  roughness: number     // fray/meander detail, 0..1
  grain: number         // grain dissolve band width (px, 0 = crisp)
  grainTexture: number  // paper-fibre texture strength on the lip, 0..1
  lipWidth: number      // average white-lip band width (px, 0 = no lip)
  lipVariation: number  // how much the lip width varies along the edge, 0..1
  lipColor: string      // hex, warm paper-white default
  seed: number          // deterministic — same seed = same tear
}

export const DEFAULT_TORN_EDGE: TornEdgeSpec = {
  style: 'shredded',
  amount: 37,
  roughness: 0.18,
  grain: 7,
  grainTexture: 0.6,
  lipWidth: 10,
  lipVariation: 0.73,
  lipColor: '#fbf6ee',
  seed: 12,
}

/** Bounds each numeric field is clamped to. */
const CLAMP: Record<string, [number, number]> = {
  amount: [0, 200], roughness: [0, 1], grain: [0, 60], grainTexture: [0, 1],
  lipWidth: [0, 80], lipVariation: [0, 1], seed: [0, 1e9],
}

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/** Active when it would visibly change the edge (some tear, grain, or lip). */
export function tornEdgeActive(t: TornEdgeSpec | undefined | null): t is TornEdgeSpec {
  return !!t && (t.amount > 0 || t.grain > 0 || t.lipWidth > 0)
}

const num = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback
}

/** Merge a partial/raw patch over `cur` (or DEFAULT), clamping every field. */
export function sanitizeTornEdge(raw: unknown, cur?: TornEdgeSpec): TornEdgeSpec {
  const base = cur ? { ...cur } : { ...DEFAULT_TORN_EDGE }
  const r = (raw ?? {}) as Record<string, unknown>
  const style = TORN_EDGE_STYLES.includes(r.style as TornEdgeStyle) ? (r.style as TornEdgeStyle) : base.style
  const color = typeof r.lipColor === 'string' && HEX.test(r.lipColor) ? r.lipColor : base.lipColor
  return {
    style,
    amount: num(r.amount, ...CLAMP.amount!, base.amount),
    roughness: num(r.roughness, ...CLAMP.roughness!, base.roughness),
    grain: num(r.grain, ...CLAMP.grain!, base.grain),
    grainTexture: num(r.grainTexture, ...CLAMP.grainTexture!, base.grainTexture),
    lipWidth: num(r.lipWidth, ...CLAMP.lipWidth!, base.lipWidth),
    lipVariation: num(r.lipVariation, ...CLAMP.lipVariation!, base.lipVariation),
    lipColor: color,
    seed: num(r.seed, ...CLAMP.seed!, base.seed),
  }
}
