<!-- app/pages/dev/sketch-draw.vue -->
<script setup lang="ts">
// Dev harness — not linked in the app. Interactive constraint drawing surface.
definePageMeta({ layout: false })
import { ref, computed, onMounted, toRaw } from 'vue'
import type { SketchDoc, EntityId, ConstraintKind, SegmentSpec } from '~/lib/sketch/model'
import { addPoint, addLine, addCircle, addConstraint, deleteEntity, addPath, repeatEntities, mirrorEntities, pointClosure, isPointReferenced } from '~/lib/sketch/edit'
import { snapPoint, inferCircleTangents, tangentJointArc } from '~/lib/sketch/infer'
import { solve, type DragTarget } from '~/lib/sketch/solve'
import { sketchPathData, entityPath } from '~/lib/sketch/sketchPath'
import { dist, type Vec2 } from '~/lib/sketch/geom'
import { constraintMarks, arcDimensionMarks } from '~/lib/sketch/annotate'

type Tool = 'select' | 'point' | 'line' | 'circle' | 'path'

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

// live path pointer position, world coords — drives the in-progress draw
// preview (previewD below); null when not hovering with the path tool
const cursor = ref<{ x: number; y: number } | null>(null)

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

// interior line-line corner of a path at anchor `pointId`: the previous and
// next anchors along the path, when both segments meeting at it are straight
// lines (an arc has no fixed direction at the joint, so any corner touching
// one is excluded). Open path: only a true interior anchor qualifies (not the
// first/last, which have just one adjacent segment). Closed path: any anchor
// qualifies, wrapping around. Returns the first path entity where this holds,
// or null if `pointId` isn't such a corner on any path.
function pathCornerInfo(pointId: EntityId): { prev: EntityId; corner: EntityId; next: EntityId } | null {
  for (const e of doc.value.entities) {
    if (e.kind !== 'path') continue
    const n = e.anchors.length
    for (let i = 0; i < n; i++) {
      if (e.anchors[i] !== pointId) continue
      if (!e.closed && (i === 0 || i === n - 1)) continue
      const prevSeg = e.segments[(i - 1 + n) % n]
      const nextSeg = e.segments[i]
      if (!prevSeg || !nextSeg) continue
      if (prevSeg.kind !== 'line' || nextSeg.kind !== 'line') continue
      return { prev: e.anchors[(i - 1 + n) % n]!, corner: pointId, next: e.anchors[(i + 1) % n]! }
    }
  }
  return null
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
  if (ids.length === 2 && count('line') === 2) {
    out.push({ kind: 'perpendicular', label: 'Perpendicular' }, { kind: 'parallel', label: 'Parallel' })
  }
  if (ids.length === 1 && count('point') === 1 && pathCornerInfo(ids[0]!)) {
    out.push({ kind: 'perpendicular', label: 'Right angle' })
  }
  return out
}

