<!-- frontend/app/components/vue-canvas/MoodboardModal.vue -->
<script setup lang="ts">
// The moodboard modal (plan 2026-08-06-moodboards-a-core, Task A6): a
// brand-guidelines DOCUMENT, not a form. One scroll column — board images,
// the Fable reading as open editable prose, named palette swatches, avoid
// chips — with a floating left nav that tracks scroll and a floating footer
// (Re-read · Save). No section numbers, no subheaders, no dividers. Amber is
// the only accent (taste), per the impeccable idioms.
//
// Library owns the entry; the opening node only references it. Save PUTs the
// entry via useMoodboards() and writes properties.sailor_moodboard back onto
// the node (the GradientStudioSurface persistence pattern: mutate the node
// record in the `nodes` array the canvas passed us).
import { useMoodboards, slugifyMoodboardName } from '~/composables/useMoodboards'
import { syncMoodboardWidgets, moodboardRefDescriptors } from '~/lib/graph/moodboardApply'
import { sectionIds, activeSection, type SectionId } from '~/lib/taste/moodboardModal'
import type { MoodboardEntry } from '~~/shared/taste/moodboard'

const props = defineProps<{ nodeId?: string | null, nodes?: any[] }>()
const emit = defineEmits<{ close: [] }>()

const { refresh, save, byId, loaded } = useMoodboards()
const { getLocalSetting } = useLocalSettings()
const { aiAvailable } = useAiStatus()

// ── editable document state ─────────────────────────────────────────────────
const name = ref('Moodboard')
const summary = ref('')
const palette = ref<{ name: string, hex: string }[]>([])
const avoids = ref<string[]>([])
const folder = ref('')            // input/moodboard_<ms> — minted by the first upload
const files = ref<string[]>([])   // stored image filenames (server truth)
const savedId = ref('')           // library id once saved (slug on first save)
const createdAt = ref('')

const NAV_LABELS: Record<SectionId, string> = { board: 'Board', reading: 'Reading', palette: 'Palette', avoids: 'Avoids' }

function currentNode() { return props.nodes?.find((n: any) => String(n.id) === String(props.nodeId)) }

onMounted(async () => {
  if (!loaded.value) await refresh().catch(() => {})
  const id = String(currentNode()?.data?.properties?.sailor_moodboard || '')
  const entry = id ? byId(id) : undefined
  if (entry) {
    savedId.value = entry.id
    name.value = entry.name
    createdAt.value = entry.createdAt
    folder.value = entry.folder
    summary.value = entry.reading.summary
    palette.value = entry.reading.palette.map(p => ({ ...p }))
    avoids.value = [...entry.reading.avoids]
  }
  await refreshFiles()
  setupNavObserver()
})

async function refreshFiles() {
  if (!folder.value) { files.value = []; return }
  try {
    const res = await fetch(`/api/moodboards/images?folder=${encodeURIComponent(folder.value)}`)
    if (res.ok) files.value = (await res.json()).files ?? []
  } catch { /* offline dev — keep the last list */ }
}
const imageUrl = (f: string) =>
  `/api/moodboards/images?folder=${encodeURIComponent(folder.value)}&file=${encodeURIComponent(f)}`

// ── images: decode client-side → upload once ────────────────────────────────
// The taste-wall `scaled()` pattern: decode in the browser, keep a 768px JPEG
// data URL per image for the Fable read, and send the originals up exactly once.
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

// 768px JPEGs decoded THIS session. Used for the read only while they cover
// the whole board; otherwise (reopened board, partial adds) the stored images
// are fetched back and downscaled — one code path for Read and Re-read.
const sessionBigJpegs = ref<string[]>([])
const uploading = ref(false)
const uploadError = ref('')

