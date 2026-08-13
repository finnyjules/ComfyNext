<script setup lang="ts">
/**
 * Character Studio — the workbench modal (Task 3 of the redesign plan).
 * Replaces the old library panel's expanded-character view with a single
 * focused surface: one character, one look at a time, the sheet as the
 * stage. Modal chrome (full-screen overlay, bordered dialog, header with
 * title + esc + close) is copied from ShotDirectorSurface.vue /
 * LipSyncSurface.vue — those don't actually wire Escape or backdrop-click
 * themselves (their parent, VueNodeCanvas.vue, teleports them and owns a
 * global key handler that never reaches them), so this component adds real
 * Escape + backdrop dismissal + its own <Teleport to="body"> since it isn't
 * mounted through that parent.
 *
 * Status wording throughout comes ONLY from readiness() (Task 1) — no
 * "locked"/"draft"/"stress"/"variant" anywhere in this file's user-facing
 * text.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Check, ChevronRight, Loader2, MoreHorizontal, Plus, RefreshCcw, Shirt, Sparkles, Upload, X } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { onClickOutside } from '@vueuse/core'

import { useCharacters, useTrainingJobs, characterStatus } from '~/composables/useCharacters'
import { useCharacterStudio } from '~/composables/useCharacterStudio'
import { readiness, type ReadinessKey } from '~/lib/characters/readiness'
import { compositeLayout, COMPOSITE_W, COMPOSITE_H } from '~/lib/characters/sheetComposite'
import { viewRefUrl } from '~/lib/shotdirector/refUpload'
import { canLock, stressOutcome } from '~/lib/characters/stress'
import type { CharacterRecord, CharacterState } from '#shared/characters/types'
import StudioButton from '~/components/vue-canvas/studio/StudioButton.vue'

const props = defineProps<{ slug: string | null; createMode?: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { characters, refresh, patchCharacter, removeCharacter, coverUrl } = useCharacters()

// useTrainingJobs() itself fires an eager, unconditional fetch on every call
// (no de-dupe) — safe to call once at setup like this, but NEVER from inside
// a template expression: the composable's own sheetCostLabel() does exactly
// that internally, so calling it from a template creates a render→fetch→
// mutate→render loop (reproduced live: it floods /api/training-queue and
// exhausts the tab). sheetCost() below reads the already-fetched `jobs` ref
// directly instead of re-invoking useTrainingJobs() on every render.
const { jobs, setPolling } = useTrainingJobs()
onMounted(() => setPolling(true))
onUnmounted(() => setPolling(false))
function sheetCost(c: CharacterRecord): string {
  return characterStatus(c, jobs.value) === 'ready' ? '~$0.12' : '~$0.32'
}

const {
  selectState, activeState, sortedStates,
  saveDescriptor, addRefFiles, removeRef, setCover,
  addingVariant, newVariantName, newVariantDescriptor, startNewVariant, cancelNewVariant, createState,
  expanding, generateSheet, rerollTile,
  stressTilesFor, stressPassCount, runStressTest,
  markTile, exitTestMode,
  dressCost, dressOpen, dressMode, dressGarment, dressText, dressResult, dressBusy, dressError,
  vkey, akey, toggleDress, runDress, keepDress,
  trainIdentity,
} = useCharacterStudio()

// ── Slug in play (create mode swaps this in place once the character exists) ──
const activeSlug = ref<string | null>(props.slug)
watch(() => props.slug, v => { activeSlug.value = v })

const character = computed<CharacterRecord | null>(
  () => (activeSlug.value ? characters.value.find(c => c.slug === activeSlug.value) ?? null : null),
)
const showCreate = computed(() => !character.value && props.createMode)

const state = computed<CharacterState | null>(() => (character.value ? activeState(character.value) ?? null : null))
const ready = computed(() => (state.value ? readiness(state.value) : null))

// ── Header: inline-editable name ────────────────────────────────────────────
async function onNameBlur(e: Event) {
  const c = character.value
  if (!c) return
  const value = (e.target as HTMLInputElement).value.trim()
  if (!value || value === c.name) return
  if (!(await patchCharacter(c.slug, { name: value }))) toast.error('Couldn\'t rename — try again')
}

function toneClass(tone: 'grey' | 'amber' | 'blue'): string {
  if (tone === 'amber') return 'bg-amber-300/10 text-amber-300'
  // "action" is the codebase's one blue accent token (grep confirms the old
  // panel's Locked chip uses bg-action/15 text-action, not a literal sky-*
  // class) — matching it here keeps Ready in the same blue everywhere.
  if (tone === 'blue') return 'bg-action/15 text-action'
  return 'bg-white/10 text-white/50'
}

// ── Close (Escape / backdrop / ✕) — persist any in-progress test judgments first ──
async function requestClose() {
  if (testMode.value && character.value && state.value) {
    await exitTestMode(character.value, state.value)
  }
  emit('close')
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') void requestClose()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

// ── Create mode ──────────────────────────────────────────────────────────
const createName = ref('')
const creating = ref(false)
const createError = ref<string | null>(null)

async function onCreatePhoto(e: Event) {
  const input = e.target as HTMLInputElement
  const name = createName.value.trim()
  if (!name) { createError.value = 'Name her first'; input.value = ''; return }
  if (!input.files?.length) return
  creating.value = true
  createError.value = null
  try {
    const res = await fetch('/api/characters-local', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    })
    if (res.status === 409) { createError.value = `A character named "${name}" already exists`; return }
    if (!res.ok) { createError.value = 'Couldn\'t create the character — try again'; return }
    const { slug } = await res.json() as { slug: string }
    await refresh()
    const c = characters.value.find(x => x.slug === slug)
    const def = c?.states.find(v => v.id === 'default')
    if (c && def) await addRefFiles(c, def, e) // first photo → first ref → coverIndex 0 → the cover
    activeSlug.value = slug
  } finally {
    creating.value = false
  }
}

// ── Stage: composite-sheet hover regions, percentage-scaled to whatever size the <img> renders at ──
const stageRects = computed(() => compositeLayout().map(r => ({
  slot: r.slot,
  left: `${(r.x / COMPOSITE_W) * 100}%`,
  top: `${(r.y / COMPOSITE_H) * 100}%`,
  width: `${(r.w / COMPOSITE_W) * 100}%`,
  height: `${(r.h / COMPOSITE_H) * 100}%`,
})))

function isExpanding(c: CharacterRecord, s: CharacterState): boolean {
  return expanding.value.has(`${c.slug}:${s.id}`)
}

// ── + New look: two inline creators (Describe / Dress her) ────────────────
const newLookOpen = ref(false)
const newLookTab = ref<'describe' | 'dress'>('describe')

function openNewLook() {
  const c = character.value
  if (!c) return
  startNewVariant(c)
  newLookTab.value = 'describe'
  newLookOpen.value = true
}
function closeNewLook() {
  const c = character.value
  if (c) cancelNewVariant(c)
  newLookOpen.value = false
  dressCreateGarment.value = null
  dressCreateText.value = ''
  dressCreateMode.value = 'garment'
  dressCreateError.value = null
}
async function submitDescribe() {
  const c = character.value
  if (!c || !newVariantName.value[c.slug]?.trim()) return
  await createState(c)
  newLookOpen.value = false
}

const dressCreateMode = ref<'garment' | 'text'>('garment')
const dressCreateGarment = ref<string | null>(null)
const dressCreateText = ref('')
const dressCreateBusy = ref(false)
const dressCreateError = ref<string | null>(null)

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}
async function onDressCreateFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  try { dressCreateGarment.value = await fileToDataUrl(file) }
  catch { dressCreateError.value = 'Couldn\'t read that image' }
  ;(e.target as HTMLInputElement).value = ''
}

const canDressCreate = computed(() => {
  const c = character.value
  if (!c || !newVariantName.value[c.slug]?.trim()) return false
  return dressCreateMode.value === 'garment' ? !!dressCreateGarment.value : !!dressCreateText.value.trim()
})

/** After createState + toggleDress + runDress land, the ported result/keep UI reuses the composable's own dress state — keyed by the now-active look. */
const dressCreateResultReady = computed(() => {
  const c = character.value
  if (!c) return false
  const s = activeState(c)
  return !!(s && dressOpen.value.has(vkey(c, s)) && dressResult.value[vkey(c, s)])
})

