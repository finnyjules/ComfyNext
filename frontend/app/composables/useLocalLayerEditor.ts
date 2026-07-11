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
  type LocalLayer, type TextLayer, type RectLayer, type LineLayer, type PathLayer, type Paint,
  createTextLayer, createRectLayer, createEllipseLayer, createLineLayer, createImageLayer,
  createPolygonLayer, createStarLayer,
  localLayerBox, shapeToPathLayer,
} from '~/composables/useCompositorLayers'
import { svgToPathLayers, pathLayerBoolean, type BooleanOp } from '~/composables/useVectorSvg'
import {
  type LayerGroup, topGroupOf, layersInGroup, ancestorsOf, isDescendantOrSelf,
  createGroupFromSelection, dissolveGroup as dissolveGroupOp, renameGroup as renameGroupOp,
  reparentGroup as reparentGroupOp, pruneEmptyGroups, resolveGroupCascade, upsertGroup,
} from '~/lib/compositor/layerGroups'
import { nudgeLayers, duplicateLayers, snapAngle, computeSnapAdjust, mapKeyToEdit, dragHud } from '~/lib/compositor/layerEdits'
import { extractForCopy, materializePaste, setClipboard, getClipboard, hasClipboard } from '~/lib/compositor/layerClipboard'
import { resizeBox, type Handle, type Box } from '~/lib/compositor/resizeBox'
import { unionBox, cornerOf, anchorOf, groupScaleFactor, scaleLayerAbout, type Handle as GHandle, type Box as GBox } from '~/lib/compositor/groupResize'
import { inject, type Ref } from 'vue'
import type { BrandKit } from '~~/shared/brand/types'

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

/** Box layers (independent width+height) get full Figma resize; text/line/path
 *  keep uniform corner scaling (no 2D box to resize). */
export function resizableKind(kind: string): boolean {
  return kind === 'rect' || kind === 'ellipse' || kind === 'image' || kind === 'polygon' || kind === 'star'
}

/** Compute handle positions (corners, edges, rotation, center) from box geometry
 *  and rotation. All positions are rotated and translated to world space. */
export function boxHandles(cx: number, cy: number, hw: number, hh: number, rotationDeg: number) {
  const rad = (rotationDeg * Math.PI) / 180
  const cosA = Math.cos(rad), sinA = Math.sin(rad)
  const t = (dx: number, dy: number) => ({ x: cx + dx * cosA - dy * sinA, y: cy + dx * sinA + dy * cosA })
  return {
    tl: t(-hw, -hh), tr: t(hw, -hh), br: t(hw, hh), bl: t(-hw, hh),
    t: t(0, -hh), r: t(hw, 0), b: t(0, hh), l: t(-hw, 0),
    rot: t(0, -hh - 26), topCenter: t(0, -hh), center: { x: cx, y: cy },
  }
}

