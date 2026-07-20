<template>
  <div class="bench">
    <h1>Shader bake bench</h1>
    <p class="note">
      Times the real Shader Studio bake path: composePasses → shaderFx.render → toBlob → upload.
      Answers "how fast is the bake, and is PNG costing us?"
    </p>

    <div class="controls">
      <label>iterations/cell <input v-model.number="iters" type="number" min="1" max="20"></label>
      <label><input v-model="doUpload" type="checkbox"> measure upload (hits /upload/image)</label>
      <button :disabled="running" @click="run">{{ running ? 'running…' : 'Run bench' }}</button>
      <span v-if="status" class="status">{{ status }}</span>
    </div>

    <table v-if="rows.length">
      <thead>
        <tr>
          <th>res</th><th>format</th>
          <th>render ms</th><th>encode ms</th><th>toBlob +ms</th><th>total ms</th>
          <th>size</th><th>upload ms</th>
          <th>30s@30fps (900f)</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.key" :class="{ png: r.format === 'png' }">
          <td>{{ r.res }}</td>
          <td>{{ r.format }}</td>
          <td>{{ r.render.toFixed(1) }}</td>
          <td>{{ r.encode.toFixed(1) }}</td>
          <td :class="{ artifact: r.blobOverhead > 300 }">{{ r.blobOverhead.toFixed(0) }}</td>
          <td class="strong">{{ (r.render + r.encode).toFixed(1) }}</td>
          <td>{{ fmtBytes(r.bytes) }}</td>
          <td>{{ r.upload != null ? r.upload.toFixed(0) : '—' }}</td>
          <td>{{ project(r) }}</td>
        </tr>
      </tbody>
    </table>

    <pre v-if="summary" class="summary">{{ summary }}</pre>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { shaderFx } from '~/lib/shaderfx/renderer'
import { composePasses } from '~/lib/shaderstudio/passes'
import { defaultConfig } from '~/lib/shaderstudio/types'

// Representative stack: every non-effect stage on, so the pass count matches a
// loaded-up studio config (6 passes) without needing the effect catalog.
function benchConfig() {
  const c = defaultConfig()
  c.effects[0]!.enabled = false
  c.duotone.enabled = true
  c.gradientMap.enabled = true
  c.adjust.enabled = true
  c.post.blur.enabled = true
  c.post.chromatic.enabled = true
  c.post.bloom.enabled = true
  return c
}

const RESOLUTIONS = [1024, 1536, 2048, 4096]
const FORMATS = [
  { name: 'png', mime: 'image/png', q: undefined as number | undefined },
  { name: 'jpeg q0.92', mime: 'image/jpeg', q: 0.92 },
  { name: 'webp q0.92', mime: 'image/webp', q: 0.92 },
]

interface Row {
  key: string; res: number; format: string
  render: number; encode: number
  /** toBlob cost beyond the sync encode — see the artifact note in run(). */
  blobOverhead: number
  bytes: number; upload: number | null
}

const iters = ref(5)
const doUpload = ref(true)
const running = ref(false)
const status = ref('')
const rows = ref<Row[]>([])
const summary = ref('')

/** Synthetic source with gradients + detail — compresses like real shader output. */
function makeSource(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = size; c.height = size
  const g = c.getContext('2d')!
  const grad = g.createLinearGradient(0, 0, size, size)
  grad.addColorStop(0, '#06283d'); grad.addColorStop(0.5, '#256d85'); grad.addColorStop(1, '#47b5ff')
  g.fillStyle = grad; g.fillRect(0, 0, size, size)
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `hsl(${(i * 37) % 360} 70% ${30 + (i % 50)}%)`
    g.fillRect((i * 137) % size, (i * 219) % size, size / 24, size / 24)
  }
  return c
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] ?? 0
}

function toBlob(c: HTMLCanvasElement, mime: string, q?: number): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('toBlob null'))), mime, q))
}