async function addFiles(list: FileList | File[] | null | undefined) {
  const imgs = Array.from(list ?? []).filter(f => /^image\//.test(f.type))
  if (!imgs.length || uploading.value) return
  uploading.value = true
  uploadError.value = ''
  try {
    // Decode first — a file the browser can't decode never gets uploaded.
    const good: File[] = []
    for (const f of imgs) {
      const url = URL.createObjectURL(f)
      try {
        const img = await loadImage(url)
        sessionBigJpegs.value.push(scaled(img, 768).toDataURL('image/jpeg', 0.85))
        good.push(f)
      }
      catch { /* skip undecodable file */ }
      finally { URL.revokeObjectURL(url) }
    }
    if (!good.length) { uploadError.value = 'None of those files decoded as images.'; return }
    const fd = new FormData()
    if (folder.value) fd.append('folder', folder.value) // re-upload into the existing board
    for (const f of good) fd.append('images', f, f.name)
    const res = await fetch('/api/moodboards/images', { method: 'POST', body: fd })
    if (!res.ok) throw new Error(`upload failed (${res.status})`)
    const out = await res.json() as { folder: string, files: string[] }
    folder.value = out.folder
    await refreshFiles()
  }
  catch (e: any) {
    uploadError.value = e?.message || 'Upload failed.'
  }
  finally { uploading.value = false }
}

const fileInput = ref<HTMLInputElement | null>(null)
function onPickFiles(e: Event) {
  const input = e.target as HTMLInputElement
  void addFiles(input.files)
  input.value = ''
}
function onDrop(e: DragEvent) {
  e.preventDefault()
  void addFiles(e.dataTransfer?.files)
}

// ── the Fable read ──────────────────────────────────────────────────────────
const readBusy = ref(false)
const readError = ref('')
const hasRead = computed(() => !!summary.value.trim())

/** Stored board images → 768px JPEG data URLs (list + serve + downscale). */
async function downscaleStored(): Promise<string[]> {
  const out: string[] = []
  for (const f of files.value.slice(0, 8)) {
    const img = await loadImage(imageUrl(f))
    out.push(scaled(img, 768).toDataURL('image/jpeg', 0.85))
  }
  return out
}

async function runRead() {
  if (readBusy.value) return
  readError.value = ''
  readBusy.value = true
  try {
    const bigs = (sessionBigJpegs.value.length && sessionBigJpegs.value.length >= files.value.length)
      ? sessionBigJpegs.value
      : await downscaleStored()
    if (!bigs.length) throw new Error('Add a few images first — the reading comes from the board.')
    const res = await $fetch<{ reading?: { avoids?: string[] }, summary?: string, palette?: { name: string, hex: string }[] }>(
      '/api/taste/read',
      { method: 'POST', body: { images: bigs.slice(0, 8), apiKey: getLocalSetting('Sailor.AI.AnthropicApiKey') ?? '' } },
    )
    summary.value = res.summary?.trim() || ''
    palette.value = (res.palette ?? []).map(p => ({ ...p }))
    avoids.value = [...(res.reading?.avoids ?? [])]
    if (!summary.value) readError.value = 'The read came back empty — try again.'
    await nextTick()
    autogrow()
  }
  catch (e: any) {
    // Keep the board and whatever reading was already there — inline error + Retry.
    readError.value = e?.data?.statusMessage || e?.statusMessage || e?.message || 'Read failed.'
  }
  finally { readBusy.value = false }
}

// ── palette strikes + avoid chips ───────────────────────────────────────────
function removeSwatch(i: number) { palette.value = palette.value.filter((_, idx) => idx !== i) }
function removeAvoid(i: number) { avoids.value = avoids.value.filter((_, idx) => idx !== i) }
const newAvoid = ref('')
function addAvoid() {
  const a = newAvoid.value.trim()
  if (a && !avoids.value.includes(a)) avoids.value = [...avoids.value, a]
  newAvoid.value = ''
}

// ── save ────────────────────────────────────────────────────────────────────
const saving = ref(false)
const saveError = ref('')
const savedFlash = ref(false)
// Never save without a reading: A1's server validation backs this, the button
// simply refuses first. A folder is required too — the entry is its images.
const canSave = computed(() => !!summary.value.trim() && !!folder.value && !!name.value.trim() && !saving.value)

async function saveBoard() {
  if (!canSave.value) return
  saving.value = true
  saveError.value = ''
  const now = new Date().toISOString()
  const id = savedId.value || slugifyMoodboardName(name.value)
  const entry: MoodboardEntry = {
    id,
    name: name.value.trim(),
    createdAt: createdAt.value || now, // stamped on first save
    updatedAt: now,                    // server re-stamps authoritatively
    folder: folder.value,
    reading: {
      summary: summary.value.trim(),
      palette: palette.value.map(p => ({ ...p })),
      avoids: [...avoids.value],
    },
  }
  try {
    await save(entry)
    savedId.value = id
    createdAt.value = entry.createdAt
    // Reference the entry from the opening node — properties-only state
    // (convertToLiteGraph drops anything else on save) — and sync the Python
    // twin's hidden reading_json/moodboard_id widgets by name (Task B4), so
    // graphToPrompt carries the reading to the backend.
    const n = currentNode()
    if (n) {
      n.data ||= {}
      n.data.properties ||= {}
      n.data.properties.sailor_moodboard = id
      syncMoodboardWidgets(n.data, entry)
    }
    // Task B5: expose the board's first images as project @refs
    // (`mb-<slug>-<i>`). The server flattens them into the input ROOT
    // (subpath filenames 404 in the app's /view-based image widgets), and the
    // layout's sailor:createRef handler owns the registry write (setRef +
    // markDocEdited + persistWorkflows) — same decoupling as the ArtifactImage
    // `@` promote. Best-effort: the save itself already succeeded, so a refs
    // failure warns instead of surfacing as a save error.
    try {
      const { files: flat } = await $fetch<{ files: string[] }>('/api/moodboards/refs', {
        method: 'POST', body: { folder: folder.value, slug: id },
      })
      const refs = moodboardRefDescriptors(id, flat)
      if (refs.length) {
        window.dispatchEvent(new CustomEvent('sailor:createRef', { detail: { refs } }))
      }
    }
    catch (e) { console.warn('[moodboard] @refs registration failed', e) }
    savedFlash.value = true
    setTimeout(() => { savedFlash.value = false }, 1500)
  }
  catch (e: any) {
    saveError.value = e?.message || 'Save failed.'
  }
  finally { saving.value = false }
}

// ── floating nav: IntersectionObserver → activeSection ─────────────────────
const scrollEl = ref<HTMLElement | null>(null)
const active = ref<string>(sectionIds[0])
const visibility = new Map<string, boolean>()
let observer: IntersectionObserver | null = null

function setupNavObserver() {
  const root = scrollEl.value
  if (!root || typeof IntersectionObserver === 'undefined') return
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) visibility.set((e.target as HTMLElement).dataset.section || '', e.isIntersecting)
    active.value = activeSection(
      [...visibility.entries()].map(([id, visible]) => ({ id, visible })),
      active.value,
    )
  }, { root, threshold: 0.05 })
  for (const el of root.querySelectorAll<HTMLElement>('[data-section]')) observer.observe(el)
}
onBeforeUnmount(() => observer?.disconnect())

