<script setup lang="ts">
/**
 * /dev/taste-wall — the executable-brand-kit spike's instrument
 * (docs/superpowers/spikes/2026-08-05-executable-brand-kit-spike.md).
 *
 * Rows = three studios (Gradient, Shader, Vector Type), columns =
 * neutral / elicited-A (deterministic) / elicited-A (Fable) / observed /
 * elicited-B (the anti-board control). Fixed composition discipline: same
 * gradient seed, same shader source image (the neutral gradient), same text —
 * only taste-driven params differ between columns.
 *
 * Board A/B come from `input/lora_dataset_*` via /api/dataset-match +
 * /api/training-image; images are downscaled client-side (64×64 RGBA for the
 * free deterministic /api/taste/analyze, ~768px JPEG for the BYOK Fable
 * /api/taste/read). The API key lives in a ref only — never persisted.
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { gradientFx } from '~/lib/gradientfx/renderer'
import { defaultConfig as gradientDefaultConfig } from '~/lib/gradientfx/randomize'
import { ensureConfigDefaults, type GradientConfig } from '~/lib/gradientfx/types'
import { defaultConfig as shaderDefaultConfig, type ShaderStudioConfig } from '~/lib/shaderstudio/types'
import { composePasses } from '~/lib/shaderstudio/passes'
import { shaderFx } from '~/lib/shaderfx/renderer'
import { fetchShaderFxCatalog, getEffectSync } from '~/lib/shaderfx/catalog'
import { drawVectorTypeToCanvas } from '~/lib/vectortype/canvas'
import { loadVariableFont, type VtFont } from '~/lib/vectortype/font'
import { DEFAULT_CONFIG, mergeConfig, type VectorTypeConfig } from '~/lib/vectortype/config'
import { applyTasteToConfigs, CONFIDENCE_FLOOR } from '~/lib/taste/mapping'
import { observedToConfigs, observedFacetProxies } from '~/lib/taste/observedConfigs'
import observedJson from '~/lib/taste/observed.json'
import { TASTE_FACETS, type TasteReading } from '~~/shared/taste/facets'

definePageMeta({ layout: false })

// ── Fixed composition constants (identical across every column) ─────────────
const CELL_W = 360
const CELL_H = 203 // 16:9, matching the gradient default aspect
const VT_LOGICAL_W = 1440
const VT_LOGICAL_H = 810
const FIXED_TEXT = 'The quiet parts, louder.'
const GRADIENT_SEED = '#tastewall'
const VT_BACKGROUND = '#101014'

type Studio = 'gradient' | 'shader' | 'vectortype'
type Column = 'neutral' | 'elicitedA' | 'fableA' | 'observed' | 'elicitedB'
const STUDIOS: { id: Studio; label: string }[] = [
  { id: 'gradient', label: 'Gradient' },
  { id: 'shader', label: 'Shader' },
  { id: 'vectortype', label: 'Vector Type' },
]
const COLUMNS: { id: Column; label: string }[] = [
  { id: 'neutral', label: 'Neutral' },
  { id: 'elicitedA', label: 'Elicited A (deterministic)' },
  { id: 'fableA', label: 'Elicited A (Fable)' },
  { id: 'observed', label: 'Observed' },
  { id: 'elicitedB', label: 'Elicited B (anti-board)' },
]

// ── State ───────────────────────────────────────────────────────────────────
interface FolderInfo { name: string; imageCount: number; cover: string | null }
interface Board { folder: string; thumbs: string[]; bigJpegs: string[]; pixels: { w: number; h: number; data: number[] }[] }

const folders = ref<FolderInfo[]>([])
const selA = ref(''), selB = ref('')
const freeA = ref(''), freeB = ref('')
const cap = ref(8)
const apiKey = ref('') // BYOK, memory only — never written to storage
const busy = ref('')
const error = ref('')

const boardA = ref<Board | null>(null)
const boardB = ref<Board | null>(null)
const uploadsA = ref<File[]>([])
const uploadsB = ref<File[]>([])
type PerImage = { palette: string[]; facets: Record<string, number> }
const perImageA = ref<PerImage[]>([])
const perImageB = ref<PerImage[]>([])
const readingA = ref<TasteReading | null>(null)
const readingB = ref<TasteReading | null>(null)
const paletteA = ref<string[]>([])
const paletteB = ref<string[]>([])
const fableA = ref<TasteReading | null>(null)
const fableB = ref<TasteReading | null>(null)

/** dataURL per `${studio}-${column}` cell. */
const cells = reactive<Record<string, string>>({})

