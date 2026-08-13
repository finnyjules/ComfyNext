/**
 * Character Studio orchestration — extracted from the original library
 * panel verbatim (Task 2 of the Character Studio workbench plan; that panel
 * was retired in Task 4, replaced by CharacterRosterPanel.vue +
 * CharacterStudioModal.vue). Owns state CRUD
 * + selection, sheet generation, the stress-test flow (+ auto-ready and
 * partial-persistence, the only new logic in this extraction), and
 * dress/train. Panel-only concerns (character create/delete, roster
 * expand/collapse, character-level status chips, the "use in image" menu,
 * "cast in shot") stay in the panel.
 *
 * State here is MODULE-level (declared outside the composable function,
 * mirroring useCharacters.ts's pattern) rather than component-scoped: the
 * panel today and the Character Studio modal (Task 3) must share one
 * instance — a sheet generation in progress, a stress-test grid mid-run, or
 * an open dress panel must survive switching between the panel and the
 * modal, not reset per component instance.
 */
import { ref } from 'vue'
import { toast } from 'vue-sonner'

import { useCharacters, useTrainingJobs, characterStatus } from '~/composables/useCharacters'
import type { CharacterRecord, CharacterState, CharacterStateStatus, CharacterPanel, PanelSlot, StressResult } from '#shared/characters/types'
import { emptyState, panelFilename, sortStatesLockedFirst } from '#shared/characters/types'
import { useSheetGeneration, type SheetSource } from '~/composables/useSheetGeneration'
import { uploadRefFilename, viewRefUrl } from '~/lib/shotdirector/refUpload'
import { bakeCompositeSheet } from '~/lib/characters/sheetComposite'
import { HIGGSFIELD_PANELS } from '~/data/character-shot-scenes'
import { usePendingTrainerSeed } from '~/composables/usePendingTrainerSeed'
import { useTabs } from '~/composables/useTabs'
import { buildDressPrompt, DRESS_COST_USD, type DressMode } from '~/lib/wardrobe/dress'
import { freshTiles, stressOutcome, canLock, type StressTile } from '~/lib/characters/stress'
import { buildStressTileRequest, buildTestingPatch, buildLockPatch } from '~/lib/characters/stressFlow'

// Shared conflict-toast wording — every patchState call in this flow shows
// the same message on a 'stale' result (someone else's edit landed first).
export const STALE_MESSAGE = 'Someone else edited this character — reloaded, try again'

// ── Variant selection ───────────────────────────────────────────────────
const selectedStateId = ref<Record<string, string>>({})

function selectState(c: CharacterRecord, id: string) {
  selectedStateId.value[c.slug] = id
}
function activeState(c: CharacterRecord): CharacterState | undefined {
  const id = selectedStateId.value[c.slug] ?? 'default'
  return c.states.find(v => v.id === id) ?? c.states.find(v => v.id === 'default') ?? c.states[0]
}

/** Looks chip row order: stress-tested (locked) looks lead, so the reliable ones are easy to find. */
function sortedStates(c: CharacterRecord): CharacterState[] {
  return sortStatesLockedFirst(c.states)
}

// ── Status chip (draft grey / testing amber / locked action-blue check) ────
function statusChipLabel(status: CharacterStateStatus): string {
  return status === 'draft' ? 'Draft' : status === 'testing' ? 'Testing…' : 'Locked'
}
function statusChipClass(status: CharacterStateStatus): string {
  if (status === 'testing') return 'bg-amber-400/15 text-amber-400/90'
  if (status === 'locked') return 'bg-action/15 text-action'
  return 'bg-white/10 text-white/50'
}

/** Data URL → File, shared by sheet generation (composite) and dress (kept photo). */
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

/** Fetch a /view URL as a data URL — used by sheet generation, stress, and dress. */
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

/** Vkey shared by the stress and dress flows: `${slug}:${stateId}`. */
function vkey(c: CharacterRecord, variant: CharacterState) { return `${c.slug}:${variant.id}` }

// ── Variant ref upload / cover / remove ────────────────────────────────
// `variant` is captured at click time (its `updatedAt`) and sent as
// `expectedUpdatedAt` — a concurrent edit landing during a (possibly long)
// upload now fails the PATCH with a 'stale' toast instead of silently
// clobbering it, so there's no need to defensively re-derive "the live
// variant" before writing (the old stale-closure guard pattern).
async function replaceState(c: CharacterRecord, variant: CharacterState, patch: Partial<CharacterState>): Promise<boolean> {
  const { patchState } = useCharacters()
  const result = await patchState(c.slug, { stateId: variant.id, expectedUpdatedAt: variant.updatedAt, patch })
  if (result === 'stale') { toast.error(STALE_MESSAGE); return false }
  if (result === 'error') { toast.error('Couldn\'t update the character — try again'); return false }
  return true
}

