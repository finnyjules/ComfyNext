<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { Dices } from 'lucide-vue-next'
import { textureFx } from '~/lib/texturefx/renderer'
import { preloadStylize, stylizeTile } from '~/lib/texturefx/stylize'
import { loadRaster, getRaster, buildSeamlessInputs, rasterViewUrl } from '~/lib/texturefx/raster'
import { TEXTURE_CONTROLS, textureDefaults } from '~/lib/texturefx/controls'
import { TEXTURE_SECTIONS } from '~/lib/texturefx/sections'
import { cloneParams } from '~/lib/texturefx/types'
import { rolesFor } from '~/lib/texturefx/roles'
import { fillForRole } from '~/lib/texturefx/fills'
import type { Fill } from '~/lib/texturefx/types'
import type { ControlSpec, Params } from '~/lib/spacetype/effect'
import type { TextureControl } from '~/lib/texturefx/controls'
import StudioModalShell from '~/components/vue-canvas/StudioModalShell.vue'
import StudioSection from '~/components/vue-canvas/StudioSection.vue'
import StudioControlPanel from '~/components/vue-canvas/studio/StudioControlPanel.vue'
import StudioButton from '~/components/vue-canvas/studio/StudioButton.vue'
import StudioColor from '~/components/vue-canvas/studio/StudioColor.vue'
import StudioColorField from '~/components/vue-canvas/studio/StudioColorField.vue'
import StudioSlider from '~/components/vue-canvas/studio/StudioSlider.vue'
import StudioSelect from '~/components/vue-canvas/studio/StudioSelect.vue'
import { useTextureAgent } from '~/composables/useTextureAgent'
import CanvasContextMenu from '~/components/vue-canvas/CanvasContextMenu.vue'
import VariableGlyph from '~/components/vue-canvas/studio/VariableGlyph.vue'
import { useStudioVarBindings } from '~/composables/useStudioVarBindings'
import { useStudioVarMenu } from '~/composables/useStudioVarMenu'
import { controlsForStudio } from '~/lib/collection/studioControls'
import type { StudioControlDesc } from '~/lib/collection/studioBindables'
import { controlKindToVariableType } from '~/lib/collection/studioBindables'
import { registerStudioParamBaker, unregisterStudioParamBaker } from '~/lib/studio/cascade'
import { showIfVisible } from '~/lib/studio/sections'
import SweepPopover from '~/components/vue-canvas/studio/SweepPopover.vue'

const props = defineProps<{ nodeId: string; nodes: any[]; edges?: any[] }>()
const emit = defineEmits<{ (e: 'close'): void }>()

// Record generated stills as the current project's assets (Assets panel).
const { recordAsset } = useProjectGenerations()
const { activeTab } = useTabs()

const params = reactive<Params>(textureDefaults())

// In-product agent — STRUCTURAL: edits per-role fills AND tunes flat controls
// through the command surface (describeTexture/applyTextureCommand). setState
// mutates the reactive params in place (fills replaced wholesale so revert clears
// a custom fill) then re-renders via onParam().
const { getLocalSetting } = useLocalSettings()
// The shell renders the prompt + results from this object (see StudioModalShell).
const textureAgent = useTextureAgent({
  getState: () => ({ params }),
  setState: (s) => { Object.assign(params, s.params); (params as any).fills = (s.params as any).fills; onParam() },
  apiKey: () => getLocalSetting('Sailor.AI.AnthropicApiKey') ?? '',
  render: () => renderTileForReview(),
})

// Render a clean 2×2 repeat of the current tile to a PNG for the agent's visual
// self-review (no seam guides — show the texture as it reads).
function renderTileForReview(): string | null {
  if (typeof document === 'undefined') return null
  try {
    const tile = stylizeTile(textureFx.render(params, TILE, TILE, 0), params, TILE, TILE)
    const off = document.createElement('canvas'); off.width = TILE * 2; off.height = TILE * 2
    const ctx = off.getContext('2d'); if (!ctx) return null
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) ctx.drawImage(tile, x * TILE, y * TILE)
    return off.toDataURL('image/png')
  } catch { return null }
}
const repeat = ref(2)
const seams = ref(true)
const baking = ref(false)
const bakeMsg = ref('')
const canvas = ref<HTMLCanvasElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const generating = ref(false)
const genError = ref('')

async function onGenerate() {
  const prompt = String(params.texturePrompt ?? '').trim()
  if (!prompt || generating.value) return
  generating.value = true; genError.value = ''
  try {
    const res = await $fetch<{ images?: string[] }>('/api/inpaint/text2img', {
      method: 'POST',
      body: { prompt, aspect_ratio: '1:1', count: 1 },
    })
    const dataUrl = res?.images?.[0]
    if (!dataUrl) { genError.value = 'No image returned'; return }
    const blob = await (await fetch(dataUrl)).blob()
    const name = `texgen_${Date.now()}.png`
    const fd = new FormData()
    fd.append('image', new File([blob], name, { type: 'image/png' }))
    fd.append('overwrite', 'true')
    const up = await fetch('/upload/image', { method: 'POST', body: fd })
    if (!up.ok) { genError.value = 'Upload failed'; return }
    const d = await up.json() as { name?: string; subfolder?: string }
    const fname = d.subfolder ? `${d.subfolder}/${d.name}` : (d.name ?? name)
    params.rasterSrc = fname
    await recordAsset(activeTab.value?.projectUuid, 'image', fname)
    await loadRaster(fname)
    renderPreview()
  } catch (e: any) {
    console.error('[texture] generate failed', e)
    genError.value = e?.statusMessage || e?.message || 'Generate failed'
  } finally { generating.value = false }
}

