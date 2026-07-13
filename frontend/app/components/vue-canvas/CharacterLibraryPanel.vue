<script lang="ts">
import { ref } from 'vue'

/**
 * True module-level state for the absorb-on-load + one-time sheet auto-gen
 * orchestration (see the block below in <script setup> for the logic). This
 * MUST live in a plain (non-setup) <script> block: variables declared
 * directly inside <script setup> are re-initialized on every component
 * instance (it compiles to a fresh setup() call per mount), so a `let`
 * declared there does NOT survive the panel being closed/reopened — and this
 * panel's parent (layouts/default.vue) mounts it behind a v-if, so it
 * genuinely unmounts/remounts on every toggle. Without this being real
 * module scope, closing and reopening the panel would silently re-run
 * absorb + auto-gen every time, defeating the one-time-per-session and
 * sanctioned-spend guarantees.
 *
 * `autoGenQueue` lives here too for the same reason: it holds the failed
 * rows the Retry UI reads from. If it were `<script setup>` state (re-created
 * per mount), closing the panel while a row was still showing "failed" would
 * wipe the queue on remount — and since `absorbRanThisSession` above already
 * blocks runAbsorbOnce from firing again, that failed row would vanish with
 * no way to retry it until a full page reload.
 */
let absorbRanThisSession = false
const autoGenInFlight = new Set<string>() // slugs currently generating (guards re-entrancy)
interface AutoGenRow { slug: string, name: string, error: boolean }
const autoGenQueue = ref<AutoGenRow[]>([])
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
  type CharacterClient, type CharacterVariantClient, type CharacterStatus,
} from '~/composables/useCharacters'
import { useSheetGeneration, type SheetSource } from '~/composables/useSheetGeneration'
import { uploadRefFile, viewRefUrl } from '~/lib/shotdirector/refUpload'
import { CHARACTER_SHEET_CANONICAL } from '~/data/character-shot-scenes'
import { usePendingTrainerSeed } from '~/composables/usePendingTrainerSeed'
import { buildDressPrompt, DRESS_COST_USD, type DressMode } from '~/lib/wardrobe/dress'

defineEmits<{ close: [] }>()

const { characters, loading, error: charactersError, coverUrl, refresh } = useCharacters()
const { jobs, setPolling } = useTrainingJobs()
const { openTab } = useTabs()

onMounted(() => { setPolling(true); void runAbsorbOnce() })
onUnmounted(() => setPolling(false))

function changed() { window.dispatchEvent(new CustomEvent('sailor:charactersChanged')) }

// ── Absorb-on-load + one-time sheet auto-gen ───────────────────────────────
// This is the one place auto-spend is sanctioned: newly absorbed LoRA
// characters (from U2's migration, or any future manual drop into
// models/loras) get their Default sheet rendered automatically, once.
// `absorbRanThisSession` / `autoGenInFlight` are true module-level state
// (declared in the plain <script> block above) so this fires once per app
// session, not once per panel open.
// AutoGenRow / autoGenQueue live in the module-level <script> block above
// (see the comment there for why) — not re-declared here.
const autoGenActive = ref(false)

async function runAbsorbOnce() {
  if (absorbRanThisSession) return
  absorbRanThisSession = true
  try {
    const res = await fetch('/api/characters-local/absorb', { method: 'POST' })
    if (!res.ok) return
    const { created } = await res.json() as { created: string[], existing: string[] }
    await refresh()

    // Auto-gen targets: characters from `created` (brand-new absorb records)
    // PLUS any ready character whose Default variant has no full generated
    // sheet yet — this covers U2's migration run, which created the 4 real
    // LoRA records (Millie, Sheila, Jene, Reva) before this orchestration
    // existed, so they'd otherwise show up under `existing` and never get
    // sheets. In practice the migration seeded each Default variant with a
    // single non-canonical cover photo (not the 4-shot canonical sheet), so
    // "has no sheet yet" is measured as "fewer than the canonical shot count"
    // rather than a literal-zero check — otherwise 3 of the 4 characters
    // (which have exactly 1 migrated cover ref) would be silently skipped.
    // This still can't re-fire indefinitely: once a character's Default
    // variant reaches the full canonical count (from this auto-gen or a
    // manual "Generate sheet"), it's never a target again.
    void created // reported by absorb for logging/telemetry parity only.
    const targets = characters.value.filter((c) => {
      if (characterStatus(c, jobs.value) !== 'ready' || !c.loraName) return false
      const def = c.variants.find(v => v.id === 'default')
      return !!def && def.refImages.length < CHARACTER_SHEET_CANONICAL.length
    })
    if (!targets.length) return

    autoGenQueue.value = targets.map(c => ({ slug: c.slug, name: c.name, error: false }))
    await runAutoGenQueue()
  } catch (err) {
    console.warn('[CharacterLibraryPanel] absorb-on-load failed', err)
  }
}