// refs order per kind (matches residuals.ts contract)
function orderRefs(kind: ConstraintKind, ids: EntityId[]): EntityId[] {
  const ent = (id: EntityId) => doc.value.entities.find(e => e.id === id)!
  if (kind === 'perpendicular' || kind === 'parallel') {
    // both refs are two LINE entity ids (from the two-lines-selected gate in
    // availableConstraints) — the residual wants 4 POINT refs: each line's
    // anchors, [L1.p1, L1.p2, L2.p1, L2.p2]. Fall back to the raw ids
    // (shouldn't happen given the gate) if either isn't actually a line.
    if (ids.length === 2) {
      const l1 = ent(ids[0]!), l2 = ent(ids[1]!)
      if (l1.kind === 'line' && l2.kind === 'line') return [l1.p1, l1.p2, l2.p1, l2.p2]
    }
    // single selected point that's a line-line path corner (the "Right angle"
    // gate above) — refs are [prev, corner, corner, next] so the shared
    // residual reads it as two segment directions meeting at `corner`.
    if (kind === 'perpendicular' && ids.length === 1) {
      const corner = pathCornerInfo(ids[0]!)
      if (corner) return [corner.prev, corner.corner, corner.corner, corner.next]
    }
    return ids.slice()
  }
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
// retained for API/E2E compat (setNextSegment / pathClick below) — the UI
// toggle is gone; the real gesture is now click-and-drag-to-bow (pathDown/Move/Up)
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

// Free (or tangent-joint-locked) arc through/near (J, end, pointer) in world
// (doc) coordinates, via tangentJointArc (~/lib/sketch/infer). sweep/large
// follow the doc-coords SVG convention (matches pathD in sketchPath.ts):
// sweep=1 means the arc travels ccw from J through pointer to reach end.
// tangentDir null → a plain circumcircle-through-three-points free arc (the
// path's first segment, no joint to honor). tangentDir non-null → when the
// free arc's tangent at J is already close to it, the center snaps onto the
// tangent-locked arc instead (see tangentJointArc / snappedTangent). Returns
// null when no arc fits (near-collinear, or the circle would be enormous) —
// callers fall back to a straight line in that case.
function bowArc(J: Vec2, end: Vec2, pointer: Vec2, tangentDir: Vec2 | null): { center: Vec2; r: number; sweep: 0 | 1; large: 0 | 1; mid: Vec2; snappedTangent: boolean } | null {
  const arc = tangentJointArc(J, end, pointer, tangentDir)
  if (!arc || arc.radius > 1e4) return null
  const TAU = Math.PI * 2
  const a0 = Math.atan2(J.y - arc.center.y, J.x - arc.center.x)
  const a1 = Math.atan2(end.y - arc.center.y, end.x - arc.center.x)
  const ccw = ((a1 - a0) % TAU + TAU) % TAU
  const span = arc.sweep === 1 ? ccw : TAU - ccw
  const large: 0 | 1 = span > Math.PI ? 1 : 0
  const am = arc.sweep === 1 ? a0 + span / 2 : a0 - span / 2
  const mid = { x: arc.center.x + arc.radius * Math.cos(am), y: arc.center.y + arc.radius * Math.sin(am) }
  return { center: arc.center, r: arc.radius, sweep: arc.sweep, large, mid, snappedTangent: arc.snappedTangent }
}

// Tangent info at the shared anchor J = pp.anchors[segIndex], derived from
// the PREVIOUS committed segment (pp.segments[segIndex - 1]) so a chain of
// bowed segments can flow smoothly through their shared joints instead of
// kinking. Null when this is the path's first segment (segIndex 0, no prior
// segment to be tangent to) — bowArc then falls back to a free arc, same as
// before this joint-tangent wiring existed.
type JointInfo =
  | { tangentDir: Vec2; prevKind: 'line'; La: EntityId; Lb: EntityId }
  | { tangentDir: Vec2; prevKind: 'arc'; Cprev: EntityId }
function jointInfoForSegment(pp: { anchors: EntityId[]; segments: SegmentSpec[] }, segIndex: number): JointInfo | null {
  if (segIndex < 1) return null
  const prevSeg = pp.segments[segIndex - 1]
  const jId = pp.anchors[segIndex]
  const J = jId ? (doc.value.entities.find(e => e.id === jId) as any) : null
  if (!prevSeg || !J || J.kind !== 'point') return null
  if (prevSeg.kind === 'line') {
    const laId = pp.anchors[segIndex - 1]
    const La = laId ? (doc.value.entities.find(e => e.id === laId) as any) : null
    if (!laId || !La || La.kind !== 'point') return null
    return { tangentDir: { x: J.x - La.x, y: J.y - La.y }, prevKind: 'line', La: laId, Lb: jId! }
  }
  if (prevSeg.kind === 'arc') {
    const Cp = doc.value.entities.find(e => e.id === prevSeg.center) as any
    if (!Cp || Cp.kind !== 'point') return null
    return { tangentDir: { x: -(J.y - Cp.y), y: J.x - Cp.x }, prevKind: 'arc', Cprev: prevSeg.center }
  }
  return null   // prev segment is a cubic — the path tool never produces one, no joint defined
}

// --- path tool: the real gesture — pointerdown places an anchor (+ a line
// segment from the previous one, as today); if the pointer moves past the
// threshold before pointerup, that segment bows into a circular arc through
// the live pointer (see bowArc).
type PathDrag = { anchor: EntityId; prevAnchor: EntityId; startX: number; startY: number; bowed: boolean } | null
let pathDrag: PathDrag = null

function pathDown(x: number, y: number) {
  const id = placePoint(x, y)
  if (!pendingPath.value) {
    pendingPath.value = { anchors: [id], segments: [] }
    pathDrag = null
    return
  }
  const pp = pendingPath.value
  if (id === pp.anchors[0] && pp.anchors.length >= 2) { finishPath(true); pathDrag = null; return }  // clicked first anchor → close
  if (id === pp.anchors[pp.anchors.length - 1]) { pathDrag = null; return }                            // ignore double-click same point
  const prevAnchor = pp.anchors[pp.anchors.length - 1]!
  pp.segments.push({ kind: 'line' })
  pp.anchors.push(id)
  pathDrag = { anchor: id, prevAnchor, startX: x, startY: y, bowed: false }
}

function pathMove(x: number, y: number) {
  // reactive — drives previewD/pathBowChip live, whether this came from a
  // real pointermove or a direct __sketchDraw.pathMove() call (tests)
  cursor.value = { x, y }
  if (!pathDrag) return
  if (dist({ x, y }, { x: pathDrag.startX, y: pathDrag.startY }) > 0.15) pathDrag.bowed = true
}

function pathUp(x: number, y: number) {
  if (!pathDrag) return
  const { anchor, prevAnchor, bowed } = pathDrag
  pathDrag = null
  const pp = pendingPath.value
  if (bowed && pp) {
    const segIndex = pp.segments.length - 1
    const seg = pp.segments[segIndex]
    const p0 = doc.value.entities.find(e => e.id === prevAnchor) as any
    const p1 = doc.value.entities.find(e => e.id === anchor) as any
    if (seg && seg.kind === 'line' && p0 && p1) {
      const joint = jointInfoForSegment(pp, segIndex)
      const arc = bowArc({ x: p0.x, y: p0.y }, { x: p1.x, y: p1.y }, { x, y }, joint?.tangentDir ?? null)
      if (arc) {
        const c = addPoint(doc.value, arc.center.x, arc.center.y)
        pp.segments[segIndex] = { kind: 'arc', center: c, sweep: arc.sweep }
        // tangent-continuous with the previous segment: wire the joint constraint
        // so the solver keeps the flow smooth after later drags (see brief §joint)
        if (arc.snappedTangent && joint) {
          if (joint.prevKind === 'arc') addConstraint(doc.value, 'collinear', [joint.Cprev, prevAnchor, c])
          else addConstraint(doc.value, 'perpendicular', [joint.La, joint.Lb, prevAnchor, c])
        }
      }
    }
  }
  runSolve()
}

// closing segment between last and first anchors — the path tool always closes with a line.
function closingSegment(): SegmentSpec {
  return { kind: 'line' }
}

function finishPath(close = false) {
  const pp = pendingPath.value
  pendingPath.value = null
  if (!pp || pp.anchors.length < 2) return
  if (close) {
    // closing segment of the current kind between last and first anchors
    if (nextSegment.value === 'arc') {
      const a = doc.value.entities.find(e => e.id === pp.anchors[pp.anchors.length - 1]) as any
      const b = doc.value.entities.find(e => e.id === pp.anchors[0]) as any
      const c = addPoint(doc.value, (a.x + b.x) / 2 - (b.y - a.y) / 2, (a.y + b.y) / 2 + (b.x - a.x) / 2)
      pp.segments.push({ kind: 'arc', center: c, sweep: 1 })
    } else pp.segments.push(closingSegment())
  }
  addPath(doc.value, pp.anchors, pp.segments, close)
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
const pts = computed(() => doc.value.entities.filter(e => e.kind === 'point') as any[])
const marks = computed(() => constraintMarks(doc.value))
// persistent "R n.n" radius chips on every finished arc segment — pure read of
// the doc, never solves; distinct from pathBowChip's live during-drag chip
const arcDims = computed(() => arcDimensionMarks(doc.value))

// screen coords of a live (already-in-doc) point entity — used by the preview,
// which never goes through the shadow-doc clone
function screenPt(id: EntityId): { x: number; y: number } | null {
  const p = doc.value.entities.find(e => e.id === id) as any
  if (!p || p.kind !== 'point') return null
  return { x: sx(p.x), y: sy(p.y) }
}

// live path draw preview: the already-placed pending segments, plus either a
// rubber band out to the cursor (hovering) or — mid drag past the bow
// threshold — the just-placed segment bending live under the pointer. Pure
// read of doc + cursor + pathDrag; never solves, never mutates the doc.
const previewD = computed(() => {
  if (tool.value !== 'path') return ''
  const pp = pendingPath.value
  if (!pp || pp.anchors.length === 0) return ''
  const first = screenPt(pp.anchors[0]!)
  if (!first) return ''
  let d = `M ${first.x} ${first.y}`
  const segCount = pp.segments.length
  const lastAnchorId = pp.anchors[pp.anchors.length - 1]!
  const bowing = !!pathDrag && pathDrag.bowed && pathDrag.anchor === lastAnchorId && !!cursor.value
  for (let i = 0; i < segCount; i++) {
    const seg = pp.segments[i]!
    const fromId = pp.anchors[i]!
    const toId = pp.anchors[i + 1]!
    const to = screenPt(toId)
    if (!to) break
    if (bowing && i === segCount - 1) {
      // just-placed segment bowing live under the pointer — bowArc works in
      // world (doc) coords, then flip sweep for the screen's y-flip (see toShadowEntities)
      const p0 = doc.value.entities.find(e => e.id === fromId) as any
      const p1 = doc.value.entities.find(e => e.id === toId) as any
      const joint = jointInfoForSegment(pp, i)
      const arc = (p0 && p1 && cursor.value) ? bowArc({ x: p0.x, y: p0.y }, { x: p1.x, y: p1.y }, cursor.value, joint?.tangentDir ?? null) : null
      if (arc) {
        const rScreen = arc.r * S
        const sweepScreen = (1 - arc.sweep) as 0 | 1
        d += ` A ${rScreen} ${rScreen} 0 ${arc.large} ${sweepScreen} ${to.x} ${to.y}`
      } else {
        d += ` L ${to.x} ${to.y}`
      }
    } else if (seg.kind === 'arc') {
      const from = screenPt(fromId)
      const c = screenPt(seg.center)
      if (from && c) {
        const r = Math.hypot(from.x - c.x, from.y - c.y)
        const a0 = Math.atan2(from.y - c.y, from.x - c.x)
        const a1 = Math.atan2(to.y - c.y, to.x - c.x)
        const TAU = Math.PI * 2
        const ccw = ((a1 - a0) % TAU + TAU) % TAU
        const sweep = (1 - seg.sweep) as 0 | 1   // screen space is y-flipped (see toShadowEntities)
        const span = sweep === 1 ? ccw : TAU - ccw
        const large = span > Math.PI ? 1 : 0
        d += ` A ${r} ${r} 0 ${large} ${sweep} ${to.x} ${to.y}`
      } else d += ` L ${to.x} ${to.y}`
    } else {
      d += ` L ${to.x} ${to.y}`
    }
  }
  if (!bowing && cursor.value) {
    const last = screenPt(lastAnchorId)
    if (last) {
      const ptr = { x: sx(cursor.value.x), y: sy(cursor.value.y) }
      d += ` M ${last.x} ${last.y} L ${ptr.x} ${ptr.y}`
    }
  }
  return d
})

// live radius chip shown near the bowed arc's midpoint while the path tool
// drags a segment into a curve — same "R n.n" badge style as constraint marks.
// When the bow is joint-tangent-locked to the previous segment (snappedTangent),
// also carries J's screen position so the template can drop a small "T" chip there.
const pathBowChip = computed(() => {
  if (tool.value !== 'path' || !pathDrag || !pathDrag.bowed || !cursor.value) return null
  const pp = pendingPath.value
  const p0 = doc.value.entities.find(e => e.id === pathDrag!.prevAnchor) as any
  const p1 = doc.value.entities.find(e => e.id === pathDrag!.anchor) as any
  if (!p0 || !p1 || !pp) return null
  const joint = jointInfoForSegment(pp, pp.segments.length - 1)
  const arc = bowArc({ x: p0.x, y: p0.y }, { x: p1.x, y: p1.y }, cursor.value, joint?.tangentDir ?? null)
  if (!arc) return null
  return {
    x: sx(arc.mid.x), y: sy(arc.mid.y), text: `R ${arc.r.toFixed(1)}`,
    snappedTangent: arc.snappedTangent, jointX: sx(p0.x), jointY: sy(p0.y),
  }
})

// pointer handling
let dragId: EntityId | null = null
let moved = false
// handle points riding the dragged anchor (Fix 3): translated by the same
// delta as the anchor each move, so their arms keep shape and the solver's
// collinear constraint has something consistent to hold onto
let dragHandleIds: EntityId[] = []
let dragLast: { x: number; y: number } | null = null

// handle ids attached to a given anchor: h1 of the segment leaving it, h2 of
// the segment arriving at it (same adjacency handleArms walks)
function handleIdsForAnchor(id: EntityId): EntityId[] {
  const out: EntityId[] = []
  for (const e of doc.value.entities) {
    if (e.kind !== 'path') continue
    const n = e.anchors.length
    for (let i = 0; i < e.segments.length; i++) {
      const seg = e.segments[i]!
      if (seg.kind !== 'cubic') continue
      const fromId = e.anchors[i]!
      const toId = e.anchors[(i + 1) % n]!
      if (fromId === id && seg.h1) out.push(seg.h1)
      if (toId === id && seg.h2) out.push(seg.h2)
    }
  }
  return out
}

function svgXY(ev: PointerEvent) {
  const r = (ev.currentTarget as SVGSVGElement).getBoundingClientRect()
  return { x: wx(ev.clientX - r.left), y: wy(ev.clientY - r.top) }
}
function onPointerDownPoint(id: EntityId, ev: PointerEvent) {
  if (tool.value !== 'select') return
  dragId = id; moved = false
  const p = doc.value.entities.find(e => e.id === id) as any
  dragHandleIds = p?.kind === 'point' ? handleIdsForAnchor(id) : []
  dragLast = p?.kind === 'point' ? { x: p.x, y: p.y } : null
  ev.stopPropagation()
}
function onPointerUpPoint(id: EntityId, ev: PointerEvent) {
  // a click without a drag toggles selection
  if (tool.value === 'select' && dragId === id && !moved) { pick(id); ev.stopPropagation() }
  dragId = null; dragHandleIds = []; dragLast = null
}
function entityPathScreen(id: EntityId): string {
  return entityPath(shadowDoc.value, id)
}
function onPointerDownSvg(ev: PointerEvent) {
  if (tool.value === 'select') return
  const { x, y } = svgXY(ev)
  if (tool.value === 'path') { pathDown(x, y); return }
  place(x, y)
}
function onPointerMove(ev: PointerEvent) {
  if (tool.value === 'path') {
    // always track too — drives the rubber-band hover preview even when not
    // mid-drag, and the live bow while pathDrag is active
    const { x, y } = svgXY(ev)
    pathMove(x, y)
    return
  }
  if (!dragId || ev.buttons === 0) return
  const { x, y } = svgXY(ev)
  moved = true
  if (dragHandleIds.length && dragLast) {
    const dx = x - dragLast.x, dy = y - dragLast.y
    for (const hid of dragHandleIds) {
      const h = doc.value.entities.find(e => e.id === hid) as any
      if (h && h.kind === 'point') { h.x += dx; h.y += dy }
    }
    dragLast = { x, y }
  }
  runSolve({ point: dragId, x, y })
}
function onPointerUp(ev: PointerEvent) {
  if (tool.value === 'path' && pathDrag) {
    const { x, y } = svgXY(ev)
    pathUp(x, y)
    return
  }
  dragId = null; dragHandleIds = []; dragLast = null
}
function onPointerLeaveSvg(ev: PointerEvent) {
  onPointerUp(ev)
  cursor.value = null
}

// an abandoned path draw (tool switched away, or reset, before it was
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
  pathDrag = null
  cursor.value = null
}

function reset() {
  cleanupPendingPath()
  doc.value = { entities: [], constraints: [] }
  pending.value = null
  pendingPath.value = null
  pathDrag = null
  cursor.value = null
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
    pathDown: (x: number, y: number) => pathDown(x, y),
    pathMove: (x: number, y: number) => pathMove(x, y),
    pathUp: (x: number, y: number) => pathUp(x, y),
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
      <button v-for="t in (['select','point','line','circle','path'] as Tool[])" :key="t"
              :data-tool="t" @click="() => selectTool(t)"
              :style="{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #333', cursor: 'pointer',
                        background: tool === t ? '#2563eb' : '#1a1a1a', color: '#fff' }">{{ t }}</button>
      <button data-act="reset" @click="reset" style="padding: 4px 10px; border-radius: 6px; border: 1px solid #333; background: #1a1a1a; color: #fff; cursor: pointer">reset</button>
      <span data-status style="margin-left: 8px; font-size: 12px; color: #9ca3af">{{ status }}</span>
    </div>
    <div v-if="tool === 'path'" style="display: flex; gap: 6px; margin-bottom: 8px; align-items: center">
      <span style="font-size: 12px; color: #9ca3af">click to place a point — drag before releasing to curve the segment into an arc; click the first point to close</span>
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
         @pointerdown="onPointerDownSvg" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointerleave="onPointerLeaveSvg">
      <path :d="pathScreen" fill="none" stroke="#3730a3" stroke-width="1.5" />
      <path :d="constructionScreen" fill="none" stroke="#9ca3af" stroke-width="1.5" stroke-dasharray="4 3" />
      <template v-for="e in doc.entities" :key="'hit-' + e.id">
        <path v-if="e.kind !== 'point'" :d="entityPathScreen(e.id)" fill="none" stroke="transparent" stroke-width="12"
              :style="{ cursor: 'pointer' }" @pointerdown="(ev) => { if (tool==='select') { pick(e.id); ev.stopPropagation() } }" :data-ent="e.id" />
        <path v-if="e.kind !== 'point' && selection.includes(e.id)" :d="entityPathScreen(e.id)" fill="none" stroke="#f59e0b" stroke-width="2.5" pointer-events="none" />
      </template>
      <path v-if="previewD" :d="previewD" fill="none" stroke="#6366f1" stroke-width="1.5" stroke-dasharray="5 3"
            pointer-events="none" data-path-preview />
      <circle v-for="p in pts" :key="p.id" :cx="sx(p.x)" :cy="sy(p.y)" r="6"
              :fill="selection.includes(p.id) ? '#f59e0b' : (p.fixed ? '#9ca3af' : '#2563eb')"
              :style="{ cursor: tool === 'select' ? 'grab' : 'crosshair' }"
              @pointerdown="(e) => onPointerDownPoint(p.id, e)" @pointerup="(e) => onPointerUpPoint(p.id, e)" :data-point="p.id" />
      <g v-for="m in marks" :key="m.id" pointer-events="none">
        <rect :x="sx(m.x) + 6" :y="sy(m.y) - 16" :width="m.text ? 30 : 16" height="14" rx="3" fill="#111827" opacity="0.85" />
        <text :x="sx(m.x) + 9" :y="sy(m.y) - 5" fill="#e5e7eb" font-size="10" font-family="ui-monospace, monospace">{{ m.glyph }}{{ m.text ? ' ' + m.text : '' }}</text>
      </g>
      <g v-for="m in arcDims" :key="m.id" pointer-events="none">
        <rect :x="sx(m.x) + 6" :y="sy(m.y) - 16" width="34" height="14" rx="3" fill="#111827" opacity="0.85" />
        <text :x="sx(m.x) + 9" :y="sy(m.y) - 5" fill="#e5e7eb" font-size="10" font-family="ui-monospace, monospace">{{ m.text }}</text>
      </g>
      <g v-if="pathBowChip" pointer-events="none">
        <rect :x="pathBowChip.x - 18" :y="pathBowChip.y - 20" width="40" height="14" rx="3" fill="#111827" opacity="0.85" />
        <text :x="pathBowChip.x - 15" :y="pathBowChip.y - 9" fill="#e5e7eb" font-size="10" font-family="ui-monospace, monospace">{{ pathBowChip.text }}</text>
      </g>
      <g v-if="pathBowChip && pathBowChip.snappedTangent" pointer-events="none">
        <rect :x="pathBowChip.jointX + 6" :y="pathBowChip.jointY - 16" width="16" height="14" rx="3" fill="#111827" opacity="0.85" />
        <text :x="pathBowChip.jointX + 9" :y="pathBowChip.jointY - 5" fill="#e5e7eb" font-size="10" font-family="ui-monospace, monospace">T</text>
      </g>
    </svg>
    <p style="font-size: 12px; color: #6b7280; margin-top: 8px">
      Pick a tool. Point/Line/Circle click to place (snaps to nearby geometry). Path click to chain anchors, drag before releasing to bow a segment into an arc, click the first anchor to close. Select drags points; the drawing re-solves.
    </p>
  </div>
</template>
