<script lang="ts">
/**
 * True module-level state for the absorb-on-load orchestration (see the
 * block below in <script setup> for the logic). This MUST live in a plain
 * (non-setup) <script> block: variables declared directly inside
 * <script setup> are re-initialized on every component instance (it
 * compiles to a fresh setup() call per mount), so a `let` declared there
 * does NOT survive the panel being closed/reopened — and this panel's
 * parent (layouts/default.vue) mounts it behind a v-if, so it genuinely
 * unmounts/remounts on every toggle. Without this being real module scope,
 * closing and reopening the panel would silently re-run absorb every time,
 * defeating the one-time-per-session guarantee.
 */
let absorbRanThisSession = false
</script>

<script setup lang="ts">
/**
 * Character Library — one unified list over the registry. Each character
 * shows its status (Draft / Training… / ready-with-LoRA-chip) and, expanded,
 * its variants: reference sheets you can build by hand (upload/cover/remove)
 * or generate from a photo (draft) / the linked LoRA (ready) via the same
 * canonical 4-shot sheet used by the Character Sheet Builder node.
 *
 * The old CHARACTER/STYLE picker + "Add to canvas" composer moved out of this
 * panel entirely — casting/using a character now dispatches events for the
 * canvas (Task 7) and identity training (Task 8) to pick up.
 */
import { Drama, Images, Loader2, RefreshCcw, Shirt, Sparkles, Upload, X } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

import {
  useCharacters, useTrainingJobs, characterStatus, IN_FLIGHT_STATUSES, slugish,
  type CharacterStatus,
} from '~/composables/useCharacters'
import type { CharacterRecord, CharacterState, CharacterPanel, PanelSlot } from '#shared/characters/types'
import { emptyState, normalizeStateId, panelFilename } from '#shared/characters/types'
import { useSheetGeneration, type SheetSource } from '~/composables/useSheetGeneration'
import { uploadRefFilename, viewRefUrl } from '~/lib/shotdirector/refUpload'
import { bakeCompositeSheet } from '~/lib/characters/sheetComposite'
import { HIGGSFIELD_PANELS } from '~/data/character-shot-scenes'
import { usePendingTrainerSeed } from '~/composables/usePendingTrainerSeed'
import { buildDressPrompt, DRESS_COST_USD, type DressMode } from '~/lib/wardrobe/dress'
import { emitCharacterEvent } from '~/lib/characters/bus'

defineEmits<{ close: [] }>()

const {
  characters, loading, error: charactersError, coverUrl, refresh,
  patchState, replaceStates, removeCharacter,
} = useCharacters()
const { jobs, setPolling } = useTrainingJobs()
const { openTab } = useTabs()

onMounted(() => { setPolling(true); void runAbsorbOnce() })
onUnmounted(() => setPolling(false))

// Shared conflict-toast wording — every patchState call in this panel shows
// the same message on a 'stale' result (someone else's edit landed first).
const STALE_MESSAGE = 'Someone else edited this character — reloaded, try again'

// ── Absorb-on-load ──────────────────────────────────────────────────────────
// Free: pulls newly-dropped LoRAs (U2's migration, or a manual drop into
// models/loras) into character records so they show up in the library. This
// used to also auto-generate each new character's Default sheet — real money,
// spent with no explicit click — which Task 9 removes entirely; "Generate
// sheet" is now always a user action. `absorbRanThisSession` is true
// module-level state (declared in the plain <script> block above) so this
// still only fires once per app session, not once per panel open (the panel
// unmounts/remounts on every toggle — see that block's comment).
async function runAbsorbOnce() {
  if (absorbRanThisSession) return
  absorbRanThisSession = true
  try {
    const res = await fetch('/api/characters-local/absorb', { method: 'POST' })
    if (!res.ok) return
    await refresh()
  } catch (err) {
    console.warn('[CharacterLibraryPanel] absorb-on-load failed', err)
  }
}

// ── Create / delete character ───────────────────────────────────────────────
const expandedSlug = ref<string | null>(null)

async function createCharacter() {
  const name = window.prompt('Character name')?.trim()
  if (!name) return
  const res = await fetch('/api/characters-local', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  })
  if (res.ok) {
    void refresh()
    expandedSlug.value = (await res.json()).slug
    toast.success(`Created ${name}`, { description: 'Add reference photos to make them ready' })
  }
  else if (res.status === 409) toast.error(`A character named "${name}" already exists`)
  else toast.error('Couldn\'t create the character — try again')
}

async function deleteCharacter(c: CharacterRecord) {
  if (!window.confirm(`Delete character "${c.name}"? Shots casting them will show an error.`)) return
  if (!(await removeCharacter(c.slug))) toast.error('Couldn\'t delete the character — try again')
}

function toggleExpanded(c: CharacterRecord) {
  expandedSlug.value = expandedSlug.value === c.slug ? null : c.slug
  if (expandedSlug.value) selectedVariantId.value[c.slug] = selectedVariantId.value[c.slug] || 'default'
}

