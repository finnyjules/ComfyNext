/**
 * Reusable inline editing engine for a Compositor/Frame's local layers
 * (text / shapes / images). Drives both the modal and on-canvas (Frame) editing.
 *
 * All pointer math is done against the canvas element's *screen* rect, so it is
 * zoom-agnostic: a Frame on the Vue Flow canvas (scaled by zoom) and the modal
 * (zoom 1) share the same code. Handle/SVG positions are returned in *logical*
 * canvas coords (0..dims), which scale correctly because they live inside the
 * (possibly zoomed) artboard element.
 */
import {
  type LocalLayer, type TextLayer, type RectLayer, type LineLayer, type PathLayer,
  createTextLayer, createRectLayer, createEllipseLayer, createLineLayer, createImageLayer,
  localLayerBox, shapeToPathLayer,
} from '~/composables/useCompositorLayers'
import { svgToPathLayers, pathLayerBoolean, type BooleanOp } from '~/composables/useVectorSvg'

interface EditorOpts {
  node: () => any                       // the compositor node (reactive)
  dims: () => { w: number; h: number }  // logical artboard size
  getRect: () => DOMRect | null         // canvas element's on-screen rect
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)) }

let _scratch: CanvasRenderingContext2D | null = null
function scratchCtx(): CanvasRenderingContext2D | null {
  if (!_scratch && typeof document !== 'undefined') _scratch = document.createElement('canvas').getContext('2d')
  return _scratch
}