const sealing = ref(false)
async function onMakeSeamless() {
  const src = String(params.rasterSrc ?? '')
  if (!src || sealing.value) return
  sealing.value = true; genError.value = ''
  try {
    await loadRaster(src)
    const img = getRaster(src)
    if (!img) { genError.value = 'Image not loaded yet'; return }
    const { image, mask } = buildSeamlessInputs(img)
    const res = await $fetch<{ images?: string[] }>('/api/inpaint/flux-fill', {
      method: 'POST',
      body: {
        image, mask,
        prompt: String(params.texturePrompt ?? '').trim() || 'seamless continuous texture, fill to match the surrounding pattern',
        tier: 'dev', count: 1,
      },
    })
    const dataUrl = res?.images?.[0]
    if (!dataUrl) { genError.value = 'No image returned'; return }
    const blob = await (await fetch(dataUrl)).blob()
    const name = `texseam_${Date.now()}.png`
    const fd = new FormData()
    fd.append('image', new File([blob], name, { type: 'image/png' }))
    fd.append('overwrite', 'true')
    const up = await fetch('/upload/image', { method: 'POST', body: fd })
    if (!up.ok) { genError.value = 'Upload failed'; return }
    const d = await up.json() as { name?: string; subfolder?: string }
    const fname = d.subfolder ? `${d.subfolder}/${d.name}` : (d.name ?? name)
    params.rasterSrc = fname
    params.seamMethod = 'direct'   // baked image is already seamless → sample 1:1
    await recordAsset(activeTab.value?.projectUuid, 'image', fname)
    await loadRaster(fname)
    renderPreview()
  } catch (e: any) {
    console.error('[texture] make-seamless failed', e)
    genError.value = e?.statusMessage || e?.message || 'Make seamless failed'
  } finally { sealing.value = false }
}

async function onImportFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  // Unique upload name → fresh cache key every import (avoids serving a stale
  // cached image when two source files share a name).
  const safe = (file.name || 'img').replace(/[^\w.\-]/g, '_')
  const fd = new FormData()
  fd.append('image', new File([file], `texraster_${Date.now()}_${safe}`, { type: file.type || 'image/png' }))
  fd.append('overwrite', 'true')
  try {
    const res = await fetch('/upload/image', { method: 'POST', body: fd })
    if (!res.ok) return
    const data = await res.json() as { name?: string; subfolder?: string }
    const name = data.subfolder ? `${data.subfolder}/${data.name}` : (data.name ?? '')
    if (!name) return
    params.rasterSrc = name
    await recordAsset(activeTab.value?.projectUuid, 'image', name)
    await loadRaster(name)
    renderPreview()
  } catch (err) { console.error('[texture] import failed', err) }
  finally { input.value = '' } // allow re-importing the same file
}

function currentNode() { return props.nodes.find((n: any) => n.id === props.nodeId) }

// Collections variable binding (Slice 2a, Task 7b) — same recipe as Gradient/Shader
// (Tasks 6/7a). `studioControls` mirrors what the agent tuner offers (via
// `controlsForStudio`, loaded once since the composable wants a synchronous
// accessor) purely for the bind-menu's control descriptions (label/kind/min/max/
// step/options), matched by dotted key `params.<key>` against `TEXTURE_CONTROLS`.
// applyParam mirrors the SAME setter every control in the main loop already uses
// (`params[key] = value; onParam()`) so onEdit's write-through behaves exactly like
// a user edit. Only the flat TEXTURE_CONTROLS loop is wrapped — the per-role Fills
// panel below is not driven by StudioControlDesc (dynamic role keys, not
// `params.<key>` dotted paths) and controlsForStudio() doesn't describe it, so it's
// out of scope here.
const studioControls = ref<StudioControlDesc[]>([])
onMounted(async () => { studioControls.value = await controlsForStudio(currentNode()) })

const { boundColumnFor, boundColumnKeyFor, onEdit, promote, unbind } = useStudioVarBindings(
  props.nodeId,
  () => studioControls.value,
  (key, value) => { (params as Record<string, unknown>)[key] = value; onParam() },
  { nodes: () => props.nodes, edges: () => props.edges ?? [] },
)

const { wiredColumns, sweepPopover, applySweep, varMenu, openVarMenu, goToCollection } = useStudioVarMenu({
  nodeId: () => props.nodeId,
  nodes: () => props.nodes,
  edges: () => props.edges ?? [],
  liveValue: (key) => (params as Record<string, unknown>)[key] as string | number,
  boundColumnFor, boundColumnKeyFor, promote, unbind,
})

