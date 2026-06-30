/**
 * Pure helpers for the localized anatomy-repair route. Kept free of any Nitro /
 * Replicate dependency so they unit-test directly.
 */
export type AnatomyKind = 'hand' | 'face' | 'limb'

const PROMPTS: Record<AnatomyKind, string> = {
  hand: 'a natural human hand, five fingers, anatomically correct, matching the image\'s existing style, skin tone and lighting',
  face: 'a clean, natural human face, correct eyes and features, matching the image\'s existing style and lighting',
  limb: 'a natural, anatomically-correct limb matching the image\'s existing style and lighting',
}

/** The canned in-region prompt for a given defect kind. Unknown → hand. */
export function repairPromptFor(kind: AnatomyKind): string {
  return PROMPTS[kind] ?? PROMPTS.hand
}

export interface RepairTarget {
  point?: { xPx: number; yPx: number }
  bbox?: [number, number, number, number]
  imageW?: number
  imageH?: number
}

/** Resolve a pixel click point from an explicit point, or from a normalized
 *  bbox centre scaled by the image dimensions. Null if neither is usable. */
export function pointFromTarget(t: RepairTarget): { xPx: number; yPx: number } | null {
  if (t.point && Number.isFinite(t.point.xPx) && Number.isFinite(t.point.yPx)) {
    return { xPx: Math.round(t.point.xPx), yPx: Math.round(t.point.yPx) }
  }
  if (t.bbox && Number.isFinite(t.imageW) && Number.isFinite(t.imageH)) {
    const [x, y, w, h] = t.bbox
    return {
      xPx: Math.round((x + w / 2) * (t.imageW as number)),
      yPx: Math.round((y + h / 2) * (t.imageH as number)),
    }
  }
  return null
}