async function autoGenerateDefaultSheet(c: CharacterClient): Promise<boolean> {
  if (!c.loraName || autoGenInFlight.has(c.slug)) return false
  autoGenInFlight.add(c.slug)
  try {
    const def = c.variants.find(v => v.id === 'default') ?? c.variants[0]
    if (!def) return false
    const gen = useSheetGeneration(CHARACTER_SHEET_CANONICAL)
    await gen.expandAll({ mode: 'lora', loraFilename: c.loraName, trigger: c.trigger })
    const shots = gen.shots.value.filter(s => s.dataUrl)
    if (!shots.length) return false
    const names: string[] = []
    for (const shot of shots) {
      const file = dataUrlToFile(shot.dataUrl!, `sheet_${Date.now()}_${names.length}.png`)
      const url = await uploadRefFile(file)
      names.push(new URLSearchParams(url.split('?')[1]).get('filename')!)
    }
    // Live-read pattern (same as generateSheet/replaceVariant): re-derive the
    // live character right before the PATCH in case a concurrent edit landed
    // during the (long) generation await.
    const live = characters.value.find(x => x.slug === c.slug) ?? c
    const liveDef = live.variants.find(v => v.id === 'default') ?? live.variants[0]
    if (!liveDef) return false
    const variants = live.variants.map(v => v.id === liveDef.id ? { ...v, refImages: names, coverIndex: 0 } : v)
    const ok = await patchChar(c.slug, { variants })
    return ok && shots.length === CHARACTER_SHEET_CANONICAL.length
  } finally {
    autoGenInFlight.delete(c.slug)
  }
}

async function runAutoGenQueue() {
  if (autoGenActive.value || !autoGenQueue.value.length) return
  autoGenActive.value = true
  try {
    // Sequential — mirrors expandAll's own sequential-per-shot behavior, one
    // character at a time, so failures are isolated and reported per-row.
    for (const row of autoGenQueue.value) {
      const c = characters.value.find(x => x.slug === row.slug)
      if (!c) { row.error = true; continue }
      const ok = await autoGenerateDefaultSheet(c)
      row.error = !ok
    }
  } finally {
    autoGenActive.value = false
    // Drop fully-succeeded rows; keep failures visible for Retry.
    autoGenQueue.value = autoGenQueue.value.filter(r => r.error)
  }
}

async function retryAutoGen(row: AutoGenRow) {
  const c = characters.value.find(x => x.slug === row.slug)
  if (!c) return
  const ok = await autoGenerateDefaultSheet(c)
  row.error = !ok
  if (ok) autoGenQueue.value = autoGenQueue.value.filter(r => r.slug !== row.slug)
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
    changed()
    expandedSlug.value = (await res.json()).slug
    toast.success(`Created ${name}`, { description: 'Add reference photos to make them ready' })
  }
  else if (res.status === 409) toast.error(`A character named "${name}" already exists`)
  else toast.error('Couldn\'t create the character — try again')
}

async function patchChar(slug: string, patch: Record<string, unknown>): Promise<boolean> {
  const res = await fetch('/api/characters-local', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, ...patch }),
  })
  if (res.ok) changed()
  else toast.error('Couldn\'t update the character — try again')
  return res.ok
}

async function deleteCharacter(c: CharacterClient) {
  if (!window.confirm(`Delete character "${c.name}"? Shots casting them will show an error.`)) return
  await patchChar(c.slug, { remove: true })
}

function toggleExpanded(c: CharacterClient) {
  expandedSlug.value = expandedSlug.value === c.slug ? null : c.slug
  if (expandedSlug.value) selectedVariantId.value[c.slug] = selectedVariantId.value[c.slug] || 'default'
}