function loadParams() {
  const p = currentNode()?.data?.properties?.sailor_textureStudio
  if (p && typeof p === 'object') Object.assign(params, { ...textureDefaults(), ...cloneParams(p) })
  if (String(params.mode) === 'raster' && params.rasterSrc) {
    loadRaster(String(params.rasterSrc)).then(renderPreview).catch(() => {})
  }
}
function saveParams() {
  const n = currentNode(); if (!n) return
  if (!n.data) n.data = {}
  if (!n.data.properties) n.data.properties = {}
  n.data.properties.sailor_textureStudio = cloneParams({ ...params })
}
function closeEditor() {
  try { saveParams() } catch (e) { console.error('[texture] save failed', e) }
  emit('close')
}

// Controls visible to StudioControlPanel: a control with a `when` predicate is
// shown only when it returns true for the current params (contextual reveal).
// Sectioning/ordering/dropping-empty-sections now lives in groupIntoSections
// (shared with every other adopter), driven by TEXTURE_SECTIONS as the order.
function controlVisible(c: ControlSpec): boolean {
  const tc = c as TextureControl
  // `showIf` too, not just `when`: the shared post stack's param rows declare it so
  // they appear only once their effect's switch is on. Checking `when` alone showed
  // all 21 of them permanently.
  return (!tc.when || tc.when(params)) && showIfVisible(c, k => params[k])
}

// `set`/`promote` mirror the setter every control in the panel already used
// before the shared component existed (`params[key] = value; onParam()`), so
// `onEdit`'s write-through behaves exactly like a user edit.
function setParam(key: string, value: string | number) {
  (params as Record<string, unknown>)[key] = value
  onParam()
  onEdit(key, value)
}
function promoteControlFromPanel(c: ControlSpec) {
  const v = (params as Record<string, unknown>)[c.key]
  promote(c, c.kind === 'slider' ? Number(v) : String(v))
}

const TILE = 256

function renderPreview() {
  const el = canvas.value; if (!el) return
  const n = repeat.value
  el.width = TILE * n; el.height = TILE * n
  const ctx = el.getContext('2d')!
  // Base tile → stylize (dither/posterize/duotone). TILE=256 is a multiple of 64
  // so the dither pattern stays seamless across the repeat.
  const tile = stylizeTile(textureFx.render(params, TILE, TILE, 0), params, TILE, TILE)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      ctx.drawImage(tile, x * TILE, y * TILE)
    }
  }
  if (seams.value) {
    ctx.strokeStyle = 'rgba(159,232,208,0.7)'; ctx.lineWidth = 1
    for (let i = 1; i < n; i++) {
      ctx.beginPath(); ctx.moveTo(i * TILE, 0); ctx.lineTo(i * TILE, el.height); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, i * TILE); ctx.lineTo(el.width, i * TILE); ctx.stroke()
    }
  }
}

function roll() { params.seed = Math.floor(Math.random() * 1e6); renderPreview() }
function setRepeat(n: number) { repeat.value = n; renderPreview() }
function toggleSeams() { seams.value = !seams.value; renderPreview() }
function onParam() {
  if (String(params.mode) === 'raster' && params.rasterSrc && !getRaster(String(params.rasterSrc))) {
    // Image not cached yet — let the deferred render fire once it loads; skip the
    // immediate render to avoid a blank-raster flash.
    loadRaster(String(params.rasterSrc)).then(renderPreview).catch(() => {})
    return
  }
  renderPreview()
}

// ── Fills panel helpers ───────────────────────────────────────────────────────
// rawFill: the stored fill for this role (un-resolved — may be type:'link').
// Use for the type picker and v-else-if guard so 'link' shows correctly.
function rawFill(rk: string): any { return (params as any).fills?.[rk] }
function roleFill(rk: string, i: number): Fill { return fillForRole(params, rk, i) }
function setFill(rk: string, fill: Fill) {
  if (!(params as any).fills) (params as any).fills = {}
  ;(params as any).fills[rk] = fill
  onParam()
}
// Fills — dynamic ref map (Vue 3 script-setup: $refs with dynamic string keys are unreliable)
const fillInputRefs = new Map<string, HTMLInputElement>()
function setFillInputRef(key: string, el: any) {
  if (el) fillInputRefs.set(key, el as HTMLInputElement)
  else fillInputRefs.delete(key)
}
function openFillImport(rk: string, i: number) {
  fillInputRefs.get(`${rk}_${i}`)?.click()
}

