<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { Dices } from 'lucide-vue-next'
import { textureFx } from '~/lib/texturefx/renderer'
import { preloadStylize, stylizeTile } from '~/lib/texturefx/stylize'
import { loadRaster, getRaster, buildSeamlessInputs } from '~/lib/texturefx/raster'
import { TEXTURE_CONTROLS, textureDefaults } from '~/lib/texturefx/controls'
import { TEXTURE_SECTIONS } from '~/lib/texturefx/sections'
import { cloneParams } from '~/lib/texturefx/types'
import { rolesFor } from '~/lib/texturefx/roles'
import { fillForRole } from '~/lib/texturefx/fills'
import type { Fill } from '~/lib/texturefx/types'
import type { Params } from '~/lib/spacetype/effect'
import type { TextureControl } from '~/lib/texturefx/controls'
import StudioModalShell from '~/components/vue-canvas/StudioModalShell.vue'
import StudioSection from '~/components/vue-canvas/StudioSection.vue'
import StudioButton from '~/components/vue-canvas/studio/StudioButton.vue'
import StudioColor from '~/components/vue-canvas/studio/StudioColor.vue'
import StudioSlider from '~/components/vue-canvas/studio/StudioSlider.vue'
import StudioSelect from '~/components/vue-canvas/studio/StudioSelect.vue'

const props = defineProps<{ nodeId: string; nodes: any[] }>()
const emit = defineEmits<{ (e: 'close'): void }>()

// Record generated stills as the current project's assets (Assets panel).
const { recordAsset } = useProjectGenerations()
const { activeTab } = useTabs()

const params = reactive<Params>(textureDefaults())
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

function loadParams() {
  const p = currentNode()?.data?.properties?.comfynext_textureStudio
  if (p && typeof p === 'object') Object.assign(params, { ...textureDefaults(), ...cloneParams(p) })
  if (String(params.mode) === 'raster' && params.rasterSrc) {
    loadRaster(String(params.rasterSrc)).then(renderPreview).catch(() => {})
  }
}
function saveParams() {
  const n = currentNode(); if (!n) return
  if (!n.data) n.data = {}
  if (!n.data.properties) n.data.properties = {}
  n.data.properties.comfynext_textureStudio = cloneParams({ ...params })
}
function closeEditor() {
  try { saveParams() } catch (e) { console.error('[texture] save failed', e) }
  emit('close')
}

// Group visible controls by section, in TEXTURE_SECTIONS order. A control with
// a `when` predicate is shown only when it returns true for the current params
// (contextual reveal); sections with no visible controls are omitted.
const sections = computed(() => {
  const byGroup = new Map<string, TextureControl[]>()
  for (const c of TEXTURE_CONTROLS as TextureControl[]) {
    if (c.when && !c.when(params)) continue
    const g = String(c.group)
    if (!(TEXTURE_SECTIONS as readonly string[]).includes(g)) continue
    if (!byGroup.has(g)) byGroup.set(g, [])
    byGroup.get(g)!.push(c)
  }
  return TEXTURE_SECTIONS
    .filter((g) => byGroup.has(g) && byGroup.get(g)!.length > 0)
    .map((g) => ({ title: g, controls: byGroup.get(g)! }))
})

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

