<!-- app/pages/dev/sketch-draw.vue -->
<script setup lang="ts">
// Dev harness — not linked in the app. Interactive constraint drawing surface.
definePageMeta({ layout: false })
import { ref, computed, onMounted, toRaw } from 'vue'
import type { SketchDoc, EntityId, ConstraintKind, SegmentSpec } from '~/lib/sketch/model'
import { addPoint, addLine, addCircle, addConstraint, deleteEntity, addPath, repeatEntities, mirrorEntities, pointClosure, addSmoothHandles, isPointReferenced } from '~/lib/sketch/edit'
import { snapPoint, inferCircleTangents } from '~/lib/sketch/infer'
import { solve, type DragTarget } from '~/lib/sketch/solve'
import { sketchPathData, entityPath } from '~/lib/sketch/sketchPath'
import { dist } from '~/lib/sketch/geom'
import { constraintMarks } from '~/lib/sketch/annotate'

type Tool = 'select' | 'point' | 'line' | 'circle' | 'path' | 'pen'

const doc = ref<SketchDoc>({ entities: [], constraints: [] })
const tool = ref<Tool>('select')
const status = ref('ready')
const ready = ref(false)

// world→screen: 34px/unit, origin lower-left of a 680x460 board
const S = 34, OX = 40, OY = 400
const sx = (x: number) => OX + x * S
const sy = (y: number) => OY - y * S
const wx = (px: number) => (px - OX) / S
const wy = (py: number) => (OY - py) / S

// in-progress multi-click draws
type Pending =
  | { kind: 'line'; p1: EntityId }
  | { kind: 'circle'; center: EntityId; cx: number; cy: number }
  | null
const pending = ref<Pending>(null)

const selection = ref<EntityId[]>([])
function pick(id: EntityId) {
  const i = selection.value.indexOf(id)
  if (i >= 0) selection.value.splice(i, 1)
  else selection.value.push(id)
}
function clearSel() { selection.value = [] }

function selKinds(): string[] {
  return selection.value.map(id => doc.value.entities.find(e => e.id === id)?.kind ?? '?')
}

// which verbs apply to the current selection (order = display order)
function availableConstraints(): { kind: ConstraintKind; label: string; value?: boolean }[] {
  const ids = selection.value
  const kinds = selKinds()
  const out: { kind: ConstraintKind; label: string; value?: boolean }[] = []
  const count = (k: string) => kinds.filter(x => x === k).length
  if (ids.length === 2 && count('point') === 2) {
    out.push({ kind: 'coincident', label: 'Coincident' }, { kind: 'distance', label: 'Distance…', value: true })
  }
  if (ids.length === 2 && count('circle') === 2) {
    out.push({ kind: 'concentric', label: 'Concentric' }, { kind: 'tangentCircleCircle', label: 'Tangent' })
  }
  if (ids.length === 2 && count('line') === 1 && count('circle') === 1) {
    out.push({ kind: 'tangentLineCircle', label: 'Tangent' })
  }
  if (ids.length === 2 && count('point') === 1 && count('line') === 1) {
    out.push({ kind: 'pointOnLine', label: 'Point on line' })
  }
  if (ids.length === 2 && count('point') === 1 && count('circle') === 1) {
    out.push({ kind: 'pointOnCircle', label: 'Point on circle' })
  }
  if (ids.length === 1 && count('line') === 1) {
    out.push({ kind: 'horizontal', label: 'Horizontal' }, { kind: 'vertical', label: 'Vertical' })
  }
  if (ids.length === 1 && count('circle') === 1) {
    out.push({ kind: 'radius', label: 'Radius…', value: true })
  }
  return out
}

// refs order per kind (matches residuals.ts contract)
function orderRefs(kind: ConstraintKind, ids: EntityId[]): EntityId[] {
  const ent = (id: EntityId) => doc.value.entities.find(e => e.id === id)!
  if (kind === 'tangentLineCircle' || kind === 'pointOnLine') {
    // [line|point-then-line]: for tangentLineCircle → [line, circle]; for pointOnLine → [point, line]
    if (kind === 'tangentLineCircle') return ids.slice().sort(a => (ent(a).kind === 'line' ? -1 : 1))
    return ids.slice().sort(a => (ent(a).kind === 'point' ? -1 : 1))
  }
  if (kind === 'pointOnCircle') return ids.slice().sort(a => (ent(a).kind === 'point' ? -1 : 1))
  return ids.slice()
}