// ── Status ───────────────────────────────────────────────────────────────
function statusFor(c: CharacterRecord): CharacterStatus {
  return characterStatus(c, jobs.value)
}
function trainingPct(c: CharacterRecord): number | null {
  // Same active-status semantics as characterStatus() — only an in-flight job
  // counts, so a finished/failed job with a matching name can't surface stale
  // progress. Also mirror its outputName fallback: a job kicked off with a
  // sanitized/slugified outputName that doesn't match displayName verbatim
  // (e.g. spaces stripped) would otherwise show "Training…" with no percent.
  const nameSlug = slugish(c.name)
  const job = jobs.value.find(j =>
    IN_FLIGHT_STATUSES.has(j.status)
    && j.loraKind === 'character'
    && (
      (j.displayName ?? '').toLowerCase() === c.name.toLowerCase()
      || slugish(j.outputName ?? '') === nameSlug
    ))
  return typeof job?.progressPct === 'number' ? Math.round(job.progressPct) : null
}
function loraChip(c: CharacterRecord): string {
  if (!c.loraName) return ''
  const stem = c.loraName.replace(/\.[^./]+$/, '')
  return stem.split('/').pop() ?? stem
}

// ── Actions row ─────────────────────────────────────────────────────────
function useInImage(c: CharacterRecord) {
  // The 'sheet' vs 'lora' use fork is wired for real in Task 12; pass 'sheet' now.
  emitCharacterEvent('addCharacterImageGen', { slug: c.slug, use: 'sheet' })
}
function castInShot(c: CharacterRecord) {
  // normalizeStateId collapses the sentinel 'default' selection (and '' /
  // undefined) to null — the Character node's own UI (CharacterNode.vue)
  // already did this by hand when picking there, but syncCast's kept/wire
  // comparison (castEdges.ts) checks stateId by strict equality against
  // hydrated cast members, which never carry the literal string 'default'
  // (hydrate strips it). If this node's property still had 'default',
  // wireCastFor would keep producing a member whose stateId never matches
  // the hydrated one, forcing a permanent cast-sync rewrite every tick.
  const raw = selectedVariantId.value[c.slug]
  emitCharacterEvent('addCharacterCastNode', { slug: c.slug, name: c.name, stateId: normalizeStateId(raw) })
}
function trainIdentity(c: CharacterRecord) {
  const defaultVariant = c.states.find(v => v.id === 'default') ?? c.states[0]
  usePendingTrainerSeed().set({
    kind: 'character',
    name: c.name,
    trigger: c.trigger,
    refViewUrls: (defaultVariant?.refImages ?? []).map(viewRefUrl),
  })
  openTab({ type: 'train', label: `Train: ${c.name}` })
}

// ── Variant selection ───────────────────────────────────────────────────
const selectedVariantId = ref<Record<string, string>>({})

function selectVariant(c: CharacterRecord, id: string) {
  selectedVariantId.value[c.slug] = id
}
function activeVariant(c: CharacterRecord): CharacterState | undefined {
  const id = selectedVariantId.value[c.slug] ?? 'default'
  return c.states.find(v => v.id === id) ?? c.states.find(v => v.id === 'default') ?? c.states[0]
}

// ── Variant ref upload / cover / remove ────────────────────────────────
// `variant` is captured at click time (its `updatedAt`) and sent as
// `expectedUpdatedAt` — a concurrent edit landing during a (possibly long)
// upload now fails the PATCH with a 'stale' toast instead of silently
// clobbering it, so there's no need to defensively re-derive "the live
// variant" before writing (the old stale-closure guard pattern).
async function replaceVariant(c: CharacterRecord, variant: CharacterState, patch: Partial<CharacterState>): Promise<boolean> {
  const result = await patchState(c.slug, { stateId: variant.id, expectedUpdatedAt: variant.updatedAt, patch })
  if (result === 'stale') { toast.error(STALE_MESSAGE); return false }
  if (result === 'error') { toast.error('Couldn\'t update the character — try again'); return false }
  return true
}

async function addRefFiles(c: CharacterRecord, variant: CharacterState, e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files ?? [])
  if (!files.length) return
  const names: string[] = []
  let failed = 0
  for (const f of files) {
    try { names.push(await uploadRefFilename(f)) } catch { failed++ }
  }
  if (failed) toast.error(`${failed} of ${files.length} upload${files.length === 1 ? '' : 's'} failed`, { description: names.length ? 'The rest were added' : undefined })
  if (names.length) {
    await replaceVariant(c, variant, { refImages: [...variant.refImages, ...names] })
  }
  ;(e.target as HTMLInputElement).value = ''
}

async function removeRef(c: CharacterRecord, variant: CharacterState, idx: number) {
  await replaceVariant(c, variant, { refImages: variant.refImages.filter((_, i) => i !== idx) })
}