function setFillType(rk: string, i: number, type: 'solid' | 'gradient' | 'image' | 'pattern' | 'link') {
  const cur = roleFill(rk, i)
  if (type === 'solid')
    setFill(rk, { type: 'solid', color: cur.type === 'solid' ? cur.color : ((cur as any).stops?.[0]?.c ?? '#7aa2f7') })
  else if (type === 'gradient')
    setFill(rk, { type: 'gradient', frame: 'cell', kind: 'linear', angle: 0, stops: [{ c: '#e8eef5', p: 0 }, { c: '#7aa2f7', p: 1 }] })
  else if (type === 'pattern')
    setFill(rk, { type: 'pattern', frame: 'tile', scale: 1, sub: { mode: 'procedural', motif: 'checker', cells: 4, colorA: '#e8eef5', colorB: '#7aa2f7', background: '#0e1116' } })
  else if (type === 'link') {
    const otherRole = rolesFor(params).find((r) => r !== rk) ?? rk
    setFill(rk, { type: 'link', to: otherRole } as any)
  } else {
    setFill(rk, { type: 'image', frame: 'tile', src: '', seam: 'mirror', scale: 1 } as any)
  }
}

function setSub(rk: string, i: number, patch: Record<string, unknown>) {
  const f = roleFill(rk, i) as any
  setFill(rk, { ...f, sub: { ...f.sub, ...patch } })
}

async function onFillImport(rk: string, i: number, file: File) {
  const name = `fillimg_${rk}_${Date.now()}.png`
  const fd = new FormData()
  fd.append('image', new File([file], name, { type: file.type || 'image/png' }))
  fd.append('overwrite', 'true')
  try {
    const res = await fetch('/upload/image', { method: 'POST', body: fd })
    if (!res.ok) { console.error('[texture] fill import upload failed'); return }
    const data = await res.json() as { name?: string; subfolder?: string }
    const fname = data.subfolder ? `${data.subfolder}/${data.name}` : (data.name ?? name)
    if (!fname) return
    await recordAsset(activeTab.value?.projectUuid, 'image', fname)
    await loadRaster(fname)
    setFill(rk, { ...(roleFill(rk, i) as any), type: 'image', src: fname })
    renderPreview()
  } catch (err) { console.error('[texture] fill import failed', err) }
}
function setFillOpacity(rk: string, i: number, v: number) {
  setFill(rk, { ...(roleFill(rk, i) as any), opacity: v })
}

// ── Fills panel UX helpers ────────────────────────────────────────────────────
// Collapsible roles: default all expanded (not in set = expanded).
const collapsedRoles = reactive(new Set<string>())
function isExpanded(rk: string): boolean { return !collapsedRoles.has(rk) }
function toggleRole(rk: string) {
  if (collapsedRoles.has(rk)) collapsedRoles.delete(rk)
  else collapsedRoles.add(rk)
}

// Live swatch: returns a CSS style object for solid/gradient; null signals 'use img/glyph'.
// Always reads from the RESOLVED fill (roleFill follows links to the target).
function roleSwatchStyle(rk: string, i: number): Record<string, string> | null {
  const f = roleFill(rk, i) as any
  if (!f) return { background: '#7aa2f7' }
  if (f.type === 'solid') return { background: f.color ?? '#7aa2f7' }
  if (f.type === 'gradient') {
    const stops: { c: string; p: number }[] = f.stops ?? [{ c: '#e8eef5', p: 0 }, { c: '#7aa2f7', p: 1 }]
    const angle = f.angle ?? 0
    const stopsStr = stops.map((s) => `${s.c} ${Math.round(s.p * 100)}%`).join(', ')
    return { background: `linear-gradient(${angle}deg, ${stopsStr})` }
  }
  if (f.type === 'image') return null          // use <img> thumbnail in the template
  if (f.type === 'pattern') return null        // use glyph in the template
  // fallback (link resolved to something unexpected, or unknown type)
  return { background: '#444' }
}
function roleSwatchIsImage(rk: string, i: number): boolean {
  return (roleFill(rk, i) as any)?.type === 'image'
}
function roleSwatchIsPattern(rk: string, i: number): boolean {
  return (roleFill(rk, i) as any)?.type === 'pattern'
}
function roleSwatchImageSrc(rk: string, i: number): string {
  const src = (roleFill(rk, i) as any)?.src ?? ''
  return src ? rasterViewUrl(src) : ''
}

// Reset fill: remove the explicit entry so the role falls back to legacy color.
function resetFill(rk: string) {
  const f = (params as any).fills
  if (f && f[rk] !== undefined) {
    delete f[rk]
    onParam()
  }
}

function setGradient(rk: string, i: number, patch: Partial<{ kind: 'linear' | 'radial'; angle: number; frame: 'cell' | 'tile'; stops: { c: string; p: number }[] }>) {
  const f = roleFill(rk, i) as any
  const cur = f?.type === 'gradient' ? f : {}
  setFill(rk, {
    type: 'gradient',
    frame: cur.frame ?? 'cell',
    kind: cur.kind ?? 'linear',
    angle: cur.angle ?? 0,
    stops: cur.stops ?? [{ c: '#e8eef5', p: 0 }, { c: '#7aa2f7', p: 1 }],
    ...patch,
  } as Fill)
}

// Write gradient stops: always sorts by position before saving so the shader walk is correct.
function setStops(rk: string, i: number, stops: { c: string; p: number }[]) {
  const sorted = [...stops].sort((a, b) => a.p - b.p)
  setGradient(rk, i, { stops: sorted })
}