function setFillType(rk: string, i: number, type: 'solid' | 'gradient' | 'image') {
  const cur = roleFill(rk, i)
  if (type === 'solid')
    setFill(rk, { type: 'solid', color: cur.type === 'solid' ? cur.color : ((cur as any).stops?.[0]?.c ?? '#7aa2f7') })
  else if (type === 'gradient')
    setFill(rk, { type: 'gradient', frame: 'cell', kind: 'linear', angle: 0, stops: [{ c: '#e8eef5', p: 0 }, { c: '#7aa2f7', p: 1 }] })
  else
    setFill(rk, { type: 'image', frame: 'tile', src: '', seam: 'mirror', scale: 1 } as any)
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

// Render the full-res tile and apply stylize, then encode. 1024 is a multiple of
// 64 so dither stays seamless.
async function exportBlob(): Promise<Blob> {
  const styled = stylizeTile(textureFx.render(params, 1024, 1024, 0), params, 1024, 1024)
  return await new Promise<Blob>((res, rej) =>
    styled.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'))
}

async function sendToCanvas() {
  baking.value = true; bakeMsg.value = 'Rendering…'
  try {
    const blob = await exportBlob()
    const { uploadFrameBatch } = await import('~/composables/useKineticRenderer')
    const [filename] = await uploadFrameBatch([blob], 'texture_img')
    if (filename) {
      saveParams()
      await recordAsset(activeTab.value?.projectUuid, 'image', filename)
      window.dispatchEvent(new CustomEvent('comfynext:textureStudioOutput', {
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
})
onBeforeUnmount(() => {
  try { saveParams() } catch { /* swallow */ }
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <StudioModalShell title="Texture Studio" @close="closeEditor">
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
      <StudioSection v-for="s in sections" :key="s.title" :title="s.title">
        <div v-for="c in s.controls" :key="c.key">
          <template v-if="c.kind === 'slider'">
            <!-- StudioSlider uses defineModel<number> — bind with v-model -->
            <StudioSlider
              :label="c.label"
              :min="Number(c.min)"
              :max="Number(c.max)"
              :step="Number(c.step)"
              :default="Number(c.default)"
              :model-value="Number(params[c.key])"
              @update:model-value="(v: number) => { params[c.key] = v; onParam() }"
            />
          </template>
          <template v-else-if="c.kind === 'select'">
            <label class="mb-1 block text-[11px] text-white/55">{{ c.label }}</label>
            <!-- StudioSelect uses defineModel<string> — bind with v-model -->
            <StudioSelect
              :options="c.options as string[]"
              :model-value="String(params[c.key])"
              @update:model-value="(v: string) => { params[c.key] = v; onParam() }"
            />
          </template>
          <template v-else-if="c.kind === 'color'">
            <div class="flex items-center gap-2">
              <label class="text-[11px] text-white/55">{{ c.label }}</label>
              <!-- StudioColor uses defineModel<string> — bind with v-model -->
              <StudioColor
                :model-value="String(params[c.key])"
                @update:model-value="(v: string) => { params[c.key] = v; onParam() }"
              />
            </div>
          </template>
        </div>
      </StudioSection>

      <!-- Fills panel: per-role solid/gradient fill pickers (not driven by TEXTURE_CONTROLS). -->
      <!-- Hidden in raster mode (raster has no ink/ground roles). -->
      <StudioSection v-if="params.mode !== 'raster'" title="Fills">
        <div v-for="(rk, i) in rolesFor(params)" :key="rk" class="mb-3">
          <label class="mb-1 block text-[11px] uppercase tracking-wide text-white/55">{{ rk }}</label>

          <!-- Fill-type picker: Solid / Gradient / Image -->
          <label class="mb-1 block text-[11px] text-white/55">Type</label>
          <StudioSelect
            :options="['solid', 'gradient', 'image']"
            :model-value="roleFill(rk, i).type === 'gradient' ? 'gradient' : roleFill(rk, i).type === 'image' ? 'image' : 'solid'"
            @update:model-value="(t: string) => setFillType(rk, i, t as 'solid' | 'gradient' | 'image')"
          />

          <!-- Solid: single color picker -->
          <template v-if="roleFill(rk, i).type === 'solid'">
            <div class="mt-1 flex items-center gap-2">
              <label class="text-[11px] text-white/55">Color</label>
              <StudioColor
                :model-value="(roleFill(rk, i) as any).color ?? '#7aa2f7'"
                @update:model-value="(c: string) => setFill(rk, { type: 'solid', color: c })"
              />
            </div>
          </template>

          <!-- Gradient: kind, angle, two stops, frame -->
          <template v-else-if="roleFill(rk, i).type === 'gradient'">
            <div class="mt-1 flex flex-col gap-1">
              <label class="text-[11px] text-white/55">Kind</label>
              <StudioSelect
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

              <div class="flex items-center gap-2">
                <label class="text-[11px] text-white/55">Start</label>
                <StudioColor
                  :model-value="(roleFill(rk, i) as any).stops?.[0]?.c ?? '#e8eef5'"
                  @update:model-value="(c: string) => { const s = (roleFill(rk, i) as any).stops; setGradient(rk, i, { stops: [{ c, p: 0 }, s?.[1] ?? { c: '#7aa2f7', p: 1 }] }) }"
                />
              </div>

              <div class="flex items-center gap-2">
                <label class="text-[11px] text-white/55">End</label>
                <StudioColor
                  :model-value="(roleFill(rk, i) as any).stops?.[1]?.c ?? '#7aa2f7'"
                  @update:model-value="(c: string) => { const s = (roleFill(rk, i) as any).stops; setGradient(rk, i, { stops: [s?.[0] ?? { c: '#e8eef5', p: 0 }, { c, p: 1 }] }) }"
                />
              </div>

              <label class="text-[11px] text-white/55">Frame</label>
              <StudioSelect
                :options="['cell', 'tile']"
                :model-value="(roleFill(rk, i) as any).frame ?? 'cell'"
                @update:model-value="(fr: string) => setGradient(rk, i, { frame: fr as any })"
              />
            </div>
          </template>

          <!-- Image: source import, seam, scale, frame -->
          <template v-else-if="roleFill(rk, i).type === 'image'">
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

              <label class="text-[11px] text-white/55">Seam</label>
              <StudioSelect
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

              <label class="text-[11px] text-white/55">Frame</label>
              <StudioSelect
                :options="['cell', 'tile']"
                :model-value="(roleFill(rk, i) as any).frame ?? 'tile'"
                @update:model-value="(frame: string) => setFill(rk, { ...(roleFill(rk, i) as any), frame })"
              />
            </div>
          </template>
        </div>
      </StudioSection>
    </template>
  </StudioModalShell>
</template>