// ── Status ───────────────────────────────────────────────────────────────
function statusFor(c: CharacterClient): CharacterStatus {
  return characterStatus(c, jobs.value)
}
function trainingPct(c: CharacterClient): number | null {
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
function loraChip(c: CharacterClient): string {
  if (!c.loraName) return ''
  const stem = c.loraName.replace(/\.[^./]+$/, '')
  return stem.split('/').pop() ?? stem
}

// ── Actions row ─────────────────────────────────────────────────────────
function useInImage(c: CharacterClient) {
  window.dispatchEvent(new CustomEvent('sailor:addCharacterImageGen', { detail: { slug: c.slug } }))
}
function castInShot(c: CharacterClient) {
  // Normalize the sentinel 'default' selection away before dispatching — the
  // Character node's own UI (CharacterNode.vue) already strips 'default' to
  // null when the user picks it there, but syncCast's kept/wire comparison
  // (castEdges.ts) checks variantId by strict equality against hydrated cast
  // members, which never carry the literal string 'default' (hydrate strips
  // it). If this node's property still had 'default', wireCastFor would keep
  // producing a member with variantId:'default' that never matches the
  // hydrated one, forcing a permanent cast-sync rewrite every tick.
  const raw = selectedVariantId.value[c.slug]
  const variantId = raw === 'default' ? undefined : raw
  window.dispatchEvent(new CustomEvent('sailor:addCharacterCastNode', {
    detail: { slug: c.slug, name: c.name, variantId },
  }))
}
function trainIdentity(c: CharacterClient) {
  const defaultVariant = c.variants.find(v => v.id === 'default') ?? c.variants[0]
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

function selectVariant(c: CharacterClient, id: string) {
  selectedVariantId.value[c.slug] = id
}
function activeVariant(c: CharacterClient): CharacterVariantClient | undefined {
  const id = selectedVariantId.value[c.slug] ?? 'default'
  return c.variants.find(v => v.id === id) ?? c.variants.find(v => v.id === 'default') ?? c.variants[0]
}

// ── Variant ref upload / cover / remove ────────────────────────────────
async function replaceVariant(c: CharacterClient, variantId: string, patch: Partial<CharacterVariantClient>) {
  // Race: `c` is a click-time closure over `characters.value`. A
  // `charactersChanged` refresh during any await before this point (e.g. a
  // concurrent edit on this or another variant) reassigns `characters.value`,
  // and this PATCH does a full-array replace server-side — so building from
  // the stale `c.variants` would silently clobber that concurrent edit.
  // Re-derive the live character right before building the patch body.
  const live = characters.value.find(x => x.slug === c.slug) ?? c
  const variants = live.variants.map(v => v.id === variantId ? { ...v, ...patch } : v)
  await patchChar(c.slug, { variants })
}

async function addRefFiles(c: CharacterClient, variant: CharacterVariantClient, e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files ?? [])
  if (!files.length) return
  const names: string[] = []
  let failed = 0
  for (const f of files) {
    try {
      const url = await uploadRefFile(f)
      names.push(new URLSearchParams(url.split('?')[1]).get('filename')!)
    } catch { failed++ }
  }
  if (failed) toast.error(`${failed} of ${files.length} upload${files.length === 1 ? '' : 's'} failed`, { description: names.length ? 'The rest were added' : undefined })
  // Re-read the live variant's refImages before appending — the upload loop
  // above can be long-running, so `variant` may be a stale closure (same
  // stale-closure race as replaceVariant/rerollTile).
  if (names.length) {
    const liveVariant = characters.value.find(x => x.slug === c.slug)?.variants.find(v => v.id === variant.id) ?? variant
    await replaceVariant(c, variant.id, { refImages: [...liveVariant.refImages, ...names] })
  }
  ;(e.target as HTMLInputElement).value = ''
}

async function removeRef(c: CharacterClient, variant: CharacterVariantClient, idx: number) {
  // Live-read the variant's refImages before filtering — same stale-closure
  // race as addRefFiles/rerollTile: `variant` is a click-time closure, and a
  // concurrent charactersChanged refresh (e.g. another edit in flight) can
  // reassign characters.value before this runs, so filtering the stale array
  // would silently resurrect whatever the concurrent edit removed/changed.
  const liveVariant = characters.value.find(x => x.slug === c.slug)?.variants.find(v => v.id === variant.id) ?? variant
  await replaceVariant(c, variant.id, { refImages: liveVariant.refImages.filter((_, i) => i !== idx) })
}

async function setCover(c: CharacterClient, variant: CharacterVariantClient, idx: number) {
  await replaceVariant(c, variant.id, { coverIndex: idx })
}

async function deleteVariant(c: CharacterClient, variant: CharacterVariantClient) {
  if (variant.id === 'default') return
  // window.confirm blocks synchronously but can sit open indefinitely while
  // the user reads it, during which characters.value can be reassigned —
  // same stale-closure race as replaceVariant, and this builds its own
  // array directly (not via replaceVariant), so re-derive live here too.
  if (!window.confirm(`Delete look "${variant.label}"?`)) return
  const live = characters.value.find(x => x.slug === c.slug) ?? c
  const variants = live.variants.filter(v => v.id !== variant.id)
  if (await patchChar(c.slug, { variants })) {
    selectedVariantId.value[c.slug] = 'default'
  }
}

// ── New variant ─────────────────────────────────────────────────────────
const addingVariant = ref<Set<string>>(new Set())
const newVariantName = ref<Record<string, string>>({})
const newVariantDescriptor = ref<Record<string, string>>({})

function startNewVariant(c: CharacterClient) {
  addingVariant.value.add(c.slug)
  newVariantName.value[c.slug] = ''
  newVariantDescriptor.value[c.slug] = ''
}
function cancelNewVariant(c: CharacterClient) {
  addingVariant.value.delete(c.slug)
}

async function createVariant(c: CharacterClient) {
  const label = (newVariantName.value[c.slug] || '').trim()
  if (!label) return
  const variant: CharacterVariantClient = {
    id: 'v-' + Date.now().toString(36),
    label,
    descriptor: (newVariantDescriptor.value[c.slug] || '').trim(),
    refImages: [],
    coverIndex: 0,
  }
  // Same stale-closure race as replaceVariant — re-derive the live character
  // right before building the patch body.
  const live = characters.value.find(x => x.slug === c.slug) ?? c
  const variants = [...live.variants, variant]
  if (await patchChar(c.slug, { variants })) {
    addingVariant.value.delete(c.slug)
    selectedVariantId.value[c.slug] = variant.id
    toast.success(`Added look "${label}"`)
  }
}

// ── Sheet generation (per variant) ──────────────────────────────────────
const sheetGens = new Map<string, ReturnType<typeof useSheetGeneration>>()
function sheetFor(c: CharacterClient, variant: CharacterVariantClient) {
  const key = `${c.slug}:${variant.id}`
  let g = sheetGens.get(key)
  if (!g) { g = useSheetGeneration(CHARACTER_SHEET_CANONICAL); sheetGens.set(key, g) }
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

async function buildSource(c: CharacterClient, variant: CharacterVariantClient): Promise<SheetSource | null> {
  const status = statusFor(c)
  if (status === 'ready' && c.loraName) {
    return { mode: 'lora', loraFilename: c.loraName, trigger: c.trigger, descriptor: variant.descriptor || undefined }
  }
  const def = c.variants.find(v => v.id === 'default') ?? c.variants[0]
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

function sheetCostLabel(c: CharacterClient): string {
  return statusFor(c) === 'ready' ? '~$0.12' : '~$0.32'
}

async function generateSheet(c: CharacterClient, variant: CharacterVariantClient) {
  const key = `${c.slug}:${variant.id}`
  if (expanding.value.has(key)) return
  const source = await buildSource(c, variant)
  if (!source) return
  expanding.value.add(key)
  try {
    const gen = sheetFor(c, variant)
    await gen.expandAll(source)
    const shots = gen.shots.value.filter(s => s.dataUrl)
    if (!shots.length) { toast.error('Sheet generation failed — try again'); return }
    const names: string[] = []
    for (const shot of shots) {
      const file = dataUrlToFile(shot.dataUrl!, `sheet_${Date.now()}_${names.length}.png`)
      const url = await uploadRefFile(file)
      names.push(new URLSearchParams(url.split('?')[1]).get('filename')!)
    }
    await replaceVariant(c, variant.id, { refImages: names, coverIndex: 0 })
    toast.success(`Generated ${names.length}-shot sheet for ${variant.label}`)
  } finally {
    expanding.value.delete(key)
  }
}

async function rerollTile(c: CharacterClient, variant: CharacterVariantClient, idx: number) {
  const source = await buildSource(c, variant)
  if (!source) return
  const gen = sheetFor(c, variant)
  await gen.runShot(idx, source)
  const shot = gen.shots.value[idx]
  if (!shot?.dataUrl) return
  const file = dataUrlToFile(shot.dataUrl, `sheet_${Date.now()}_${idx}.png`)
  const url = await uploadRefFile(file)
  const name = new URLSearchParams(url.split('?')[1]).get('filename')!
  // Re-read the live variant's refImages (not the captured `variant` closure)
  // before splicing — same stale-closure race as replaceVariant, but here the
  // patch itself is derived from refImages, so replaceVariant's own live-read
  // of `variants` isn't enough to protect it.
  const liveVariant = characters.value.find(x => x.slug === c.slug)?.variants.find(v => v.id === variant.id) ?? variant
  const refImages = [...liveVariant.refImages]
  refImages[idx] = name
  await replaceVariant(c, variant.id, { refImages })
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

function vkey(c: CharacterClient, variant: CharacterVariantClient) { return `${c.slug}:${variant.id}` }
/** Dress-state key for the character's currently-selected look. */
function akey(c: CharacterClient): string { const v = activeVariant(c); return v ? vkey(c, v) : c.slug }

function toggleDress(c: CharacterClient, variant: CharacterVariantClient) {
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

async function runDress(c: CharacterClient, variant: CharacterVariantClient) {
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

async function keepDress(c: CharacterClient, variant: CharacterVariantClient) {
  const k = vkey(c, variant)
  const dataUrl = dressResult.value[k]
  if (!dataUrl) return
  const file = dataUrlToFile(dataUrl, `dressed_${Date.now()}.png`)
  const url = await uploadRefFile(file)
  const name = new URLSearchParams(url.split('?')[1]).get('filename')!
  // Prepend as the new cover so this look leads with its dressed photo.
  const liveVariant = characters.value.find(x => x.slug === c.slug)?.variants.find(v => v.id === variant.id) ?? variant
  await replaceVariant(c, variant.id, { refImages: [name, ...liveVariant.refImages], coverIndex: 0 })
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

    <!-- Auto-gen banner: one-time sheet render for merged/absorbed LoRA characters -->
    <div v-if="autoGenActive || autoGenQueue.length" class="border-b border-white/10 bg-white/[0.04] px-3 py-2 space-y-1.5">
      <div v-if="autoGenActive" class="flex items-center gap-1.5 text-[11px] text-white/70">
        <Loader2 class="size-3 animate-spin shrink-0" />
        <span>Rendering reference sheets for {{ autoGenQueue.length }} merged character{{ autoGenQueue.length === 1 ? '' : 's' }}… (~$0.12 each)</span>
      </div>
      <template v-if="!autoGenActive">
        <div v-for="row in autoGenQueue" :key="row.slug" class="flex items-center justify-between gap-2 text-[11px]">
          <span class="text-red-400/90 truncate">{{ row.name }} — sheet generation failed</span>
          <button
            class="shrink-0 rounded bg-white/10 px-2 py-0.5 text-[10.5px] text-white/75 hover:bg-white/20 cursor-pointer"
            @click="retryAutoGen(row)"
          >Retry</button>
        </div>
      </template>
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
                  v-for="v in c.variants" :key="v.id"
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
              <div class="grid grid-cols-4 gap-1.5">
                <div v-for="(f, i) in activeVariant(c)!.refImages" :key="f" class="group relative aspect-square overflow-hidden rounded">
                  <img :src="`/view?filename=${encodeURIComponent(f)}&type=input`" class="h-full w-full object-cover">
                  <!-- persistent cover badge: the single photo sent to video -->
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
                    v-if="!expanding.has(`${c.slug}:${activeVariant(c)!.id}`)"
                    class="absolute inset-0 hidden items-center justify-center bg-black/50 group-hover:flex cursor-pointer"
                    title="Re-roll this shot"
                    @click="rerollTile(c, activeVariant(c)!, i)"
                  >
                    <RefreshCcw class="size-3.5 text-white/85" />
                  </button>
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
                The <span class="text-white/55">Cover</span> is the single photo sent to video — pick the clearest one. The rest are angle views for training.
              </p>

              <div class="flex items-center gap-1.5">
                <button
                  class="flex-1 inline-flex items-center justify-center gap-1.5 rounded bg-white/10 px-2.5 py-1.5 text-[11px] text-white/80 hover:bg-white/20 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  :disabled="expanding.has(`${c.slug}:${activeVariant(c)!.id}`)"
                  @click="generateSheet(c, activeVariant(c)!)"
                >
                  <Loader2 v-if="expanding.has(`${c.slug}:${activeVariant(c)!.id}`)" class="size-3 animate-spin" />
                  <Images v-else class="size-3" />
                  <span>{{ activeVariant(c)!.refImages.length ? 'Regenerate sheet' : 'Generate sheet' }} · {{ sheetCostLabel(c) }}</span>
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