function apply(kind: ConstraintKind, value?: number) {
  const refs = orderRefs(kind, selection.value)
  addConstraint(doc.value, kind, refs, value)
  clearSel()
  runSolve()
}

function applyWithValue(v: { kind: ConstraintKind; label: string; value?: boolean }) {
  if (!v.value) { apply(v.kind); return }
  const raw = window.prompt(v.label + ' value?', '3')
  if (raw == null) return                 // cancelled → no constraint (Bug 3)
  const n = Number(raw)
  if (!Number.isFinite(n)) return          // invalid → no constraint (Bug 3)
  apply(v.kind, n)
}

function del() {
  for (const id of [...selection.value]) deleteEntity(doc.value, id)
  clearSel()
  runSolve()
}

// Solve on a plain (non-reactive) snapshot — every inner-loop read/write in the
// solver would otherwise pay Vue proxy overhead. structuredClone can't handle
// what toRaw hands back once any entity has gone through a delete (a stale Vue
// proxy reference can end up embedded), so build the plain snapshot explicitly
// instead. Only positions/radii are copied back afterward — solve never changes
// entity/constraint structure.
function runSolve(drag?: DragTarget) {
  const plain: SketchDoc = {
    entities: doc.value.entities.map(e => ({
      ...toRaw(e),
      ...(e.kind === 'path' ? { anchors: [...e.anchors], segments: e.segments.map(s => ({ ...toRaw(s) })) } : {}),
    })),
    constraints: doc.value.constraints.map(c => ({ ...toRaw(c), refs: [...c.refs] })),
  }
  const res = solve(plain, { maxIter: 120, drag })
  const solved = new Map(plain.entities.map(e => [e.id, e]))
  for (const e of doc.value.entities) {
    const s = solved.get(e.id)
    if (!s) continue
    if (e.kind === 'point' && s.kind === 'point') { e.x = s.x; e.y = s.y }
    else if (e.kind === 'circle' && s.kind === 'circle') { e.r = s.r }
  }
  status.value = res.converged ? `solved · ${doc.value.entities.length} ent · ${doc.value.constraints.length} con` : `NOT converged (${res.residualNorm.toFixed(2)})`
  return res
}

// place a point, honoring a snap: reuse the snapped point (coincident) or create
// a new point and the on-line/on-circle constraint the snap implies.
function placePoint(x: number, y: number, exclude: EntityId[] = []): EntityId {
  const snapped = snapPoint(doc.value, x, y, { exclude })
  if (snapped.snap?.kind === 'coincident') return snapped.snap.targetId
  const id = addPoint(doc.value, snapped.x, snapped.y)
  if (snapped.snap?.kind === 'pointOnLine') addConstraint(doc.value, 'pointOnLine', [id, snapped.snap.targetId])
  else if (snapped.snap?.kind === 'pointOnCircle') addConstraint(doc.value, 'pointOnCircle', [id, snapped.snap.targetId])
  return id
}

// the current tool's action at world (x,y)
function place(x: number, y: number) {
  if (tool.value === 'point') {
    placePoint(x, y)
    runSolve()
  } else if (tool.value === 'line') {
    if (!pending.value || pending.value.kind !== 'line') {
      const p1 = placePoint(x, y)
      pending.value = { kind: 'line', p1 }
    } else {
      const p2 = placePoint(x, y, [pending.value.p1])
      if (p2 !== pending.value.p1) addLine(doc.value, pending.value.p1, p2)
      pending.value = null
      runSolve()
    }
  } else if (tool.value === 'circle') {
    if (!pending.value || pending.value.kind !== 'circle') {
      const center = placePoint(x, y)
      const c = doc.value.entities.find(e => e.id === center) as any
      pending.value = { kind: 'circle', center, cx: c.x, cy: c.y }
    } else {
      const r = Math.max(0.2, dist({ x, y }, { x: pending.value.cx, y: pending.value.cy }))
      const cid = addCircle(doc.value, pending.value.center, r)
      // auto-capture tangency to existing geometry
      for (const t of inferCircleTangents(doc.value, pending.value.cx, pending.value.cy, r, { exclude: [cid] })) {
        addConstraint(doc.value, t.kind, t.kind === 'tangentLineCircle' ? [t.targetId, cid] : [cid, t.targetId])
      }
      pending.value = null
      runSolve()
    }
  } else if (tool.value === 'path') {
    pathClick(x, y)
  }
  // 'select' does nothing on empty-space click
}