// Add a stop at the midpoint between the last two stops (or 0.5 if only 2 stops).
function addStop(rk: string, i: number) {
  const stops: { c: string; p: number }[] = [...((roleFill(rk, i) as any).stops ?? [{ c: '#e8eef5', p: 0 }, { c: '#7aa2f7', p: 1 }])]
  if (stops.length >= 4) return
  const sorted = [...stops].sort((a, b) => a.p - b.p)
  const last = sorted[sorted.length - 1]!
  const prev = sorted[sorted.length - 2]!
  const mp = (prev.p + last.p) / 2
  stops.push({ c: '#aabbcc', p: mp })
  setStops(rk, i, stops)
}

// Remove a stop at a given index (only allowed when stops.length > 2).
function removeStop(rk: string, i: number, si: number) {
  const stops: { c: string; p: number }[] = [...((roleFill(rk, i) as any).stops ?? [])]
  if (stops.length <= 2) return
  stops.splice(si, 1)
  setStops(rk, i, stops)
}

// Update a single stop's color or position.
function patchStop(rk: string, i: number, si: number, patch: Partial<{ c: string; p: number }>) {
  const stops: { c: string; p: number }[] = [...((roleFill(rk, i) as any).stops ?? [])]
  stops[si] = { ...stops[si]!, ...patch }
  setStops(rk, i, stops)
}