/**
 * Inline descriptor editor (Task: remediation loop). Descriptor is otherwise
 * write-once — set at look creation and never editable again — even though
 * the stress-failure hint tells the user to "edit the descriptor" to fix a
 * failing look. Saves on blur/Enter, and only when the trimmed value
 * actually changed (no-op patch avoided). Locked-state demote-on-content-edit
 * is server-side (characterStatePatch.ts) — nothing extra needed here.
 */
async function saveDescriptor(c: CharacterRecord, variant: CharacterState, e: Event) {
  const value = (e.target as HTMLInputElement).value.trim()
  if (value === variant.descriptor) return
  await replaceState(c, variant, { descriptor: value })
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
    await replaceState(c, variant, { refImages: [...variant.refImages, ...names] })
  }
  ;(e.target as HTMLInputElement).value = ''
}

async function removeRef(c: CharacterRecord, variant: CharacterState, idx: number) {
  await replaceState(c, variant, { refImages: variant.refImages.filter((_, i) => i !== idx) })
}

async function setCover(c: CharacterRecord, variant: CharacterState, idx: number) {
  await replaceState(c, variant, { coverIndex: idx })
}

async function deleteState(c: CharacterRecord, variant: CharacterState) {
  if (variant.id === 'default') return
  if (!window.confirm(`Delete look "${variant.label}"?`)) return
  const { replaceStates } = useCharacters()
  const states = c.states.filter(v => v.id !== variant.id)
  const result = await replaceStates(c.slug, states, c.updatedAt)
  if (result === 'stale') { toast.error(STALE_MESSAGE); return }
  if (result === 'error') { toast.error('Couldn\'t delete the look — try again'); return }
  selectedStateId.value[c.slug] = 'default'
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

async function createState(c: CharacterRecord) {
  const label = (newVariantName.value[c.slug] || '').trim()
  if (!label) return
  const variant: CharacterState = {
    ...emptyState('v-' + Date.now().toString(36), label),
    descriptor: (newVariantDescriptor.value[c.slug] || '').trim(),
  }
  const { replaceStates } = useCharacters()
  const states = [...c.states, variant]
  const result = await replaceStates(c.slug, states, c.updatedAt)
  if (result === 'stale') { toast.error(STALE_MESSAGE); return }
  if (result === 'error') { toast.error('Couldn\'t add the look — try again'); return }
  addingVariant.value.delete(c.slug)
  selectedStateId.value[c.slug] = variant.id
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

async function buildSource(c: CharacterRecord, variant: CharacterState): Promise<SheetSource | null> {
  const { coverUrl } = useCharacters()
  const { jobs } = useTrainingJobs()
  const status = characterStatus(c, jobs.value)
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
  const { jobs } = useTrainingJobs()
  return characterStatus(c, jobs.value) === 'ready' ? '~$0.12' : '~$0.32'
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
  const { patchState } = useCharacters()
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
  // Same key + guard as generateSheet — re-entrancy protection AND it drives
  // the same `expanding`-keyed busy UI (reroll overlay hidden, Generate sheet
  // button spinner/disabled) so a reroll and a full regenerate can't race
  // each other on the same variant.
  const { patchState } = useCharacters()
  const key = `${c.slug}:${variant.id}`
  if (expanding.value.has(key)) return
  expanding.value.add(key)
  try {
    const source = await buildSource(c, variant)
    if (!source) return
    const gen = sheetFor(c, variant)
    try {
      await gen.rerollPanel(slot, source)
    } catch (e) {
      // rerollPanel throws for a derived-panel reroll with no portrait
      // generated yet this session (nothing to derive from) — surface it.
      console.warn('[useCharacterStudio] reroll failed', e)
      toast.error(e instanceof Error ? e.message : 'Reroll failed — try again')
      return
    }
    const rerolled = gen.panels.value.find(p => p.spec.slot === slot)
    if (!rerolled?.dataUrl) { toast.error('Reroll failed — try again'); return }
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
  } finally {
    expanding.value.delete(key)
  }
}

// ── Stress test: 10-tile identity-fidelity grid that gates Lock ────────────
// Sequential + abort-on-first-failure — the same money guard as expandAll
// (useSheetGeneration): the reference sheet is fetched ONCE and reused for
// all 10 tiles, and a failed tile stops the rest of the queue instead of
// spending on tiles likely to fail the same way. Tile state is
// module-level (not persisted) — a reload clears an unfinished grid.
const stressTiles = ref<Record<string, StressTile[]>>({})
const stressBusy = ref<Set<string>>(new Set())

function stressTilesFor(c: CharacterRecord, variant: CharacterState): StressTile[] | null {
  return stressTiles.value[vkey(c, variant)] ?? null
}
function stressPassCount(c: CharacterRecord, variant: CharacterState): number {
  return (stressTilesFor(c, variant) ?? []).filter(t => t.pass === true).length
}

/**
 * Both patchState calls in this flow (the mid-run testing transition and the
 * final lock) must send the state's CURRENT server updatedAt, not whatever
 * was captured when the button was clicked — the testing-transition patch
 * itself advances updatedAt, so a lock call re-using the stale click-time
 * value would 409 against its own prior write. Resolve fresh from the
 * reactive store (patchState refreshes it internally on every call).
 */
function liveState(slug: string, stateId: string): CharacterState | undefined {
  const { characters } = useCharacters()
  return characters.value.find(x => x.slug === slug)?.states.find(s => s.id === stateId)
}

async function runStressTest(c: CharacterRecord, variant: CharacterState) {
  const { patchState } = useCharacters()
  const k = vkey(c, variant)
  if (stressBusy.value.has(k) || !variant.sheetImage) return
  stressBusy.value.add(k)
  const tiles = freshTiles()
  stressTiles.value[k] = tiles
  try {
    let sheetDataUrl: string
    try {
      sheetDataUrl = await fetchAsDataUrl(viewRefUrl(variant.sheetImage))
    } catch {
      toast.error('Couldn\'t load the reference sheet — try again')
      delete stressTiles.value[k]
      return
    }
    let testingPatchSent = false
    for (const tile of tiles) {
      tile.loading = true
      try {
        const req = buildStressTileRequest(sheetDataUrl, tile.scene, tile.idx)
        const res = await fetch('/api/cloud-train/character-shot', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req),
        })
        if (!res.ok) throw new Error(`character-shot ${res.status}`)
        const { imageDataUrl } = await res.json() as { imageDataUrl?: string }
        if (!imageDataUrl) throw new Error('no image returned')
        tile.dataUrl = imageDataUrl
        tile.loading = false
        if (!testingPatchSent) {
          testingPatchSent = true
          const live = liveState(c.slug, variant.id) ?? variant
          const result = await patchState(c.slug, {
            stateId: variant.id, expectedUpdatedAt: live.updatedAt, patch: buildTestingPatch(),
          })
          if (result === 'stale') { toast.error(STALE_MESSAGE); break }
          if (result === 'error') toast.error('Couldn\'t update the character — try again')
        }
      } catch (e) {
        tile.loading = false
        tile.error = true
        console.warn('[useCharacterStudio] stress tile failed', e)
        toast.error(`Stress tile ${tile.idx + 1} of 10 failed — stopped`)
        break
      }
    }
  } finally {
    stressBusy.value.delete(k)
  }
}

