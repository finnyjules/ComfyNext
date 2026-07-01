<script setup lang="ts">
// Shot Director — editor surface. Two-column layout inside a custom modal:
// LEFT = references-first editing controls; RIGHT = always-visible compiled preview.
// All mutations go through update/addReference/removeReference from useShotDirector.
import { computed, ref } from 'vue'
import { X, Plus, Copy, Check, ChevronDown, ChevronRight } from 'lucide-vue-next'
import { useShotDirector } from '~/composables/useShotDirector'
import {
  SHOT_TYPE_PHRASE, CAMERA_MOVE_PHRASE, ROLES_BY_KIND,
  type RefKind, type ShotType, type CameraMove, type Pacing, type RefRole,
} from '~/lib/shotdirector/types'
import { formatShotUSD } from '~/lib/shotdirector/price'
import StudioSection from '~/components/vue-canvas/StudioSection.vue'

const props = defineProps<{ nodeId: string; nodes: any[] }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const node = computed(() => props.nodes.find(n => String(n.id) === String(props.nodeId)))

function persist(s: any) {
  const n = node.value
  if (!n) return
  if (!n.data) n.data = {}
  if (!n.data.properties) n.data.properties = {}
  n.data.properties.comfynext_shotDirector = s
}

const { sheet, result, addReference, removeReference, update, rerollSeed } = useShotDirector(
  node.value?.data?.properties?.comfynext_shotDirector,
  persist,
)

// ── Generate / New take ───────────────────────────────────────────────────────
// `update`/`rerollSeed` call `persist` synchronously (no debounce), so by the time
// we dispatch the canvas event the node's properties already hold the fresh sheet.
const hasErrors = computed(() => result.value.issues.some(i => i.level === 'error'))

function onGenerate() {
  window.dispatchEvent(new CustomEvent('comfynext:shotDirectorGenerate', { detail: { sourceNodeId: props.nodeId } }))
}

function onNewTake() {
  rerollSeed()
  onGenerate()
}

// ── Copy actions ──────────────────────────────────────────────────────────────
const copiedPrompt = ref(false)
const copiedJson = ref(false)

function copyPrompt() {
  navigator.clipboard.writeText(result.value.prompt).then(() => {
    copiedPrompt.value = true
    setTimeout(() => { copiedPrompt.value = false }, 1800)
  })
}
function copyJson() {
  navigator.clipboard.writeText(JSON.stringify(result.value.input, null, 2)).then(() => {
    copiedJson.value = true
    setTimeout(() => { copiedJson.value = false }, 1800)
  })
}

// ── Word budget meter ──────────────────────────────────────────────────────────
const wordCountClass = computed(() => {
  if (result.value.issues.some(i => i.code === 'word-budget-exceeded')) return 'text-red-400'
  if (result.value.wordCount > 100) return 'text-amber-400'
  return 'text-emerald-400'
})
const wordBarClass = computed(() => {
  if (result.value.issues.some(i => i.code === 'word-budget-exceeded')) return 'bg-red-400'
  if (result.value.wordCount > 100) return 'bg-amber-400'
  return 'bg-emerald-400'
})
// Word bar width: 0-100 words maps to 0-100%; 100-600 maps to 100-100% (already capped red)
const wordBarWidth = computed(() => {
  const w = result.value.wordCount
  return Math.min(100, Math.round((w / 100) * 100)) + '%'
})

// ── Reference helpers ─────────────────────────────────────────────────────────
const imageRefs = computed(() =>
  sheet.value.references.filter(r => r.kind === 'image').sort((a, b) => a.slot - b.slot))
const videoRefs = computed(() =>
  sheet.value.references.filter(r => r.kind === 'video').sort((a, b) => a.slot - b.slot))
const audioRefs = computed(() =>
  sheet.value.references.filter(r => r.kind === 'audio').sort((a, b) => a.slot - b.slot))

const DEFAULT_ROLE_BY_KIND: Record<RefKind, RefRole> = {
  image: 'identity-lock',
  video: 'camera-copy',
  audio: 'mood',
}