// Render the full-res tile and apply stylize, then encode. 1024 is a multiple of
// 64 so dither stays seamless.
async function exportBlob(): Promise<Blob> {
  const styled = stylizeTile(textureFx.render(params, 1024, 1024, 0), params, 1024, 1024)
  return await new Promise<Blob>((res, rej) =>
    styled.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'))
}

// Studio param-baker (Slice 2a Task 8c) — bakes ONE frame with a set of
// `params.*` overrides applied (a collection sweep/generate row), without
// disturbing the studio's live on-screen tile: snapshot the current value of
// every overridden key directly off the flat reactive `params` object (no
// dotted-path proxy needed here — Texture Studio's controls are flat
// `params[key]` writes, unlike Gradient's nested/layer-scoped config), write
// the overrides the same way `onEdit`'s setter does (`params[key] = value`,
// no separate rebuild step needed — `exportBlob` reads `params` fresh each
// call), render one full-res frame via the shared `exportBlob` capture path,
// then restore the snapshots in `finally` regardless of success/failure.
// `exportBlob` calls `textureFx.render(params, ...)` directly with `params`
// as an argument and only awaits the `toBlob` callback, so no `nextTick`/rAF
// wait is needed between the override-write and the capture call.
async function renderBlobWithOverrides(overrides: Record<string, string | number>): Promise<Blob | null> {
  const keys = Object.keys(overrides)
  const snapshot = new Map<string, unknown>()
  for (const key of keys) snapshot.set(key, (params as Record<string, unknown>)[key])
  try {
    for (const key of keys) (params as Record<string, unknown>)[key] = overrides[key]!
    return await exportBlob()
  } catch (e) {
    console.error('[texture] param-baker render failed', e)
    return null
  } finally {
    for (const key of keys) {
      if (snapshot.has(key)) (params as Record<string, unknown>)[key] = snapshot.get(key)
    }
  }
}

async function sendToCanvas() {
  baking.value = true; bakeMsg.value = 'Rendering…'
  try {
    const blob = await exportBlob()
    const { uploadFrameBatch } = await import('~/lib/studio/frameUpload')
    const [filename] = await uploadFrameBatch([blob], 'texture_img')
    if (filename) {
      saveParams()
      await recordAsset(activeTab.value?.projectUuid, 'image', filename)
      window.dispatchEvent(new CustomEvent('sailor:textureStudioOutput', {
        detail: { sourceNodeId: props.nodeId, nodeType: 'Image', widgetOverrides: { image: filename } },
      }))
      closeEditor()
    } else { bakeMsg.value = 'Upload failed — see console.' }
  } catch (e) { console.error('[texture] send failed', e); bakeMsg.value = 'Failed — see console.' }
  finally { baking.value = false }
}

async function downloadPng() {
  try {
    const blob = await exportBlob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = `texture_${params.seed}.png`; a.click()
    URL.revokeObjectURL(a.href)
  } catch (e) { console.error('[texture] PNG download failed', e) }
}

// Keyboard shortcut: Escape closes the editor.
function onKey(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
  if (e.key === 'Escape') closeEditor()
}

onMounted(() => {
  bakeMsg.value = ''
  loadParams()
  renderPreview()
  // Stylize effects load async; re-render once ready so the preview reflects them.
  preloadStylize().then(renderPreview).catch(() => {})
  window.addEventListener('keydown', onKey)
  registerStudioParamBaker(props.nodeId, renderBlobWithOverrides)
})
onBeforeUnmount(() => {
  try { saveParams() } catch { /* swallow */ }
  window.removeEventListener('keydown', onKey)
  unregisterStudioParamBaker(props.nodeId)
})
</script>

<template>
  <StudioModalShell
    title="Pattern Studio"
    :agent="textureAgent"
    agent-placeholder="Describe it — e.g. red and cream, fade the ground, tighter cells…"
    @close="closeEditor"
  >
    <template #preview>
      <div class="flex h-full flex-col items-center justify-center gap-3 p-4">
        <canvas ref="canvas" class="max-h-[60vh] max-w-full rounded-lg border border-white/10" />
        <div class="flex items-center gap-2 text-xs">
          <button v-for="n in [1, 2, 3]" :key="n"
                  type="button"
                  class="rounded border px-2 py-1 transition-colors"
                  :class="repeat === n ? 'border-white bg-white/10 text-white' : 'border-white/15 text-white/55 hover:bg-white/10'"
                  @click="setRepeat(n)">{{ n }}×</button>
          <button type="button"
                  class="rounded border px-2 py-1 transition-colors"
                  :class="seams ? 'border-white bg-white/10 text-white' : 'border-white/15 text-white/55 hover:bg-white/10'"
                  @click="toggleSeams">Highlight seams</button>
        </div>
        <div v-if="params.mode === 'raster'" class="flex flex-col items-center gap-2">
          <div class="flex items-center gap-2 text-xs">
            <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onImportFile">
            <button type="button"
                    class="rounded border border-white/15 px-2 py-1 text-white/80 transition-colors hover:bg-white/10"
                    @click="fileInput?.click()">Import image…</button>
            <span class="truncate text-white/45" style="max-width:220px">{{ params.rasterSrc || 'no image — mirror/feather makes it seamless' }}</span>
          </div>
          <div class="flex w-full max-w-[420px] items-center gap-2 text-xs">
            <input
              v-model="params.texturePrompt"
              type="text"
              placeholder="Describe a texture to generate…"
              class="min-w-0 flex-1 rounded border border-white/15 bg-white/5 px-2 py-1 text-white/90 placeholder:text-white/35"
              @keydown.enter="onGenerate"
            >
            <button
              type="button"
              class="shrink-0 rounded border border-white/15 px-2 py-1 transition-colors hover:bg-white/10 disabled:opacity-50"
              :disabled="generating || !String(params.texturePrompt ?? '').trim()"
              @click="onGenerate"
            >{{ generating ? 'Generating…' : 'Generate' }}</button>
          </div>
          <div v-if="params.rasterSrc" class="flex items-center gap-2 text-xs">
            <button
              type="button"
              class="rounded border border-white/15 px-2 py-1 text-xs transition-colors hover:bg-white/10 disabled:opacity-50"
              :disabled="sealing"
              @click="onMakeSeamless"
            >{{ sealing ? 'Sealing…' : 'Make seamless (AI)' }}</button>
          </div>
          <p v-if="genError" class="text-[10px] text-red-300">{{ genError }}</p>
        </div>
      </div>
    </template>

    <template #actions>
      <StudioButton variant="secondary" @click="roll"><Dices :size="14" /> Roll · seed {{ params.seed }}</StudioButton>
      <StudioButton variant="secondary" @click="downloadPng">Download PNG</StudioButton>
      <StudioButton variant="primary" :disabled="baking" @click="sendToCanvas">{{ baking ? bakeMsg : 'Send to canvas' }}</StudioButton>
    </template>

    <template #controls>
      <StudioControlPanel
        :controls="TEXTURE_CONTROLS"
        :order="TEXTURE_SECTIONS"
        :value="(key: string) => (params as Record<string, unknown>)[key] as string | number"
        :visible="controlVisible"
        :bound-for="boundColumnFor"
        :go-to-collection="goToCollection"
        @set="setParam"
        @promote="promoteControlFromPanel"
        @menu="(e: MouseEvent, c: ControlSpec) => openVarMenu(e, c)"
      />

      <!-- Fills panel: per-role solid/gradient fill pickers (not driven by TEXTURE_CONTROLS). -->
      <!-- Hidden in raster mode (raster has no ink/ground roles). -->
      <StudioSection v-if="params.mode !== 'raster'" title="Fills">
        <div v-for="(rk, i) in rolesFor(params)" :key="rk" class="mb-3">
          <!-- Role header: swatch + label + caret + reset -->
          <div
            class="mb-1 flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-white/5"
            role="button"
            :tabindex="0"
            @click="toggleRole(rk)"
            @keydown.enter.prevent="toggleRole(rk)"
            @keydown.space.prevent="toggleRole(rk)"
          >
            <!-- Swatch -->
            <span class="flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-white/20">
              <img
                v-if="roleSwatchIsImage(rk, i) && roleSwatchImageSrc(rk, i)"
                :src="roleSwatchImageSrc(rk, i)"
                class="h-full w-full object-cover"
                alt=""
              >
              <span v-else-if="roleSwatchIsPattern(rk, i)" class="text-[9px] text-white/60">▦</span>
              <span
                v-else
                class="block h-full w-full"
                :style="roleSwatchStyle(rk, i) ?? { background: '#444' }"
              />
            </span>
            <span class="flex-1 text-[11px] uppercase tracking-wide text-white/55">{{ rk }}</span>
            <!-- Reset button -->
            <button
              class="shrink-0 rounded px-1 py-0.5 text-[10px] text-white/35 hover:bg-white/10 hover:text-white/70"
              title="Reset fill to default"
              @click.stop="resetFill(rk)"
            >
              ↺
            </button>
            <!-- Caret -->
            <span
              class="shrink-0 text-[10px] text-white/35 transition-transform"
              :style="{ transform: isExpanded(rk) ? 'rotate(0deg)' : 'rotate(-90deg)' }"
            >&#9660;</span>
          </div>

          <div v-show="isExpanded(rk)">
          <!-- Fill-type picker: Solid / Gradient / Image / Pattern / Link -->
                    <StudioSelect
            label="Type"
            :options="['solid', 'gradient', 'image', 'pattern', 'link']"
            :model-value="rawFill(rk)?.type ?? 'solid'"
            @update:model-value="(t: string) => setFillType(rk, i, t as 'solid' | 'gradient' | 'image' | 'pattern' | 'link')"
          />

          <!-- Solid: single color picker + opacity -->
          <template v-if="rawFill(rk)?.type === 'solid' || !rawFill(rk)">
            <div class="mt-1 flex items-center gap-2">
                            <StudioColorField
                label="Color"
                :model-value="(roleFill(rk, i) as any).color ?? '#7aa2f7'"
                @update:model-value="(c: string) => setFill(rk, { ...(roleFill(rk, i) as any), type: 'solid', color: c })"
              />
            </div>
            <StudioSlider
              label="Opacity"
              :min="0"
              :max="1"
              :step="0.01"
              :default="1"
              :model-value="(roleFill(rk, i) as any).opacity ?? 1"
              @update:model-value="(v: number) => setFillOpacity(rk, i, v)"
            />
          </template>

          <!-- Gradient: kind, angle, two stops, frame -->
          <template v-else-if="rawFill(rk)?.type === 'gradient'">
            <div class="mt-1 flex flex-col gap-1">
                            <StudioSelect
                label="Kind"
                :options="['linear', 'radial']"
                :model-value="(roleFill(rk, i) as any).kind ?? 'linear'"
                @update:model-value="(k: string) => setGradient(rk, i, { kind: k as any })"
              />

              <StudioSlider
                label="Angle"
                :min="0"
                :max="360"
                :step="1"
                :default="0"
                :model-value="(roleFill(rk, i) as any).angle ?? 0"
                @update:model-value="(a: number) => setGradient(rk, i, { angle: a })"
              />

              <!-- Multi-stop list: 2-4 stops, each with color + position + optional remove -->
              <div
                v-for="(st, si) in ((roleFill(rk, i) as any).stops ?? [{ c: '#e8eef5', p: 0 }, { c: '#7aa2f7', p: 1 }])"
                :key="si"
                class="flex items-center gap-2"
              >
                <label class="w-8 shrink-0 text-[11px] text-white/55">{{ si === 0 ? 'Start' : si === ((roleFill(rk, i) as any).stops?.length ?? 2) - 1 ? 'End' : 'Mid' }}</label>
                <StudioColor
                  :model-value="st.c"
                  @update:model-value="(c: string) => patchStop(rk, i, Number(si), { c })"
                />
                <StudioSlider
                  label=""
                  :min="0"
                  :max="1"
                  :step="0.01"
                  :default="Number(si) === 0 ? 0 : 1"
                  :model-value="st.p"
                  @update:model-value="(p: number) => patchStop(rk, i, Number(si), { p })"
                />
                <button
                  v-if="((roleFill(rk, i) as any).stops?.length ?? 2) > 2"
                  class="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-white/40 hover:bg-white/10 hover:text-white/70"
                  @click="removeStop(rk, i, Number(si))"
                >
                  &times;
                </button>
              </div>
              <!-- Add stop button (max 4) -->
              <button
                v-if="((roleFill(rk, i) as any).stops?.length ?? 2) < 4"
                class="mt-0.5 self-start rounded px-2 py-0.5 text-[10px] text-white/50 hover:bg-white/10 hover:text-white/80"
                @click="addStop(rk, i)"
              >
                + Add stop
              </button>

                            <StudioSelect
                label="Frame"
                :options="['cell', 'tile']"
                :model-value="(roleFill(rk, i) as any).frame ?? 'cell'"
                @update:model-value="(fr: string) => setGradient(rk, i, { frame: fr as any })"
              />

              <StudioSlider
                label="Opacity"
                :min="0"
                :max="1"
                :step="0.01"
                :default="1"
                :model-value="(roleFill(rk, i) as any).opacity ?? 1"
                @update:model-value="(v: number) => setFillOpacity(rk, i, v)"
              />
            </div>
          </template>

          <!-- Image: source import, seam, scale, frame -->
          <template v-else-if="rawFill(rk)?.type === 'image'">
            <div class="mt-1 flex flex-col gap-1">
              <!-- Source row -->
              <label class="text-[11px] text-white/55">Source</label>
              <div class="flex items-center gap-2">
                <StudioButton @click="openFillImport(rk, i)">Import image…</StudioButton>
                <span class="truncate text-[11px] text-white/40">{{ (roleFill(rk, i) as any).src ? (roleFill(rk, i) as any).src.split('/').pop() : 'none' }}</span>
                <input
                  type="file"
                  accept="image/*"
                  class="hidden"
                  :ref="(el) => setFillInputRef(`${rk}_${i}`, el)"
                  @change="(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) onFillImport(rk, i, f) }"
                >
              </div>

                            <StudioSelect
                label="Seam"
                :options="['mirror', 'feather', 'direct']"
                :model-value="(roleFill(rk, i) as any).seam ?? 'mirror'"
                @update:model-value="(seam: string) => setFill(rk, { ...(roleFill(rk, i) as any), seam })"
              />

              <StudioSlider
                label="Scale"
                :min="0.25"
                :max="4"
                :step="0.05"
                :default="1"
                :model-value="(roleFill(rk, i) as any).scale ?? 1"
                @update:model-value="(scale: number) => setFill(rk, { ...(roleFill(rk, i) as any), scale })"
              />

                            <StudioSelect
                label="Frame"
                :options="['cell', 'tile']"
                :model-value="(roleFill(rk, i) as any).frame ?? 'tile'"
                @update:model-value="(frame: string) => setFill(rk, { ...(roleFill(rk, i) as any), frame })"
              />

              <StudioSlider
                label="Opacity"
                :min="0"
                :max="1"
                :step="0.01"
                :default="1"
                :model-value="(roleFill(rk, i) as any).opacity ?? 1"
                @update:model-value="(v: number) => setFillOpacity(rk, i, v)"
              />
            </div>
          </template>

          <!-- Link: mirrors another role's fill (cycle-guarded in fillForRole) -->
          <template v-else-if="rawFill(rk)?.type === 'link'">
            <div class="mt-1 flex flex-col gap-1">
                            <StudioSelect
                label="Link to role"
                :options="rolesFor(params).filter((r) => r !== rk)"
                :model-value="rawFill(rk)?.to ?? rolesFor(params).find((r) => r !== rk) ?? rk"
                @update:model-value="(to: string) => setFill(rk, { type: 'link', to } as any)"
              />
            </div>
          </template>

          <!-- Pattern: nested motif sub-picker -->
          <template v-else-if="rawFill(rk)?.type === 'pattern'">
            <div class="mt-1 flex flex-col gap-1">
                            <StudioSelect
                label="Motif"
                :options="['checker', 'stripes', 'dots', 'grid']"
                :model-value="(roleFill(rk, i) as any).sub?.motif ?? 'checker'"
                @update:model-value="(motif: string) => setSub(rk, i, { mode: 'procedural', motif })"
              />

              <StudioSlider
                label="Cells"
                :min="2"
                :max="12"
                :step="1"
                :default="4"
                :model-value="(roleFill(rk, i) as any).sub?.cells ?? 4"
                @update:model-value="(cells: number) => setSub(rk, i, { cells })"
              />

              <div class="flex items-center gap-2">
                                <StudioColorField
                  label="Color A"
                  :model-value="(roleFill(rk, i) as any).sub?.colorA ?? '#e8eef5'"
                  @update:model-value="(colorA: string) => setSub(rk, i, { colorA })"
                />
              </div>

              <div class="flex items-center gap-2">
                                <StudioColorField
                  label="Color B"
                  :model-value="(roleFill(rk, i) as any).sub?.colorB ?? '#7aa2f7'"
                  @update:model-value="(colorB: string) => setSub(rk, i, { colorB })"
                />
              </div>

              <div class="flex items-center gap-2">
                                <StudioColorField
                  label="Background"
                  :model-value="(roleFill(rk, i) as any).sub?.background ?? '#0e1116'"
                  @update:model-value="(background: string) => setSub(rk, i, { background })"
                />
              </div>

                            <StudioSelect
                label="Frame"
                :options="['cell', 'tile']"
                :model-value="(roleFill(rk, i) as any).frame ?? 'tile'"
                @update:model-value="(frame: string) => setFill(rk, { ...(roleFill(rk, i) as any), frame })"
              />

              <StudioSlider
                label="Opacity"
                :min="0"
                :max="1"
                :step="0.01"
                :default="1"
                :model-value="(roleFill(rk, i) as any).opacity ?? 1"
                @update:model-value="(v: number) => setFillOpacity(rk, i, v)"
              />
            </div>
          </template>
          </div><!-- /v-show isExpanded -->
        </div>
      </StudioSection>
    </template>
  </StudioModalShell>
  <CanvasContextMenu
    v-if="varMenu"
    :x="varMenu.x"
    :y="varMenu.y"
    :items="varMenu.items"
    @close="varMenu = null"
  />
  <SweepPopover
    v-if="sweepPopover"
    :control="sweepPopover.control"
    :anchor="sweepPopover.anchor"
    @apply="applySweep"
    @close="sweepPopover = null"
  />
</template>