async function submitDressHer() {
  const c = character.value
  if (!c || !canDressCreate.value) return
  dressCreateBusy.value = true
  dressCreateError.value = null
  try {
    newVariantDescriptor.value[c.slug] = dressCreateText.value.trim()
    await createState(c)
    const variant = activeState(c)
    if (!variant) return
    toggleDress(c, variant)
    const k = vkey(c, variant)
    dressMode.value[k] = dressCreateMode.value
    if (dressCreateMode.value === 'garment') dressGarment.value[k] = dressCreateGarment.value
    dressText.value[k] = dressCreateText.value.trim()
    await runDress(c, variant)
    if (dressError.value[k]) { dressCreateError.value = dressError.value[k]; return }
  } finally {
    dressCreateBusy.value = false
  }
}
async function keepNewLookDress() {
  const c = character.value
  const s = c ? activeState(c) : null
  if (!c || !s) return
  await keepDress(c, s)
  newLookOpen.value = false
  dressCreateGarment.value = null
  dressCreateText.value = ''
}

// ── Test mode ────────────────────────────────────────────────────────────
const testMode = ref(false)

function enterTestMode() {
  if (!character.value?.states.length || !state.value?.sheetImage) return
  testMode.value = true
}
async function confirmRunTest() {
  const c = character.value
  const s = state.value
  if (!c || !s) return
  await runStressTest(c, s)
}
async function backToSheet() {
  const c = character.value
  const s = state.value
  if (c && s) await exitTestMode(c, s)
  testMode.value = false
}
async function onRailSelect(v: CharacterState) {
  if (testMode.value && character.value && state.value) {
    await exitTestMode(character.value, state.value)
    testMode.value = false
  }
  selectState(character.value!, v.id)
}

