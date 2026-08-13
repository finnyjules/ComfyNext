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
 * defeating the one-time-per-session guarantee. Ported verbatim from the
 * retired library panel.
 */
let absorbRanThisSession = false
</script>

<script setup lang="ts">
/**
 * Character Roster — Task 4 of the Character Studio workbench redesign.
 * Thin scope: one card per character (portrait, name, readiness, the
 * training-pipeline chip), the "Use in image" / "Cast in shot" actions, and
 * a "+ New character" card. Everything else (look switching, descriptor,
 * reference sheet, stress test, dress, delete) lives in CharacterStudioModal
 * (Task 3), one instance of which this panel owns and opens on card click.
 *
 * Status wording on cards comes ONLY from readiness() — the training chip
 * below it is a SEPARATE concept (LoRA pipeline progress, not sheet
 * readiness) and is styled distinctly on purpose.
 */
import { Drama, X } from 'lucide-vue-next'
import { onClickOutside } from '@vueuse/core'

import {
  useCharacters, useTrainingJobs, characterStatus, IN_FLIGHT_STATUSES, slugish,
} from '~/composables/useCharacters'
import type { CharacterRecord } from '#shared/characters/types'
import { defaultState, normalizeStateId } from '#shared/characters/types'
import { emitCharacterEvent } from '~/lib/characters/bus'
import { readiness } from '~/lib/characters/readiness'
import StudioButton from '~/components/vue-canvas/studio/StudioButton.vue'
import CharacterStudioModal from '~/components/vue-canvas/CharacterStudioModal.vue'

defineEmits<{ close: [] }>()

const {
  characters, loading, error: charactersError, coverUrl, portraitUrl, refresh,
} = useCharacters()
const { jobs, setPolling } = useTrainingJobs()

onMounted(() => { setPolling(true); void runAbsorbOnce() })
onUnmounted(() => setPolling(false))

// ── Absorb-on-load ──────────────────────────────────────────────────────────
// Free: pulls newly-dropped LoRAs into character records so they show up in
// the roster. Ported verbatim from the retired library panel — see
// absorbRanThisSession's comment above for why it needs real module scope.
async function runAbsorbOnce() {
  if (absorbRanThisSession) return
  absorbRanThisSession = true
  try {
    const res = await fetch('/api/characters-local/absorb', { method: 'POST' })
    if (!res.ok) return
    await refresh()
  } catch (err) {
    console.warn('[CharacterRosterPanel] absorb-on-load failed', err)
  }
}

// ── Studio modal ─────────────────────────────────────────────────────────
const studioSlug = ref<string | null>(null)
const studioCreateMode = ref(false)

function openStudio(c: CharacterRecord) {
  studioSlug.value = c.slug
  studioCreateMode.value = false
}
function openCreate() {
  studioSlug.value = null
  studioCreateMode.value = true
}

// ── Training-pipeline chip (NOT readiness — ported verbatim) ───────────────
function statusFor(c: CharacterRecord) {
  return characterStatus(c, jobs.value)
}
function trainingPct(c: CharacterRecord): number | null {
  // Same active-status semantics as characterStatus() — only an in-flight
  // job counts, so a finished/failed job with a matching name can't surface
  // stale progress. Also mirror its outputName fallback: a job kicked off
  // with a sanitized/slugified outputName that doesn't match displayName
  // verbatim (e.g. spaces stripped) would otherwise show "Training…" with
  // no percent.
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

function toneClass(tone: 'grey' | 'amber' | 'blue'): string {
  if (tone === 'amber') return 'bg-amber-300/10 text-amber-300'
  if (tone === 'blue') return 'bg-action/15 text-action'
  return 'bg-white/10 text-white/50'
}

// ── Use in image / cast in shot (ported verbatim) ──────────────────────────
// "Use in image" is a visible choice, not a silent fork: a LoRA-less
// character just sends the sheet (nothing else it could do), but a
// character WITH a trained LoRA gets an explicit two-option menu so the
// canvas never silently prefers one path over the other. The menu is
// teleported to <body> in screen space so it isn't clipped by this panel's
// overflow-y-auto list; the anchor button is captured from the click event
// rather than a template ref, since template refs inside v-for come back as
// arrays, not elements.
const useInImageMenuSlug = ref<string | null>(null)
const useInImageMenuAnchor = ref<HTMLElement | null>(null)
const useInImageMenuPanelRef = ref<HTMLElement | null>(null)
const useInImageMenuStyle = ref<Record<string, string>>({})
onClickOutside(useInImageMenuAnchor, () => { useInImageMenuSlug.value = null }, { ignore: [useInImageMenuPanelRef] })

function useInImage(c: CharacterRecord, e: MouseEvent) {
  if (!c.loraName) {
    emitCharacterEvent('addCharacterImageGen', { slug: c.slug, use: 'sheet' })
    return
  }
  if (useInImageMenuSlug.value === c.slug) { useInImageMenuSlug.value = null; return }
  const btn = e.currentTarget as HTMLElement
  useInImageMenuAnchor.value = btn
  const r = btn.getBoundingClientRect()
  const MENU_W = 220
  const left = Math.max(8, Math.min(r.left, window.innerWidth - MENU_W - 8))
  const top = Math.min(r.bottom + 4, window.innerHeight - 120)
  useInImageMenuStyle.value = { left: `${left}px`, top: `${top}px`, width: `${MENU_W}px` }
  useInImageMenuSlug.value = c.slug
}

function chooseUseInImage(c: CharacterRecord, use: 'sheet' | 'lora') {
  emitCharacterEvent('addCharacterImageGen', { slug: c.slug, use })
  useInImageMenuSlug.value = null
}

const useInImageMenuCharacter = computed(() =>
  useInImageMenuSlug.value ? characters.value.find(c => c.slug === useInImageMenuSlug.value) ?? null : null,
)

function onUseInImageMenuKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && useInImageMenuSlug.value) { useInImageMenuSlug.value = null }
}
onMounted(() => window.addEventListener('keydown', onUseInImageMenuKeydown))
onUnmounted(() => window.removeEventListener('keydown', onUseInImageMenuKeydown))