// --- path tool: multi-click anchor chain, line or arc segments ---
type PendingPath = { anchors: EntityId[]; segments: SegmentSpec[] } | null
const pendingPath = ref<PendingPath>(null)
const nextSegment = ref<'line' | 'arc'>('line')

function pathClick(x: number, y: number) {
  const id = placePoint(x, y)
  if (!pendingPath.value) { pendingPath.value = { anchors: [id], segments: [] }; return }
  const pp = pendingPath.value
  const prev = doc.value.entities.find(e => e.id === pp.anchors[pp.anchors.length - 1]) as any
  if (id === pp.anchors[0] && pp.anchors.length >= 2) { finishPath(true); return }  // clicked first anchor → close
  if (id === pp.anchors[pp.anchors.length - 1]) return                               // ignore double-click same point
  if (nextSegment.value === 'arc') {
    const cur = doc.value.entities.find(e => e.id === id) as any
    // center: midpoint pushed perpendicular by half the chord
    const mx = (prev.x + cur.x) / 2, my = (prev.y + cur.y) / 2
    const dx = cur.x - prev.x, dy = cur.y - prev.y
    const c = addPoint(doc.value, mx - dy / 2, my + dx / 2)
    pp.segments.push({ kind: 'arc', center: c, sweep: 1 })
  } else {
    pp.segments.push({ kind: 'line' })
  }
  pp.anchors.push(id)
}

// closing segment between last and first anchors; pen paths always close with a cubic.
// h2 wires the first anchor's own incoming handle back in — if it was drawn smooth,
// firstHIn holds that handle so the closing curve honors it instead of landing as a cusp.
function closingSegment(): SegmentSpec {
  return tool.value === 'pen' ? { kind: 'cubic', h1: lastHOut, h2: firstHIn } : { kind: 'line' }
}

function finishPath(close = false) {
  const pp = pendingPath.value
  pendingPath.value = null
  if (!pp || pp.anchors.length < 2) return
  if (close) {
    // closing segment of the current kind between last and first anchors
    if (tool.value !== 'pen' && nextSegment.value === 'arc') {
      const a = doc.value.entities.find(e => e.id === pp.anchors[pp.anchors.length - 1]) as any
      const b = doc.value.entities.find(e => e.id === pp.anchors[0]) as any
      const c = addPoint(doc.value, (a.x + b.x) / 2 - (b.y - a.y) / 2, (a.y + b.y) / 2 + (b.x - a.x) / 2)
      pp.segments.push({ kind: 'arc', center: c, sweep: 1 })
    } else pp.segments.push(closingSegment())
  }
  addPath(doc.value, pp.anchors, pp.segments, close)
  runSolve()
}

// --- pen tool: click-drag anchor chain; drag beyond 0.15 world units → smooth anchor ---
type PenDrag = { anchor: EntityId; startX: number; startY: number; smooth: boolean } | null
let penDrag: PenDrag = null
let lastHOut: EntityId | null = null
// the first anchor's incoming handle, if it was drawn smooth — wired into the
// closing segment's h2 when the path closes (see closingSegment / F3)
let firstHIn: EntityId | null = null