// Auto-ready: markTile already fires autoReadyIfComplete internally. Watch
// readiness so the moment a state flips to 'ready' WHILE testing, we
// announce it and drop back to the sheet — the only new behavior here.
watch(
  () => (testMode.value && ready.value ? ready.value.key : null),
  (key: ReadinessKey | null, prev) => {
    if (key === 'ready' && prev !== 'ready' && character.value) {
      toast.success(`${character.value.name} is ready`)
      testMode.value = false
    }
  },
)

const showFailureHint = computed(() => {
  const c = character.value
  const s = state.value
  if (!c || !s) return false
  const tiles = stressTilesFor(c, s)
  return !!tiles && !!stressOutcome(tiles) && !canLock(tiles)
})

// ── ⋯ menu ───────────────────────────────────────────────────────────────
const menuOpen = ref(false)
const menuRoot = ref<HTMLElement | null>(null)
onClickOutside(menuRoot, () => { menuOpen.value = false })

function onTrainIdentity() {
  const c = character.value
  if (!c) return
  menuOpen.value = false
  trainIdentity(c)
}
async function onDeleteCharacter() {
  const c = character.value
  if (!c) return
  menuOpen.value = false
  if (!window.confirm(`Delete character "${c.name}"? Shots casting them will show an error.`)) return
  if (!(await removeCharacter(c.slug))) { toast.error('Couldn\'t delete the character — try again'); return }
  emit('close')
}