/**
 * Auto-ready (new in this task): the old `lockStress` body, now fired
 * automatically — from `markTile`, after every tile judgment — instead of
 * behind an explicit button click. Still a no-op guarded by `canLock`, so
 * calling it before all 10 tiles are generated+judged+passing is harmless.
 */
async function autoReadyIfComplete(c: CharacterRecord, state: CharacterState) {
  const { patchState } = useCharacters()
  const tiles = stressTilesFor(c, state)
  if (!tiles || !canLock(tiles)) return
  const outcome = stressOutcome(tiles)
  if (!outcome) return
  const live = liveState(c.slug, state.id) ?? state
  const result = await patchState(c.slug, {
    stateId: state.id, expectedUpdatedAt: live.updatedAt, patch: buildLockPatch(outcome, new Date().toISOString()),
  })
  if (result === 'stale') { toast.error(STALE_MESSAGE); return }
  if (result === 'error') { toast.error('Couldn\'t lock — try again'); return }
  toast.success(`Locked ${state.label} · ${outcome.passes}/10`)
}

/**
 * Thin setter for a tile's pass/fail judgment — mirrors the previous
 * template's inline toggle (`tile.pass === value ? null : value`, so
 * clicking an already-active button clears the judgment), then triggers
 * the new auto-ready check so a completed grid locks without a button.
 */
