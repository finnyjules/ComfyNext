/**
 * Map our /api/inpaint/segment request body to SAM-2's point-prompt input.
 * Kept as a pure util (out of the route file) so it's unit-testable and so
 * swapping SAM models stays a one-spot change (see segment.post.ts NOTE).
 *
 * Two body shapes:
 *  - legacy v3 click-to-select: { xPx, yPx } → one foreground point
 *  - smart select scribble:     { points: [{x, y, label}] } — label 1 =
 *    foreground, 0 = background (subtract). Wins when non-empty.
 */
export interface SamRequestPoint { x: number; y: number; label: 0 | 1 }
export interface SamRequestBody {
  image?: string
  xPx?: number
  yPx?: number
  points?: SamRequestPoint[]
}

export function buildSamInput(body: SamRequestBody): Record<string, unknown> {
  const pts = (body.points?.length)
    ? body.points
    : [{ x: body.xPx ?? 0, y: body.yPx ?? 0, label: 1 as const }]
  return {
    image: body.image,
    point_coords: pts.map(p => [Math.round(p.x), Math.round(p.y)]),
    point_labels: pts.map(p => (p.label === 0 ? 0 : 1)),
  }
}