const folderFor = (side: 'A' | 'B') =>
  (side === 'A' ? freeA.value.trim() || selA.value : freeB.value.trim() || selB.value)

onMounted(async () => {
  try {
    const res = await $fetch<{ folders: FolderInfo[] }>('/api/dataset-match?list=1')
    folders.value = res.folders
  }
  catch (e: any) { error.value = `folder list: ${e?.message ?? e}` }
})

// ── Image loading + client-side downscale ───────────────────────────────────
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`image failed: ${url}`))
    img.src = url
  })
}

function scaled(img: HTMLImageElement, maxSide: number): HTMLCanvasElement {
  const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(img.naturalWidth * k))
  c.height = Math.max(1, Math.round(img.naturalHeight * k))
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  return c
}

async function loadBoard(folder: string, count: number): Promise<Board> {
  const res = await $fetch<{ files: string[] }>(`/api/dataset-match?folder=${encodeURIComponent(folder)}`)
  const files = (res.files ?? []).slice(0, count)
  if (!files.length) throw new Error(`${folder}: no images`)
  const board: Board = { folder, thumbs: [], bigJpegs: [], pixels: [] }
  for (const file of files) {
    const img = await loadImage(`/api/training-image?folder=${encodeURIComponent(folder)}&file=${encodeURIComponent(file)}`)
    board.thumbs.push(scaled(img, 96).toDataURL('image/jpeg', 0.8))
    board.bigJpegs.push(scaled(img, 768).toDataURL('image/jpeg', 0.85))
    const px = document.createElement('canvas')
    px.width = 64; px.height = 64
    const ctx = px.getContext('2d')!
    ctx.drawImage(img, 0, 0, 64, 64)
    board.pixels.push({ w: 64, h: 64, data: Array.from(ctx.getImageData(0, 0, 64, 64).data) })
  }
  return board
}

/** Uploaded files → the same Board shape, fully client-side (files never leave the browser raw). */
async function loadBoardFromFiles(files: File[], count: number): Promise<Board> {
  const picked = files.slice(0, count)
  if (!picked.length) throw new Error('no images in the drop')
  const board: Board = { folder: `uploaded · ${picked.length} files`, thumbs: [], bigJpegs: [], pixels: [] }
  for (const file of picked) {
    const url = URL.createObjectURL(file)
    try {
      const img = await loadImage(url)
      board.thumbs.push(scaled(img, 96).toDataURL('image/jpeg', 0.8))
      board.bigJpegs.push(scaled(img, 768).toDataURL('image/jpeg', 0.85))
      const px = document.createElement('canvas')
      px.width = 64; px.height = 64
      const ctx = px.getContext('2d')!
      ctx.drawImage(img, 0, 0, 64, 64)
      board.pixels.push({ w: 64, h: 64, data: Array.from(ctx.getImageData(0, 0, 64, 64).data) })
    }
    finally { URL.revokeObjectURL(url) }
  }
  return board
}