function markTile(c: CharacterRecord, state: CharacterState, idx: number, pass: boolean) {
  const tiles = stressTilesFor(c, state)
  const tile = tiles?.find(t => t.idx === idx)
  if (!tile) return
  tile.pass = tile.pass === pass ? null : pass
  void autoReadyIfComplete(c, state)
}

/**
 * Partial-persistence payload builder (new in this task, pure): null when
 * nothing's been judged yet (nothing to save) or when the grid is complete
 * (the auto-ready path above handles that — locking, not a partial patch).
 * Exported for the composable-level unit test.
 */
export function partialResultPatch(tiles: StressTile[], now: string): { stressResult: StressResult } | null {
  const judged = tiles.some(t => t.pass !== null)
  if (!judged) return null
  if (shouldAutoReady(tiles)) return null
  const passes = tiles.filter(t => t.pass === true).length
  return { stressResult: { passes, total: tiles.length, at: now } }
}

/** === canLock(tiles) — exported alias so the panel/modal don't reach past the composable into the stress lib for this gate. */
export function shouldAutoReady(tiles: StressTile[]): boolean {
  return canLock(tiles)
}

/**
 * Partial persistence (new in this task): called when the tester leaves a
 * look's stress-test view before finishing all 10 judgments — e.g. the
 * Character Studio modal (Task 3) closing mid-run. Persists the partial
 * count via `stressResult` while the state's `status` stays 'testing' (the
 * server only demands 10/10 for a lock), so "N/10 poses" survives a modal
 * close instead of the in-memory tile grid being the only record.
 */
async function exitTestMode(c: CharacterRecord, state: CharacterState) {
  const { patchState } = useCharacters()
  const tiles = stressTilesFor(c, state)
  if (!tiles) return
  const patch = partialResultPatch(tiles, new Date().toISOString())
  if (!patch) return
  const live = liveState(c.slug, state.id) ?? state
  const result = await patchState(c.slug, { stateId: state.id, expectedUpdatedAt: live.updatedAt, patch })
  if (result === 'stale') { toast.error(STALE_MESSAGE); return }
  if (result === 'error') { toast.error('Couldn\'t save progress — try again'); return }
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

/** Dress-state key for the character's currently-selected look. */
function akey(c: CharacterRecord): string { const v = activeState(c); return v ? vkey(c, v) : c.slug }

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
  const { coverUrl } = useCharacters()
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
  const ok = await replaceState(c, variant, { refImages: [name, ...variant.refImages], coverIndex: 0 })
  if (!ok) return
  dressOpen.value.delete(k)
  dressResult.value[k] = null
  dressGarment.value[k] = null
  toast.success(`Dressed ${c.name} · ${variant.label}`)
}

// ── Train ────────────────────────────────────────────────────────────────
function trainIdentity(c: CharacterRecord) {
  const { openTab } = useTabs()
  const defaultVariant = c.states.find(v => v.id === 'default') ?? c.states[0]
  usePendingTrainerSeed().set({
    kind: 'character',
    name: c.name,
    trigger: c.trigger,
    refViewUrls: (defaultVariant?.refImages ?? []).map(viewRefUrl),
  })
  openTab({ type: 'train', label: `Train: ${c.name}` })
}

export function useCharacterStudio() {
  return {
    // state CRUD + selection
    selectedStateId, selectState, activeState, sortedStates,
    statusChipLabel, statusChipClass,
    replaceState, saveDescriptor, addRefFiles, removeRef, setCover, deleteState,
    addingVariant, newVariantName, newVariantDescriptor, startNewVariant, cancelNewVariant, createState,
    // sheet generation
    expanding, sheetFor, buildSource, sheetCostLabel, panelUrl, generateSheet, rerollTile,
    // stress + ready
    stressTiles, stressBusy, stressTilesFor, stressPassCount, runStressTest,
    markTile, exitTestMode, autoReadyIfComplete,
    // dress
    dressCost, dressOpen, dressMode, dressGarment, dressText, dressResult, dressBusy, dressError,
    vkey, akey, toggleDress, onGarmentFile, canDress, runDress, keepDress,
    // train
    trainIdentity,
    STALE_MESSAGE,
  }
}