function goTo(id: string) {
  scrollEl.value?.querySelector<HTMLElement>(`[data-section="${id}"]`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// ── prose textarea autogrow (open text, no box chrome) ─────────────────────
const summaryEl = ref<HTMLTextAreaElement | null>(null)
function autogrow() {
  const el = summaryEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}
watch(summary, () => nextTick(autogrow))
onMounted(() => nextTick(autogrow))

// ── modal chrome ────────────────────────────────────────────────────────────
const rootEl = ref<HTMLElement | null>(null)
function onKeydown(e: KeyboardEvent) {
  if (e.defaultPrevented) return
  if (e.key === 'Escape') { e.stopPropagation(); emit('close') }
}
onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  rootEl.value?.focus()
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
    <div
      ref="rootEl" tabindex="-1" role="dialog" aria-modal="true" data-testid="moodboard-modal"
      class="relative flex h-[820px] max-h-[92vh] w-[960px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[#0e0e10] text-white outline-none"
    >
      <!-- header: editable name (the document's title) · esc · close -->
      <div class="flex shrink-0 items-center gap-2 px-5 pt-3 pb-1">
        <input
          v-model="name" data-testid="mb-name" spellcheck="false"
          class="min-w-0 flex-1 bg-transparent text-[13px] font-medium tracking-[-0.01em] text-white/90 outline-none placeholder:text-white/30"
          placeholder="Name this moodboard"
        >
        <span class="rounded border border-white/10 px-1.5 py-0.5 text-[11px] text-white/30">esc</span>
        <button type="button" aria-label="Close" class="text-white/45 transition-colors hover:text-white/80" @click="emit('close')">✕</button>
      </div>

      <!-- floating left nav — the only wayfinding in the document -->
      <nav class="absolute left-5 top-16 z-10 flex flex-col gap-1.5">
        <button
          v-for="id in sectionIds" :key="id" type="button"
          class="text-left text-[11px] tracking-wide transition-colors"
          :class="active === id ? 'text-amber-300' : 'text-white/35 hover:text-white/60'"
          @click="goTo(id)"
        >{{ NAV_LABELS[id] }}</button>
      </nav>

      <!-- the document -->
      <div ref="scrollEl" class="min-h-0 flex-1 overflow-y-auto scroll-pt-6 pl-32 pr-10 pb-28">
        <!-- Board: full-bleed grid + drop cell -->
        <section data-section="board" class="pt-4" @dragover.prevent @drop="onDrop">
          <div class="grid grid-cols-4 gap-1.5">
            <img
              v-for="f in files" :key="f" :src="imageUrl(f)" :alt="f" data-testid="mb-board-image"
              class="aspect-square w-full rounded-md object-cover"
            >
            <label
              class="flex aspect-square w-full cursor-pointer items-center justify-center rounded-md border border-dashed border-white/15 text-[11px] text-white/35 transition-colors hover:border-amber-400/40 hover:text-amber-200/70"
              :class="uploading ? 'pointer-events-none opacity-50' : ''"
            >
              <span>{{ uploading ? 'uploading…' : '＋ drop' }}</span>
              <input
                ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" multiple
                class="hidden" data-testid="mb-file-input" @change="onPickFiles"
              >
            </label>
          </div>
          <p v-if="uploadError" class="mt-2 text-[11px] text-red-300/85">{{ uploadError }}</p>
        </section>

        <!-- Reading: the summary as open, editable prose -->
        <section data-section="reading" class="pt-10">
          <textarea
            ref="summaryEl" v-model="summary" data-testid="mb-summary" rows="3" spellcheck="false"
            class="w-full resize-none overflow-hidden bg-transparent text-[13px] leading-[1.8] text-white/85 outline-none placeholder:text-white/25"
            placeholder="No reading yet — add images to the board and press Read."
            @input="autogrow"
          />
        </section>

        <!-- Palette: named strikeable swatches -->
        <section data-section="palette" class="pt-8">
          <div class="flex flex-wrap gap-2.5">
            <div
              v-for="(p, i) in palette" :key="`${p.hex}-${i}`" data-testid="mb-swatch"
              class="group relative w-24 overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.03]"
            >
              <div class="h-14 w-full" :style="{ background: p.hex }" />
              <button
                type="button" :aria-label="`Remove ${p.name}`"
                class="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-black/55 text-[10px] text-white/80 backdrop-blur-sm group-hover:flex"
                @click="removeSwatch(i)"
              >✕</button>
              <div class="px-2 py-1.5">
                <div class="truncate text-[11px] text-white/80">{{ p.name }}</div>
                <div class="text-[10px] uppercase tracking-wide text-white/35">{{ p.hex }}</div>
              </div>
            </div>
            <p v-if="!palette.length" class="self-center text-[11px] text-white/30">
              The read curates a named palette for this board.
            </p>
          </div>
        </section>

        <!-- Avoids: chips + add -->
        <section data-section="avoids" class="pt-8">
          <div class="flex flex-wrap items-center gap-1.5">
            <span
              v-for="(a, i) in avoids" :key="`${a}-${i}`" data-testid="mb-avoid"
              class="group inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/70"
            >
              {{ a }}
              <button
                type="button" :aria-label="`Remove avoid ${a}`"
                class="text-white/30 transition-colors hover:text-white/80" @click="removeAvoid(i)"
              >✕</button>
            </span>
            <span class="inline-flex items-center rounded-full border border-dashed border-white/15 px-2.5 py-1">
              <input
                v-model="newAvoid" data-testid="mb-avoid-add" placeholder="＋ add"
                class="w-16 bg-transparent text-[11px] text-white/70 outline-none placeholder:text-white/30 focus:w-28 transition-all"
                @keydown.enter.prevent="addAvoid" @blur="addAvoid"
              >
            </span>
            <p v-if="!avoids.length" class="text-[11px] text-white/30">Things this taste never does.</p>
          </div>
        </section>
      </div>

      <!-- floating footer: Re-read · Save -->
      <div class="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-3 px-5 pb-4 pt-10 bg-gradient-to-t from-[#0e0e10] via-[#0e0e10]/85 to-transparent">
        <div class="pointer-events-auto min-w-0 flex flex-col gap-1">
          <p v-if="!aiAvailable" class="text-[11px] leading-snug text-white/40">
            AI isn’t set up — start the app with NUXT_ANTHROPIC_API_KEY, or paste your own key in Settings → AI.
          </p>
          <p v-if="readError" class="flex items-center gap-2 text-[11px] text-red-300/85" data-testid="mb-read-error">
            <span class="truncate">{{ readError }}</span>
            <button type="button" class="shrink-0 underline decoration-red-300/40 underline-offset-2 hover:text-red-200" @click="runRead">Retry</button>
          </p>
          <p v-if="saveError" class="text-[11px] text-red-300/85">{{ saveError }}</p>
        </div>
        <div class="pointer-events-auto flex shrink-0 items-center gap-2">
          <button
            type="button" data-testid="mb-read" :disabled="readBusy || uploading || (!files.length && !sessionBigJpegs.length)"
            class="rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-[12px] text-white/75 transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
            @click="runRead"
          >{{ readBusy ? 'Reading…' : hasRead ? 'Re-read' : 'Read' }}</button>
          <button
            type="button" data-testid="mb-save" :disabled="!canSave"
            class="rounded-lg border border-amber-400/30 bg-amber-500/20 px-4 py-1.5 text-[12px] font-medium text-amber-200 transition-colors hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-40"
            @click="saveBoard"
          >{{ saving ? 'Saving…' : savedFlash ? 'Saved ✓' : 'Save' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