async function run() {
  running.value = true; rows.value = []; summary.value = ''
  const cfg = benchConfig()
  const out: Row[] = []

  try {
    for (const res of RESOLUTIONS) {
      const src = makeSource(Math.min(res, 2048))
      const passes = composePasses(cfg, () => null, 0)

      for (const f of FORMATS) {
        status.value = `${res}px ${f.name}…`
        await new Promise(r => setTimeout(r, 0))

        const renderMs: number[] = []
        const encodeMs: number[] = []
        const blobMs: number[] = []
        let bytes = 0
        let blob: Blob | null = null

        for (let i = 0; i < iters.value; i++) {
          const t0 = performance.now()
          shaderFx.render(passes, src, res, res)
          const t1 = performance.now()
          // Encode is timed with the SYNCHRONOUS toDataURL, not toBlob. Under
          // automation, toBlob adds a flat ~1s to image/png and image/jpeg
          // (but not image/webp) that does not scale with pixel count — an
          // instrumentation artifact that swamps the real signal. toDataURL
          // scales correctly and matches toBlob for webp, so it's the
          // trustworthy measure. toBlob is still timed separately below to
          // keep the artifact visible rather than hidden.
          const t1b = performance.now()
          shaderFx.outputCanvas!.toDataURL(f.mime, f.q)
          const encode = performance.now() - t1b

          blob = await toBlob(shaderFx.outputCanvas!, f.mime, f.q)
          const t2 = performance.now()
          renderMs.push(t1 - t0)
          encodeMs.push(encode)
          blobMs.push(t2 - t1b - encode)
          bytes = blob.size
        }

        let upload: number | null = null
        if (doUpload.value && blob) {
          const u0 = performance.now()
          const fd = new FormData()
          const ext = f.mime.split('/')[1]
          fd.append('image', new File([blob], `bench_${res}_${Date.now()}.${ext}`, { type: f.mime }))
          fd.append('overwrite', 'true')
          try {
            await fetch('/upload/image', { method: 'POST', body: fd })
            upload = performance.now() - u0
          } catch { upload = null }
        }

        out.push({
          key: `${res}-${f.name}`, res, format: f.name,
          render: median(renderMs), encode: median(encodeMs),
          blobOverhead: median(blobMs), bytes, upload,
        })
        rows.value = [...out]
      }
    }
    summary.value = buildSummary(out)
    status.value = 'done'
  } catch (e) {
    status.value = `failed: ${e}`
    console.error('[bench]', e)
  } finally {
    running.value = false
  }
}

/** Per-frame cost projected to a 900-frame (30s @ 30fps) bake. */
function project(r: Row): string {
  const per = r.render + r.encode + (r.upload ?? 0)
  const secs = (per * 900) / 1000
  const gb = (r.bytes * 900) / 1e9
  return `${fmtDur(secs)} · ${gb.toFixed(2)} GB`
}

function fmtDur(s: number): string {
  if (s < 60) return `${s.toFixed(0)}s`
  return `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s`
}

function fmtBytes(b: number): string {
  if (b > 1e6) return `${(b / 1e6).toFixed(1)} MB`
  return `${(b / 1e3).toFixed(0)} KB`
}

function buildSummary(out: Row[]): string {
  const lines: string[] = []
  for (const res of RESOLUTIONS) {
    const png = out.find(r => r.res === res && r.format === 'png')
    const jpeg = out.find(r => r.res === res && r.format.startsWith('jpeg'))
    const webp = out.find(r => r.res === res && r.format.startsWith('webp'))
    if (!png || !jpeg || !webp) continue
    const pngT = png.render + png.encode
    lines.push(
      `${res}px  encode: png ${png.encode.toFixed(0)}ms / jpeg ${jpeg.encode.toFixed(0)}ms ` +
      `(${(png.encode / Math.max(jpeg.encode, 0.01)).toFixed(1)}x) / webp ${webp.encode.toFixed(0)}ms ` +
      `(${(png.encode / Math.max(webp.encode, 0.01)).toFixed(1)}x)  |  ` +
      `size: png ${fmtBytes(png.bytes)} / jpeg ${fmtBytes(jpeg.bytes)} ` +
      `(${(png.bytes / Math.max(jpeg.bytes, 1)).toFixed(1)}x smaller)  |  ` +
      `png frame total ${pngT.toFixed(0)}ms`,
    )
  }
  return lines.join('\n')
}
</script>

<style scoped>
.bench { padding: 16px; font: 13px ui-monospace, monospace; color: #ddd; background: #111; min-height: 100vh }
h1 { font-size: 15px; margin: 0 0 4px }
.note { color: #888; margin: 0 0 12px; max-width: 70ch; line-height: 1.5 }
.controls { display: flex; gap: 14px; align-items: center; margin-bottom: 14px; flex-wrap: wrap }
label { display: flex; gap: 5px; align-items: center }
input[type=number] { width: 50px; background: #222; color: #ddd; border: 1px solid #444; padding: 2px 4px }
button { background: #2a5; color: #000; border: 0; padding: 5px 12px; cursor: pointer; font: inherit; font-weight: 600 }
button:disabled { background: #444; color: #888; cursor: default }
.status { color: #fa0 }
table { border-collapse: collapse; margin-bottom: 14px }
th, td { border: 1px solid #333; padding: 3px 9px; text-align: right }
th { background: #1c1c1c; color: #999; font-weight: 600 }
td:nth-child(2) { text-align: left }
.strong { color: #fff; font-weight: 700 }
tr.png { background: #1a1414 }
.artifact { color: #f66 }
.summary { color: #9c9; background: #161616; padding: 10px; border: 1px solid #333; line-height: 1.7; overflow-x: auto }
</style>