export function useLocalLayerEditor(opts: EditorOpts) {
  const { node, dims, getRect } = opts

  // Active brand kit → font default for new text layers. Optional: the
  // editor also runs in dev labs with no project shell above it.
  const projectBrand = inject<{ activeKit: Ref<BrandKit | undefined> } | null>('sailor:brand', null)

  const localLayers = computed<LocalLayer[]>(() =>
    (node()?.data?.properties?.sailor_localLayers as LocalLayer[]) ?? [])

  function commit(next: LocalLayer[]) {
    const n = node(); if (!n) return
    if (!n.data.properties) n.data.properties = {}
    n.data.properties.sailor_localLayers = next
  }
  // The unified z-order (wired + local StackKeys) lives alongside the layers;
  // history captures it too so reorders/grouping undo cleanly.
  function readOrder(): string[] { return ((node()?.data?.properties as any)?.sailor_stackOrder as string[]) ?? [] }
  function writeOrder(order: string[]) {
    const n = node(); if (!n) return
    if (!n.data.properties) n.data.properties = {}
    ;(n.data.properties as any).sailor_stackOrder = order
  }

  // Nested-group registry: LayerGroup { id, name?, parentId? } describing the
  // group tree. Layers keep their flat `groupId` (immediate group); this only
  // adds parent links + names. Absent ⇒ every group is a flat root (old frames).
  const localGroups = computed<LayerGroup[]>(() =>
    ((node()?.data?.properties as any)?.sailor_localGroups as LayerGroup[]) ?? [])
  function writeGroups(next: LayerGroup[]) {
    const n = node(); if (!n) return
    if (!n.data.properties) n.data.properties = {}
    ;(n.data.properties as any).sailor_localGroups = next
  }
  /** Commit layers + registry together (registry pruned of empty groups). */
  function commitBoth(nextLayers: LocalLayer[], nextGroups: LayerGroup[]) {
    commit(nextLayers)
    writeGroups(pruneEmptyGroups(nextLayers, nextGroups))
  }

  // Doc-level background fill (behind every layer; baked into output).
  const background = computed<Paint | undefined>(() => (node()?.data?.properties as any)?.sailor_localBg as Paint | undefined)
  function writeBg(p: Paint | undefined) {
    const n = node(); if (!n) return
    if (!n.data.properties) n.data.properties = {}
    if (p === undefined || p === 'none' || p === '') delete (n.data.properties as any).sailor_localBg
    else (n.data.properties as any).sailor_localBg = p
  }
  function setBackground(p: Paint | undefined) { recordHistory(); writeBg(p) }

  // ── Undo / redo (snapshot history over local layers + z-order) ──────────────
  // The editor is the single mutation choke point, so one history stack here
  // covers every vector edit. Discrete ops record before mutating; a drag
  // records once at pointer-down (coalesced) so it's a single undo step.
  type Snapshot = { layers: LocalLayer[]; order: string[]; bg: Paint | undefined; groups: LayerGroup[] }
  const HISTORY_CAP = 120
  const _past = ref<Snapshot[]>([])
  const _future = ref<Snapshot[]>([])
  function snapshot(): Snapshot { return { layers: JSON.parse(JSON.stringify(localLayers.value)), order: [...readOrder()], bg: background.value, groups: JSON.parse(JSON.stringify(localGroups.value)) } }
  function restore(s: Snapshot) { commit(s.layers); writeOrder([...s.order]); writeBg(s.bg); writeGroups([...s.groups]) }
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
    restore(_past.value.pop()!)
    if (selectedId.value && !localLayers.value.some(l => l.id === selectedId.value)) selectedId.value = null
  }
  function redo() {
    if (!_future.value.length) return
    _past.value.push(snapshot())
    restore(_future.value.pop()!)
    if (selectedId.value && !localLayers.value.some(l => l.id === selectedId.value)) selectedId.value = null
  }

  function setLocal(id: string, patch: Record<string, any>) {
    if (!drag.value) recordHistory() // drags record once at pointer-down
    commit(localLayers.value.map(l => (l.id === id ? { ...l, ...patch } as LocalLayer : l)))
  }
  function addLocal(layer: LocalLayer) { recordHistory(); commit([...localLayers.value, layer]); selectLocal(layer.id) }
  function deleteLocal(id: string) {
    recordHistory()
    commitBoth(localLayers.value.filter(l => l.id !== id), localGroups.value)
    if (selectedId.value === id) selectedId.value = null
  }
  /** Delete many layers in one history step (e.g. a whole group). */
  function deleteLayers(ids: string[]) {
    if (!ids.length) return
    recordHistory()
    const set = new Set(ids)
    commitBoth(localLayers.value.filter(l => !set.has(l.id)), localGroups.value)
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
  /** Every layer id under the same OUTERMOST group as `id` (just `id` if
   *  ungrouped). Nesting-aware: clicking a nested layer selects the whole top
   *  group, matching Figma. For a flat (un-nested) group this is byte-identical
   *  to the old "same groupId" behavior. */
  function groupSiblings(id: string): string[] {
    const l = localLayers.value.find(x => x.id === id)
    if (!l?.groupId) return [id]
    const top = topGroupOf(l.groupId, localGroups.value)
    const ids = layersInGroup(top, localLayers.value, localGroups.value)
    return ids.length ? ids : [id]
  }
  function selectLocal(id: string | null) {
    selectedId.value = id
    selectedIds.value = id ? new Set(groupSiblings(id)) : new Set() // selecting a grouped layer selects the group
  }
  /** Select exactly one group's subtree (a specific level, not expanded to the
   *  outermost like a canvas click). Used by the layers panel. */
  function selectGroupById(groupId: string) {
    const ids = layersInGroup(groupId, localLayers.value, localGroups.value)
    if (!ids.length) return
    selectedIds.value = new Set(ids)
    selectedId.value = ids[ids.length - 1] ?? null
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
  let _dupSeq = 0
  /** Group the current multi-selection (≥2 layers). Fully-selected existing
   *  groups nest under the new group; loose layers become direct members. */
  function groupSelected() {
    if (selectedIds.value.size < 2) return
    const gid = `g-${Date.now().toString(36)}-${++_groupSeq}`
    recordHistory()
    const r = createGroupFromSelection(localLayers.value, localGroups.value, selectedIds.value, gid)
    commitBoth(r.layers as LocalLayer[], r.groups)
  }
  /** Rename a group (stored in the registry). */
  function renameGroup(groupId: string, name: string) {
    recordHistory()
    writeGroups(renameGroupOp(localGroups.value, groupId, name))
  }
  /** Per-layer display name (overrides the derived label in the panel). */
  const editingLayerNameId = ref<string | null>(null)
  const layerNameDraft = ref('')
  function setLayerName(id: string, name: string) {
    const nm = name.trim()
    recordHistory()
    commit(localLayers.value.map(l => (l.id === id ? ({ ...l, name: nm || undefined } as LocalLayer) : l)))
  }
  function startLayerRename(id: string) {
    editingLayerNameId.value = id
    const l = localLayers.value.find(x => x.id === id)
    layerNameDraft.value = (l as any)?.name ?? ''
  }
  function commitLayerRename() {
    if (editingLayerNameId.value) setLayerName(editingLayerNameId.value, layerNameDraft.value)
    editingLayerNameId.value = null
  }
  /** Set a group's own hidden flag (cascades to descendants via resolveGroupCascade). */
  function setGroupHidden(groupId: string, hidden: boolean) { recordHistory(); writeGroups(upsertGroup(localGroups.value, groupId, { hidden })) }
  /** Set a group's own locked flag (cascades to descendants via resolveGroupCascade). */
  function setGroupLocked(groupId: string, locked: boolean) { recordHistory(); writeGroups(upsertGroup(localGroups.value, groupId, { locked })) }
  /** Set a group's own opacity (multiplies with ancestors via resolveGroupCascade). */
  function setGroupOpacity(groupId: string, opacity: number) { recordHistory(); writeGroups(upsertGroup(localGroups.value, groupId, { opacity: Math.max(0, Math.min(1, opacity)) })) }
  /** Effective (cascaded) hidden/locked/opacity for a group, for the layers panel. */
  function groupCascade(groupId: string) { return resolveGroupCascade(groupId, localGroups.value) }
  /** Dissolve one specific group level (used by the layers panel). */
  function ungroupGroup(groupId: string) {
    recordHistory()
    const r = dissolveGroupOp(localLayers.value, localGroups.value, groupId)
    commitBoth(r.layers as LocalLayer[], r.groups)
  }
  /** Ungroup the outermost group(s) in the current selection. */
  function ungroupSelected() {
    const sel = selectedIds.value
    if (!sel.size) return
    const tops = new Set<string>()
    for (const l of localLayers.value) if (sel.has(l.id) && l.groupId) tops.add(topGroupOf(l.groupId, localGroups.value))
    if (!tops.size) return
    recordHistory()
    let L = localLayers.value as LocalLayer[]
    let G = localGroups.value
    for (const t of tops) { const r = dissolveGroupOp(L, G, t); L = r.layers as LocalLayer[]; G = r.groups }
    commitBoth(L, G)
    selectedIds.value = new Set([...sel].filter(id => L.some(l => l.id === id)))
  }
  /** Move a layer into `groupId` (or out to loose when undefined). Panel drag. */
  function setLayerGroup(layerId: string, groupId: string | undefined) {
    recordHistory()
    commitBoth(localLayers.value.map(l => (l.id === layerId ? { ...l, groupId } as LocalLayer : l)), localGroups.value)
  }
  /** Re-parent a group under `parentId` (root when undefined). Panel drag. */
  function setGroupParent(groupId: string, parentId: string | undefined) {
    if (parentId && isDescendantOrSelf(parentId, groupId, localGroups.value)) return // no cycles
    recordHistory()
    writeGroups(reparentGroupOp(localGroups.value, groupId, parentId))
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
  const handlePositions = computed(() => {
    const l = selected.value
    if (!l) return null
    const b = boxPx(l)
    return boxHandles(l.x * dims().w, l.y * dims().h, b.w / 2, b.h / 2, l.rotation)
  })

  /** Union box (px) of the current multi-selection (≥2), else null. */
  const selectionBox = computed<GBox | null>(() => {
    if (selectedIds.value.size < 2) return null
    const W = dims().w, H = dims().h
    const boxes = selectedLayers.value.map((l) => { const b = boxPx(l); return { cx: l.x * W, cy: l.y * H, w: b.w, h: b.h } })
    return boxes.length ? unionBox(boxes) : null
  })
  const selectionHandles = computed(() => {
    const b = selectionBox.value; if (!b) return null
    return { tl: cornerOf(b, 'tl'), tr: cornerOf(b, 'tr'), br: cornerOf(b, 'br'), bl: cornerOf(b, 'bl') }
  })

  const hud = computed(() => {
    const d = drag.value
    if (!d) return null
    if (d.type === 'groupResize') {
      const b = selectionBox.value; if (!b) return null
      const hh = dragHud('scale', { wPx: b.w, hPx: b.h, xPx: b.cx, yPx: b.cy, rotation: 0 })
      if (!hh) return null
      return { text: hh.text, left: b.cx, top: b.cy - b.h / 2 - 12 }
    }
    const l = selected.value
    if (!l) return null
    const b = boxPx(l); const W = dims().w, H = dims().h
    const kind = d.type === 'resize' ? 'scale' : d.type
    const hh = dragHud(kind, { wPx: b.w, hPx: b.h, xPx: l.x * W, yPx: l.y * H, rotation: l.rotation })
    if (!hh) return null
    return { text: hh.text, left: l.x * W, top: l.y * H - b.h / 2 - 12 }
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

  /** Move the whole multi-selection by a normalized delta (keyboard nudge). */
  function nudgeSelection(dx: number, dy: number) {
    if (!selectedIds.value.size || (dx === 0 && dy === 0)) return
    recordHistory()
    commit(nudgeLayers(localLayers.value, selectedIds.value, dx, dy))
  }

  /** Duplicate the current multi-selection; the copies become the selection. */
  function duplicateSelection() {
    if (!selectedIds.value.size) return
    recordHistory()
    const r = duplicateLayers(
      localLayers.value, localGroups.value, selectedIds.value, 0.02,
      () => `ll-${Date.now().toString(36)}-${++_dupSeq}`,
      () => `g-${Date.now().toString(36)}-${++_groupSeq}`,
    )
    commitBoth(r.layers as LocalLayer[], r.groups)
    selectedIds.value = new Set(r.newIds)
    selectedId.value = r.newIds[r.newIds.length - 1] ?? null
  }

  /** Copy the current multi-selection to the shared in-app clipboard. */
  function copySelection() {
    const p = extractForCopy(localLayers.value, localGroups.value, selectedIds.value)
    if (p) setClipboard(p)
  }
  /** Paste the clipboard into THIS frame; offset unless inPlace. Copies become the selection. */
  function pasteClipboard(inPlace: boolean) {
    const p = getClipboard()
    if (!p) return
    recordHistory()
    const r = materializePaste(
      p, localLayers.value, localGroups.value, inPlace ? 0 : 0.02,
      () => `ll-${Date.now().toString(36)}-${++_dupSeq}`,
      () => `g-${Date.now().toString(36)}-${++_groupSeq}`,
    )
    commitBoth(r.layers as LocalLayer[], r.groups)
    selectedIds.value = new Set(r.newIds)
    selectedId.value = r.newIds[r.newIds.length - 1] ?? null
  }

  /** Keyboard: arrow-nudge (1px / shift 10px), cmd/ctrl-D duplicate,
   *  cmd/ctrl-C copy, cmd/ctrl-V paste (offset) / +Shift paste in-place.
   *  Paste only needs a clipboard; nudge/duplicate/copy need a selection.
   *  Returns true if consumed. */
  function handleEditorKey(e: KeyboardEvent): boolean {
    const a = mapKeyToEdit(e, 1, 10)
    if (!a) return false
    if (a.type === 'paste') {
      if (!hasClipboard()) return false
      e.preventDefault(); pasteClipboard(a.inPlace); return true
    }
    if (!selectedIds.value.size) return false
    e.preventDefault()
    if (a.type === 'nudge') nudgeSelection(a.dxPx / dims().w, a.dyPx / dims().h)
    else if (a.type === 'duplicate') duplicateSelection()
    else if (a.type === 'copy') copySelection()
    return true
  }

  // ── Pointer interaction (zoom-agnostic via screen rect) ─────────────────────
  type Drag =
    | { type: 'move'; id: string; sx: number; sy: number; origins: { id: string; ox: number; oy: number }[] }
    | { type: 'scale'; id: string; cx: number; cy: number; startDist: number; start: Record<string, number> }
    | { type: 'rotate'; id: string; cx: number; cy: number; startAngle: number; startRot: number }
    | { type: 'resize'; id: string; handle: Handle; rot: number; start: Box; p0: { x: number; y: number } }
    | { type: 'groupResize'; handle: GHandle; anchor: { x: number; y: number }; cornerStart: { x: number; y: number }; ids: string[]; start: Record<string, { x: number; y: number; size: Record<string, number> }> }
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
      // Hidden/locked layers are transparent to canvas hits (the layers panel
      // can still select a locked layer; the canvas can't).
      if (l.visible === false || l.locked) continue
      const gc = resolveGroupCascade(l.groupId, localGroups.value)
      if (gc.hidden || gc.locked) continue
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
    const others = [] as { cx: number; cy: number; hx: number; hy: number }[]
    for (const l of localLayers.value) {
      if (movingIds.has(l.id)) continue
      const lb = boxPx(l)
      others.push({ cx: l.x, cy: l.y, hx: lb.w / 2 / W, hy: lb.h / 2 / H })
    }
    const res = computeSnapAdjust({ cx, cy, hx, hy }, others, SNAP_PX / W, SNAP_PX / H)
    snapGuides.value = { vx: res.guideX, hy: res.guideY }
    return { dx: dx + res.dx, dy: dy + res.dy }
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
  function startResize(handle: Handle, e: PointerEvent) {
    e.preventDefault(); e.stopPropagation()
    const l = selected.value; const r = getRect(); if (!l || !r) return
    const W = dims().w, H = dims().h
    const b = boxPx(l)
    const { nx, ny } = toNorm(e.clientX, e.clientY, r)
    recordHistory()
    drag.value = {
      type: 'resize', id: l.id, handle, rot: l.rotation,
      start: { cx: l.x * W, cy: l.y * H, w: b.w, h: b.h },
      p0: { x: nx * W, y: ny * H },
    }
    attach()
  }
  /** Begin a proportional resize of the whole multi-selection from a corner
   *  handle of the union box. Each layer's start x/y/size is snapshotted so
   *  onMove always scales from the ORIGINAL (never compounds across moves). */
  function startGroupResize(handle: GHandle, e: PointerEvent) {
    e.preventDefault(); e.stopPropagation()
    const box = selectionBox.value; const r = getRect(); if (!box || !r) return
    const anchor = anchorOf(box, handle, e.altKey)
    const cornerStart = cornerOf(box, handle)
    // Snapshot each selected layer's start center (px) + size fields so f re-derives from the ORIGINAL each move.
    const start: Record<string, { x: number; y: number; size: Record<string, number> }> = {}
    for (const l of selectedLayers.value) {
      const s: Record<string, number> = {}
      const ll = l as any
      if (ll.kind === 'text') s.fontSize = ll.fontSize
      else if (ll.kind === 'line') s.w = ll.w
      else if (ll.kind === 'path') s.scale = ll.scale
      else { s.w = ll.w; s.h = ll.h }
      start[l.id] = { x: l.x, y: l.y, size: s }
    }
    recordHistory()
    drag.value = { type: 'groupResize', handle, anchor, cornerStart, ids: selectedLayers.value.map(l => l.id), start }
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
      setLocal(d.id, { rotation: Math.round(snapAngle(rot, e.shiftKey ? 15 : null)) })
    } else if (d.type === 'resize') {
      const W = dims().w, H = dims().h
      const { nx, ny } = toNorm(e.clientX, e.clientY, r)
      const box = resizeBox(d.start, d.rot, d.handle, d.p0, { x: nx * W, y: ny * H }, { aspect: e.shiftKey, fromCenter: e.altKey })
      // px → normalized (w,h fractions of WIDTH; x of width, y of height)
      setLocal(d.id, { x: box.cx / W, y: box.cy / H, w: box.w / W, h: box.h / W })
    } else if (d.type === 'groupResize') {
      const W = dims().w, H = dims().h
      const { nx, ny } = toNorm(e.clientX, e.clientY, r)
      const f = groupScaleFactor(d.anchor, d.cornerStart, { x: nx * W, y: ny * H })
      commit(localLayers.value.map((l) => {
        const s = d.start[l.id]; if (!s) return l
        const startLayer = { ...l, x: s.x, y: s.y, ...s.size } as LocalLayer
        return { ...l, ...scaleLayerAbout(startLayer, d.anchor, f, W, H) } as LocalLayer
      }))
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
  // `forcedId` lets the caller supply the hit layer from a more accurate (e.g.
  // pixel-perfect, z-aware-with-wired) hit test; when omitted we fall back to the
  // editor's own bbox hit test. Pass `null` to mean "an explicit miss".
  function onCanvasPointerDown(e: PointerEvent, forcedId?: string | null): boolean {
    if ((e.target as HTMLElement)?.closest?.('[data-handle]')) return true
    const id = forcedId !== undefined ? forcedId : hitTest(e.clientX, e.clientY)
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
  function onCanvasDblClick(e: MouseEvent, forcedId?: string | null): boolean {
    const id = forcedId !== undefined ? forcedId : hitTest(e.clientX, e.clientY)
    if (!id) return false
    const l = localLayers.value.find(x => x.id === id)
    if (l?.kind === 'text') { e.preventDefault(); e.stopPropagation(); beginEdit(id); return true }
    return false
  }

  onScopeDispose(() => window.removeEventListener('pointermove', onMove))

  // ── Factories ────────────────────────────────────────────────────────────--
  function addText() {
    const fontDisplay = projectBrand?.activeKit.value?.fontDisplay
    const l = createTextLayer(fontDisplay ? { fontFamily: fontDisplay } : {})
    addLocal(l); nextTick(() => beginEdit(l.id)); return l
  }
  function addRect() { addLocal(createRectLayer()) }
  function addEllipse() { addLocal(createEllipseLayer()) }
  function addLine() { addLocal(createLineLayer()) }
  function addPolygon() { addLocal(createPolygonLayer()) }
  function addStar() { addLocal(createStarLayer()) }
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
    // Operate on any closed-outline shapes; convert rect/ellipse/line/polygon/star
    // → path so they can boolean with real paths. Keep the originals (with their
    // ids) for removal, and z-order is preserved (selectedLayers is z-ordered).
    const originals = selectedLayers.value.filter(l => l.kind === 'path' || l.kind === 'rect' || l.kind === 'ellipse' || l.kind === 'line'
      || l.kind === 'polygon' || l.kind === 'star')
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
    boxPx, handlePositions, hud,
    selectionBox, selectionHandles, startGroupResize,
    hitTest, startScale, startRotate, startResize,
    onCanvasPointerDown, onCanvasDblClick,
    addText, addRect, addEllipse, addLine, addPolygon, addStar, addImageFromFile, addImageFromName,
    addPathLayers, addPathFromSvg, deleteLayers, commit, recordHistory,
    background, setBackground,
    undo, redo, canUndo, canRedo,
    selectedIds, selectedLayers, toggleSelect, applyBoolean, alignSelected, nudgeSelection, duplicateSelection, handleEditorKey,
    copySelection, pasteClipboard,
    groupSelected, ungroupSelected, ungroupGroup, renameGroup, canGroup, canUngroup,
    setGroupHidden, setGroupLocked, setGroupOpacity, groupCascade,
    editingLayerNameId, layerNameDraft, startLayerRename, commitLayerRename, setLayerName,
    localGroups, commitBoth, writeGroups, setLayerGroup, setGroupParent, selectGroupById,
    snapGuides, marquee, startMarquee, moveMarquee, endMarquee,
  }
}