function penDown(x: number, y: number) {
  const id = placePoint(x, y)
  if (!pendingPath.value) {
    pendingPath.value = { anchors: [id], segments: [] }
    lastHOut = null
    firstHIn = null
    penDrag = { anchor: id, startX: x, startY: y, smooth: false }
    return
  }
  const pp = pendingPath.value
  if (id === pp.anchors[0] && pp.anchors.length >= 2) { finishPath(true); penDrag = null; return }  // clicked first anchor → close
  if (id === pp.anchors[pp.anchors.length - 1]) { penDrag = null; return }                            // ignore double-click same point
  pp.segments.push({ kind: 'cubic', h1: lastHOut, h2: null })
  pp.anchors.push(id)
  penDrag = { anchor: id, startX: x, startY: y, smooth: false }
}

function penMove(x: number, y: number) {
  if (!penDrag) return
  if (dist({ x, y }, { x: penDrag.startX, y: penDrag.startY }) > 0.15) penDrag.smooth = true
}

function penUp(x: number, y: number) {
  if (!penDrag) return
  const { anchor, smooth } = penDrag
  penDrag = null
  if (smooth) {
    const { hOut, hIn } = addSmoothHandles(doc.value, anchor, x, y)
    const pp = pendingPath.value
    if (pp && pp.segments.length > 0) {
      const segIn = pp.segments[pp.segments.length - 1]
      if (segIn && segIn.kind === 'cubic') segIn.h2 = hIn
    }
    if (pp && pp.anchors[0] === anchor) firstHIn = hIn  // this anchor IS the path's first anchor
    lastHOut = hOut
  } else {
    // corner anchor — no outgoing handle; must NOT carry the previous smooth
    // anchor's hOut into the next segment (F1)
    lastHOut = null
  }
  runSolve()
}

function doRepeat(count: number) {
  const ptSel = selection.value.filter(id => (doc.value.entities.find(e => e.id === id) as any)?.kind === 'point')
  const entSel = selection.value.filter(id => !ptSel.includes(id))
  if (ptSel.length !== 1 || entSel.length === 0 || !Number.isFinite(count) || count < 2) return
  repeatEntities(doc.value, entSel, ptSel[0]!, Math.round(count))
  clearSel(); runSolve()
}
function repeatPrompt() {
  const raw = window.prompt('Repeat count?', '6')
  if (raw == null) return
  doRepeat(Number(raw))
}
function doMirror() {
  const lineSel = selection.value.filter(id => (doc.value.entities.find(e => e.id === id) as any)?.kind === 'line')
  const entSel = selection.value.filter(id => !lineSel.includes(id))
  if (lineSel.length !== 1 || entSel.length === 0) return
  mirrorEntities(doc.value, entSel, lineSel[0]!)
  clearSel(); runSolve()
}
function flip(axis: 'h' | 'v') {
  const ptIds = pointClosure(doc.value, selection.value)
  const pts = ptIds.map(id => doc.value.entities.find(e => e.id === id)).filter((e: any) => e?.kind === 'point') as any[]
  if (!pts.length) return
  const minX = Math.min(...pts.map(p => p.x)), maxX = Math.max(...pts.map(p => p.x))
  const minY = Math.min(...pts.map(p => p.y)), maxY = Math.max(...pts.map(p => p.y))
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
  for (const p of pts) { if (axis === 'h') p.x = 2 * cx - p.x; else p.y = 2 * cy - p.y }
  runSolve()
}
function makeConstruction() {
  for (const id of selection.value) {
    const e = doc.value.entities.find(x => x.id === id) as any
    if (e && e.kind !== 'point') e.construction = !e.construction
  }
  clearSel(); runSolve()
}
function copySvg(): string {
  const d = sketchPathData(doc.value)
  try { navigator.clipboard?.writeText(d)?.catch?.(() => {}) } catch {}
  return d
}