function takeFiles(side: 'A' | 'B', list: FileList | File[] | null | undefined) {
  const files = Array.from(list ?? []).filter(f => /^image\//.test(f.type))
  if (!files.length) return
  ;(side === 'A' ? uploadsA : uploadsB).value = files
}

// ── Fixed bases + renderers ─────────────────────────────────────────────────
const deepClone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

function bases(): { gradient: GradientConfig; shader: ShaderStudioConfig; vectortype: VectorTypeConfig } {
  return {
    gradient: ensureConfigDefaults(gradientDefaultConfig(GRADIENT_SEED)),
    shader: shaderDefaultConfig(),
    vectortype: mergeConfig({ ...deepClone(DEFAULT_CONFIG), text: FIXED_TEXT, fontId: 'roboto-flex', size: 150 }),
  }
}

let vtFont: VtFont | null = null
async function ensureFont(): Promise<VtFont> {
  if (!vtFont) vtFont = await loadVariableFont('roboto-flex')
  return vtFont
}

/** The fixed shader source: the NEUTRAL gradient render, snapshotted once. */
let shaderSource: HTMLCanvasElement | null = null
function ensureShaderSource(neutralGradient: GradientConfig): HTMLCanvasElement {
  if (shaderSource) return shaderSource
  const rendered = gradientFx.render(neutralGradient, CELL_W, CELL_H, 0)
  const copy = document.createElement('canvas')
  copy.width = rendered.width; copy.height = rendered.height
  copy.getContext('2d')!.drawImage(rendered, 0, 0)
  shaderSource = copy
  return copy
}

function renderGradientCell(cfg: GradientConfig): string {
  return gradientFx.render(cfg, CELL_W, CELL_H, 0).toDataURL('image/jpeg', 0.9)
}

function renderShaderCell(cfg: ShaderStudioConfig, source: HTMLCanvasElement): string {
  const passes = composePasses(cfg, getEffectSync, 0)
  return shaderFx.render(passes, source, CELL_W, CELL_H).toDataURL('image/jpeg', 0.9)
}

function renderVectorCell(cfg: VectorTypeConfig, font: VtFont): string {
  const canvas = document.createElement('canvas')
  drawVectorTypeToCanvas(canvas, font, cfg, 0, {
    width: VT_LOGICAL_W, height: VT_LOGICAL_H, padding: 60,
    pixelRatio: CELL_W / VT_LOGICAL_W, background: VT_BACKGROUND,
  })
  return canvas.toDataURL('image/jpeg', 0.9)
}

function renderColumn(
  col: Column,
  cfgs: { gradient: GradientConfig; shader: ShaderStudioConfig; vectortype: VectorTypeConfig },
  source: HTMLCanvasElement,
  font: VtFont,
) {
  cells[`gradient-${col}`] = renderGradientCell(cfgs.gradient)
  cells[`shader-${col}`] = renderShaderCell(cfgs.shader, source)
  cells[`vectortype-${col}`] = renderVectorCell(cfgs.vectortype, font)
}

// ── The two runs ────────────────────────────────────────────────────────────
async function runAnalyze() {
  const fA = folderFor('A'), fB = folderFor('B')
  if (!uploadsA.value.length && !fA) { error.value = 'drop images on Board A or pick a dataset first'; return }
  error.value = ''
  try {
    busy.value = 'loading boards…'
    boardA.value = uploadsA.value.length
      ? await loadBoardFromFiles(uploadsA.value, cap.value)
      : await loadBoard(fA, cap.value)
    const wantB = uploadsB.value.length > 0 || !!fB
    boardB.value = wantB
      ? (uploadsB.value.length ? await loadBoardFromFiles(uploadsB.value, cap.value) : await loadBoard(fB, cap.value))
      : null

    busy.value = 'analyzing…'
    const resA = await $fetch<{ reading: TasteReading; palette: string[]; perImage: PerImage[] }>('/api/taste/analyze', {
      method: 'POST', body: { pixels: boardA.value.pixels },
    })
    readingA.value = resA.reading; paletteA.value = resA.palette; perImageA.value = resA.perImage ?? []
    if (boardB.value) {
      const resB = await $fetch<{ reading: TasteReading; palette: string[]; perImage: PerImage[] }>('/api/taste/analyze', {
        method: 'POST', body: { pixels: boardB.value.pixels },
      })
      readingB.value = resB.reading; paletteB.value = resB.palette; perImageB.value = resB.perImage ?? []
    }
    else { readingB.value = null; paletteB.value = []; perImageB.value = [] }

    busy.value = 'rendering wall…'
    await fetchShaderFxCatalog()
    const font = await ensureFont()
    const neutral = bases()
    const source = ensureShaderSource(neutral.gradient)
    renderColumn('neutral', neutral, source, font)
    renderColumn('elicitedA', applyTasteToConfigs(resA.reading, resA.palette, bases()), source, font)
    if (readingB.value) renderColumn('elicitedB', applyTasteToConfigs(readingB.value, paletteB.value, bases()), source, font)
    renderColumn('observed', observedToConfigs(observedJson as any, bases()), source, font)
    if (fableA.value) renderColumn('fableA', applyTasteToConfigs(fableA.value, paletteA.value, bases()), source, font)
  }
  catch (e: any) { error.value = e?.data?.statusMessage ?? e?.message ?? String(e) }
  finally { busy.value = '' }
}

async function runFable() {
  if (!apiKey.value.trim()) { error.value = 'Fable read needs an Anthropic API key (BYOK — no server key configured)'; return }
  if (!boardA.value) { error.value = 'run Analyze first (it loads the boards)'; return }
  error.value = ''
  try {
    busy.value = 'reading A with Fable…'
    const resA = await $fetch<{ reading: TasteReading }>('/api/taste/read', {
      method: 'POST', body: { images: boardA.value.bigJpegs.slice(0, 8), apiKey: apiKey.value.trim() },
    })
    fableA.value = resA.reading
    if (boardB.value) {
      busy.value = 'reading B with Fable…'
      const resB = await $fetch<{ reading: TasteReading }>('/api/taste/read', {
        method: 'POST', body: { images: boardB.value.bigJpegs.slice(0, 8), apiKey: apiKey.value.trim() },
      })
      fableB.value = resB.reading
    }

    busy.value = 'rendering…'
    await fetchShaderFxCatalog()
    const font = await ensureFont()
    const source = ensureShaderSource(bases().gradient)
    renderColumn('fableA', applyTasteToConfigs(resA.reading, paletteA.value, bases()), source, font)
  }
  catch (e: any) { error.value = e?.data?.statusMessage ?? e?.message ?? String(e) }
  finally { busy.value = '' }
}

// ── Readings + divergence view models ───────────────────────────────────────
function facetRows(reading: TasteReading | null) {
  return TASTE_FACETS.map((f) => {
    const r = reading?.facets[f.id]
    return {
      id: f.id, label: f.label, low: f.low, high: f.high,
      value: r?.value ?? null, confidence: r?.confidence ?? 0,
      read: !!r && r.confidence >= CONFIDENCE_FLOOR,
    }
  })
}

const divergence = computed(() => {
  const proxies = observedFacetProxies(observedJson as any)
  return TASTE_FACETS.map((f) => {
    const a = readingA.value?.facets[f.id]
    const elicited = a && a.confidence >= CONFIDENCE_FLOOR ? a.value : null
    const observed = (proxies as Record<string, number>)[f.id] ?? null
    return {
      id: f.id, label: f.label,
      elicited, observed,
      delta: elicited !== null && observed !== null ? Math.abs(elicited - observed) : null,
    }
  })
})

const fmt = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toFixed(2))
</script>

