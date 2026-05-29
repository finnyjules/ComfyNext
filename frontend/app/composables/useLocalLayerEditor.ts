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
  type LocalLayer, type TextLayer, type RectLayer, type LineLayer,
  createTextLayer, createRectLayer, createEllipseLayer, createLineLayer, createImageLayer,
  localLayerBox,
} from '~/composables/useCompositorLayers'

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
  function setLocal(id: string, patch: Record<string, any>) {
    commit(localLayers.value.map(l => (l.id === id ? { ...l, ...patch } as LocalLayer : l)))
  }
  function addLocal(layer: LocalLayer) { commit([...localLayers.value, layer]); selectLocal(layer.id) }
  function deleteLocal(id: string) {
    commit(localLayers.value.filter(l => l.id !== id))
    if (selectedId.value === id) selectedId.value = null
  }
  function moveLocalZ(id: string, dir: -1 | 1) {
    const arr = [...localLayers.value]
    const i = arr.findIndex(l => l.id === id); const j = i + dir
    if (i < 0 || j < 0 || j >= arr.length) return
    ;[arr[i], arr[j]] = [arr[j], arr[i]]; commit(arr)
  }

  // ── Selection / editing state ──────────────────────────────────────────────
  const selectedId = ref<string | null>(null)
  const selected = computed(() => localLayers.value.find(l => l.id === selectedId.value) ?? null)
  function selectLocal(id: string | null) { selectedId.value = id }
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

  // ── Pointer interaction (zoom-agnostic via screen rect) ─────────────────────
  type Drag =
    | { type: 'move'; id: string; sx: number; sy: number; ox: number; oy: number }
    | { type: 'scale'; id: string; cx: number; cy: number; startDist: number; start: Record<string, number> }
    | { type: 'rotate'; id: string; cx: number; cy: number; startAngle: number; startRot: number }
    | null
  const drag = ref<Drag>(null)

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
    drag.value = { type: 'move', id, sx: e.clientX, sy: e.clientY, ox: l.x, oy: l.y }
    attach()
  }
  function startScale(e: PointerEvent) {
    e.preventDefault(); e.stopPropagation()
    const l = selected.value; const r = getRect(); if (!l || !r) return
    const cx = r.left + l.x * r.width, cy = r.top + l.y * r.height
    const start: Record<string, number> = {}
    if (l.kind === 'text') start.fontSize = (l as TextLayer).fontSize
    else if (l.kind === 'line') start.w = (l as LineLayer).w
    else { start.w = (l as RectLayer).w; start.h = (l as RectLayer).h }
    drag.value = { type: 'scale', id: l.id, cx, cy, startDist: Math.max(1, Math.hypot(e.clientX - cx, e.clientY - cy)), start }
    attach()
  }
  function startRotate(e: PointerEvent) {
    e.preventDefault(); e.stopPropagation()
    const l = selected.value; const r = getRect(); if (!l || !r) return
    const cx = r.left + l.x * r.width, cy = r.top + l.y * r.height
    drag.value = { type: 'rotate', id: l.id, cx, cy, startAngle: Math.atan2(e.clientY - cy, e.clientX - cx), startRot: l.rotation }
    attach()
  }
  function onMove(e: PointerEvent) {
    const d = drag.value; if (!d) return
    const r = getRect(); if (!r) return
    if (d.type === 'move') {
      setLocal(d.id, {
        x: clamp(d.ox + (e.clientX - d.sx) / r.width, -0.5, 1.5),
        y: clamp(d.oy + (e.clientY - d.sy) / r.height, -0.5, 1.5),
      })
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
  function onUp() { drag.value = null; window.removeEventListener('pointermove', onMove) }
  function attach() {
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
  }

  // Consumer binds these to the artboard element (capture phase recommended so
  // it wins over node-drag). Returns true if it handled (hit a layer).
  function onCanvasPointerDown(e: PointerEvent): boolean {
    if ((e.target as HTMLElement)?.closest?.('[data-handle]')) return true
    const id = hitTest(e.clientX, e.clientY)
    if (id) { e.preventDefault(); e.stopPropagation(); selectLocal(id); startMove(id, e); return true }
    selectedId.value = null
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

  return {
    localLayers, selectedId, selected, selectLocal,
    setLocal, addLocal, deleteLocal, moveLocalZ,
    editingId, editingLayer, beginEdit, endEdit,
    boxPx, handlePositions,
    hitTest, startScale, startRotate,
    onCanvasPointerDown, onCanvasDblClick,
    addText, addRect, addEllipse, addLine, addImageFromFile,
  }
}