// rendering: remap to screen via a shadow doc (points scaled, radii * S)
// the y-flip mirrors arc winding, so arc segments carried into the shadow doc
// have their sweep flipped to keep the rendered curve on the correct side
function toShadowEntities(d: SketchDoc) {
  return d.entities.map(e => e.kind === 'point'
    ? { ...e, x: sx(e.x), y: sy(e.y) }
    : e.kind === 'circle' ? { ...e, r: e.r * S }
    : e.kind === 'path' ? { ...e, segments: e.segments.map(s => s.kind === 'arc' ? { ...s, sweep: (1 - s.sweep) as 0 | 1 } : s) }
    : { ...e })
}
const shadowDoc = computed<SketchDoc>(() => ({ entities: toShadowEntities(doc.value), constraints: [] }))
const pathScreen = computed(() => sketchPathData(shadowDoc.value))
const constructionScreen = computed(() => {
  const d = doc.value
  const shadow = shadowDoc.value
  const parts: string[] = []
  for (const e of d.entities) {
    if (e.kind === 'point' || !e.construction) continue
    const dstr = entityPath(shadow, e.id)
    if (dstr) parts.push(dstr)
  }
  return parts.join(' ')
})
// construction points are handles — only worth drawing while their owning
// path is selected or is the in-progress draw; otherwise they're stray dots
const visibleHandleIds = computed(() => {
  const d = doc.value
  const out = new Set<EntityId>()
  const addHandles = (segments: SegmentSpec[]) => {
    for (const seg of segments) {
      if (seg.kind !== 'cubic') continue
      if (seg.h1) out.add(seg.h1)
      if (seg.h2) out.add(seg.h2)
    }
  }
  for (const e of d.entities) {
    if (e.kind === 'path' && selection.value.includes(e.id)) addHandles(e.segments)
  }
  if (pendingPath.value) addHandles(pendingPath.value.segments)
  return out
})
const pts = computed(() => doc.value.entities.filter(e =>
  e.kind === 'point' && (!(e as any).construction || visibleHandleIds.value.has(e.id))) as any[])
const marks = computed(() => constraintMarks(doc.value))

// screen-space arm lines (anchor→handle) for cubic segments of selected or pending paths
const handleArms = computed(() => {
  const d = doc.value
  const out: { x1: number; y1: number; x2: number; y2: number }[] = []
  const addArms = (anchors: EntityId[], segments: SegmentSpec[]) => {
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!
      if (seg.kind !== 'cubic') continue
      const fromId = anchors[i]!
      const toId = anchors[(i + 1) % anchors.length]!
      if (seg.h1) {
        const from = d.entities.find(e => e.id === fromId) as any
        const h1 = d.entities.find(e => e.id === seg.h1) as any
        if (from && h1) out.push({ x1: sx(from.x), y1: sy(from.y), x2: sx(h1.x), y2: sy(h1.y) })
      }
      if (seg.h2) {
        const to = d.entities.find(e => e.id === toId) as any
        const h2 = d.entities.find(e => e.id === seg.h2) as any
        if (to && h2) out.push({ x1: sx(to.x), y1: sy(to.y), x2: sx(h2.x), y2: sy(h2.y) })
      }
    }
  }
  for (const e of d.entities) {
    if (e.kind === 'path' && selection.value.includes(e.id)) addArms(e.anchors, e.segments)
  }
  if (pendingPath.value) addArms(pendingPath.value.anchors, pendingPath.value.segments)
  return out
})

// pointer handling
let dragId: EntityId | null = null
let moved = false
function svgXY(ev: PointerEvent) {
  const r = (ev.currentTarget as SVGSVGElement).getBoundingClientRect()
  return { x: wx(ev.clientX - r.left), y: wy(ev.clientY - r.top) }
}
function onPointerDownPoint(id: EntityId, ev: PointerEvent) {
  if (tool.value === 'select') { dragId = id; moved = false; ev.stopPropagation() }
}
function onPointerUpPoint(id: EntityId, ev: PointerEvent) {
  // a click without a drag toggles selection
  if (tool.value === 'select' && dragId === id && !moved) { pick(id); ev.stopPropagation() }
  dragId = null
}
function entityPathScreen(id: EntityId): string {
  return entityPath(shadowDoc.value, id)
}
function onPointerDownSvg(ev: PointerEvent) {
  if (tool.value === 'select') return
  const { x, y } = svgXY(ev)
  if (tool.value === 'pen') { penDown(x, y); return }
  place(x, y)
}
function onPointerMove(ev: PointerEvent) {
  if (tool.value === 'pen') {
    if (!penDrag || ev.buttons === 0) return
    const { x, y } = svgXY(ev)
    penMove(x, y)
    return
  }
  if (!dragId || ev.buttons === 0) return
  const { x, y } = svgXY(ev)
  moved = true
  runSolve({ point: dragId, x, y })
}
function onPointerUp(ev: PointerEvent) {
  if (tool.value === 'pen' && penDrag) {
    const { x, y } = svgXY(ev)
    penUp(x, y)
    return
  }
  dragId = null
}