function humanizeRole(role: string): string {
  return role.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// File input refs per kind
const fileInputImage = ref<HTMLInputElement | null>(null)
const fileInputVideo = ref<HTMLInputElement | null>(null)
const fileInputAudio = ref<HTMLInputElement | null>(null)

function fileInputForKind(kind: RefKind): HTMLInputElement | null {
  if (kind === 'image') return fileInputImage.value
  if (kind === 'video') return fileInputVideo.value
  return fileInputAudio.value
}

function triggerFileAdd(kind: RefKind) {
  fileInputForKind(kind)?.click()
}

async function onFileAdd(kind: RefKind, e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
  addReference(kind, dataUrl, DEFAULT_ROLE_BY_KIND[kind])
  input.value = ''
}

function updateRefRole(kind: RefKind, slot: number, role: RefRole) {
  update(s => ({
    ...s,
    references: s.references.map(r =>
      r.kind === kind && r.slot === slot ? { ...r, role } : r
    ),
  }))
}

// First/last frame file add
const fileInputFirst = ref<HTMLInputElement | null>(null)
const fileInputLast = ref<HTMLInputElement | null>(null)

async function onFrameFile(which: 'firstFrame' | 'lastFrame', e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
  update(s => ({ ...s, [which]: dataUrl }))
  input.value = ''
}

// ── Lighting presets ───────────────────────────────────────────────────────────
const LIGHTING_PRESETS = ['golden hour', 'rim light', 'backlit', 'neon', 'soft daylight']

// ── Constraints chip editor ────────────────────────────────────────────────────
const newConstraint = ref('')
function addConstraint() {
  const v = newConstraint.value.trim()
  if (!v) return
  update(s => ({ ...s, constraints: [...s.constraints, v] }))
  newConstraint.value = ''
}
function removeConstraint(i: number) {
  update(s => ({ ...s, constraints: s.constraints.filter((_, idx) => idx !== i) }))
}

// ── Beats ──────────────────────────────────────────────────────────────────────
const beatsOpen = ref(true)

function addBeat() {
  if (sheet.value.format.durationS === -1 || sheet.value.beats.length >= 3) return
  const dur = sheet.value.format.durationS
  const lastEnd = sheet.value.beats.length > 0
    ? Math.max(...sheet.value.beats.map(b => b.endS))
    : 0
  const start = lastEnd
  const end = Math.min(start + Math.round(dur / 3), dur)
  const id = `beat-${Date.now()}`
  update(s => ({
    ...s,
    beats: [...s.beats, { id, startS: start, endS: end, action: '' }],
  }))
}

function removeBeat(id: string) {
  update(s => ({ ...s, beats: s.beats.filter(b => b.id !== id) }))
}

function patchBeat(id: string, patch: Record<string, unknown>) {
  update(s => ({
    ...s,
    beats: s.beats.map(b => b.id === id ? { ...b, ...patch } : b),
  }))
}

// ── Format helpers ─────────────────────────────────────────────────────────────
// 'adaptive' removed for v1: neither the FilmShotNode combo
// (_VIDEO_GEN_ASPECT_RATIOS) nor _SEEDANCE_AR accepts it — it silently
// coerces to 16:9. Re-add once the FilmShotNode combo + _SEEDANCE_AR are
// widened to support it (follow-up).
const ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']
const DURATIONS = [3, 5, 10, 15]
const RESOLUTIONS = ['720p', '1080p']

const durationLabel = computed(() =>
  sheet.value.format.durationS === -1 ? 'Auto' : String(sheet.value.format.durationS) + 's'
)

function setDuration(v: string) {
  const n = v === 'auto' || v === '-1' ? -1 : Number(v)
  update(s => ({ ...s, format: { ...s.format, durationS: n } }))
}

// ── Dialogue lines ─────────────────────────────────────────────────────────────
function addDialogueLine() {
  update(s => ({
    ...s,
    audio: { ...s.audio, dialogue: [...(s.audio.dialogue ?? []), { speaker: '', line: '' }] },
  }))
}
function removeDialogueLine(i: number) {
  update(s => ({
    ...s,
    audio: { ...s.audio, dialogue: (s.audio.dialogue ?? []).filter((_, idx) => idx !== i) },
  }))
}
function patchDialogue(i: number, patch: { speaker?: string; line?: string }) {
  update(s => ({
    ...s,
    audio: {
      ...s.audio,
      dialogue: (s.audio.dialogue ?? []).map((d, idx) => idx === i ? { ...d, ...patch } : d),
    },
  }))
}
</script>

<template>
  <!-- Full-screen modal overlay -->
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
    <div
      role="dialog"
      aria-modal="true"
      class="flex h-[720px] max-h-[94vh] w-[1160px] max-w-[97vw] flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[#0e0e10] text-white shadow-2xl outline-none"
    >
      <!-- Header -->
      <div class="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-4 pt-3 pb-2.5">
        <span class="text-[13px] font-medium tracking-[-0.01em] text-white/90">Shot Director</span>
        <span class="ml-1 rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-white/40">Seedance 2.0</span>
        <span class="flex-1" />
        <span class="rounded border border-white/10 px-1.5 py-0.5 text-[11px] text-white/30">esc</span>
        <button type="button" aria-label="Close" class="ml-1 text-white/40 transition hover:text-white/80" @click="emit('close')">
          <X class="h-4 w-4" />
        </button>
      </div>

      <!-- Two-column body -->
      <div class="flex min-h-0 flex-1 gap-0">

        <!-- LEFT: editing controls (scrollable) -->
        <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto border-r border-white/[0.06] p-4">

          <!-- ═══ REFERENCE RAIL (primary, top) ═════════════════════════════ -->
          <div class="rounded-lg border border-white/[0.12] bg-white/[0.03]">
            <!-- Mode toggle -->
            <div class="flex items-center gap-0 border-b border-white/[0.08] p-1">
              <button
                type="button"
                class="flex-1 rounded-md py-1.5 text-[11px] font-medium transition-colors"
                :class="sheet.mode === 'reference' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'"
                @click="update(s => ({ ...s, mode: 'reference' }))"
              >Reference</button>
              <button
                type="button"
                class="flex-1 rounded-md py-1.5 text-[11px] font-medium transition-colors"
                :class="sheet.mode === 'firstLastFrame' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'"
                @click="update(s => ({ ...s, mode: 'firstLastFrame' }))"
              >First / Last frame</button>
            </div>

            <!-- Reference mode -->
            <div v-if="sheet.mode === 'reference'" class="space-y-4 p-3">

              <!-- Hidden file inputs -->
              <input ref="fileInputImage" type="file" accept="image/*" class="hidden" @change="onFileAdd('image', $event)" />
              <input ref="fileInputVideo" type="file" accept="video/*" class="hidden" @change="onFileAdd('video', $event)" />
              <input ref="fileInputAudio" type="file" accept="audio/*" class="hidden" @change="onFileAdd('audio', $event)" />

              <!-- Images (≤9) -->
              <div>
                <div class="mb-1.5 flex items-center justify-between">
                  <span class="text-[10px] font-medium uppercase tracking-widest text-white/35">Images <span class="text-white/20">≤9</span></span>
                  <button
                    v-if="imageRefs.length < 9"
                    type="button"
                    class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-white/40 transition hover:bg-white/10 hover:text-white/70"
                    @click="triggerFileAdd('image')"
                  ><Plus class="h-3 w-3" /> Add</button>
                </div>
                <div v-if="imageRefs.length === 0" class="rounded border border-dashed border-white/10 py-3 text-center text-[11px] text-white/25">
                  No images — click Add or paste a URL below
                </div>
                <div class="space-y-1.5">
                  <div
                    v-for="ref in imageRefs" :key="ref.slot"
                    class="flex items-center gap-2 rounded-md border border-white/[0.07] bg-white/[0.03] px-2 py-1.5"
                  >
                    <!-- Tag -->
                    <span class="shrink-0 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/60">[Image{{ ref.slot }}]</span>
                    <!-- Thumbnail (data URL or hosted URL) -->
                    <img
                      v-if="ref.src"
                      :src="ref.src"
                      class="h-8 w-8 shrink-0 rounded object-cover border border-white/10"
                      alt=""
                    />
                    <!-- Role dropdown -->
                    <select
                      :value="ref.role"
                      class="min-w-0 flex-1 rounded border border-white/10 bg-transparent px-1.5 py-0.5 text-[11px] text-white/70 outline-none focus:border-white/30"
                      @change="updateRefRole('image', ref.slot, ($event.target as HTMLSelectElement).value as RefRole)"
                    >
                      <option
                        v-for="role in ROLES_BY_KIND.image" :key="role"
                        :value="role"
                        class="bg-neutral-900"
                      >{{ humanizeRole(role) }}</option>
                    </select>
                    <!-- Remove -->
                    <button type="button" class="shrink-0 rounded p-0.5 text-white/30 transition hover:bg-white/10 hover:text-white/70" @click="removeReference('image', ref.slot)">
                      <X class="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>

              <!-- Videos (≤3) -->
              <div>
                <div class="mb-1.5 flex items-center justify-between">
                  <span class="text-[10px] font-medium uppercase tracking-widest text-white/35">Videos <span class="text-white/20">≤3</span></span>
                  <button
                    v-if="videoRefs.length < 3"
                    type="button"
                    class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-white/40 transition hover:bg-white/10 hover:text-white/70"
                    @click="triggerFileAdd('video')"
                  ><Plus class="h-3 w-3" /> Add</button>
                </div>
                <div v-if="videoRefs.length === 0" class="rounded border border-dashed border-white/10 py-3 text-center text-[11px] text-white/25">
                  No videos
                </div>
                <div class="space-y-1.5">
                  <div
                    v-for="ref in videoRefs" :key="ref.slot"
                    class="flex items-center gap-2 rounded-md border border-white/[0.07] bg-white/[0.03] px-2 py-1.5"
                  >
                    <span class="shrink-0 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/60">[Video{{ ref.slot }}]</span>
                    <select
                      :value="ref.role"
                      class="min-w-0 flex-1 rounded border border-white/10 bg-transparent px-1.5 py-0.5 text-[11px] text-white/70 outline-none focus:border-white/30"
                      @change="updateRefRole('video', ref.slot, ($event.target as HTMLSelectElement).value as RefRole)"
                    >
                      <option
                        v-for="role in ROLES_BY_KIND.video" :key="role"
                        :value="role"
                        class="bg-neutral-900"
                      >{{ humanizeRole(role) }}</option>
                    </select>
                    <button type="button" class="shrink-0 rounded p-0.5 text-white/30 transition hover:bg-white/10 hover:text-white/70" @click="removeReference('video', ref.slot)">
                      <X class="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>

              <!-- Audio (≤3) -->
              <div>
                <div class="mb-1.5 flex items-center justify-between">
                  <span class="text-[10px] font-medium uppercase tracking-widest text-white/35">Audio <span class="text-white/20">≤3</span></span>
                  <button
                    v-if="audioRefs.length < 3"
                    type="button"
                    class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-white/40 transition hover:bg-white/10 hover:text-white/70"
                    @click="triggerFileAdd('audio')"
                  ><Plus class="h-3 w-3" /> Add</button>
                </div>
                <div v-if="audioRefs.length === 0" class="rounded border border-dashed border-white/10 py-3 text-center text-[11px] text-white/25">
                  No audio
                </div>
                <div class="space-y-1.5">
                  <div
                    v-for="ref in audioRefs" :key="ref.slot"
                    class="flex items-center gap-2 rounded-md border border-white/[0.07] bg-white/[0.03] px-2 py-1.5"
                  >
                    <span class="shrink-0 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/60">[Audio{{ ref.slot }}]</span>
                    <select
                      :value="ref.role"
                      class="min-w-0 flex-1 rounded border border-white/10 bg-transparent px-1.5 py-0.5 text-[11px] text-white/70 outline-none focus:border-white/30"
                      @change="updateRefRole('audio', ref.slot, ($event.target as HTMLSelectElement).value as RefRole)"
                    >
                      <option
                        v-for="role in ROLES_BY_KIND.audio" :key="role"
                        :value="role"
                        class="bg-neutral-900"
                      >{{ humanizeRole(role) }}</option>
                    </select>
                    <button type="button" class="shrink-0 rounded p-0.5 text-white/30 transition hover:bg-white/10 hover:text-white/70" @click="removeReference('audio', ref.slot)">
                      <X class="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- First / Last frame mode -->
            <div v-else class="space-y-3 p-3">
              <input ref="fileInputFirst" type="file" accept="image/*" class="hidden" @change="onFrameFile('firstFrame', $event)" />
              <input ref="fileInputLast" type="file" accept="image/*" class="hidden" @change="onFrameFile('lastFrame', $event)" />
              <div class="flex gap-3">
                <div class="flex-1">
                  <p class="mb-1.5 text-[11px] text-white/40">First frame</p>
                  <div
                    class="relative flex h-20 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed border-white/15 bg-white/[0.03] transition hover:border-white/30"
                    @click="fileInputFirst?.click()"
                  >
                    <img v-if="sheet.firstFrame" :src="sheet.firstFrame" class="absolute inset-0 h-full w-full object-cover" alt="" />
                    <span v-else class="text-[11px] text-white/25">+ Add image</span>
                  </div>
                  <button v-if="sheet.firstFrame" type="button" class="mt-1 text-[10px] text-white/30 hover:text-white/60" @click="update(s => ({ ...s, firstFrame: undefined }))">Remove</button>
                </div>
                <div class="flex-1">
                  <p class="mb-1.5 text-[11px] text-white/40">Last frame</p>
                  <div
                    class="relative flex h-20 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed border-white/15 bg-white/[0.03] transition hover:border-white/30"
                    @click="fileInputLast?.click()"
                  >
                    <img v-if="sheet.lastFrame" :src="sheet.lastFrame" class="absolute inset-0 h-full w-full object-cover" alt="" />
                    <span v-else class="text-[11px] text-white/25">+ Add image</span>
                  </div>
                  <button v-if="sheet.lastFrame" type="button" class="mt-1 text-[10px] text-white/30 hover:text-white/60" @click="update(s => ({ ...s, lastFrame: undefined }))">Remove</button>
                </div>
              </div>
            </div>
          </div>

          <!-- ═══ SHOT FIELDS ═══════════════════════════════════════════════ -->
          <StudioSection title="Shot">
            <!-- Subject -->
            <div>
              <label class="mb-1 block text-[11px] text-white/45">Subject</label>
              <input
                type="text"
                :value="sheet.subject"
                placeholder="e.g. A woman in a red coat"
                class="w-full rounded border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[12px] text-white/90 placeholder:text-white/25 outline-none focus:border-white/25"
                @input="update(s => ({ ...s, subject: ($event.target as HTMLInputElement).value }))"
              />
            </div>
            <!-- Action -->
            <div>
              <label class="mb-1 block text-[11px] text-white/45">Action</label>
              <input
                type="text"
                :value="sheet.action"
                placeholder="e.g. walks slowly toward camera"
                class="w-full rounded border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[12px] text-white/90 placeholder:text-white/25 outline-none focus:border-white/25"
                @input="update(s => ({ ...s, action: ($event.target as HTMLInputElement).value }))"
              />
            </div>
            <!-- Environment -->
            <div>
              <label class="mb-1 block text-[11px] text-white/45">Environment</label>
              <input
                type="text"
                :value="sheet.environment"
                placeholder="e.g. rainy street, neon signs"
                class="w-full rounded border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[12px] text-white/90 placeholder:text-white/25 outline-none focus:border-white/25"
                @input="update(s => ({ ...s, environment: ($event.target as HTMLInputElement).value }))"
              />
            </div>
            <!-- Lighting (prominent + presets) -->
            <div>
              <label class="mb-1 block text-[11px] text-white/45">Lighting</label>
              <input
                type="text"
                :value="sheet.lighting"
                placeholder="e.g. golden hour"
                class="w-full rounded border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[12px] text-white/90 placeholder:text-white/25 outline-none focus:border-white/25"
                @input="update(s => ({ ...s, lighting: ($event.target as HTMLInputElement).value }))"
              />
              <div class="mt-1.5 flex flex-wrap gap-1">
                <button
                  v-for="preset in LIGHTING_PRESETS" :key="preset"
                  type="button"
                  class="rounded border px-2 py-0.5 text-[10px] transition-colors"
                  :class="sheet.lighting === preset
                    ? 'border-white/30 bg-white/10 text-white/80'
                    : 'border-white/10 text-white/35 hover:border-white/20 hover:text-white/60'"
                  @click="update(s => ({ ...s, lighting: sheet.lighting === preset ? '' : preset }))"
                >{{ preset }}</button>
              </div>
            </div>
            <!-- Style -->
            <div>
              <label class="mb-1 block text-[11px] text-white/45">Style</label>
              <input
                type="text"
                :value="sheet.style"
                placeholder="e.g. cinematic, 35mm film grain"
                class="w-full rounded border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[12px] text-white/90 placeholder:text-white/25 outline-none focus:border-white/25"
                @input="update(s => ({ ...s, style: ($event.target as HTMLInputElement).value }))"
              />
            </div>
          </StudioSection>

          <!-- ═══ CAMERA ═════════════════════════════════════════════════════ -->
          <StudioSection title="Camera">
            <!-- Shot type -->
            <div>
              <label class="mb-1 block text-[11px] text-white/45">Shot type</label>
              <select
                :value="sheet.camera.shotType"
                class="w-full rounded border border-white/10 bg-[#0e0e10] px-2.5 py-1.5 text-[12px] text-white/80 outline-none focus:border-white/25"
                @change="update(s => ({ ...s, camera: { ...s.camera, shotType: ($event.target as HTMLSelectElement).value as ShotType } }))"
              >
                <option v-for="(label, key) in SHOT_TYPE_PHRASE" :key="key" :value="key" class="bg-neutral-900">{{ label }}</option>
              </select>
            </div>
            <!-- Camera move (single select) -->
            <div>
              <label class="mb-1 block text-[11px] text-white/45">Camera move</label>
              <select
                :value="sheet.camera.move"
                class="w-full rounded border border-white/10 bg-[#0e0e10] px-2.5 py-1.5 text-[12px] text-white/80 outline-none focus:border-white/25"
                @change="update(s => ({ ...s, camera: { ...s.camera, move: ($event.target as HTMLSelectElement).value as CameraMove } }))"
              >
                <option v-for="(label, key) in CAMERA_MOVE_PHRASE" :key="key" :value="key" class="bg-neutral-900">{{ label }}</option>
              </select>
            </div>
            <!-- Pacing -->
            <div>
              <label class="mb-1 block text-[11px] text-white/45">Pacing</label>
              <select
                :value="sheet.camera.pacing"
                class="w-full rounded border border-white/10 bg-[#0e0e10] px-2.5 py-1.5 text-[12px] text-white/80 outline-none focus:border-white/25"
                @change="update(s => ({ ...s, camera: { ...s.camera, pacing: ($event.target as HTMLSelectElement).value as Pacing } }))"
              >
                <option value="slow" class="bg-neutral-900">Slow</option>
                <option value="smooth" class="bg-neutral-900">Smooth</option>
                <option value="gradual" class="bg-neutral-900">Gradual</option>
                <option value="gentle" class="bg-neutral-900">Gentle</option>
              </select>
            </div>
          </StudioSection>

          <!-- ═══ CONSTRAINTS ════════════════════════════════════════════════ -->
          <StudioSection title="Constraints">
            <div class="flex flex-wrap gap-1.5">
              <span
                v-for="(c, i) in sheet.constraints" :key="i"
                class="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[11px] text-white/60"
              >
                {{ c }}
                <button type="button" class="ml-0.5 text-white/30 hover:text-white/70" @click="removeConstraint(i)">×</button>
              </span>
            </div>
            <div class="flex gap-1.5">
              <input
                v-model="newConstraint"
                type="text"
                placeholder="e.g. no camera shake"
                class="min-w-0 flex-1 rounded border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] text-white/80 placeholder:text-white/25 outline-none focus:border-white/25"
                @keydown.enter.prevent="addConstraint"
              />
              <button
                type="button"
                class="shrink-0 rounded border border-white/10 px-2.5 py-1.5 text-[11px] text-white/50 transition hover:bg-white/10 hover:text-white/80"
                @click="addConstraint"
              >Add</button>
            </div>
          </StudioSection>

          <!-- ═══ BEAT BOARD (collapsible) ══════════════════════════════════ -->
          <StudioSection title="Beats" :open="beatsOpen">
            <div class="space-y-2">
              <div
                v-for="beat in sheet.beats" :key="beat.id"
                class="rounded-md border border-white/[0.08] bg-white/[0.03] p-2.5 space-y-2"
              >
                <!-- Time range -->
                <div class="flex items-center gap-2">
                  <label class="shrink-0 text-[10px] text-white/40">Start</label>
                  <input
                    type="number"
                    :value="beat.startS"
                    min="0"
                    :max="sheet.format.durationS > 0 ? sheet.format.durationS : 999"
                    class="w-16 rounded border border-white/10 bg-transparent px-1.5 py-0.5 text-[11px] text-white/80 outline-none"
                    @change="patchBeat(beat.id, { startS: Number(($event.target as HTMLInputElement).value) })"
                  />
                  <label class="shrink-0 text-[10px] text-white/40">End</label>
                  <input
                    type="number"
                    :value="beat.endS"
                    min="0"
                    :max="sheet.format.durationS > 0 ? sheet.format.durationS : 999"
                    class="w-16 rounded border border-white/10 bg-transparent px-1.5 py-0.5 text-[11px] text-white/80 outline-none"
                    @change="patchBeat(beat.id, { endS: Number(($event.target as HTMLInputElement).value) })"
                  />
                  <button type="button" class="ml-auto text-white/25 hover:text-white/60" @click="removeBeat(beat.id)">
                    <X class="h-3 w-3" />
                  </button>
                </div>
                <!-- Action -->
                <input
                  type="text"
                  :value="beat.action"
                  placeholder="What happens in this beat"
                  class="w-full rounded border border-white/10 bg-transparent px-2 py-1 text-[11px] text-white/80 placeholder:text-white/25 outline-none focus:border-white/25"
                  @input="patchBeat(beat.id, { action: ($event.target as HTMLInputElement).value })"
                />
                <!-- Optional overrides -->
                <div class="flex gap-1.5">
                  <select
                    :value="beat.shotType ?? ''"
                    class="flex-1 rounded border border-white/10 bg-[#0e0e10] px-1.5 py-1 text-[10px] text-white/60 outline-none"
                    @change="patchBeat(beat.id, { shotType: ($event.target as HTMLSelectElement).value || undefined })"
                  >
                    <option value="" class="bg-neutral-900">Shot (inherit)</option>
                    <option v-for="(label, key) in SHOT_TYPE_PHRASE" :key="key" :value="key" class="bg-neutral-900">{{ label }}</option>
                  </select>
                  <select
                    :value="beat.move ?? ''"
                    class="flex-1 rounded border border-white/10 bg-[#0e0e10] px-1.5 py-1 text-[10px] text-white/60 outline-none"
                    @change="patchBeat(beat.id, { move: ($event.target as HTMLSelectElement).value || undefined })"
                  >
                    <option value="" class="bg-neutral-900">Move (inherit)</option>
                    <option v-for="(label, key) in CAMERA_MOVE_PHRASE" :key="key" :value="key" class="bg-neutral-900">{{ label }}</option>
                  </select>
                </div>
              </div>

              <button
                type="button"
                class="flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-white/10 py-1.5 text-[11px] text-white/35 transition hover:border-white/25 hover:text-white/60 disabled:opacity-30 disabled:cursor-not-allowed"
                :disabled="sheet.format.durationS === -1 || sheet.beats.length >= 3"
                @click="addBeat"
              >
                <Plus class="h-3 w-3" />
                Add beat
                <span v-if="sheet.format.durationS === -1" class="text-white/25">(set duration first)</span>
                <span v-else-if="sheet.beats.length >= 3" class="text-white/25">(max 3)</span>
              </button>
            </div>
          </StudioSection>

          <!-- ═══ FORMAT BAR ══════════════════════════════════════════════════ -->
          <StudioSection title="Format">
            <div class="grid grid-cols-2 gap-x-3 gap-y-2.5">
              <!-- Aspect ratio -->
              <div>
                <label class="mb-1 block text-[11px] text-white/45">Aspect ratio</label>
                <select
                  :value="sheet.format.aspectRatio"
                  class="w-full rounded border border-white/10 bg-[#0e0e10] px-2 py-1.5 text-[11px] text-white/80 outline-none focus:border-white/25"
                  @change="update(s => ({ ...s, format: { ...s.format, aspectRatio: ($event.target as HTMLSelectElement).value } }))"
                >
                  <option v-for="ar in ASPECT_RATIOS" :key="ar" :value="ar" class="bg-neutral-900">{{ ar }}</option>
                </select>
              </div>
              <!-- Duration -->
              <div>
                <label class="mb-1 block text-[11px] text-white/45">Duration</label>
                <select
                  :value="sheet.format.durationS === -1 ? 'auto' : String(sheet.format.durationS)"
                  class="w-full rounded border border-white/10 bg-[#0e0e10] px-2 py-1.5 text-[11px] text-white/80 outline-none focus:border-white/25"
                  @change="setDuration(($event.target as HTMLSelectElement).value)"
                >
                  <option value="auto" class="bg-neutral-900">Auto</option>
                  <option v-for="d in DURATIONS" :key="d" :value="String(d)" class="bg-neutral-900">{{ d }}s</option>
                </select>
              </div>
              <!-- Resolution -->
              <div>
                <label class="mb-1 block text-[11px] text-white/45">Resolution</label>
                <select
                  :value="sheet.format.resolution"
                  class="w-full rounded border border-white/10 bg-[#0e0e10] px-2 py-1.5 text-[11px] text-white/80 outline-none focus:border-white/25"
                  @change="update(s => ({ ...s, format: { ...s.format, resolution: ($event.target as HTMLSelectElement).value } }))"
                >
                  <option v-for="r in RESOLUTIONS" :key="r" :value="r" class="bg-neutral-900">{{ r }}</option>
                </select>
              </div>
              <!-- Seed -->
              <div>
                <label class="mb-1 block text-[11px] text-white/45">Seed <span class="text-white/20">(optional)</span></label>
                <input
                  type="number"
                  :value="sheet.format.seed ?? ''"
                  placeholder="random"
                  class="w-full rounded border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[11px] text-white/80 placeholder:text-white/25 outline-none focus:border-white/25"
                  @input="update(s => ({ ...s, format: { ...s.format, seed: ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : undefined } }))"
                />
              </div>
            </div>

            <!-- Generate audio toggle -->
            <div class="flex items-center justify-between pt-1">
              <span class="text-[11px] text-white/50">Generate audio</span>
              <button
                type="button"
                class="h-5 w-9 rounded-full transition-colors"
                :class="sheet.audio.generate ? 'bg-white/30' : 'bg-white/10'"
                @click="update(s => ({ ...s, audio: { ...s.audio, generate: !s.audio.generate } }))"
              >
                <span
                  class="block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform mx-0.5"
                  :class="sheet.audio.generate ? 'translate-x-4' : 'translate-x-0'"
                />
              </button>
            </div>

            <!-- Dialogue lines editor -->
            <div v-if="sheet.audio.generate" class="space-y-1.5">
              <div class="flex items-center justify-between">
                <label class="text-[11px] text-white/40">Dialogue lines</label>
                <button type="button" class="flex items-center gap-0.5 text-[10px] text-white/35 hover:text-white/60" @click="addDialogueLine">
                  <Plus class="h-3 w-3" /> Add line
                </button>
              </div>
              <div
                v-for="(line, i) in (sheet.audio.dialogue ?? [])" :key="i"
                class="flex gap-1.5"
              >
                <input
                  type="text"
                  :value="line.speaker ?? ''"
                  placeholder="Speaker"
                  class="w-24 shrink-0 rounded border border-white/10 bg-white/[0.04] px-1.5 py-1 text-[11px] text-white/70 placeholder:text-white/20 outline-none"
                  @input="patchDialogue(i, { speaker: ($event.target as HTMLInputElement).value })"
                />
                <input
                  type="text"
                  :value="line.line"
                  placeholder="Line…"
                  class="min-w-0 flex-1 rounded border border-white/10 bg-white/[0.04] px-1.5 py-1 text-[11px] text-white/80 placeholder:text-white/20 outline-none"
                  @input="patchDialogue(i, { line: ($event.target as HTMLInputElement).value })"
                />
                <button type="button" class="shrink-0 text-white/25 hover:text-white/60" @click="removeDialogueLine(i)">
                  <X class="h-3 w-3" />
                </button>
              </div>
            </div>
          </StudioSection>

        </div><!-- /left column -->

        <!-- RIGHT: compiled preview (sticky, never scrolls) -->
        <div class="flex w-[340px] shrink-0 flex-col gap-3 overflow-y-auto p-4">

          <!-- Word budget meter -->
          <div class="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3">
            <div class="mb-2 flex items-center justify-between">
              <span class="text-[11px] text-white/45">Word budget</span>
              <span class="text-[13px] font-semibold tabular-nums" :class="wordCountClass">{{ result.wordCount }}</span>
            </div>
            <div class="h-1 overflow-hidden rounded-full bg-white/10">
              <div
                class="h-full rounded-full transition-all duration-200"
                :class="wordBarClass"
                :style="{ width: wordBarWidth }"
              />
            </div>
            <p class="mt-1 text-[10px] text-white/25">≤100 words recommended</p>
          </div>

          <!-- Issues -->
          <div v-if="result.issues.length > 0" class="space-y-1">
            <div
              v-for="(issue, i) in result.issues" :key="i"
              class="flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-[11px]"
              :class="issue.level === 'error'
                ? 'border-red-500/20 bg-red-500/[0.06] text-red-300'
                : 'border-amber-500/20 bg-amber-500/[0.06] text-amber-300'"
            >
              <span class="mt-px shrink-0 text-[9px] font-bold uppercase">{{ issue.level }}</span>
              <span>{{ issue.message }}</span>
            </div>
          </div>

          <!-- Compiled prompt -->
          <div class="flex min-h-0 flex-1 flex-col gap-1.5">
            <span class="text-[11px] text-white/40">Compiled prompt</span>
            <div class="min-h-0 flex-1 overflow-y-auto rounded-lg border border-white/[0.08] bg-black/30 p-3">
              <pre class="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-white/75">{{ result.prompt || '(empty — fill in Shot fields to the left)' }}</pre>
            </div>
          </div>

          <!-- Copy actions -->
          <div class="flex flex-col gap-2">
            <button
              type="button"
              class="flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-[12px] font-medium transition-colors"
              :class="copiedPrompt
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                : 'border-white/10 text-white/60 hover:border-white/20 hover:text-white/90'"
              @click="copyPrompt"
            >
              <Check v-if="copiedPrompt" class="h-3.5 w-3.5" />
              <Copy v-else class="h-3.5 w-3.5" />
              {{ copiedPrompt ? 'Copied!' : 'Copy prompt' }}
            </button>
            <button
              type="button"
              class="flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-[12px] font-medium transition-colors"
              :class="copiedJson
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                : 'border-white/10 text-white/60 hover:border-white/20 hover:text-white/90'"
              @click="copyJson"
            >
              <Check v-if="copiedJson" class="h-3.5 w-3.5" />
              <Copy v-else class="h-3.5 w-3.5" />
              {{ copiedJson ? 'Copied!' : 'Copy input JSON' }}
            </button>
          </div>

        </div><!-- /right column -->

      </div><!-- /two-column body -->

      <!-- Footer -->
      <div class="flex shrink-0 items-center justify-end gap-2 border-t border-white/[0.06] px-4 py-2.5">
        <span class="text-[11px] tabular-nums text-white/40" :title="'Estimated provider cost for this shot'">
          {{ formatShotUSD(sheet) }}
        </span>
        <button
          type="button"
          class="rounded bg-white/[0.06] px-2.5 py-1.5 text-[12px] text-white/70 transition hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="hasErrors"
          title="Reroll the seed and generate a new variant"
          @click="onNewTake"
        >
          New take
        </button>
        <button
          type="button"
          class="rounded bg-emerald-500/15 px-3 py-1.5 text-[12px] font-medium text-emerald-300 transition hover:bg-emerald-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="hasErrors"
          @click="onGenerate"
        >
          Generate
        </button>
      </div>
    </div>
  </div>
</template>
