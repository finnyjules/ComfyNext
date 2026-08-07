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
import StudioButton from '~/components/vue-canvas/studio/StudioButton.vue'
import { useMoodboards, uniqueMoodboardId } from '~/composables/useMoodboards'
import { syncMoodboardWidgets, moodboardRefDescriptors } from '~/lib/graph/moodboardApply'
import type { MoodboardEntry } from '~~/shared/taste/moodboard'

const props = defineProps<{ nodeId?: string | null, nodes?: any[] }>()
const emit = defineEmits<{ close: [] }>()

const { refresh, save, byId, loaded, moodboards } = useMoodboards()
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
    const res = await $fetch<{ reading?: { avoids?: string[] }, name?: string, summary?: string, palette?: { name: string, hex: string }[] }>(
      '/api/taste/read',
      { method: 'POST', body: { images: bigs.slice(0, 8), apiKey: getLocalSetting('Sailor.AI.AnthropicApiKey') ?? '' } },
    )
    // Adopt Fable's proposed title only while the board still wears the
    // default name — a name the user typed is authorship and always wins.
    if (res.name && (!name.value.trim() || name.value.trim() === 'Moodboard')) name.value = res.name
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
  // New boards uniquify against the library (moodboard, moodboard-2, …):
  // a bare slug collides when two boards share a (default) name, and the
  // second save would overwrite the first entry for every node referencing it.
  const id = savedId.value
    || uniqueMoodboardId(name.value, new Set(moodboards.value.map(m => m.id)))
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
      class="relative flex h-[860px] max-h-[92vh] w-[1240px] max-w-[96vw] overflow-hidden rounded-xl border border-white/[0.08] bg-[#0e0e10] text-white outline-none"
    >
      <!-- The wall: masonry image columns, natural aspect ratios. The board IS
           the modal's hero — everything editorial lives in the right rail. -->
      <div class="min-h-0 flex-1 overflow-y-auto p-3" @dragover.prevent @drop="onDrop">
        <div class="columns-2 gap-2 md:columns-3">
          <img
            v-for="f in files" :key="f" :src="imageUrl(f)" :alt="f" data-testid="mb-board-image"
            class="mb-2 w-full break-inside-avoid rounded-md" loading="lazy"
          >
          <label
            class="mb-2 flex h-28 w-full break-inside-avoid cursor-pointer items-center justify-center rounded-md border border-dashed border-white/15 text-[11px] text-white/35 transition-colors hover:border-amber-400/40 hover:text-amber-200/70"
            :class="uploading ? 'pointer-events-none opacity-50' : ''"
          >
            <span>{{ uploading ? 'uploading…' : '＋ drop images' }}</span>
            <input
              ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" multiple
              class="hidden" data-testid="mb-file-input" @change="onPickFiles"
            >
          </label>
        </div>
        <p v-if="uploadError" class="mt-1 text-[11px] text-red-300/85">{{ uploadError }}</p>
      </div>

      <!-- The rail: name · reading · palette · avoids, actions pinned last -->
      <div class="flex w-[360px] shrink-0 flex-col border-l border-white/[0.06] bg-white/[0.015]">
        <div class="flex shrink-0 items-center gap-2 px-5 pt-4">
          <input
            v-model="name" data-testid="mb-name" spellcheck="false"
            class="min-w-0 flex-1 bg-transparent text-[15px] font-semibold tracking-[-0.01em] text-white/90 outline-none placeholder:text-white/30"
            placeholder="Name this moodboard"
          >
          <span class="rounded border border-white/10 px-1.5 py-0.5 text-[11px] text-white/30">esc</span>
          <button type="button" aria-label="Close" class="text-white/45 transition-colors hover:text-white/80" @click="emit('close')">✕</button>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          <!-- Reading -->
          <div class="mt-5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-white/35">Reading</div>
          <div class="mt-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-3">
            <textarea
              ref="summaryEl" v-model="summary" data-testid="mb-summary" rows="3" spellcheck="false"
              class="w-full resize-none overflow-hidden bg-transparent text-[12.5px] leading-[1.75] text-white/85 outline-none placeholder:text-white/25"
              placeholder="No reading yet — add images to the board and press Read."
              @input="autogrow"
            />
          </div>

          <!-- Palette -->
          <div class="mt-6 text-[10.5px] font-medium uppercase tracking-[0.1em] text-white/35">Palette</div>
          <div class="mt-2 flex flex-wrap gap-2">
            <div
              v-for="(p, i) in palette" :key="`${p.hex}-${i}`" data-testid="mb-swatch"
              class="group relative w-[74px] overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.03]"
            >
              <div class="h-10 w-full" :style="{ background: p.hex }" />
              <button
                type="button" :aria-label="`Remove ${p.name}`"
                class="absolute right-1 top-1 hidden h-4.5 w-4.5 items-center justify-center rounded-full bg-black/55 text-[10px] text-white/80 backdrop-blur-sm group-hover:flex"
                @click="removeSwatch(i)"
              >✕</button>
              <div class="px-1.5 py-1">
                <div class="truncate text-[10.5px] text-white/80">{{ p.name }}</div>
                <div class="text-[9.5px] uppercase tracking-wide text-white/35">{{ p.hex }}</div>
              </div>
            </div>
            <p v-if="!palette.length" class="self-center text-[11px] text-white/30">
              The read curates a named palette for this board.
            </p>
          </div>

          <!-- Avoids -->
          <div class="mt-6 text-[10.5px] font-medium uppercase tracking-[0.1em] text-white/35">Avoids</div>
          <div class="mt-2 flex flex-wrap items-center gap-1.5">
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
                class="w-16 bg-transparent text-[11px] text-white/70 outline-none transition-all placeholder:text-white/30 focus:w-28"
                @keydown.enter.prevent="addAvoid" @blur="addAvoid"
              >
            </span>
            <p v-if="!avoids.length" class="text-[11px] text-white/30">Things this taste never does.</p>
          </div>
        </div>

        <!-- Actions: full-width pills, reference-style -->
        <div class="flex shrink-0 flex-col gap-2 border-t border-white/[0.06] px-5 py-4">
          <p v-if="!aiAvailable" class="text-[11px] leading-snug text-white/40">
            AI isn’t set up — start the app with NUXT_ANTHROPIC_API_KEY, or paste your own key in Settings → AI.
          </p>
          <p v-if="readError" class="flex items-center gap-2 text-[11px] text-red-300/85" data-testid="mb-read-error">
            <span class="truncate">{{ readError }}</span>
            <button type="button" class="shrink-0 underline decoration-red-300/40 underline-offset-2 hover:text-red-200" @click="runRead">Retry</button>
          </p>
          <p v-if="saveError" class="text-[11px] text-red-300/85">{{ saveError }}</p>
          <div class="flex items-center justify-end gap-2">
            <StudioButton
              data-testid="mb-read" variant="secondary"
              :disabled="readBusy || uploading || (!files.length && !sessionBigJpegs.length)"
              @click="runRead"
            >{{ readBusy ? 'Reading…' : hasRead ? 'Re-read' : 'Read' }}</StudioButton>
            <StudioButton data-testid="mb-save" variant="primary" :disabled="!canSave" @click="saveBoard">
              {{ saving ? 'Saving…' : savedFlash ? 'Saved ✓' : 'Save' }}
            </StudioButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