// an abandoned path/pen draw (tool switched away, or reset, before it was
// committed) leaves its anchors and handles sitting in the doc forever. Delete
// whichever of them nothing committed ends up referencing — an anchor reused
// via snap-coincidence with existing geometry stays (deleteEntity would
// otherwise cascade into whatever committed line/circle/path shares it).
function cleanupPendingPath() {
  const pp = pendingPath.value
  if (!pp) return
  const candidates = new Set<EntityId>(pp.anchors)
  for (const s of pp.segments) {
    if (s.kind === 'cubic') { if (s.h1) candidates.add(s.h1); if (s.h2) candidates.add(s.h2) }
    else if (s.kind === 'arc') candidates.add(s.center)
  }
  if (lastHOut) candidates.add(lastHOut)
  if (firstHIn) candidates.add(firstHIn)
  for (const id of candidates) {
    const p = doc.value.entities.find(e => e.id === id) as any
    if (!p || p.kind !== 'point' || p.fixed) continue
    if (!isPointReferenced(doc.value, id)) deleteEntity(doc.value, id)
  }
}

function selectTool(t: Tool) {
  cleanupPendingPath()
  tool.value = t
  pending.value = null
  pendingPath.value = null
  penDrag = null
  lastHOut = null
  firstHIn = null
}

function reset() {
  cleanupPendingPath()
  doc.value = { entities: [], constraints: [] }
  pending.value = null
  pendingPath.value = null
  penDrag = null
  lastHOut = null
  firstHIn = null
  status.value = 'ready'
}

onMounted(() => {
  ;(window as any).__sketchDraw = {
    get doc() { return doc.value },
    get tool() { return tool.value },
    get selection() { return selection.value.slice() },
    status: () => status.value,
    pathData: () => sketchPathData(doc.value),
    entityCount: () => doc.value.entities.length,
    constraintCount: () => doc.value.constraints.length,
    setTool: (t: Tool) => selectTool(t),
    reset,
    place: (x: number, y: number) => place(x, y),
    penDown: (x: number, y: number) => penDown(x, y),
    penMove: (x: number, y: number) => penMove(x, y),
    penUp: (x: number, y: number) => penUp(x, y),
    drag: (id: EntityId, x: number, y: number) => runSolve({ point: id, x, y }),
    pick: (id: EntityId) => pick(id),
    clearSel: () => clearSel(),
    apply: (kind: ConstraintKind, value?: number) => apply(kind, value),
    del: () => del(),
    availableConstraints: () => availableConstraints(),
    setNextSegment: (k: 'line' | 'arc') => { nextSegment.value = k },
    finishPath: (close = false) => finishPath(close),
    repeat: (ids: EntityId[], centerId: EntityId, count: number) => { repeatEntities(doc.value, ids, centerId, count); runSolve() },
    mirror: (ids: EntityId[], axisId: EntityId) => { mirrorEntities(doc.value, ids, axisId); runSolve() },
    flipH: () => flip('h'),
    flipV: () => flip('v'),
    makeConstruction: () => makeConstruction(),
    copySvg: () => copySvg(),
  }
  ready.value = true
})
</script>