export function useLocalLayerEditor(opts: EditorOpts) {
  const { node, dims, getRect } = opts

  const localLayers = computed<LocalLayer[]>(() =>
    (node()?.data?.properties?.comfynext_localLayers as LocalLayer[]) ?? [])

  function commit(next: LocalLayer[]) {
    const n = node(); if (!n) return
    if (!n.data.properties) n.data.properties = {}
    n.data.properties.comfynext_localLayers = next
  }

  // ── Undo / redo (snapshot history over local layers) ────────────────────────
  // The editor is the single mutation choke point, so one history stack here
  // covers every vector edit. Discrete ops record before mutating; a drag
  // records once at pointer-down (coalesced) so it's a single undo step.
  const HISTORY_CAP = 120
  const _past = ref<LocalLayer[][]>([])
  const _future = ref<LocalLayer[][]>([])
  function snapshot(): LocalLayer[] { return JSON.parse(JSON.stringify(localLayers.value)) }
  function recordHistory() {
    _past.value.push(snapshot())
    if (_past.value.length > HISTORY_CAP) _past.value.shift()
    _future.value = []
  }
  const canUndo = computed(() => _past.value.length > 0)
  const canRedo = computed(() => _future.value.length > 0)
  function undo() {
    if (!_past.value.length) return
    _future.value.push(snapshot())
    commit(_past.value.pop()!)
    if (selectedId.value && !localLayers.value.some(l => l.id === selectedId.value)) selectedId.value = null
  }
  function redo() {
    if (!_future.value.length) return
    _past.value.push(snapshot())
    commit(_future.value.pop()!)
    if (selectedId.value && !localLayers.value.some(l => l.id === selectedId.value)) selectedId.value = null
  }

  function setLocal(id: string, patch: Record<string, any>) {
    if (!drag.value) recordHistory() // drags record once at pointer-down
    commit(localLayers.value.map(l => (l.id === id ? { ...l, ...patch } as LocalLayer : l)))
  }
  function addLocal(layer: LocalLayer) { recordHistory(); commit([...localLayers.value, layer]); selectLocal(layer.id) }
  function deleteLocal(id: string) {
    recordHistory()
    commit(localLayers.value.filter(l => l.id !== id))
    if (selectedId.value === id) selectedId.value = null
  }
  /** Delete many layers in one history step (e.g. a whole group). */
  function deleteLayers(ids: string[]) {
    if (!ids.length) return
    recordHistory()
    const set = new Set(ids)
    commit(localLayers.value.filter(l => !set.has(l.id)))
    if (selectedId.value && set.has(selectedId.value)) selectLocal(null)
  }
  function moveLocalZ(id: string, dir: -1 | 1) {
    const arr = [...localLayers.value]
    const i = arr.findIndex(l => l.id === id); const j = i + dir
    if (i < 0 || j < 0 || j >= arr.length) return
    recordHistory()
    ;[arr[i], arr[j]] = [arr[j], arr[i]]; commit(arr)
  }

  // ── Selection / editing state ──────────────────────────────────────────────
  const selectedId = ref<string | null>(null)
  const selected = computed(() => localLayers.value.find(l => l.id === selectedId.value) ?? null)
  // Multi-selection (superset of selectedId) for booleans / group / align.
  const selectedIds = ref<Set<string>>(new Set())
  /** All layer ids in the same group as `id` (just `id` if ungrouped). */
  function groupSiblings(id: string): string[] {
    const l = localLayers.value.find(x => x.id === id)
    if (!l?.groupId) return [id]
    return localLayers.value.filter(x => x.groupId === l.groupId).map(x => x.id)
  }
  function selectLocal(id: string | null) {
    selectedId.value = id
    selectedIds.value = id ? new Set(groupSiblings(id)) : new Set() // selecting a grouped layer selects the group
  }
  /** Shift-click: toggle `id` (and its group) in the multi-selection. */
  function toggleSelect(id: string) {
    const sibs = groupSiblings(id)
    const s = new Set(selectedIds.value)
    if (s.has(id)) { for (const x of sibs) s.delete(x); if (sibs.includes(selectedId.value!)) selectedId.value = [...s][s.size - 1] ?? null }
    else { for (const x of sibs) s.add(x); selectedId.value = id }
    selectedIds.value = s
  }
  let _groupSeq = 0
  /** Group the current multi-selection (≥2 layers) under one groupId. */
  function groupSelected() {
    const ids = [...selectedIds.value]
    if (ids.length < 2) return
    const gid = `g-${Date.now().toString(36)}-${++_groupSeq}`
    recordHistory()
    commit(localLayers.value.map(l => (selectedIds.value.has(l.id) ? { ...l, groupId: gid } as LocalLayer : l)))
  }
  /** Rename a group: mirror the name onto every member layer. */
  function renameGroup(groupId: string, name: string) {
    recordHistory()
    const nm = name.trim()
    commit(localLayers.value.map(l => (l.groupId === groupId
      ? { ...l, groupName: nm || undefined } as LocalLayer : l)))
  }
  /** Ungroup: clear groupId on the selected layers. */
  function ungroupSelected() {
    if (!selectedIds.value.size) return
    recordHistory()
    commit(localLayers.value.map(l => {
      if (!selectedIds.value.has(l.id) || !l.groupId) return l
      const { groupId: _drop, ...rest } = l as any
      return rest as LocalLayer
    }))
  }
  const canGroup = computed(() => selectedIds.value.size >= 2)
  const canUngroup = computed(() => selectedLayers.value.some(l => !!l.groupId))
  const selectedLayers = computed(() =>
    localLayers.value.filter(l => selectedIds.value.has(l.id))) // preserves z-order
  const editingId = ref<string | null>(null)
  const editingLayer = computed(() =>
    localLayers.value.find(l => l.id === editingId.value && l.kind === 'text') as TextLayer | undefined)
  function beginEdit(id: string) { selectLocal(id); editingId.value = id }
  function endEdit() { editingId.value = null }

  // ── Geometry ────────────────────────────────────────────────────────────────
  function boxPx(layer: LocalLayer) { return localLayerBox(scratchCtx(), layer, dims().w, dims().h) }

  function boxHandles(cx: number, cy: number, hw: number, hh: number, rotationDeg: number) {
    const rad = (rotationDeg * Math.PI) / 180
    const cosA = Math.cos(rad), sinA = Math.sin(rad)
    const t = (dx: number, dy: number) => ({ x: cx + dx * cosA - dy * sinA, y: cy + dx * sinA + dy * cosA })
    return {
      tl: t(-hw, -hh), tr: t(hw, -hh), br: t(hw, hh), bl: t(-hw, hh),
      rot: t(0, -hh - 26), topCenter: t(0, -hh), center: { x: cx, y: cy },
    }
  }
  const handlePositions = computed(() => {
    const l = selected.value
    if (!l) return null
    const b = boxPx(l)
    return boxHandles(l.x * dims().w, l.y * dims().h, b.w / 2, b.h / 2, l.rotation)
  })

  // ── Align / distribute (operates on the multi-selection) ────────────────────
  type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom' | 'hdist' | 'vdist'
  function alignSelected(mode: AlignMode) {
    const sel = selectedLayers.value
    if (sel.length < 2) return
    const W = dims().w, H = dims().h
    // Per-layer extents in normalized coords (x of width, y of height).
    const ext = sel.map(l => {
      const b = boxPx(l)
      return { l, hx: b.w / 2 / W, hy: b.h / 2 / H }
    })
    recordHistory()
    const patch = (id: string, p: Record<string, number>) =>
      commit(localLayers.value.map(x => (x.id === id ? { ...x, ...p } as LocalLayer : x)))
    if (mode === 'left') { const t = Math.min(...ext.map(e => e.l.x - e.hx)); for (const e of ext) patch(e.l.id, { x: t + e.hx }) }
    else if (mode === 'right') { const t = Math.max(...ext.map(e => e.l.x + e.hx)); for (const e of ext) patch(e.l.id, { x: t - e.hx }) }
    else if (mode === 'hcenter') { const lo = Math.min(...ext.map(e => e.l.x - e.hx)), hi = Math.max(...ext.map(e => e.l.x + e.hx)); const c = (lo + hi) / 2; for (const e of ext) patch(e.l.id, { x: c }) }
    else if (mode === 'top') { const t = Math.min(...ext.map(e => e.l.y - e.hy)); for (const e of ext) patch(e.l.id, { y: t + e.hy }) }
    else if (mode === 'bottom') { const t = Math.max(...ext.map(e => e.l.y + e.hy)); for (const e of ext) patch(e.l.id, { y: t - e.hy }) }
    else if (mode === 'vcenter') { const lo = Math.min(...ext.map(e => e.l.y - e.hy)), hi = Math.max(...ext.map(e => e.l.y + e.hy)); const c = (lo + hi) / 2; for (const e of ext) patch(e.l.id, { y: c }) }
    else if (mode === 'hdist' && sel.length >= 3) {
      const s = [...ext].sort((a, b) => a.l.x - b.l.x)
      const lo = s[0].l.x, hi = s[s.length - 1].l.x, step = (hi - lo) / (s.length - 1)
      s.forEach((e, i) => patch(e.l.id, { x: lo + step * i }))
    } else if (mode === 'vdist' && sel.length >= 3) {
      const s = [...ext].sort((a, b) => a.l.y - b.l.y)
      const lo = s[0].l.y, hi = s[s.length - 1].l.y, step = (hi - lo) / (s.length - 1)
      s.forEach((e, i) => patch(e.l.id, { y: lo + step * i }))
    }
  }

  // ── Pointer interaction (zoom-agnostic via screen rect) ─────────────────────
  type Drag =
    | { type: 'move'; id: string; sx: number; sy: number; origins: { id: string; ox: number; oy: number }[] }
    | { type: 'scale'; id: string; cx: number; cy: number; startDist: number; start: Record<string, number> }
    | { type: 'rotate'; id: string; cx: number; cy: number; startAngle: number; startRot: number }
    | null
  const drag = ref<Drag>(null)
  // Active snap guide lines (normalized positions) shown while moving.
  const snapGuides = ref<{ vx: number | null; hy: number | null }>({ vx: null, hy: null })
  const SNAP_PX = 6 // snap distance threshold in screen pixels

  // screen px → normalized [0,1] within the artboard
  function toNorm(clientX: number, clientY: number, r: DOMRect) {
    return { nx: (clientX - r.left) / r.width, ny: (clientY - r.top) / r.height }
  }

  function hitTest(clientX: number, clientY: number): string | null {
    const r = getRect(); if (!r) return null
    const { nx, ny } = toNorm(clientX, clientY, r)
    const W = dims().w, H = dims().h
    const px = nx * W, py = ny * H
    for (let i = localLayers.value.length - 1; i >= 0; i--) {
      const l = localLayers.value[i]
      const b = boxPx(l)
      const cx = l.x * W, cy = l.y * H
      const rad = (-l.rotation * Math.PI) / 180
      const dx = px - cx, dy = py - cy
      const lx = dx * Math.cos(rad) - dy * Math.sin(rad)
      const ly = dx * Math.sin(rad) + dy * Math.cos(rad)
      const pad = 8
      if (Math.abs(lx) <= b.w / 2 + pad && Math.abs(ly) <= b.h / 2 + pad) return l.id
    }
    return null
  }

  function startMove(id: string, e: PointerEvent) {
    const l = localLayers.value.find(x => x.id === id); if (!l) return
    recordHistory() // coalesce the whole drag into one undo step
    // Move the whole selection (group) together when dragging within it.
    const moveIds = selectedIds.value.has(id) ? [...selectedIds.value] : [id]
    const origins = moveIds
      .map(mid => { const m = localLayers.value.find(x => x.id === mid); return m ? { id: mid, ox: m.x, oy: m.y } : null })
      .filter(Boolean) as { id: string; ox: number; oy: number }[]
    drag.value = { type: 'move', id, sx: e.clientX, sy: e.clientY, origins }
    attach()
  }

  /** Snap the primary layer's edges/center to other layers + canvas center.
   *  Returns adjusted (dx,dy) and sets the visible guide lines. */
  function applySnap(primaryId: string, ox: number, oy: number, dx: number, dy: number) {
    const W = dims().w, H = dims().h
    const prim = localLayers.value.find(l => l.id === primaryId)
    if (!prim) return { dx, dy }
    const b = boxPx(prim); const hx = b.w / 2 / W, hy = b.h / 2 / H
    const cx = ox + dx, cy = oy + dy
    const movingIds = new Set((drag.value as any)?.origins?.map((o: any) => o.id) ?? [primaryId])
    // Target lines from non-moving layers (left/center/right, top/middle/bottom) + canvas center.
    const xt: number[] = [0.5], yt: number[] = [0.5]
    for (const l of localLayers.value) {
      if (movingIds.has(l.id)) continue
      const lb = boxPx(l); const lhx = lb.w / 2 / W, lhy = lb.h / 2 / H
      xt.push(l.x - lhx, l.x, l.x + lhx); yt.push(l.y - lhy, l.y, l.y + lhy)
    }
    const tx = SNAP_PX / W, ty = SNAP_PX / H
    let bestX = { d: tx, adj: 0, guide: null as number | null }
    for (const edge of [cx - hx, cx, cx + hx]) for (const t of xt) {
      const dd = Math.abs(edge - t); if (dd < bestX.d) bestX = { d: dd, adj: t - edge, guide: t }
    }
    let bestY = { d: ty, adj: 0, guide: null as number | null }
    for (const edge of [cy - hy, cy, cy + hy]) for (const t of yt) {
      const dd = Math.abs(edge - t); if (dd < bestY.d) bestY = { d: dd, adj: t - edge, guide: t }
    }
    snapGuides.value = { vx: bestX.guide, hy: bestY.guide }
    return { dx: dx + bestX.adj, dy: dy + bestY.adj }
  }
  function startScale(e: PointerEvent) {
    e.preventDefault(); e.stopPropagation()
    const l = selected.value; const r = getRect(); if (!l || !r) return
    const cx = r.left + l.x * r.width, cy = r.top + l.y * r.height
    const start: Record<string, number> = {}
    if (l.kind === 'text') start.fontSize = (l as TextLayer).fontSize
    else if (l.kind === 'line') start.w = (l as LineLayer).w
    else if (l.kind === 'path') start.scale = (l as PathLayer).scale
    else { start.w = (l as RectLayer).w; start.h = (l as RectLayer).h }
    recordHistory()
    drag.value = { type: 'scale', id: l.id, cx, cy, startDist: Math.max(1, Math.hypot(e.clientX - cx, e.clientY - cy)), start }
    attach()
  }
  function startRotate(e: PointerEvent) {
    e.preventDefault(); e.stopPropagation()
    const l = selected.value; const r = getRect(); if (!l || !r) return
    const cx = r.left + l.x * r.width, cy = r.top + l.y * r.height
    recordHistory()
    drag.value = { type: 'rotate', id: l.id, cx, cy, startAngle: Math.atan2(e.clientY - cy, e.clientX - cx), startRot: l.rotation }
    attach()
  }
  function onMove(e: PointerEvent) {
    const d = drag.value; if (!d) return
    const r = getRect(); if (!r) return
    if (d.type === 'move') {
      const prim = d.origins.find(o => o.id === d.id) ?? d.origins[0]
      let dx = (e.clientX - d.sx) / r.width, dy = (e.clientY - d.sy) / r.height
      if (!e.altKey && prim) ({ dx, dy } = applySnap(prim.id, prim.ox, prim.oy, dx, dy)) // Alt disables snap
      else snapGuides.value = { vx: null, hy: null }
      const map = new Map(d.origins.map(o => [o.id, o]))
      commit(localLayers.value.map(l => {
        const o = map.get(l.id)
        return o ? { ...l, x: clamp(o.ox + dx, -0.5, 1.5), y: clamp(o.oy + dy, -0.5, 1.5) } as LocalLayer : l
      }))
    } else if (d.type === 'scale') {
      const ratio = Math.max(0.05, Math.hypot(e.clientX - d.cx, e.clientY - d.cy) / d.startDist)
      const patch: Record<string, number> = {}
      for (const k in d.start) patch[k] = clamp(d.start[k] * ratio, 0.002, 4)
      setLocal(d.id, patch)
    } else if (d.type === 'rotate') {
      let rot = d.startRot + ((Math.atan2(e.clientY - d.cy, e.clientX - d.cx) - d.startAngle) * 180) / Math.PI
      while (rot > 180) rot -= 360
      while (rot < -180) rot += 360
      setLocal(d.id, { rotation: Math.round(rot) })
    }
  }
  function onUp() { drag.value = null; snapGuides.value = { vx: null, hy: null }; window.removeEventListener('pointermove', onMove) }

  // ── Marquee (rubber-band) selection ─────────────────────────────────────────
  const marquee = ref<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  function startMarquee(nx: number, ny: number) { marquee.value = { x0: nx, y0: ny, x1: nx, y1: ny } }
  function moveMarquee(nx: number, ny: number) { if (marquee.value) marquee.value = { ...marquee.value, x1: nx, y1: ny } }
  function endMarquee(additive = false) {
    const m = marquee.value; marquee.value = null
    if (!m) return
    const lo = { x: Math.min(m.x0, m.x1), y: Math.min(m.y0, m.y1) }
    const hi = { x: Math.max(m.x0, m.x1), y: Math.max(m.y0, m.y1) }
    if (hi.x - lo.x < 0.005 && hi.y - lo.y < 0.005) return // a click, not a drag
    const hits = localLayers.value.filter(l => l.x >= lo.x && l.x <= hi.x && l.y >= lo.y && l.y <= hi.y)
    const ids = new Set(additive ? selectedIds.value : [])
    for (const l of hits) for (const sib of groupSiblings(l.id)) ids.add(sib)
    selectedIds.value = ids
    selectedId.value = hits.length ? hits[hits.length - 1].id : (additive ? selectedId.value : null)
  }
  function attach() {
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
  }

  // Consumer binds these to the artboard element (capture phase recommended so
  // it wins over node-drag). Returns true if it handled (hit a layer).
  function onCanvasPointerDown(e: PointerEvent): boolean {
    if ((e.target as HTMLElement)?.closest?.('[data-handle]')) return true
    const id = hitTest(e.clientX, e.clientY)
    if (id) {
      e.preventDefault(); e.stopPropagation()
      if (e.shiftKey) { toggleSelect(id); return true } // add/remove from multi-selection
      if (!selectedIds.value.has(id)) selectLocal(id)    // keep group if clicking within it
      else selectedId.value = id
      startMove(id, e)
      return true
    }
    selectedId.value = null; selectedIds.value = new Set()
    return false
  }
  function onCanvasDblClick(e: MouseEvent): boolean {
    const id = hitTest(e.clientX, e.clientY)
    if (!id) return false
    const l = localLayers.value.find(x => x.id === id)
    if (l?.kind === 'text') { e.preventDefault(); e.stopPropagation(); beginEdit(id); return true }
    return false
  }

  onScopeDispose(() => window.removeEventListener('pointermove', onMove))

  // ── Factories ────────────────────────────────────────────────────────────--
  function addText() { const l = createTextLayer(); addLocal(l); nextTick(() => beginEdit(l.id)); return l }
  function addRect() { addLocal(createRectLayer()) }
  function addEllipse() { addLocal(createEllipseLayer()) }
  function addLine() { addLocal(createLineLayer()) }
  async function addImageFromFile(file: File) {
    if (!file.type.startsWith('image/')) return
    const ts = Date.now()
    const safe = `frame_${ts}_${(file.name || 'image.png').replace(/[^\w.-]+/g, '_')}`
    const fd = new FormData()
    fd.append('image', new File([file], safe, { type: file.type }))
    fd.append('overwrite', 'true')
    const res = await fetch('/upload/image', { method: 'POST', body: fd })
    if (!res.ok) throw new Error(`upload ${res.status}`)
    const name = (await res.json())?.name || safe
    const aspect = await new Promise<number>((resolve) => {
      const im = new Image()
      im.onload = () => resolve(im.naturalWidth && im.naturalHeight ? im.naturalWidth / im.naturalHeight : 1)
      im.onerror = () => resolve(1)
      im.src = `/view?${new URLSearchParams({ filename: name, type: 'input' })}`
    })
    addLocal(createImageLayer(name, aspect))
  }

  // Add an image layer from an already-uploaded input name (e.g. a generative-
  // fill result), with optional transform overrides (x/y/w/h).
  function addImageFromName(name: string, aspect = 1, partial: Partial<LocalLayer> = {}) {
    addLocal(createImageLayer(name, aspect, partial as any))
  }

  // Insert pre-built path layers (e.g. from SVG import / pen tool / AI vector).
  // All layers from one import are added together; the topmost is selected.
  function addPathLayers(layers: PathLayer[]) {
    if (!layers.length) return
    recordHistory()
    // Auto-group a multi-path import (e.g. an SVG) so it lists and moves as one
    // unit instead of flooding the layer panel with dozens of loose paths.
    if (layers.length > 1) {
      const gid = `g-${Date.now().toString(36)}-${++_groupSeq}`
      for (const l of layers) (l as any).groupId = gid
    }
    commit([...localLayers.value, ...layers])
    selectLocal(layers[layers.length - 1].id)
  }
  /** Parse an SVG string and add it as path layer(s), centered on the artboard. */
  async function addPathFromSvg(svg: string, opts: { targetWidth?: number; cx?: number; cy?: number } = {}) {
    const layers = await svgToPathLayers(svg, opts)
    addPathLayers(layers)
    return layers
  }

  /**
   * Apply a boolean op to the selected path layers (≥2). Replaces the operands
   * with a single result layer at the topmost operand's z-position.
   */
  async function applyBoolean(op: BooleanOp): Promise<boolean> {
    // Operate on any closed-outline shapes; convert rect/ellipse/line → path so
    // they can boolean with real paths. Keep the originals (with their ids) for
    // removal, and z-order is preserved (selectedLayers is z-ordered).
    const originals = selectedLayers.value.filter(l => l.kind === 'path' || l.kind === 'rect' || l.kind === 'ellipse' || l.kind === 'line')
    if (originals.length < 2) return false
    const operands = originals.map(l => shapeToPathLayer(l)).filter(Boolean) as PathLayer[]
    if (operands.length < 2) return false
    const result = await pathLayerBoolean(operands, op, dims())
    if (!result) return false
    const operandIds = new Set(originals.map(o => o.id))
    const arr = localLayers.value
    const topIdx = Math.max(...arr.map((l, i) => (operandIds.has(l.id) ? i : -1)))
    const next = arr.filter(l => !operandIds.has(l.id))
    next.splice(Math.min(topIdx - (operands.length - 1), next.length), 0, result)
    recordHistory()
    commit(next)
    selectLocal(result.id)
    return true
  }

  return {
    localLayers, selectedId, selected, selectLocal,
    setLocal, addLocal, deleteLocal, moveLocalZ,
    editingId, editingLayer, beginEdit, endEdit,
    boxPx, handlePositions,
    hitTest, startScale, startRotate,
    onCanvasPointerDown, onCanvasDblClick,
    addText, addRect, addEllipse, addLine, addImageFromFile, addImageFromName,
    addPathLayers, addPathFromSvg, deleteLayers, commit, recordHistory,
    undo, redo, canUndo, canRedo,
    selectedIds, selectedLayers, toggleSelect, applyBoolean, alignSelected,
    groupSelected, ungroupSelected, renameGroup, canGroup, canUngroup,
    snapGuides, marquee, startMarquee, moveMarquee, endMarquee,
  }
}
