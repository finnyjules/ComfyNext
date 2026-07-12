<script setup lang="ts">
/**
 * Export panel: renders every format through the real pipeline, optionally
 * converts to JPEG/WebP at a quality (client-side via canvas), reports file
 * size with an IAB 150KB initial-load warning, supports @2x, and downloads
 * the set as a ZIP. All client-side — no server or node changes.
 */
import JSZip from 'jszip'
import { computed, ref } from 'vue'

import type { GridEditorContext } from '~/composables/useGridEditor'

const emit = defineEmits<{ close: [] }>()

const ctx = inject<GridEditorContext>('gridEditor')!
const { template, outputs, sampleProps, effectiveBrand } = ctx

type Fmt = 'png' | 'jpeg' | 'webp'
const fileFormat = ref<Fmt>('png')
const quality = ref(0.85)
const scale = ref(1)
const IAB_CAP = 150 * 1024   // IAB LEAN initial-load budget

interface Row {
  id: string; key: string; file: string; label: string; w: number; h: number
  url: string | null; bytes: number; over: boolean; error: boolean; busy: boolean
}
const rows = ref<Row[]>([])
const running = ref(false)
let urls: string[] = []

/** One unique, filesystem-safe stem per output (variations of the same format
 *  get a numeric suffix) so the ZIP/contact-sheet filenames don't collide. */
function buildRows(): Row[] {
  const seen = new Map<string, number>()
  return outputs.value.map((o) => {
    const f = template.value.formats[o.format]
    const label = o.label ?? f?.label ?? o.format
    let stem = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || o.format
    const n = (seen.get(stem) ?? 0) + 1
    seen.set(stem, n)
    if (n > 1) stem = `${stem}-${n}`
    return {
      id: o.id, key: o.format, file: stem, label,
      w: Math.round((f?.w ?? 0) * scale.value), h: Math.round((f?.h ?? 0) * scale.value),
      url: null, bytes: 0, over: false, error: false, busy: true,
    }
  })
}

const mime = computed(() => fileFormat.value === 'png' ? 'image/png' : fileFormat.value === 'jpeg' ? 'image/jpeg' : 'image/webp')
const ext = computed(() => fileFormat.value === 'jpeg' ? 'jpg' : fileFormat.value)

function fmtBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${Math.round(n / 1024)} KB`
}

/** PNG blob → re-encoded blob in the chosen format (PNG passes through). */
async function reencode(png: Blob): Promise<Blob> {
  if (fileFormat.value === 'png') return png
  const bmp = await createImageBitmap(png)
  const canvas = document.createElement('canvas')
  canvas.width = bmp.width; canvas.height = bmp.height
  const cx = canvas.getContext('2d')!
  // JPEG has no alpha — flat white behind, matching how a display network would.
  if (fileFormat.value === 'jpeg') { cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, canvas.width, canvas.height) }
  cx.drawImage(bmp, 0, 0)
  return await new Promise<Blob>((res) => canvas.toBlob(b => res(b!), mime.value, quality.value))
}

async function renderOne(row: Row): Promise<Blob | null> {
  const f = template.value.formats[row.key]
  const res = await fetch('/api/render-template', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      template: template.value, aspect: row.key, outputId: row.id,
      width: Math.round(f.w * scale.value), height: Math.round(f.h * scale.value),
      props: sampleProps.value, brand: effectiveBrand.value,
    }),
  })
  if (!res.ok) return null
  return reencode(await res.blob())
}

async function run() {
  running.value = true
  urls.forEach(u => URL.revokeObjectURL(u)); urls = []
  rows.value = buildRows()
  for (const row of rows.value) {
    try {
      const blob = await renderOne(row)
      if (!blob) { row.error = true; row.busy = false; continue }
      const url = URL.createObjectURL(blob); urls.push(url)
      row.url = url; row.bytes = blob.size; row.over = blob.size > IAB_CAP; row.busy = false
    } catch { row.error = true; row.busy = false }
  }
  running.value = false
}

function downloadOne(row: Row) {
  if (!row.url) return
  const a = document.createElement('a')
  a.href = row.url; a.download = `${template.value.name || 'layout'}_${row.file}.${ext.value}`
  a.click()
}

async function downloadAll() {
  if (!rows.value.some(r => r.url)) await run()
  const zip = new JSZip()
  const base = (template.value.name || 'layout').toLowerCase().replace(/[^a-z0-9]+/g, '-')
  for (const row of rows.value) {
    if (!row.url) continue
    const blob = await fetch(row.url).then(r => r.blob())
    zip.file(`${base}_${row.file}.${ext.value}`, blob)
  }
  const out = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(out)
  const a = document.createElement('a')
  a.href = url; a.download = `${base}_ad-set.zip`; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** Composite every rendered format onto one labelled sheet for client/
 * stakeholder approval, downloaded as PNG. */
async function downloadContactSheet() {
  if (!rows.value.some(r => r.url)) await run()
  const ready = rows.value.filter(r => r.url)
  if (!ready.length) return
  const COLS = 3, CELL = 360, PAD = 24, LABEL = 28, GAP = 16
  const colW = CELL, rowH = CELL + LABEL
  const n = ready.length
  const gridRows = Math.ceil(n / COLS)
  const W = PAD * 2 + COLS * colW + (COLS - 1) * GAP
  const H = PAD * 2 + 48 + gridRows * rowH + (gridRows - 1) * GAP
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const cx = canvas.getContext('2d')!
  cx.fillStyle = '#0e0e10'; cx.fillRect(0, 0, W, H)
  cx.fillStyle = '#ffffff'; cx.font = '600 22px sans-serif'
  cx.fillText(template.value.name || 'Ad set', PAD, PAD + 22)
  for (let i = 0; i < n; i++) {
    const row = ready[i]
    const bmp = await createImageBitmap(await fetch(row.url!).then(r => r.blob()))
    const cellX = PAD + (i % COLS) * (colW + GAP)
    const cellY = PAD + 48 + Math.floor(i / COLS) * (rowH + GAP)
    // contain the thumb in the cell box
    const sc = Math.min(CELL / bmp.width, CELL / bmp.height)
    const dw = bmp.width * sc, dh = bmp.height * sc
    cx.fillStyle = '#000000'; cx.fillRect(cellX, cellY, CELL, CELL)
    cx.drawImage(bmp, cellX + (CELL - dw) / 2, cellY + (CELL - dh) / 2, dw, dh)
    cx.fillStyle = '#aaaaaa'; cx.font = '13px sans-serif'
    cx.fillText(`${row.label} · ${row.w}×${row.h}`, cellX, cellY + CELL + 18)
  }
  const blob = await new Promise<Blob>(res => canvas.toBlob(b => res(b!), 'image/png'))
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${(template.value.name || 'layout').toLowerCase().replace(/[^a-z0-9]+/g, '-')}_contact-sheet.png`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