<template>
  <div :data-ready="ready ? '' : undefined" style="font-family: ui-sans-serif, system-ui; padding: 12px; color: #e5e5e5; background: #0b0b0b; min-height: 100vh">
    <h1 style="font-size: 14px; margin: 0 0 8px">Sketch Draw</h1>
    <div style="display: flex; gap: 6px; margin-bottom: 8px; align-items: center">
      <button v-for="t in (['select','point','line','circle','path','pen'] as Tool[])" :key="t"
              :data-tool="t" @click="() => selectTool(t)"
              :style="{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #333', cursor: 'pointer',
                        background: tool === t ? '#2563eb' : '#1a1a1a', color: '#fff' }">{{ t }}</button>
      <button data-act="reset" @click="reset" style="padding: 4px 10px; border-radius: 6px; border: 1px solid #333; background: #1a1a1a; color: #fff; cursor: pointer">reset</button>
      <span data-status style="margin-left: 8px; font-size: 12px; color: #9ca3af">{{ status }}</span>
    </div>
    <div v-if="tool === 'path'" style="display: flex; gap: 6px; margin-bottom: 8px; align-items: center">
      <span style="font-size: 12px; color: #9ca3af">next segment:</span>
      <button data-seg="line" @click="nextSegment = 'line'"
              :style="{ padding: '3px 9px', borderRadius: '6px', border: '1px solid #333', cursor: 'pointer', fontSize: '12px',
                        background: nextSegment === 'line' ? '#2563eb' : '#1a1a1a', color: '#fff' }">line</button>
      <button data-seg="arc" @click="nextSegment = 'arc'"
              :style="{ padding: '3px 9px', borderRadius: '6px', border: '1px solid #333', cursor: 'pointer', fontSize: '12px',
                        background: nextSegment === 'arc' ? '#2563eb' : '#1a1a1a', color: '#fff' }">arc</button>
      <button data-act="close" @click="finishPath(true)"
              style="padding: 3px 9px; border-radius: 6px; border: 1px solid #333; background: #1a1a1a; color: #fff; cursor: pointer; font-size: 12px">close</button>
      <button data-act="finish" @click="finishPath(false)"
              style="padding: 3px 9px; border-radius: 6px; border: 1px solid #333; background: #1a1a1a; color: #fff; cursor: pointer; font-size: 12px">finish</button>
    </div>
    <div v-else-if="tool === 'pen'" style="display: flex; gap: 6px; margin-bottom: 8px; align-items: center">
      <span style="font-size: 12px; color: #9ca3af">click for a corner anchor, click-drag for a smooth anchor; click the first anchor to close</span>
      <button data-act="close" @click="finishPath(true)"
              style="padding: 3px 9px; border-radius: 6px; border: 1px solid #333; background: #1a1a1a; color: #fff; cursor: pointer; font-size: 12px">close</button>
      <button data-act="finish" @click="finishPath(false)"
              style="padding: 3px 9px; border-radius: 6px; border: 1px solid #333; background: #1a1a1a; color: #fff; cursor: pointer; font-size: 12px">finish</button>
    </div>
    <div style="display: flex; gap: 6px; margin: 8px 0; min-height: 28px; align-items: center; flex-wrap: wrap">
      <span style="font-size: 12px; color: #9ca3af">sel: {{ selection.length }}</span>
      <button v-for="v in availableConstraints()" :key="v.kind" :data-verb="v.kind"
              @click="() => applyWithValue(v)"
              style="padding: 3px 9px; border-radius: 6px; border: 1px solid #333; background: #1a1a1a; color: #fff; cursor: pointer; font-size: 12px">{{ v.label }}</button>
      <button v-if="selection.length" data-verb="fix" @click="() => { for (const id of selection) { const e = doc.entities.find(x => x.id === id); if (e && e.kind === 'point') (e as any).fixed = true } clearSel(); runSolve() }"
              style="padding: 3px 9px; border-radius: 6px; border: 1px solid #333; background: #1a1a1a; color: #fff; cursor: pointer; font-size: 12px">Fix</button>
      <button v-if="selection.length" data-verb="repeat" @click="repeatPrompt"
              style="padding: 3px 9px; border-radius: 6px; border: 1px solid #333; background: #1a1a1a; color: #fff; cursor: pointer; font-size: 12px">Repeat…</button>
      <button v-if="selection.length" data-verb="mirror" @click="doMirror"
              style="padding: 3px 9px; border-radius: 6px; border: 1px solid #333; background: #1a1a1a; color: #fff; cursor: pointer; font-size: 12px">Mirror</button>
      <button v-if="selection.length" data-verb="construction" @click="makeConstruction"
              style="padding: 3px 9px; border-radius: 6px; border: 1px solid #333; background: #1a1a1a; color: #fff; cursor: pointer; font-size: 12px">Make construction</button>
      <button v-if="selection.length" data-verb="flip-h" @click="flip('h')"
              style="padding: 3px 9px; border-radius: 6px; border: 1px solid #333; background: #1a1a1a; color: #fff; cursor: pointer; font-size: 12px">Flip H</button>
      <button v-if="selection.length" data-verb="flip-v" @click="flip('v')"
              style="padding: 3px 9px; border-radius: 6px; border: 1px solid #333; background: #1a1a1a; color: #fff; cursor: pointer; font-size: 12px">Flip V</button>
      <button data-verb="copy-svg" @click="copySvg"
              style="padding: 3px 9px; border-radius: 6px; border: 1px solid #333; background: #1a1a1a; color: #fff; cursor: pointer; font-size: 12px">Copy SVG</button>
      <button v-if="selection.length" data-act="delete" @click="del"
              style="padding: 3px 9px; border-radius: 6px; border: 1px solid #7f1d1d; background: #1a1a1a; color: #fca5a5; cursor: pointer; font-size: 12px">Delete</button>
    </div>
    <svg width="680" height="460" style="background: #fafafa; border-radius: 8px; touch-action: none; cursor: crosshair"
         @pointerdown="onPointerDownSvg" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointerleave="onPointerUp">
      <path :d="pathScreen" fill="none" stroke="#3730a3" stroke-width="1.5" />
      <path :d="constructionScreen" fill="none" stroke="#9ca3af" stroke-width="1.5" stroke-dasharray="4 3" />
      <template v-for="e in doc.entities" :key="'hit-' + e.id">
        <path v-if="e.kind !== 'point'" :d="entityPathScreen(e.id)" fill="none" stroke="transparent" stroke-width="12"
              :style="{ cursor: 'pointer' }" @pointerdown="(ev) => { if (tool==='select') { pick(e.id); ev.stopPropagation() } }" :data-ent="e.id" />
        <path v-if="e.kind !== 'point' && selection.includes(e.id)" :d="entityPathScreen(e.id)" fill="none" stroke="#f59e0b" stroke-width="2.5" pointer-events="none" />
      </template>
      <line v-for="(a, i) in handleArms" :key="'arm-' + i" :x1="a.x1" :y1="a.y1" :x2="a.x2" :y2="a.y2"
            stroke="#7c3aed" stroke-width="1" pointer-events="none" />
      <circle v-for="p in pts" :key="p.id" :cx="sx(p.x)" :cy="sy(p.y)" :r="p.construction ? 4 : 6"
              :fill="p.construction ? 'none' : (selection.includes(p.id) ? '#f59e0b' : (p.fixed ? '#9ca3af' : '#2563eb'))"
              :stroke="p.construction ? (selection.includes(p.id) ? '#f59e0b' : '#7c3aed') : 'none'"
              :stroke-width="p.construction ? 1.5 : 0"
              :style="{ cursor: tool === 'select' ? 'grab' : 'crosshair' }"
              @pointerdown="(e) => onPointerDownPoint(p.id, e)" @pointerup="(e) => onPointerUpPoint(p.id, e)" :data-point="p.id" />
      <g v-for="m in marks" :key="m.id" pointer-events="none">
        <rect :x="sx(m.x) + 6" :y="sy(m.y) - 16" :width="m.text ? 30 : 16" height="14" rx="3" fill="#111827" opacity="0.85" />
        <text :x="sx(m.x) + 9" :y="sy(m.y) - 5" fill="#e5e7eb" font-size="10" font-family="ui-monospace, monospace">{{ m.glyph }}{{ m.text ? ' ' + m.text : '' }}</text>
      </g>
    </svg>
    <p style="font-size: 12px; color: #6b7280; margin-top: 8px">
      Pick a tool. Point/Line/Circle click to place (snaps to nearby geometry). Path/Pen click to chain anchors, click the first anchor to close. Pen: click-drag for a smooth anchor. Select drags points; the drawing re-solves.
    </p>
  </div>
</template>