function castInShot(c: CharacterRecord) {
  // normalizeStateId collapses the sentinel 'default' selection (and '' /
  // undefined) to null — the roster only ever casts the default look, so
  // this is always null, but normalizeStateId is still the single place
  // that understands the sentinel (see its own doc comment).
  emitCharacterEvent('addCharacterCastNode', { slug: c.slug, name: c.name, stateId: normalizeStateId(null) })
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

        <!-- Roster -->
        <div class="space-y-1.5">
          <div
            v-for="c in characters" :key="c.slug"
            class="rounded-lg border border-white/10 bg-white/[0.03] p-2 cursor-pointer hover:bg-white/[0.05] transition-colors"
            @click="openStudio(c)"
          >
            <div class="flex items-center gap-2">
              <img
                v-if="portraitUrl(c, null) || coverUrl(c)" :src="(portraitUrl(c, null) ?? coverUrl(c))!"
                class="h-9 w-9 rounded object-cover" :alt="c.name"
              >
              <div v-else class="h-9 w-9 rounded flex items-center justify-center shrink-0" :style="{ background: tileColor(c.name) }">
                <Drama class="size-4 text-white/25" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="truncate text-[12px] text-white/85">{{ c.name }}</div>
                <div class="flex items-center gap-1.5 mt-0.5">
                  <span
                    class="rounded px-1.5 py-0.5 text-[10px] font-medium"
                    :class="toneClass(readiness(defaultState(c)).tone)"
                  >
                    {{ readiness(defaultState(c)).label }}
                  </span>
                  <!-- Training-pipeline chip — pipeline status, not readiness -->
                  <span v-if="statusFor(c) === 'training'" class="text-[10px] font-medium text-blue-400/90">
                    Training…{{ trainingPct(c) !== null ? ` ${trainingPct(c)}%` : '' }}
                  </span>
                  <span
                    v-else-if="statusFor(c) === 'ready'"
                    class="rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-mono text-white/40 truncate max-w-[100px]"
                    :title="c.loraName ?? undefined"
                  >
                    {{ loraChip(c) }}
                  </span>
                </div>
              </div>
            </div>
            <div class="flex gap-1.5 mt-2">
              <StudioButton variant="secondary" class="flex-1" @click.stop="useInImage(c, $event)">
                Image
              </StudioButton>
              <StudioButton variant="secondary" class="flex-1" @click.stop="castInShot(c)">
                Shot
              </StudioButton>
            </div>
          </div>

          <!-- Empty (still shows the create card below) -->
          <p v-if="!loading && !charactersError && !characters.length" class="text-[11px] text-white/30 pb-1">
            None yet — start with "New character" below.
          </p>

          <!-- + New character -->
          <button
            class="w-full rounded-lg border border-dashed border-white/15 px-2 py-2.5 text-[11px] text-white/45 hover:border-white/30 hover:text-white/70 cursor-pointer transition-colors"
            @click="openCreate"
          >
            + New character
          </button>
        </div>
      </div>
    </div>

    <!-- Use-in-image: sheet vs LoRA (only when the character has a trained LoRA) -->
    <Teleport to="body">
      <div
        v-if="useInImageMenuCharacter"
        ref="useInImageMenuPanelRef"
        class="fixed z-[300] rounded-lg border border-white/10 bg-[#1a1a1a] p-1 shadow-2xl"
        :style="useInImageMenuStyle"
      >
        <button
          class="block w-full rounded px-2.5 py-1.5 text-left text-[11px] text-white/85 hover:bg-white/10 cursor-pointer"
          @click="chooseUseInImage(useInImageMenuCharacter, 'sheet')"
        >
          Reference sheet
          <div class="text-[10px] text-white/40">works everywhere · sends the sheet</div>
        </button>
        <button
          class="block w-full rounded px-2.5 py-1.5 text-left text-[11px] text-white/85 hover:bg-white/10 cursor-pointer"
          @click="chooseUseInImage(useInImageMenuCharacter, 'lora')"
        >
          Trained identity (LoRA)
          <div class="text-[10px] text-white/40">Flux only · uses the trigger word</div>
        </button>
      </div>
    </Teleport>

    <CharacterStudioModal
      v-if="studioSlug !== null || studioCreateMode"
      :slug="studioSlug"
      :create-mode="studioCreateMode"
      @close="studioSlug = null; studioCreateMode = false"
    />
  </div>
</template>
