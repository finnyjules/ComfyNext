/**
 * Pen tool — draft a bezier path by clicking anchors (click = corner, drag =
 * smooth point with mirrored handles), then bake it into a PathLayer via the
 * shared coordinate contract in useCompositorLayers.
 *
 * Draft anchors are kept in NORMALIZED artboard coords (0..1 of width/height) so
 * the live overlay can render without knowing pixel size; finish() converts to
 * the PathLayer local frame (1 unit = width, centered on the path's centroid),
 * which is the only place the artboard aspect (H/W) is needed.
 */
import { createPathLayer, type PathLayer, type Paint } from '~/composables/useCompositorLayers'

export interface PenAnchor {
  x: number; y: number                 // normalized artboard coords
  hIn?: { x: number; y: number }       // normalized; absolute (not relative)
  hOut?: { x: number; y: number }
}

export interface PenStyle { fill: Paint; stroke: string; strokeWidth: number }

/** Build an SVG `d` from anchors in an arbitrary coord space (used for both the
 *  normalized live preview and the final local-frame path). */
function anchorsToD(
  pts: { x: number; y: number; hIn?: { x: number; y: number }; hOut?: { x: number; y: number } }[],
  closed: boolean,
): string {
  if (!pts.length) return ''
  const n = (v: number) => +v.toFixed(4)
  let d = `M ${n(pts[0].x)} ${n(pts[0].y)}`
  const seg = (a: typeof pts[0], b: typeof pts[0]) => {
    const c1 = a.hOut, c2 = b.hIn
    if (c1 || c2) {
      const p1 = c1 ?? a, p2 = c2 ?? b
      d += ` C ${n(p1.x)} ${n(p1.y)} ${n(p2.x)} ${n(p2.y)} ${n(b.x)} ${n(b.y)}`
    } else {
      d += ` L ${n(b.x)} ${n(b.y)}`
    }
  }
  for (let i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i])
  if (closed && pts.length > 1) { seg(pts[pts.length - 1], pts[0]); d += ' Z' }
  return d
}

/**
 * Convert finished anchors → a PathLayer. `dims` is the artboard logical size;
 * only its aspect (h/w) matters. Returns null if fewer than 2 anchors.
 */
export function buildPathLayerFromAnchors(
  anchors: PenAnchor[],
  closed: boolean,
  dims: { w: number; h: number },
  style: PenStyle,
): PathLayer | null {
  if (anchors.length < 2) return null
  const ar = dims.h / dims.w // vertical scale: normalized-Y → width-fraction

  // Map normalized → width-fraction (x stays, y *= h/w), collect extents over
  // anchors AND handles so the bbox encloses the curve's control hull.
  const toWF = (p: { x: number; y: number }) => ({ x: p.x, y: p.y * ar })
  const all: { x: number; y: number }[] = []
  for (const a of anchors) {
    all.push(toWF(a))
    if (a.hIn) all.push(toWF(a.hIn))
    if (a.hOut) all.push(toWF(a.hOut))
  }
  const xs = all.map(p => p.x), ys = all.map(p => p.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2

  const center = (p: { x: number; y: number }) => ({ x: p.x - cx, y: p.y - cy })
  const local = anchors.map(a => ({
    ...center(toWF(a)),
    hIn: a.hIn ? center(toWF(a.hIn)) : undefined,
    hOut: a.hOut ? center(toWF(a.hOut)) : undefined,
  }))

  const d = anchorsToD(local, closed)
  // The centroid in width-fraction units maps back to normalized artboard:
  // layer.x = cx (fraction of width), layer.y = cy / ar (fraction of height).
  return createPathLayer({
    d, scale: 1,
    bbox: { w: Math.max(maxX - minX, 0.001), h: Math.max(maxY - minY, 0.001) },
    x: cx, y: cy / ar,
    fill: style.fill, stroke: style.stroke, strokeWidth: style.strokeWidth,
  })
}

export function useVectorPen() {
  const active = ref(false)
  const anchors = ref<PenAnchor[]>([])
  const draftClosed = ref(false)
  const cursor = ref<{ x: number; y: number } | null>(null) // live pointer (normalized)
  const dragging = ref(false)
  const CLOSE_DIST = 0.02 // normalized distance to snap-close onto first anchor

  function reset() { anchors.value = []; draftClosed.value = false; cursor.value = null; dragging.value = false }
  function setActive(v: boolean) { active.value = v; if (!v) reset() }

  function nearFirst(x: number, y: number): boolean {
    const a = anchors.value[0]; if (!a) return false
    return Math.hypot(x - a.x, y - a.y) <= CLOSE_DIST
  }

  // Begin an anchor at (nx, ny). Returns 'closed' if this click closed the path.
  function down(nx: number, ny: number): 'added' | 'closed' {
    if (anchors.value.length >= 2 && nearFirst(nx, ny)) { draftClosed.value = true; return 'closed' }
    anchors.value = [...anchors.value, { x: nx, y: ny }]
    dragging.value = true
    return 'added'
  }
  // Drag sets the last anchor's out-handle (and mirrored in-handle → smooth).
  function move(nx: number, ny: number) {
    cursor.value = { x: nx, y: ny }
    if (!dragging.value) return
    const i = anchors.value.length - 1; if (i < 0) return
    const a = anchors.value[i]
    const hOut = { x: nx, y: ny }
    const hIn = { x: 2 * a.x - nx, y: 2 * a.y - ny }
    anchors.value = anchors.value.map((p, k) => (k === i ? { ...p, hOut, hIn } : p))
  }
  function up() { dragging.value = false }

  /** Preview `d` in a 0..100 viewBox (normalized*100) for an overlay <svg>. */
  const previewD = computed(() => {
    const pts = anchors.value.map(a => ({
      x: a.x * 100, y: a.y * 100,
      hIn: a.hIn ? { x: a.hIn.x * 100, y: a.hIn.y * 100 } : undefined,
      hOut: a.hOut ? { x: a.hOut.x * 100, y: a.hOut.y * 100 } : undefined,
    }))
    // include the live segment to the cursor while drafting (open end)
    if (cursor.value && !dragging.value && pts.length) {
      pts.push({ x: cursor.value.x * 100, y: cursor.value.y * 100, hIn: undefined, hOut: undefined })
    }
    return anchorsToD(pts, draftClosed.value)
  })

  return {
    active, anchors, draftClosed, cursor, dragging,
    setActive, reset, down, move, up, nearFirst, previewD,
  }
}