async function setCover(c: CharacterRecord, variant: CharacterState, idx: number) {
  await replaceVariant(c, variant, { coverIndex: idx })
}

async function deleteVariant(c: CharacterRecord, variant: CharacterState) {
  if (variant.id === 'default') return
  if (!window.confirm(`Delete look "${variant.label}"?`)) return
  const states = c.states.filter(v => v.id !== variant.id)
  const result = await replaceStates(c.slug, states, c.updatedAt)
  if (result === 'stale') { toast.error(STALE_MESSAGE); return }
  if (result === 'error') { toast.error('Couldn\'t delete the look — try again'); return }
  selectedVariantId.value[c.slug] = 'default'
}

// ── New variant ─────────────────────────────────────────────────────────
const addingVariant = ref<Set<string>>(new Set())
const newVariantName = ref<Record<string, string>>({})
const newVariantDescriptor = ref<Record<string, string>>({})

function startNewVariant(c: CharacterRecord) {
  addingVariant.value.add(c.slug)
  newVariantName.value[c.slug] = ''
  newVariantDescriptor.value[c.slug] = ''
}
function cancelNewVariant(c: CharacterRecord) {
  addingVariant.value.delete(c.slug)
}

async function createVariant(c: CharacterRecord) {
  const label = (newVariantName.value[c.slug] || '').trim()
  if (!label) return
  const variant: CharacterState = {
    ...emptyState('v-' + Date.now().toString(36), label),
    descriptor: (newVariantDescriptor.value[c.slug] || '').trim(),
  }
  const states = [...c.states, variant]
  const result = await replaceStates(c.slug, states, c.updatedAt)
  if (result === 'stale') { toast.error(STALE_MESSAGE); return }
  if (result === 'error') { toast.error('Couldn\'t add the look — try again'); return }
  addingVariant.value.delete(c.slug)
  selectedVariantId.value[c.slug] = variant.id
  toast.success(`Added look "${label}"`)
}

// ── Sheet generation (per variant) ──────────────────────────────────────
const sheetGens = new Map<string, ReturnType<typeof useSheetGeneration>>()
function sheetFor(c: CharacterRecord, variant: CharacterState) {
  const key = `${c.slug}:${variant.id}`
  let g = sheetGens.get(key)
  if (!g) { g = useSheetGeneration(); sheetGens.set(key, g) }
  return g
}
const expanding = ref<Set<string>>(new Set())