onMounted(run)
onBeforeUnmount(() => urls.forEach(u => URL.revokeObjectURL(u)))
const selectCls = 'h-8 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white focus:outline-none focus:border-action/50'
</script>

<template>
  <div class="absolute inset-0 z-20 overflow-y-auto bg-[#121212]/97 backdrop-blur-sm">
    <div class="max-w-4xl mx-auto px-8 py-8">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-[15px] text-white/90 font-medium">Export ad set</h2>
          <p class="text-[12px] text-white/45 mt-1">Every output, rendered through the real pipeline. IAB display needs ≤ 150&nbsp;KB initial load.</p>
        </div>
        <button class="size-8 rounded-md bg-white/[0.06] hover:bg-white/[0.12] flex items-center justify-center text-white/70 cursor-pointer" @click="emit('close')">✕</button>
      </div>

      <div class="flex flex-wrap items-end gap-4 mt-5">
        <label class="flex flex-col gap-1">
          <span class="text-[10px] uppercase tracking-[0.12em] text-white/35">Format</span>
          <select v-model="fileFormat" :class="selectCls" @change="run">
            <option value="png">PNG</option>
            <option value="jpeg">JPEG</option>
            <option value="webp">WebP</option>
          </select>
        </label>
        <label v-if="fileFormat !== 'png'" class="flex flex-col gap-1">
          <span class="text-[10px] uppercase tracking-[0.12em] text-white/35">Quality {{ Math.round(quality * 100) }}%</span>
          <input type="range" min="0.4" max="1" step="0.05" v-model.number="quality" class="w-36" @change="run">
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-[10px] uppercase tracking-[0.12em] text-white/35">Scale</span>
          <select v-model.number="scale" :class="selectCls" @change="run">
            <option :value="1">@1x</option>
            <option :value="2">@2x</option>
          </select>
        </label>
        <div class="flex-1" />
        <button
          class="h-8 px-3 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-[12px] text-white/70 transition-colors cursor-pointer disabled:opacity-40"
          :disabled="running"
          title="One image with every format laid out, for client approval"
          @click="downloadContactSheet"
        >
          Contact sheet
        </button>
        <button
          class="h-8 px-3 rounded-md bg-action/20 hover:bg-action/30 text-[12px] text-[#c9d6ff] transition-colors cursor-pointer disabled:opacity-40"
          :disabled="running"
          @click="downloadAll"
        >
          {{ running ? 'Rendering…' : 'Download all (ZIP)' }}
        </button>
      </div>

      <div class="grid grid-cols-3 gap-4 mt-6">
        <div v-for="row in rows" :key="row.key" class="rounded-lg border border-white/[0.08] bg-[#0e0e10] overflow-hidden">
          <div class="flex items-center justify-center min-h-28 bg-black/40 p-2">
            <img v-if="row.url" :src="row.url" class="max-h-40 max-w-full rounded-sm" :alt="row.label">
            <span v-else-if="row.error" class="text-[11px] text-red-400">render failed</span>
            <span v-else class="text-[11px] text-white/35">rendering…</span>
          </div>
          <div class="px-3 py-2 flex items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="text-[12px] text-white/80 truncate">{{ row.label }}</div>
              <div class="text-[10px] tabular-nums" :class="row.over ? 'text-amber-400' : 'text-white/40'">
                {{ row.w }}×{{ row.h }} · {{ row.bytes ? fmtBytes(row.bytes) : '—' }}{{ row.over ? ' · over 150KB' : '' }}
              </div>
            </div>
            <button
              class="shrink-0 px-2 h-6 rounded text-[10px] bg-white/[0.06] hover:bg-white/[0.12] text-white/70 cursor-pointer disabled:opacity-30"
              :disabled="!row.url"
              @click="downloadOne(row)"
            >Save</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