// ── Photos drawer ──────────────────────────────────────────────────────────
async function onDrawerFiles(e: Event) {
  const c = character.value
  const s = state.value
  if (!c || !s) return
  await addRefFiles(c, s, e)
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70" @mousedown.self="requestClose">
      <div
        role="dialog"
        aria-modal="true"
        class="flex h-[640px] max-h-[94vh] w-[980px] max-w-[97vw] flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[#0e0e10] text-white shadow-2xl outline-none"
      >
        <!-- ═══ Create mode ═══════════════════════════════════════════════ -->
        <template v-if="showCreate">
          <div class="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-4 pt-3 pb-2.5">
            <span class="text-[13px] font-medium tracking-[-0.01em] text-white/90">New character</span>
            <span class="flex-1" />
            <button type="button" aria-label="Close" class="text-white/40 transition hover:text-white/80" @click="requestClose">
              <X class="h-4 w-4" />
            </button>
          </div>
          <div class="flex flex-1 flex-col items-center justify-center gap-4 p-8">
            <input
              v-model="createName"
              placeholder="Her name"
              class="w-72 rounded border border-white/10 bg-white/[0.04] px-3 py-2 text-center text-[13px] text-white/90 placeholder-white/30 outline-none focus:border-white/25"
            >
            <label class="flex w-72 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 py-10 text-[12px] text-white/40 hover:border-white/30 hover:text-white/65">
              <Upload class="size-5" />
              {{ creating ? 'Creating…' : 'Drop or choose her first photo' }}
              <input type="file" accept="image/*" class="hidden" :disabled="creating" @change="onCreatePhoto">
            </label>
            <p v-if="createError" class="text-[11px] text-red-400/80">{{ createError }}</p>
          </div>
        </template>

        <!-- ═══ Workbench ═════════════════════════════════════════════════ -->
        <template v-else-if="character">
          <!-- Header -->
          <div class="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-4 pt-3 pb-2.5">
            <input
              :key="character.slug + ':' + character.updatedAt"
              :value="character.name"
              class="min-w-0 max-w-[220px] bg-transparent text-[13px] font-medium tracking-[-0.01em] text-white/90 outline-none focus:bg-white/[0.06] rounded px-1 -mx-1"
              @blur="onNameBlur"
              @keydown.enter="($event.target as HTMLInputElement).blur()"
            >
            <span
              v-if="ready"
              class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
              :class="toneClass(ready.tone)"
            >
              <Check v-if="ready.key === 'ready'" class="size-2.5" />
              {{ ready.label }}
            </span>
            <span v-if="testMode" class="text-[11px] text-white/40">· {{ state?.label }}</span>
            <span class="flex-1" />
            <span class="rounded border border-white/10 px-1.5 py-0.5 text-[11px] text-white/30">esc</span>
            <button type="button" aria-label="Close" class="ml-1 text-white/40 transition hover:text-white/80" @click="requestClose">
              <X class="h-4 w-4" />
            </button>
          </div>

          <!-- Body -->
          <div class="flex min-h-0 flex-1">
            <!-- Left rail -->
            <div class="flex w-[168px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-white/[0.06] p-2">
              <button
                v-for="v in sortedStates(character)" :key="v.id"
                type="button"
                class="rounded-md border px-2.5 py-1.5 text-left transition-colors cursor-pointer"
                :class="(state && state.id === v.id)
                  ? 'border-action/50 bg-action/10 text-white'
                  : 'border-white/[0.06] bg-white/[0.02] text-white/70 hover:bg-white/[0.05]'"
                @click="onRailSelect(v)"
              >
                <div class="truncate text-[11.5px]">{{ v.label }}</div>
                <div class="mt-0.5 text-[9.5px] text-white/35">{{ readiness(v).label }}</div>
              </button>

              <button
                type="button"
                class="mt-0.5 flex items-center gap-1 rounded-md border border-dashed border-white/15 px-2.5 py-1.5 text-left text-[11px] text-white/45 hover:border-white/30 hover:text-white/70 cursor-pointer"
                @click="newLookOpen ? closeNewLook() : openNewLook()"
              >
                <Plus class="size-3 shrink-0" /> New look
                <ChevronRight class="ml-auto size-3 shrink-0 transition-transform" :class="{ 'rotate-90': newLookOpen }" />
              </button>

              <!-- + New look: Describe / Dress her -->
              <div v-if="newLookOpen" class="rounded-md border border-white/10 bg-black/20 p-2 space-y-1.5">
                <div class="flex gap-1 rounded bg-black/30 p-0.5">
                  <button
                    type="button"
                    class="flex-1 rounded py-1 text-[10px] transition-colors cursor-pointer"
                    :class="newLookTab === 'describe' ? 'bg-white/12 text-white/90' : 'text-white/45 hover:text-white/70'"
                    @click="newLookTab = 'describe'"
                  >Describe</button>
                  <button
                    type="button"
                    class="flex-1 rounded py-1 text-[10px] transition-colors cursor-pointer"
                    :class="newLookTab === 'dress' ? 'bg-white/12 text-white/90' : 'text-white/45 hover:text-white/70'"
                    @click="newLookTab = 'dress'"
                  >Dress her</button>
                </div>

                <template v-if="newLookTab === 'describe'">
                  <input
                    v-model="newVariantName[character.slug]"
                    placeholder="Look name"
                    class="w-full bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-[10.5px] text-white/85 placeholder-white/30 outline-none focus:border-white/25"
                  >
                  <input
                    v-model="newVariantDescriptor[character.slug]"
                    placeholder="What she wears in this look"
                    class="w-full bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-[10.5px] text-white/85 placeholder-white/30 outline-none focus:border-white/25"
                  >
                  <div class="flex justify-end gap-1.5 pt-0.5">
                    <button type="button" class="text-[10px] text-white/40 hover:text-white/70 cursor-pointer" @click="closeNewLook">Cancel</button>
                    <button
                      type="button"
                      class="rounded bg-white/15 px-2 py-1 text-[10px] text-white/85 hover:bg-white/25 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      :disabled="!newVariantName[character.slug]?.trim()"
                      @click="submitDescribe"
                    >Create</button>
                  </div>
                </template>

                <template v-else>
                  <input
                    v-model="newVariantName[character.slug]"
                    placeholder="Look name"
                    class="w-full bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-[10.5px] text-white/85 placeholder-white/30 outline-none focus:border-white/25"
                  >
                  <template v-if="!dressCreateResultReady">
                    <div class="flex gap-1 rounded bg-black/30 p-0.5">
                      <button type="button" class="flex-1 rounded py-1 text-[10px]" :class="dressCreateMode === 'garment' ? 'bg-white/12 text-white/90' : 'text-white/45'" @click="dressCreateMode = 'garment'">Garment photo</button>
                      <button type="button" class="flex-1 rounded py-1 text-[10px]" :class="dressCreateMode === 'text' ? 'bg-white/12 text-white/90' : 'text-white/45'" @click="dressCreateMode = 'text'">Describe</button>
                    </div>
                    <template v-if="dressCreateMode === 'garment'">
                      <div v-if="dressCreateGarment" class="flex items-center gap-1.5">
                        <img :src="dressCreateGarment" class="h-9 w-9 rounded object-cover border border-white/10">
                        <button type="button" class="text-[9.5px] text-white/40 hover:text-white/70 cursor-pointer" @click="dressCreateGarment = null">Remove</button>
                      </div>
                      <label v-else class="flex cursor-pointer items-center justify-center gap-1 rounded border border-dashed border-white/15 py-2 text-[10px] text-white/45 hover:border-white/30">
                        <Upload class="size-3" /> Upload a photo
                        <input type="file" accept="image/*" class="hidden" @change="onDressCreateFile">
                      </label>
                    </template>
                    <input
                      v-model="dressCreateText"
                      :placeholder="dressCreateMode === 'garment' ? 'Optional refinement' : 'Describe the outfit'"
                      class="w-full bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-[10.5px] text-white/85 placeholder-white/30 outline-none focus:border-white/25"
                    >
                    <p v-if="dressCreateError" class="text-[9.5px] text-red-400/80">{{ dressCreateError }}</p>
                    <div class="flex justify-end gap-1.5 pt-0.5">
                      <button type="button" class="text-[10px] text-white/40 hover:text-white/70 cursor-pointer" @click="closeNewLook">Cancel</button>
                      <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded bg-white/15 px-2 py-1 text-[10px] text-white/85 hover:bg-white/25 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        :disabled="!canDressCreate || dressCreateBusy"
                        @click="submitDressHer"
                      >
                        <Loader2 v-if="dressCreateBusy" class="size-2.5 animate-spin" />
                        <Sparkles v-else class="size-2.5" />
                        {{ dressCreateBusy ? 'Dressing…' : `Dress & create · ${dressCost}` }}
                      </button>
                    </div>
                  </template>
                  <template v-else>
                    <img :src="dressResult[vkey(character, activeState(character)!)]!" class="w-full rounded border border-white/10 object-contain max-h-32">
                    <div class="flex gap-1.5">
                      <button type="button" class="flex-1 rounded bg-white/15 px-2 py-1 text-[10px] text-white/90 hover:bg-white/25 cursor-pointer" @click="keepNewLookDress">Keep look</button>
                      <button type="button" class="rounded border border-white/15 px-2 py-1 text-[10px] text-white/60 hover:bg-white/10 cursor-pointer" @click="runDress(character, activeState(character)!)">Retry</button>
                    </div>
                  </template>
                </template>
              </div>
            </div>

            <!-- Main column: stage / test grid + descriptor + drawer -->
            <div class="flex min-w-0 flex-1 flex-col overflow-y-auto p-3 gap-2.5">
              <!-- ═══ Stage (normal state) ═══════════════════════════════ -->
              <template v-if="!testMode">
                <div class="relative w-full overflow-hidden rounded-lg bg-white/[0.03]" style="aspect-ratio: 1920 / 1080">
                  <template v-if="state?.sheetImage">
                    <img :src="viewRefUrl(state.sheetImage)" class="h-full w-full object-cover" alt="">
                    <div
                      v-for="r in stageRects" :key="r.slot"
                      class="group absolute cursor-pointer"
                      :style="{ left: r.left, top: r.top, width: r.width, height: r.height }"
                      title="Redo this shot"
                      @click="rerollTile(character, state, r.slot)"
                    >
                      <div class="hidden h-full w-full items-center justify-center bg-black/50 group-hover:flex">
                        <RefreshCcw class="size-4 text-white/85" />
                        <span class="ml-1.5 text-[11px] text-white/85">Redo this shot</span>
                      </div>
                    </div>
                    <div v-if="isExpanding(character, state)" class="absolute inset-0 flex items-center justify-center bg-black/70">
                      <Loader2 class="size-5 animate-spin text-white/70" />
                    </div>
                  </template>
                  <template v-else>
                    <div class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                      <Loader2 v-if="state && isExpanding(character, state)" class="size-5 animate-spin text-white/50" />
                      <template v-else>
                        <p class="text-[12px] text-white/40">Build a sheet to start working with this look.</p>
                        <StudioButton variant="primary" :disabled="!state" @click="state && generateSheet(character, state)">
                          Build her sheet · {{ sheetCost(character) }}
                        </StudioButton>
                      </template>
                    </div>
                  </template>
                </div>

                <!-- Descriptor -->
                <input
                  v-if="state"
                  :key="`${state.id}:${state.updatedAt}`"
                  :value="state.descriptor"
                  placeholder="What she wears in this look — it travels into every shot."
                  class="w-full rounded border border-white/10 bg-transparent px-2.5 py-1.5 text-[11.5px] italic text-white/70 placeholder-white/30 outline-none focus:border-white/25"
                  @blur="saveDescriptor(character, state, $event)"
                  @keydown.enter="($event.target as HTMLInputElement).blur()"
                >

                <!-- Photos drawer -->
                <div v-if="state" class="flex items-center gap-1.5">
                  <div v-for="(f, i) in state.refImages" :key="f" class="group relative size-8 shrink-0 overflow-hidden rounded">
                    <img :src="viewRefUrl(f)" class="h-full w-full object-cover">
                    <span v-if="i === state.coverIndex" class="pointer-events-none absolute left-0 top-0 rounded-br bg-white/90 px-1 text-[7px] font-semibold text-neutral-900">Cover</span>
                    <button type="button" class="absolute right-0 top-0 hidden rounded bg-black/70 px-1 text-[9px] text-white/80 group-hover:block cursor-pointer" @click="removeRef(character, state, i)">×</button>
                    <button v-if="i !== state.coverIndex" type="button" class="absolute bottom-0 left-0 hidden rounded bg-black/70 px-1 text-[8px] text-white/70 group-hover:block cursor-pointer" @click="setCover(character, state, i)">set cover</button>
                  </div>
                  <label class="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded border border-dashed border-white/15 text-[13px] text-white/40 hover:border-white/30">
                    +<input type="file" accept="image/*" multiple class="hidden" @change="onDrawerFiles">
                  </label>
                  <span class="ml-1 text-[10px] text-white/35">her photos</span>
                </div>
              </template>

              <!-- ═══ Test mode (stage swaps) ═══════════════════════════ -->
              <template v-else-if="character && state">
                <!-- Money gate: entering test mode never spends by itself — this
                     inline confirm is the one explicit click that triggers runStressTest. -->
                <div v-if="!stressTilesFor(character, state)" class="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg bg-white/[0.03] py-10 text-center">
                  <p class="text-[12px] text-white/50">This generates 10 test images · ~$0.80</p>
                  <div class="flex gap-2">
                    <StudioButton variant="secondary" @click="testMode = false">Cancel</StudioButton>
                    <StudioButton variant="primary" @click="confirmRunTest">Confirm</StudioButton>
                  </div>
                </div>

                <template v-else>
                  <div class="grid grid-cols-5 gap-1.5">
                    <div
                      v-for="tile in stressTilesFor(character, state)!" :key="tile.idx"
                      class="relative aspect-square overflow-hidden rounded bg-white/[0.04]"
                    >
                      <img v-if="tile.dataUrl" :src="tile.dataUrl" class="h-full w-full object-cover">
                      <div v-else-if="tile.loading" class="flex h-full items-center justify-center">
                        <Loader2 class="size-4 animate-spin text-white/40" />
                      </div>
                      <div v-else-if="tile.error" class="flex h-full items-center justify-center px-1 text-center text-[9px] leading-tight text-red-400/70">Failed</div>
                      <div v-else class="flex h-full items-center justify-center text-[11px] text-white/15">·</div>

                      <div v-if="tile.dataUrl" class="absolute inset-x-0 bottom-0 flex justify-center gap-1 bg-black/55 py-0.5">
                        <button type="button" class="rounded p-0.5 cursor-pointer" :class="tile.pass === true ? 'bg-action text-white' : 'text-white/50 hover:text-white/85'" title="Yes, that's her" @click="markTile(character, state, tile.idx, true)">
                          <Check class="size-3.5" />
                        </button>
                        <button type="button" class="rounded p-0.5 cursor-pointer" :class="tile.pass === false ? 'bg-red-500/85 text-white' : 'text-white/50 hover:text-white/85'" title="Not her" @click="markTile(character, state, tile.idx, false)">
                          <X class="size-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  <p class="text-[11px] text-white/45">
                    <b class="text-white/85">{{ stressPassCount(character, state) }} of {{ stressTilesFor(character, state)!.length }} held up so far</b> — mark each: is this her?
                  </p>
                  <p v-if="showFailureHint" class="text-[10.5px] leading-relaxed text-amber-400/80">
                    Fix the description, not the model — edit what she wears, redo a panel, then test again.
                  </p>
                </template>
              </template>
            </div>
          </div>

          <!-- Footer -->
          <div class="flex shrink-0 items-center gap-2 border-t border-white/[0.06] px-4 py-2.5">
            <template v-if="!testMode">
              <StudioButton v-if="state?.sheetImage" variant="secondary" @click="enterTestMode">Test 10 poses · ~$0.80</StudioButton>
              <span class="text-[10.5px] text-white/30">hover any panel to redo just that shot</span>
              <span class="flex-1" />
              <div ref="menuRoot" class="relative">
                <StudioButton variant="subtle" @click="menuOpen = !menuOpen">
                  <MoreHorizontal class="size-3.5" />
                </StudioButton>
                <div v-if="menuOpen" class="absolute bottom-full right-0 mb-1.5 w-44 rounded-lg border border-white/10 bg-[#1a1a1a] p-1 shadow-2xl z-10">
                  <button type="button" class="flex w-full items-center gap-1.5 rounded px-2.5 py-1.5 text-left text-[11px] text-white/85 hover:bg-white/10 cursor-pointer" @click="onTrainIdentity">
                    <Shirt class="size-3" /> Train identity
                  </button>
                  <button type="button" class="flex w-full items-center gap-1.5 rounded px-2.5 py-1.5 text-left text-[11px] text-red-400/80 hover:bg-white/10 cursor-pointer" @click="onDeleteCharacter">
                    <X class="size-3" /> Delete character
                  </button>
                </div>
              </div>
              <StudioButton
                variant="primary"
                :disabled="!state || (!!state && isExpanding(character, state))"
                @click="state && generateSheet(character, state)"
              >
                <Loader2 v-if="state && isExpanding(character, state)" class="size-3 animate-spin" />
                {{ state?.sheetImage ? 'Rebuild sheet' : 'Build her sheet' }} · {{ sheetCost(character) }}
              </StudioButton>
            </template>
            <template v-else>
              <span class="flex-1" />
              <StudioButton variant="secondary" @click="backToSheet">Back to sheet</StudioButton>
            </template>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>