<template>
  <div style="min-height:100vh;background:#0b0b0f;color:#ddd;font-family:sans-serif;padding:20px">
    <h1 style="font-size:16px;margin:0 0 4px">Taste wall</h1>
    <p style="font-size:12px;color:#888;margin:0 0 14px;max-width:860px">
      Executable-brand-kit spike instrument. Fixed composition per studio (same seed, same shader source image, same text)
      — only taste-driven params differ per column. Analyze is free and deterministic; the Fable column needs your Anthropic key (kept in memory only).
    </p>

    <!-- Controls -->
    <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end;margin-bottom:14px">
      <div v-for="side in (['A', 'B'] as const)" :key="side" style="display:flex;flex-direction:column;gap:4px">
        <label style="font-size:11px;color:#aaa">{{ side === 'A' ? 'Board A (taste)' : 'Board B (anti-board)' }}</label>
        <select :value="side === 'A' ? selA : selB" :data-picker="side"
          @change="side === 'A' ? (selA = ($event.target as HTMLSelectElement).value) : (selB = ($event.target as HTMLSelectElement).value)"
          style="background:#15151c;color:#ddd;border:1px solid #2a2a35;border-radius:6px;padding:5px;min-width:220px">
          <option value="">— pick a dataset —</option>
          <option v-for="f in folders" :key="f.name" :value="f.name">{{ f.name }} ({{ f.imageCount }} imgs)</option>
        </select>
        <input :value="side === 'A' ? freeA : freeB" :data-free="side"
          @input="side === 'A' ? (freeA = ($event.target as HTMLInputElement).value) : (freeB = ($event.target as HTMLInputElement).value)"
          placeholder="…or type a folder name" spellcheck="false"
          style="background:#15151c;color:#ddd;border:1px solid #2a2a35;border-radius:6px;padding:5px;font-size:11px" />
        <label :data-drop="side"
          @dragover.prevent @drop.prevent="takeFiles(side, ($event as DragEvent).dataTransfer?.files)"
          style="border:1px dashed #3a3a48;border-radius:6px;padding:6px 8px;font-size:11px;color:#888;cursor:pointer;text-align:center">
          {{ (side === 'A' ? uploadsA : uploadsB).length ? `${(side === 'A' ? uploadsA : uploadsB).length} files ready — click Analyze` : '…or drop / click to upload images' }}
          <input type="file" multiple accept="image/*" :data-upload="side" style="display:none"
            @change="takeFiles(side, ($event.target as HTMLInputElement).files)" />
        </label>
      </div>
      <label style="font-size:11px;color:#aaa;display:flex;flex-direction:column;gap:4px">Images / board
        <input v-model.number="cap" type="number" min="1" max="32" data-cap
          style="width:70px;background:#15151c;color:#ddd;border:1px solid #2a2a35;border-radius:6px;padding:5px" />
      </label>
      <label style="font-size:11px;color:#aaa;display:flex;flex-direction:column;gap:4px">Anthropic API key (BYOK, memory only)
        <input v-model="apiKey" type="password" autocomplete="off" data-apikey placeholder="sk-ant-…"
          style="width:220px;background:#15151c;color:#ddd;border:1px solid #2a2a35;border-radius:6px;padding:5px" />
      </label>
      <button :disabled="!!busy" data-analyze @click="runAnalyze"
        style="background:#e6e6ea;color:#111;border:none;border-radius:8px;padding:8px 16px;font-weight:600;cursor:pointer">
        {{ busy || 'Analyze (free)' }}
      </button>
      <button :disabled="!!busy" data-fable @click="runFable"
        style="background:#2a2a35;color:#ddd;border:1px solid #3a3a48;border-radius:8px;padding:8px 16px;font-weight:600;cursor:pointer">
        Read with Fable
      </button>
    </div>
    <p v-if="error" data-error style="color:#e66;font-size:12px;margin:0 0 12px">{{ error }}</p>

    <!-- Board strips -->
    <div v-for="(board, i) in [boardA, boardB]" :key="i" style="margin-bottom:6px">
      <template v-if="board">
        <div style="font-size:11px;color:#888;margin-bottom:3px">{{ i === 0 ? 'A' : 'B' }} · {{ board.folder }}</div>
        <div :data-strip="i === 0 ? 'A' : 'B'" style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px">
          <img v-for="(t, j) in board.thumbs" :key="j" :src="t" style="height:48px;border-radius:4px;display:block" />
        </div>
      </template>
    </div>

    <!-- The wall -->
    <div style="overflow-x:auto;margin:14px 0">
      <table style="border-collapse:collapse">
        <thead>
          <tr>
            <th style="font-size:11px;color:#888;text-align:left;padding:4px 8px"></th>
            <th v-for="c in COLUMNS" :key="c.id" style="font-size:11px;color:#aaa;font-weight:600;text-align:left;padding:4px 8px">{{ c.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in STUDIOS" :key="s.id">
            <td style="font-size:12px;color:#ddd;font-weight:600;padding:4px 8px;vertical-align:top">{{ s.label }}</td>
            <td v-for="c in COLUMNS" :key="c.id" style="padding:4px 8px;vertical-align:top">
              <img v-if="cells[`${s.id}-${c.id}`]" :src="cells[`${s.id}-${c.id}`]" :data-cell="`${s.id}-${c.id}`"
                :style="{ width: CELL_W + 'px', maxWidth: 'none', display: 'block', borderRadius: '6px', background: '#000' }" />
              <div v-else :data-cell-empty="`${s.id}-${c.id}`"
                :style="{ width: CELL_W + 'px', height: CELL_H + 'px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed #2a2a35', borderRadius: '6px', color: '#555', fontSize: '11px' }">
                {{ c.id === 'fableA' ? 'needs key — run "Read with Fable"' : c.id === 'elicitedB' ? 'optional anti-board' : 'run Analyze' }}
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Readings panel -->
    <div style="display:flex;gap:28px;flex-wrap:wrap;margin:10px 0 18px">
      <div v-for="side in (['A', 'B'] as const)" :key="side" style="min-width:340px">
        <h2 style="font-size:13px;margin:0 0 6px">Reading {{ side }} <span style="color:#666;font-weight:400">(deterministic{{ (side === 'A' ? fableA : fableB) ? ' + Fable' : '' }})</span></h2>
        <div v-for="which in ((side === 'A' ? [readingA, fableA] : [readingB, fableB]) as (TasteReading | null)[])" :key="which === (side === 'A' ? readingA : readingB) ? 'det' : 'fable'">
          <template v-if="which">
            <div v-for="row in facetRows(which)" :key="row.id" :data-facet="`${side}-${row.id}`" style="display:flex;align-items:center;gap:8px;margin-bottom:2px">
              <span style="font-size:10px;color:#888;width:130px;text-align:right">{{ row.label }}</span>
              <div style="width:150px;height:8px;background:#1a1a22;border-radius:4px;position:relative">
                <div v-if="row.value !== null" :style="{ position: 'absolute', left: 0, top: 0, bottom: 0, width: (row.value * 100) + '%', background: row.read ? '#7aa2f7' : '#3a3a48', borderRadius: '4px' }" />
              </div>
              <span style="font-size:10px;color:#aaa;width:88px" :data-facet-value="`${side}-${row.id}`">
                {{ row.value === null ? 'unread' : `${row.value.toFixed(2)} · c ${row.confidence.toFixed(2)}` }}
              </span>
            </div>
            <div style="font-size:11px;color:#888;margin:6px 0 10px">
              <span v-if="which.avoids?.length">avoids: {{ which.avoids.join(' · ') }}</span>
              <span v-else>avoids: —</span>
              <span v-if="which.clusters?.length"> · clusters: {{ which.clusters.map(c => c.label ?? '?').join(', ') }}</span>
            </div>
          </template>
        </div>
        <div v-if="(side === 'A' ? paletteA : paletteB).length" style="display:flex;gap:4px;margin-top:4px">
          <div v-for="hex in (side === 'A' ? paletteA : paletteB)" :key="hex" :title="hex"
            :style="{ width: '28px', height: '28px', borderRadius: '5px', background: hex, border: '1px solid #2a2a35' }" />
        </div>
      </div>
    </div>

    <!-- Per-image extraction: what the analyzer sees in each image -->
    <div v-for="side in (['A', 'B'] as const)" :key="`per-${side}`" style="margin:0 0 18px">
      <template v-if="(side === 'A' ? perImageA : perImageB).length && (side === 'A' ? boardA : boardB)">
        <h2 style="font-size:13px;margin:0 0 6px">Per-image extraction · {{ side }} <span style="color:#666;font-weight:400">(deterministic, per source)</span></h2>
        <div :data-per-image="side" style="display:flex;gap:10px;flex-wrap:wrap">
          <div v-for="(pi, j) in (side === 'A' ? perImageA : perImageB)" :key="j"
            style="background:#12121a;border:1px solid #22222c;border-radius:8px;padding:8px;width:150px">
            <img :src="(side === 'A' ? boardA : boardB)!.thumbs[j]" style="width:100%;border-radius:5px;display:block;margin-bottom:6px" />
            <div style="display:flex;gap:3px;margin-bottom:6px">
              <div v-for="hex in pi.palette" :key="hex" :title="hex" :style="{ flex: 1, height: '14px', borderRadius: '3px', background: hex }" />
            </div>
            <div v-for="(v, fid) in pi.facets" :key="fid" style="display:flex;justify-content:space-between;font-size:9.5px;color:#999">
              <span>{{ fid }}</span><span style="color:#ccc">{{ (v as number).toFixed(2) }}</span>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- Raw extraction JSON -->
    <details v-if="readingA" style="margin:0 0 18px" data-raw-json>
      <summary style="font-size:12px;color:#888;cursor:pointer">Raw extraction JSON (aggregate readings + Fable)</summary>
      <pre style="font-size:10.5px;color:#9a9;background:#0f0f14;border:1px solid #22222c;border-radius:6px;padding:10px;overflow-x:auto;max-height:400px">{{ JSON.stringify({ deterministicA: readingA, paletteA, fableA, deterministicB: readingB, paletteB, fableB }, null, 2) }}</pre>
    </details>

    <!-- Divergence readout -->
    <h2 style="font-size:13px;margin:0 0 4px">Elicited A vs observed — rough agreement check</h2>
    <p style="font-size:11px;color:#777;margin:0 0 8px;max-width:720px">
      Observed proxies exist only where the mapping is trivially invertible (grain → texture, background luma → value bias).
      This is a sanity read, not science.
    </p>
    <table style="border-collapse:collapse;font-size:11px" data-divergence>
      <thead>
        <tr>
          <th style="text-align:left;color:#888;padding:2px 12px 2px 0">Facet</th>
          <th style="text-align:left;color:#888;padding:2px 12px 2px 0">Elicited A</th>
          <th style="text-align:left;color:#888;padding:2px 12px 2px 0">Observed proxy</th>
          <th style="text-align:left;color:#888;padding:2px 12px 2px 0">|Δ|</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in divergence" :key="row.id">
          <td style="color:#aaa;padding:2px 12px 2px 0">{{ row.label }}</td>
          <td style="color:#ddd;padding:2px 12px 2px 0">{{ fmt(row.elicited) }}</td>
          <td style="color:#ddd;padding:2px 12px 2px 0">{{ row.observed === null ? 'n/a' : fmt(row.observed) }}</td>
          <td style="color:#ddd;padding:2px 12px 2px 0">{{ row.delta === null ? 'n/a' : fmt(row.delta) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