async function fetchAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetch ${res.status}`)
  const blob = await res.blob()
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

async function buildSource(c: CharacterRecord, variant: CharacterState): Promise<SheetSource | null> {
  const status = statusFor(c)
  if (status === 'ready' && c.loraName) {
    return { mode: 'lora', loraFilename: c.loraName, trigger: c.trigger, descriptor: variant.descriptor || undefined }
  }
  const def = c.states.find(v => v.id === 'default') ?? c.states[0]
  const cover = def ? coverUrl(c, def.id) : null
  if (!cover) {
    toast.error('Add a reference photo to the Default variant first')
    return null
  }
  try {
    const dataUrl = await fetchAsDataUrl(cover)
    return { mode: 'photo', referenceImageDataUrl: dataUrl, descriptor: variant.descriptor || undefined }
  } catch {
    toast.error('Couldn\'t load the cover photo — try again')
    return null
  }
}

function sheetCostLabel(c: CharacterRecord): string {
  return statusFor(c) === 'ready' ? '~$0.12' : '~$0.32'
}

/** Panel filename → /view URL for a state's saved composite panel, or null. */
function panelUrl(state: CharacterState, slot: PanelSlot): string | null {
  const filename = panelFilename(state, slot)
  return filename ? viewRefUrl(filename) : null
}

/**
 * Data URLs for all 5 canonical slots, ready to bake into a composite:
 * prefer whatever this browser session already generated (`gen.panels`,
 * fresh from expandAll/rerollPanel) and fall back to fetching the state's
 * already-saved panel file for any slot this session hasn't touched (e.g.
 * rerolling a single tile after a reload, before regenerating the rest).
 * Returns null if any slot has neither — the composite can't be completed.
 */
async function resolvePanelDataUrls(
  variant: CharacterState, gen: ReturnType<typeof useSheetGeneration>,
): Promise<Record<PanelSlot, string> | null> {
  const out = {} as Record<PanelSlot, string>
  for (const spec of HIGGSFIELD_PANELS) {
    const fresh = gen.panels.value.find(p => p.spec.slot === spec.slot)?.dataUrl
    if (fresh) { out[spec.slot] = fresh; continue }
    const filename = panelFilename(variant, spec.slot)
    if (!filename) return null
    try { out[spec.slot] = await fetchAsDataUrl(viewRefUrl(filename)) }
    catch { return null }
  }
  return out
}

/** Upload every generated panel (by slot) + bake and upload the composite. */
async function uploadPanelsAndComposite(
  shots: { spec: { slot: PanelSlot }, dataUrl: string | null }[],
): Promise<{ panels: CharacterPanel[], sheetImage: string } | null> {
  const panelDataUrls = {} as Record<PanelSlot, string>
  const panels: CharacterPanel[] = []
  for (const shot of shots) {
    if (!shot.dataUrl) continue
    panelDataUrls[shot.spec.slot] = shot.dataUrl
    const file = dataUrlToFile(shot.dataUrl, `sheet_${shot.spec.slot}.png`)
    const filename = await uploadRefFilename(file)
    panels.push({ slot: shot.spec.slot, filename })
  }
  if (!panels.length) return null
  const compositeFile = await bakeCompositeSheet(panelDataUrls)
  const sheetImage = await uploadRefFilename(compositeFile)
  return { panels, sheetImage }
}

async function generateSheet(c: CharacterRecord, variant: CharacterState) {
  const key = `${c.slug}:${variant.id}`
  if (expanding.value.has(key)) return
  const source = await buildSource(c, variant)
  if (!source) return
  expanding.value.add(key)
  try {
    const gen = sheetFor(c, variant)
    await gen.expandAll(source)
    if (!gen.panels.value.every(s => s.dataUrl)) { toast.error('Sheet generation failed — try again'); return }
    const built = await uploadPanelsAndComposite(gen.panels.value)
    if (!built) { toast.error('Sheet generation failed — try again'); return }
    const result = await patchState(c.slug, {
      stateId: variant.id,
      expectedUpdatedAt: variant.updatedAt,
      patch: { panels: built.panels, sheetImage: built.sheetImage, status: 'draft', stressResult: null },
    })
    if (result === 'stale') { toast.error(STALE_MESSAGE); return }
    if (result === 'error') { toast.error('Couldn\'t save the sheet — try again'); return }
    toast.success(`Generated ${built.panels.length}-shot sheet for ${variant.label}`)
  } finally {
    expanding.value.delete(key)
  }
}

async function rerollTile(c: CharacterRecord, variant: CharacterState, slot: PanelSlot) {
  const source = await buildSource(c, variant)
  if (!source) return
  const gen = sheetFor(c, variant)
  try {
    await gen.rerollPanel(slot, source)
  } catch (e) {
    // rerollPanel throws for a derived-panel reroll with no portrait
    // generated yet this session (nothing to derive from) — surface it.
    console.warn('[CharacterLibraryPanel] reroll failed', e)
    toast.error(e instanceof Error ? e.message : 'Reroll failed — try again')
    return
  }
  const rerolled = gen.panels.value.find(p => p.spec.slot === slot)
  if (!rerolled?.dataUrl) return
  const panelDataUrls = await resolvePanelDataUrls(variant, gen)
  if (!panelDataUrls) { toast.error('Couldn\'t rebuild the full sheet — try Generate sheet instead'); return }
  const filename = await uploadRefFilename(dataUrlToFile(rerolled.dataUrl, `sheet_${slot}.png`))
  const compositeFile = await bakeCompositeSheet(panelDataUrls)
  const sheetImage = await uploadRefFilename(compositeFile)
  const panels = variant.panels.some(p => p.slot === slot)
    ? variant.panels.map(p => p.slot === slot ? { slot, filename } : p)
    : [...variant.panels, { slot, filename }]
  const result = await patchState(c.slug, {
    stateId: variant.id,
    expectedUpdatedAt: variant.updatedAt,
    patch: { panels, sheetImage, status: 'draft', stressResult: null },
  })
  if (result === 'stale') toast.error(STALE_MESSAGE)
  else if (result === 'error') toast.error('Couldn\'t save the reroll — try again')
}

function dataUrlToFile(dataUrl: string, name: string): File {
  const comma = dataUrl.indexOf(',')
  const head = dataUrl.slice(0, comma)
  const b64 = dataUrl.slice(comma + 1)
  const mime = head.match(/data:(.*?);base64/)?.[1] || 'image/png'
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new File([arr], name, { type: mime })
}

// ── Wardrobe: dress a character into a look ────────────────────────────────
// A look's cover is generated by dressing the character's Default (identity)
// cover — via nano-banana-pro, with a garment reference photo (two images) or a
// text outfit (one image). Keeping the result writes it as the look's cover.
const dressCost = `~$${DRESS_COST_USD.toFixed(2)}`
const dressOpen = ref<Set<string>>(new Set())
const dressMode = ref<Record<string, DressMode>>({})
const dressGarment = ref<Record<string, string | null>>({})   // garment photo data URL
const dressText = ref<Record<string, string>>({})
const dressResult = ref<Record<string, string | null>>({})    // dressed preview data URL
const dressBusy = ref<Set<string>>(new Set())
const dressError = ref<Record<string, string | null>>({})

function vkey(c: CharacterRecord, variant: CharacterState) { return `${c.slug}:${variant.id}` }
/** Dress-state key for the character's currently-selected look. */
function akey(c: CharacterRecord): string { const v = activeVariant(c); return v ? vkey(c, v) : c.slug }

function toggleDress(c: CharacterRecord, variant: CharacterState) {
  const k = vkey(c, variant)
  if (dressOpen.value.has(k)) { dressOpen.value.delete(k); return }
  dressOpen.value.add(k)
  dressMode.value[k] = dressMode.value[k] ?? 'garment'
  // Seed the prompt from the look's descriptor so "Swimsuit" arrives pre-filled.
  if (dressText.value[k] === undefined) dressText.value[k] = variant.descriptor || ''
}

async function onGarmentFile(k: string, e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  dressError.value[k] = null
  try { dressGarment.value[k] = await fileToDataUrl(file) }
  catch { dressError.value[k] = 'Couldn\'t read that image' }
  ;(e.target as HTMLInputElement).value = ''
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

/** Enable Generate only when there's something to dress them in. */
function canDress(k: string): boolean {
  const mode = dressMode.value[k] ?? 'garment'
  return mode === 'garment' ? !!dressGarment.value[k] : !!(dressText.value[k] ?? '').trim()
}

async function runDress(c: CharacterRecord, variant: CharacterState) {
  const k = vkey(c, variant)
  if (dressBusy.value.has(k) || !canDress(k)) return
  const cover = coverUrl(c) // the Default identity cover — clean identity in
  if (!cover) { toast.error('Add a reference photo to the Default look first'); return }
  const mode = dressMode.value[k] ?? 'garment'
  dressBusy.value.add(k)
  dressError.value[k] = null
  dressResult.value[k] = null
  try {
    const person = await fetchAsDataUrl(cover)
    const images = mode === 'garment' && dressGarment.value[k] ? [person, dressGarment.value[k]!] : [person]
    const prompt = buildDressPrompt({ mode, outfit: dressText.value[k] })
    const res = await $fetch<{ images?: string[] }>('/api/inpaint/nano-gen', { method: 'POST', body: { prompt, images } })
    const out = res.images?.[0]
    if (!out) throw new Error('No image returned')
    dressResult.value[k] = out
  } catch (err) {
    dressError.value[k] = err instanceof Error ? err.message : 'Dressing failed'
  } finally {
    dressBusy.value.delete(k)
  }
}

async function keepDress(c: CharacterRecord, variant: CharacterState) {
  const k = vkey(c, variant)
  const dataUrl = dressResult.value[k]
  if (!dataUrl) return
  const file = dataUrlToFile(dataUrl, `dressed_${Date.now()}.png`)
  const name = await uploadRefFilename(file)
  // Prepend as the new cover so this look leads with its dressed photo.
  const ok = await replaceVariant(c, variant, { refImages: [name, ...variant.refImages], coverIndex: 0 })
  if (!ok) return
  dressOpen.value.delete(k)
  dressResult.value[k] = null
  dressGarment.value[k] = null
  toast.success(`Dressed ${c.name} · ${variant.label}`)
}

/** Provenance caption for a ref tile, inferred from the upload filename. */
function photoKind(filename: string): 'Source' | 'Sheet' | null {
  if (/source/i.test(filename)) return 'Source'
  if (/sheet/i.test(filename)) return 'Sheet'
  return null
}

// ── Tile color fallback (deterministic from name) ──────────────────────────
function tileColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = ((h * 31) + seed.charCodeAt(i)) >>> 0
  const hue = h % 360
  return `linear-gradient(135deg, hsl(${hue}, 45%, 22%) 0%, hsl(${(hue + 30) % 360}, 50%, 14%) 100%)`
}
</script>

<template>
  <div class="h-full bg-[#1a1a1a]/95 backdrop-blur-md border-r border-white/10 flex flex-col shadow-2xl">
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-white/10">
      <div class="flex items-center gap-2">
        <Drama class="size-4 text-white/70" />
        <span class="text-sm font-semibold text-white/90">Characters</span>
      </div>
      <button
        class="flex items-center justify-center size-6 rounded hover:bg-white/10 transition-colors cursor-pointer"
        @click="$emit('close')"
      >
        <X class="size-4 text-white/60" />
      </button>
    </div>

    <div class="flex-1 overflow-y-auto">
      <div class="px-3 pt-3 pb-3">
        <div class="mb-2 flex items-center justify-between">
          <h4 class="text-[11px] font-medium uppercase tracking-wide text-white/50">Library</h4>
          <button class="rounded bg-white/[0.06] px-2 py-1 text-[11px] text-white/70 hover:bg-white/10 cursor-pointer" @click="createCharacter">New</button>
        </div>

        <!-- Loading -->
        <div v-if="loading && !characters.length" class="py-6 text-center text-xs text-white/40">Loading…</div>

        <!-- Fetch failed: say so instead of a false "None yet" (stale list, if any, stays) -->
        <div v-else-if="charactersError" class="py-3 text-center text-xs text-amber-400/90">
          {{ charactersError }}
          <button
            class="block mx-auto mt-2 text-white/70 hover:text-white underline underline-offset-2 cursor-pointer"
            @click="refresh()"
          >
            Retry
          </button>
        </div>

        <!-- Empty -->
        <p v-else-if="!characters.length" class="text-[11px] text-white/30">
          None yet — "New", or save one from any image on the canvas.
        </p>

        <!-- Character list -->
        <div v-for="c in characters" :key="c.slug" class="mb-1.5 rounded-lg border border-white/10 bg-white/[0.03]">
          <button class="flex w-full items-center gap-2 p-2 text-left cursor-pointer" @click="toggleExpanded(c)">
            <img v-if="coverUrl(c)" :src="coverUrl(c)!" class="h-9 w-9 rounded object-cover" :alt="c.name">
            <div v-else class="h-9 w-9 rounded flex items-center justify-center" :style="{ background: tileColor(c.name) }">
              <Drama class="size-4 text-white/25" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="truncate text-[12px] text-white/85">{{ c.name }}</div>
              <div class="flex items-center gap-1.5 mt-0.5">
                <span v-if="statusFor(c) === 'draft'" class="text-[10px] font-medium text-amber-400/90">Draft</span>
                <span v-else-if="statusFor(c) === 'training'" class="text-[10px] font-medium text-blue-400/90">
                  Training…{{ trainingPct(c) !== null ? ` ${trainingPct(c)}%` : '' }}
                </span>
                <span v-else class="rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-mono text-white/40 truncate max-w-[140px]" :title="c.loraName ?? undefined">
                  {{ loraChip(c) }}
                </span>
              </div>
            </div>
            <button
              v-if="statusFor(c) === 'draft'"
              class="shrink-0 rounded bg-white/10 px-2 py-1 text-[10px] text-white/75 hover:bg-white/20 cursor-pointer"
              title="Train a LoRA identity for this character"
              @click.stop="trainIdentity(c)"
            >Train identity</button>
          </button>

          <!-- Expanded -->
          <div v-if="expandedSlug === c.slug" class="border-t border-white/[0.06] p-2 space-y-2.5">
            <!-- Actions row -->
            <div class="flex gap-1.5">
              <button class="flex-1 rounded bg-white/[0.06] px-2 py-1.5 text-[10.5px] text-white/75 hover:bg-white/[0.12] cursor-pointer" @click="useInImage(c)">
                Use in image
              </button>
              <button class="flex-1 rounded bg-white/[0.06] px-2 py-1.5 text-[10.5px] text-white/75 hover:bg-white/[0.12] cursor-pointer" @click="castInShot(c)">
                Cast in shot
              </button>
            </div>

            <!-- Looks (wardrobe) -->
            <div>
              <div class="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-white/40">
                <Shirt class="size-3" /> Looks
              </div>
              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="v in c.states" :key="v.id"
                  class="rounded-full px-2.5 py-1 text-[10.5px] cursor-pointer transition-colors"
                  :class="(selectedVariantId[c.slug] ?? 'default') === v.id
                    ? 'bg-white/20 text-white ring-1 ring-white/30'
                    : 'bg-white/[0.05] text-white/60 hover:bg-white/[0.1]'"
                  @click="selectVariant(c, v.id)"
                >
                  {{ v.label }} <span class="text-white/40">· {{ v.refImages.length }}</span>
                </button>
                <button
                  class="rounded-full px-2.5 py-1 text-[10.5px] text-white/50 border border-dashed border-white/20 hover:border-white/40 hover:text-white/75 cursor-pointer"
                  @click="startNewVariant(c)"
                >+ New look</button>
              </div>
            </div>

            <!-- New look form -->
            <div v-if="addingVariant.has(c.slug)" class="rounded border border-white/10 bg-black/20 p-2 space-y-1.5">
              <input
                v-model="newVariantName[c.slug]"
                placeholder="Look name (e.g. Swimsuit, Winter coat)"
                class="w-full bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-[11px] text-white/85 placeholder-white/30 outline-none focus:border-white/25"
              >
              <input
                v-model="newVariantDescriptor[c.slug]"
                placeholder="Outfit description (optional — seeds the Dress prompt)"
                class="w-full bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-[11px] text-white/85 placeholder-white/30 outline-none focus:border-white/25"
              >
              <div class="flex justify-end gap-1.5">
                <button class="text-[10px] text-white/40 hover:text-white/70 px-1.5 py-1 cursor-pointer" @click="cancelNewVariant(c)">Cancel</button>
                <button
                  class="rounded bg-white/15 px-2 py-1 text-[10px] text-white/85 hover:bg-white/25 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  :disabled="!newVariantName[c.slug]?.trim()"
                  @click="createVariant(c)"
                >Create</button>
              </div>
            </div>

            <!-- Active look sheet -->
            <template v-if="activeVariant(c)">
              <!-- Composite reference sheet: the 5 canonical Higgsfield panels -->
              <div>
                <div class="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-white/40">
                  <Images class="size-3" /> Reference sheet
                </div>
                <div class="grid grid-cols-5 gap-1.5">
                  <div
                    v-for="spec in HIGGSFIELD_PANELS" :key="spec.slot"
                    class="group relative aspect-square overflow-hidden rounded bg-white/[0.04]"
                  >
                    <img
                      v-if="panelUrl(activeVariant(c)!, spec.slot)"
                      :src="panelUrl(activeVariant(c)!, spec.slot)!"
                      class="h-full w-full object-cover"
                    >
                    <div v-else class="flex h-full items-center justify-center px-1 text-center text-[8px] leading-tight text-white/25">
                      {{ spec.slot }}
                    </div>
                    <button
                      v-if="panelUrl(activeVariant(c)!, spec.slot) && !expanding.has(`${c.slug}:${activeVariant(c)!.id}`)"
                      class="absolute inset-0 hidden items-center justify-center bg-black/50 group-hover:flex cursor-pointer"
                      title="Re-roll this shot"
                      @click="rerollTile(c, activeVariant(c)!, spec.slot)"
                    >
                      <RefreshCcw class="size-3.5 text-white/85" />
                    </button>
                  </div>
                </div>
              </div>

              <!-- Manual reference photos (upload pool) -->
              <div>
                <div class="mb-1 text-[10px] font-medium uppercase tracking-wide text-white/40">Uploaded photos</div>
                <div class="grid grid-cols-4 gap-1.5">
                  <div v-for="(f, i) in activeVariant(c)!.refImages" :key="f" class="group relative aspect-square overflow-hidden rounded">
                    <img :src="`/view?filename=${encodeURIComponent(f)}&type=input`" class="h-full w-full object-cover">
                    <!-- persistent cover badge: the single photo sent to video (before a sheet exists) -->
                    <span
                      v-if="i === activeVariant(c)!.coverIndex"
                      class="pointer-events-none absolute left-0.5 top-0.5 rounded bg-white/90 px-1 text-[8px] font-semibold text-neutral-900"
                    >Cover</span>
                    <!-- provenance caption inferred from filename -->
                    <span
                      v-if="photoKind(f)"
                      class="pointer-events-none absolute bottom-0.5 right-0.5 rounded bg-black/60 px-1 text-[8px] text-white/55"
                    >{{ photoKind(f) }}</span>
                    <button
                      class="absolute right-0.5 top-0.5 hidden rounded bg-black/70 px-1 text-[10px] text-white/80 group-hover:block cursor-pointer"
                      @click="removeRef(c, activeVariant(c)!, i)"
                    >×</button>
                    <button
                      v-if="i !== activeVariant(c)!.coverIndex"
                      class="absolute bottom-0.5 left-0.5 hidden rounded bg-black/70 px-1 text-[9px] text-white/70 group-hover:block cursor-pointer"
                      @click="setCover(c, activeVariant(c)!, i)"
                    >set cover</button>
                  </div>
                  <label class="flex aspect-square cursor-pointer items-center justify-center rounded border border-dashed border-white/15 text-[16px] text-white/40 hover:border-white/30">
                    +<input type="file" accept="image/*" multiple class="hidden" @change="addRefFiles(c, activeVariant(c)!, $event)">
                  </label>
                </div>
                <p class="text-[10px] leading-relaxed text-white/35">
                  The <span class="text-white/55">Cover</span> is the fallback identity photo used before a reference sheet exists. The rest are angle views for training.
                </p>
              </div>

              <div class="flex items-center gap-1.5">
                <button
                  class="flex-1 inline-flex items-center justify-center gap-1.5 rounded bg-white/10 px-2.5 py-1.5 text-[11px] text-white/80 hover:bg-white/20 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  :disabled="expanding.has(`${c.slug}:${activeVariant(c)!.id}`)"
                  @click="generateSheet(c, activeVariant(c)!)"
                >
                  <Loader2 v-if="expanding.has(`${c.slug}:${activeVariant(c)!.id}`)" class="size-3 animate-spin" />
                  <Images v-else class="size-3" />
                  <span>{{ activeVariant(c)!.panels.length ? 'Regenerate sheet' : 'Generate sheet' }} · {{ sheetCostLabel(c) }}</span>
                </button>
                <!-- Dress: only for non-default looks (the Default is the identity base) -->
                <button
                  v-if="activeVariant(c)!.id !== 'default'"
                  class="inline-flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-[11px] cursor-pointer transition-colors"
                  :class="dressOpen.has(akey(c))
                    ? 'border-white/30 bg-white/10 text-white/85'
                    : 'border-white/15 text-white/70 hover:bg-white/10 hover:text-white/90'"
                  @click="toggleDress(c, activeVariant(c)!)"
                >
                  <Shirt class="size-3" /> Dress
                </button>
                <button
                  v-if="activeVariant(c)!.id !== 'default'"
                  class="text-[10px] text-white/35 hover:text-red-400/80 cursor-pointer px-1.5"
                  @click="deleteVariant(c, activeVariant(c)!)"
                >Delete look</button>
              </div>

              <!-- Dress panel -->
              <div v-if="dressOpen.has(akey(c))" class="rounded border border-white/10 bg-black/20 p-2 space-y-2">
                <!-- mode tabs -->
                <div class="flex gap-1 rounded bg-black/30 p-0.5">
                  <button
                    class="flex-1 rounded py-1 text-[10.5px] transition-colors"
                    :class="(dressMode[akey(c)] ?? 'garment') === 'garment' ? 'bg-white/12 text-white/90' : 'text-white/45 hover:text-white/70'"
                    @click="dressMode[akey(c)] = 'garment'"
                  >Garment photo</button>
                  <button
                    class="flex-1 rounded py-1 text-[10.5px] transition-colors"
                    :class="(dressMode[akey(c)] ?? 'garment') === 'text' ? 'bg-white/12 text-white/90' : 'text-white/45 hover:text-white/70'"
                    @click="dressMode[akey(c)] = 'text'"
                  >Describe</button>
                </div>

                <!-- garment mode -->
                <template v-if="(dressMode[akey(c)] ?? 'garment') === 'garment'">
                  <div v-if="dressGarment[akey(c)]" class="flex items-center gap-2">
                    <img :src="dressGarment[akey(c)]!" class="h-12 w-12 rounded object-cover border border-white/10">
                    <span class="flex-1 text-[10px] text-white/45">Garment ready. Generate to dress {{ c.name }} in it.</span>
                    <button class="text-[10px] text-white/40 hover:text-white/70 cursor-pointer" @click="dressGarment[akey(c)] = null">Remove</button>
                  </div>
                  <label v-else class="flex cursor-pointer items-center justify-center gap-1.5 rounded border border-dashed border-white/15 py-3 text-[10.5px] text-white/45 hover:border-white/30 hover:text-white/65">
                    <Upload class="size-3.5" /> Upload a garment photo
                    <input type="file" accept="image/*" class="hidden" @change="onGarmentFile(akey(c), $event)">
                  </label>
                  <input
                    v-model="dressText[akey(c)]"
                    placeholder="Optional refinement (e.g. sleeves rolled up)"
                    class="w-full bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-[11px] text-white/85 placeholder-white/30 outline-none focus:border-white/25"
                  >
                </template>
                <!-- describe mode -->
                <template v-else>
                  <input
                    v-model="dressText[akey(c)]"
                    placeholder="Describe the outfit (e.g. a white one-piece swimsuit)"
                    class="w-full bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-[11px] text-white/85 placeholder-white/30 outline-none focus:border-white/25"
                  >
                </template>

                <p v-if="dressError[akey(c)]" class="text-[10px] text-red-400/80">{{ dressError[akey(c)] }}</p>

                <!-- result preview or generate -->
                <template v-if="dressResult[akey(c)]">
                  <img :src="dressResult[akey(c)]!" class="w-full rounded border border-white/10 object-contain max-h-48">
                  <div class="flex gap-1.5">
                    <button class="flex-1 rounded bg-white/15 px-2 py-1.5 text-[11px] text-white/90 hover:bg-white/25 cursor-pointer" @click="keepDress(c, activeVariant(c)!)">Keep as cover</button>
                    <button class="rounded border border-white/15 px-2.5 py-1.5 text-[11px] text-white/60 hover:bg-white/10 cursor-pointer" @click="runDress(c, activeVariant(c)!)">Retry</button>
                  </div>
                </template>
                <button
                  v-else
                  class="gen-pastel flex w-full items-center justify-center gap-1.5 rounded px-2.5 py-1.5 text-[11px] font-medium text-neutral-900 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  :class="{ 'animate-pulse': dressBusy.has(akey(c)) }"
                  :disabled="!canDress(akey(c)) || dressBusy.has(akey(c))"
                  @click="runDress(c, activeVariant(c)!)"
                >
                  <Loader2 v-if="dressBusy.has(akey(c))" class="size-3 animate-spin" />
                  <Sparkles v-else class="size-3" />
                  {{ dressBusy.has(akey(c)) ? 'Dressing…' : `Dress · ${dressCost}` }}
                </button>
              </div>
            </template>

            <div class="flex justify-end pt-0.5">
              <button class="text-[10px] text-white/35 hover:text-red-400/80 cursor-pointer" @click="deleteCharacter(c)">Delete character</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
