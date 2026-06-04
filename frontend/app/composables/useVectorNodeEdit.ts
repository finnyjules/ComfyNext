/**
 * Node-edit (direct selection) session for a single path layer: drag anchors and
 * their bezier handles live, add/delete anchors, then bake back to the layer.
 *
 * Segments are kept in NORMALIZED artboard coords (0..1) — the overlay renders
 * them and pointer math maps screen→normalized, so no per-layer transform is
 * needed mid-drag. The actual PathLayer is rebuilt (via paper.js) only on
 * pointer-up, so dragging stays synchronous and smooth.
 */
import { pathLayerToSegments, segmentsToPathLayer, type PathSegment } from '~/composables/useVectorSvg'
import type { PathLayer } from '~/composables/useCompositorLayers'

type Target =
  | { kind: 'anchor'; i: number }
  | { kind: 'handle'; i: number; which: 'in' | 'out' }
  | null

export function useVectorNodeEdit() {
  const active = ref(false)
  const layerId = ref<string | null>(null)
  const segments = ref<PathSegment[]>([])
  const closed = ref(false)
  const selected = ref<number | null>(null)   // selected anchor index
  const hot = ref<Target>(null)               // currently-dragged target
  let _base: PathLayer | null = null

  const HIT = 0.018 // normalized hit radius for anchors/handles

  async function enter(layer: PathLayer, dims: { w: number; h: number }) {
    const seg = await pathLayerToSegments(layer, dims)
    if (!seg.segments.length) return false
    _base = layer
    layerId.value = layer.id
    segments.value = seg.segments
    closed.value = seg.closed
    selected.value = null
    active.value = true
    return true
  }
  function reset() {
    active.value = false; layerId.value = null; segments.value = []
    closed.value = false; selected.value = null; hot.value = null; _base = null
  }

  function dist(a: { x: number; y: number }, x: number, y: number) { return Math.hypot(a.x - x, a.y - y) }

  /** Find the anchor/handle under (nx,ny). Handles take priority on the selected anchor. */
  function hitTest(nx: number, ny: number): Target {
    const segs = segments.value
    if (selected.value != null) {
      const s = segs[selected.value]
      if (s?.outH && dist(s.outH, nx, ny) <= HIT) return { kind: 'handle', i: selected.value, which: 'out' }
      if (s?.inH && dist(s.inH, nx, ny) <= HIT) return { kind: 'handle', i: selected.value, which: 'in' }
    }
    for (let i = 0; i < segs.length; i++) if (dist(segs[i].point, nx, ny) <= HIT) return { kind: 'anchor', i }
    return null
  }

  // Returns true if the pointer engaged an anchor/handle (caller should not pan).
  function down(nx: number, ny: number): boolean {
    const t = hitTest(nx, ny)
    if (!t) { selected.value = null; return false }
    if (t.kind === 'anchor') selected.value = t.i
    hot.value = t
    return true
  }
  function move(nx: number, ny: number) {
    const t = hot.value; if (!t) return
    const segs = segments.value.slice()
    const s = { ...segs[t.i] }
    if (t.kind === 'anchor') {
      const dx = nx - s.point.x, dy = ny - s.point.y
      s.point = { x: nx, y: ny }
      if (s.inH) s.inH = { x: s.inH.x + dx, y: s.inH.y + dy }   // handles follow the anchor
      if (s.outH) s.outH = { x: s.outH.x + dx, y: s.outH.y + dy }
    } else {
      const h = { x: nx, y: ny }
      if (t.which === 'out') {
        s.outH = h
        if (s.inH) s.inH = { x: 2 * s.point.x - nx, y: 2 * s.point.y - ny } // mirror → smooth
      } else {
        s.inH = h
        if (s.outH) s.outH = { x: 2 * s.point.x - nx, y: 2 * s.point.y - ny }
      }
    }
    segs[t.i] = s
    segments.value = segs
  }
  function up() { hot.value = null }

  /** Delete the selected anchor (keeps ≥2). */
  function deleteSelected() {
    if (selected.value == null || segments.value.length <= 2) return
    segments.value = segments.value.filter((_, i) => i !== selected.value)
    selected.value = null
  }

  /** Live overlay path in a 0..100 viewBox built straight from segments. */
  const previewD = computed(() => {
    const segs = segments.value
    if (segs.length < 2) return ''
    const n = (v: number) => +(v * 100).toFixed(3)
    let d = `M ${n(segs[0].point.x)} ${n(segs[0].point.y)}`
    const seg = (a: PathSegment, b: PathSegment) => {
      if (a.outH || b.inH) {
        const c1 = a.outH ?? a.point, c2 = b.inH ?? b.point
        d += ` C ${n(c1.x)} ${n(c1.y)} ${n(c2.x)} ${n(c2.y)} ${n(b.point.x)} ${n(b.point.y)}`
      } else d += ` L ${n(b.point.x)} ${n(b.point.y)}`
    }
    for (let i = 1; i < segs.length; i++) seg(segs[i - 1], segs[i])
    if (closed.value) { seg(segs[segs.length - 1], segs[0]); d += ' Z' }
    return d
  })

  /** Rebuild the edited PathLayer (null if nothing valid). */
  async function buildLayer(dims: { w: number; h: number }): Promise<PathLayer | null> {
    if (!_base) return null
    return segmentsToPathLayer({ segments: segments.value, closed: closed.value }, _base, dims)
  }

  return {
    active, layerId, segments, closed, selected, hot,
    enter, reset, down, move, up, hitTest, deleteSelected, previewD, buildLayer,
  }
}
