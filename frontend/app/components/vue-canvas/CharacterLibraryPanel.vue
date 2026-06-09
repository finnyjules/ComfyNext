<script setup lang="ts">
/**
 * Character Library — pick a CHARACTER LoRA + an optional STYLE, then drop a
 * "Flux Dev + 2 LoRAs" node on the canvas with both slots filled.
 *
 * A "character" is just one of your trained LoRAs tagged `kind: 'character'`
 * (set here or from the Styles panel). The style can be one of your other
 * trained LoRAs or any curated public LoRA. The node stacks both on Flux Dev
 * via lucataco/flux-dev-multi-lora — character identity + style in one gen.
 */
import {
  Search as SearchIcon,
  X,
  Drama,
  Sparkles,
  Check,
  Plus,
  Wand2,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'

import {
  LORA_LIBRARY,
  type LoRALibraryEntry,
} from '~/data/lora-library'
import { useNodeSearch } from '~/composables/useNodeSearch'

defineEmits<{ close: [] }>()

const { addNode } = useNodeSearch()

// ── Your trained LoRAs ─────────────────────────────────────────────────────
interface LocalLora {
  filename: string
  name: string
  baseModel: string | null
  provider: string
  trigger: string | null
  aesthetic: string | null
  kind: 'character' | 'style' | null
  url: string | null
  coverUrl: string | null
  trainedOn: string | null
  sizeBytes: number | null
}
const localLoras = ref<LocalLora[]>([])
const loading = ref(true)

async function fetchLocalLoras() {
  try {
    const res = await fetch('/api/loras-local')
    if (!res.ok) return
    const data = await res.json() as { loras: LocalLora[] }
    localLoras.value = data.loras || []
  } catch { /* offline */ }
  finally { loading.value = false }
}
onMounted(fetchLocalLoras)

const characters = computed(() => localLoras.value.filter(l => l.kind === 'character'))
const localStyles = computed(() => localLoras.value.filter(l => l.kind !== 'character'))

// ── Selection state ────────────────────────────────────────────────────────
type StylePick =
  | { type: 'none' }
  | { type: 'local'; lora: LocalLora }
  | { type: 'curated'; entry: LoRALibraryEntry }

const selectedCharacter = ref<LocalLora | null>(null)
const selectedStyle = ref<StylePick>({ type: 'none' })
const charScale = ref(0.9)
const styleScale = ref(0.8)

function pickCharacter(l: LocalLora) {
  selectedCharacter.value = selectedCharacter.value?.filename === l.filename ? null : l
}
function isStyleSelected(s: StylePick): boolean {
  const cur = selectedStyle.value
  if (cur.type !== s.type) return false
  if (cur.type === 'local' && s.type === 'local') return cur.lora.filename === s.lora.filename
  if (cur.type === 'curated' && s.type === 'curated') return cur.entry.hfPath === s.entry.hfPath
  return cur.type === 'none'
}
function pickStyle(s: StylePick) {
  selectedStyle.value = isStyleSelected(s) ? { type: 'none' } : s
}

// ── Style search ───────────────────────────────────────────────────────────
const styleQuery = ref('')
const visibleCuratedStyles = computed<LoRALibraryEntry[]>(() => {
  const q = styleQuery.value.trim().toLowerCase()
  return LORA_LIBRARY.filter(e =>
    !q
    || e.label.toLowerCase().includes(q)
    || e.trigger.toLowerCase().includes(q)
    || e.category.toLowerCase().includes(q)
    || e.author.toLowerCase().includes(q))
})
const visibleLocalStyles = computed<LocalLora[]>(() => {
  const q = styleQuery.value.trim().toLowerCase()
  return localStyles.value.filter(l =>
    !q || l.name.toLowerCase().includes(q) || (l.trigger || '').toLowerCase().includes(q))
})

// ── Compose → add the 2-LoRA node ──────────────────────────────────────────
const canGenerate = computed(() => !!selectedCharacter.value)

const styleLabel = computed(() => {
  const s = selectedStyle.value
  if (s.type === 'local') return s.lora.name
  if (s.type === 'curated') return s.entry.label
  return null
})
const styleTrigger = computed<string | null>(() => {
  const s = selectedStyle.value
  if (s.type === 'local') return s.lora.trigger?.trim() || null
  if (s.type === 'curated') return s.entry.trigger?.trim() || null
  return null
})
// The STYLE's aesthetic profile — a dense description of its look, generated at
// train time. Prepended to the prompt to push the base model toward the style
// (a far stronger signal than the trigger token alone). Only the *style's*
// aesthetic: the character's would reinforce its own lighting bias and fight
// the style. Curated library styles don't ship an aesthetic.
const styleAesthetic = computed<string | null>(() => {
  const s = selectedStyle.value
  return s.type === 'local' ? (s.lora.aesthetic?.trim() || null) : null
})

function generate() {
  const char = selectedCharacter.value
  if (!char) return

  const overrides: Record<string, unknown> = {
    // Slot A = the character (a local trained LoRA → resolved server-side to
    // its weights .tar for multi-lora stacking).
    lora_a: char.filename,
    scale_a: charScale.value,
  }

  const s = selectedStyle.value
  if (s.type === 'local') {
    overrides.lora_b = s.lora.filename
    overrides.scale_b = styleScale.value
  } else if (s.type === 'curated') {
    overrides.lora_b_url = s.entry.hfPath
    overrides.scale_b = styleScale.value
  }

  // Visible prompt: just the trigger words (short — they activate the LoRAs).
  // The STYLE's dense aesthetic goes into the node's collapsed "Style" property
  // (folded into the prompt at run time, same as the single-LoRA node), so the
  // prompt box stays clean for the user's scene.
  const triggers = [char.trigger?.trim(), styleTrigger.value].filter(Boolean)
  const prompt = triggers.length ? `${triggers.join(', ')}, ` : ''
  if (prompt) overrides.prompt = prompt

  const opts: { widgetOverrides: Record<string, unknown>, propertyOverrides?: Record<string, unknown> } = {
    widgetOverrides: overrides,
  }
  if (styleAesthetic.value) opts.propertyOverrides = { aesthetic: styleAesthetic.value }
  addNode('FluxMultiLoRARemoteNode', opts)

  toast.success(`Added ${char.name}`, {
    description: styleLabel.value ? `Styled with ${styleLabel.value}` : 'Character only',
  })
}

// ── Tagging: promote a trained LoRA to a character ─────────────────────────
const showAdd = ref(false)
const tagging = ref<Set<string>>(new Set())

async function setKind(l: LocalLora, kind: 'character' | 'style' | null) {
  tagging.value.add(l.filename)
  try {
    const res = await fetch('/api/loras-local', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: l.filename, kind }),
    })
    if (!res.ok) throw new Error()
    // Reflect locally without a full refetch.
    const target = localLoras.value.find(x => x.filename === l.filename)
    if (target) target.kind = kind
    toast.success(kind === 'character' ? `${l.name} is now a character` : `${l.name} moved to styles`)
  } catch {
    toast.error('Couldn\'t update — try again')
  } finally {
    tagging.value.delete(l.filename)
  }
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
      <!-- ── 1 · Character ─────────────────────────────────────────────── -->
      <div class="px-3 pt-3">
        <div class="flex items-center justify-between mb-2">
          <span class="text-[11px] uppercase tracking-[0.1em] font-semibold text-white/45">Character</span>
          <button
            v-if="characters.length"
            class="inline-flex items-center gap-1 text-[10px] text-white/50 hover:text-white/80 cursor-pointer"
            @click="showAdd = !showAdd"
          >
            <Plus class="size-3" /> Add
          </button>
        </div>

        <!-- Loading -->
        <div v-if="loading" class="py-6 text-center text-xs text-white/40">Loading…</div>

        <!-- Character grid -->
        <div v-else-if="characters.length" class="grid grid-cols-2 gap-2">
          <button
            v-for="c in characters"
            :key="c.filename"
            class="group relative rounded-lg border transition-colors cursor-pointer overflow-hidden aspect-[4/3] text-left"
            :class="selectedCharacter?.filename === c.filename
              ? 'border-violet-400 ring-1 ring-violet-400/60'
              : 'border-white/[0.08] hover:border-violet-400/40'"
            @click="pickCharacter(c)"
          >
            <img v-if="c.coverUrl" :src="c.coverUrl" class="absolute inset-0 w-full h-full object-cover" loading="lazy" />
            <div v-else class="absolute inset-0 flex items-center justify-center" :style="{ background: tileColor(c.name) }">
              <Drama class="size-6 text-white/25" />
            </div>
            <!-- Selected check -->
            <div
              v-if="selectedCharacter?.filename === c.filename"
              class="absolute top-1.5 right-1.5 size-5 rounded-full bg-violet-500 flex items-center justify-center shadow"
            >
              <Check class="size-3 text-white" />
            </div>
            <div class="absolute inset-x-0 bottom-0 px-2 pt-5 pb-1.5 bg-gradient-to-t from-black/85 via-black/45 to-transparent">
              <div class="text-[11px] font-medium text-white truncate">{{ c.name }}</div>
            </div>
          </button>
        </div>

        <!-- Empty state -->
        <div v-else class="rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-4 text-center">
          <Drama class="size-6 text-white/25 mx-auto mb-2" />
          <p class="text-xs text-white/60 leading-snug mb-2">
            No characters yet. Tag one of your trained LoRAs as a character to use it here.
          </p>
          <button
            v-if="localStyles.length"
            class="text-[11px] text-violet-300 hover:text-violet-200 underline underline-offset-2 cursor-pointer"
            @click="showAdd = true"
          >
            Choose from your LoRAs
          </button>
          <p v-else class="text-[10px] text-white/35">Train a LoRA first, then come back.</p>
        </div>

        <!-- Add-character picker: your untagged/style LoRAs → mark as character -->
        <div v-if="showAdd && localStyles.length" class="mt-2 rounded-lg border border-white/[0.08] bg-black/30 p-2 space-y-1">
          <div class="text-[10px] text-white/45 px-1 pb-1">Mark a trained LoRA as a character:</div>
          <button
            v-for="l in localStyles"
            :key="l.filename"
            class="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/[0.06] cursor-pointer text-left disabled:opacity-50"
            :disabled="tagging.has(l.filename)"
            @click="setKind(l, 'character')"
          >
            <div class="size-7 rounded shrink-0 overflow-hidden" :style="{ background: tileColor(l.name) }">
              <img v-if="l.coverUrl" :src="l.coverUrl" class="w-full h-full object-cover" loading="lazy" />
            </div>
            <span class="text-[11px] text-white/80 truncate flex-1">{{ l.name }}</span>
            <span class="text-[10px] text-violet-300 shrink-0">{{ tagging.has(l.filename) ? '…' : '+ Character' }}</span>
          </button>
        </div>
      </div>

      <!-- ── 2 · Style (optional) ─────────────────────────────────────── -->
      <div class="px-3 pt-4">
        <div class="text-[11px] uppercase tracking-[0.1em] font-semibold text-white/45 mb-2">
          Style <span class="text-white/25 normal-case tracking-normal">· optional</span>
        </div>

        <!-- Style search -->
        <div class="relative mb-2">
          <SearchIcon class="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-white/40 pointer-events-none" />
          <input
            v-model="styleQuery"
            type="text"
            placeholder="Search styles…"
            class="w-full bg-white/[0.04] border border-white/10 rounded pl-7 pr-2 py-1.5 text-xs text-white/85 placeholder-white/30 outline-none focus:bg-white/[0.06] focus:border-white/20 transition-colors"
          />
        </div>

        <div class="space-y-1 max-h-[280px] overflow-y-auto pr-0.5">
          <!-- None -->
          <button
            class="w-full flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-left transition-colors"
            :class="isStyleSelected({ type: 'none' }) ? 'bg-violet-500/15 ring-1 ring-violet-400/40' : 'hover:bg-white/[0.05]'"
            @click="pickStyle({ type: 'none' })"
          >
            <div class="size-6 rounded shrink-0 bg-white/[0.06] flex items-center justify-center">
              <X class="size-3 text-white/40" />
            </div>
            <span class="text-[11px] text-white/70 flex-1">No style (character only)</span>
            <Check v-if="isStyleSelected({ type: 'none' })" class="size-3.5 text-violet-300 shrink-0" />
          </button>

          <!-- Your styles -->
          <div v-if="visibleLocalStyles.length" class="text-[9px] uppercase tracking-wider text-white/30 px-2 pt-1.5">Your styles</div>
          <button
            v-for="l in visibleLocalStyles"
            :key="l.filename"
            class="w-full flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-left transition-colors"
            :class="isStyleSelected({ type: 'local', lora: l }) ? 'bg-violet-500/15 ring-1 ring-violet-400/40' : 'hover:bg-white/[0.05]'"
            @click="pickStyle({ type: 'local', lora: l })"
          >
            <div class="size-6 rounded shrink-0 overflow-hidden" :style="{ background: tileColor(l.name) }">
              <img v-if="l.coverUrl" :src="l.coverUrl" class="w-full h-full object-cover" loading="lazy" />
            </div>
            <span class="text-[11px] text-white/80 truncate flex-1">{{ l.name }}</span>
            <span v-if="l.trigger" class="text-[9px] font-mono text-white/35 truncate max-w-[70px]">{{ l.trigger }}</span>
            <Check v-if="isStyleSelected({ type: 'local', lora: l })" class="size-3.5 text-violet-300 shrink-0" />
          </button>

          <!-- Curated styles -->
          <div v-if="visibleCuratedStyles.length" class="text-[9px] uppercase tracking-wider text-white/30 px-2 pt-1.5">Library</div>
          <button
            v-for="e in visibleCuratedStyles"
            :key="e.hfPath"
            class="w-full flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-left transition-colors"
            :class="isStyleSelected({ type: 'curated', entry: e }) ? 'bg-violet-500/15 ring-1 ring-violet-400/40' : 'hover:bg-white/[0.05]'"
            @click="pickStyle({ type: 'curated', entry: e })"
          >
            <div class="size-6 rounded shrink-0" :style="{ background: tileColor(e.author) }" />
            <span class="text-[11px] text-white/80 truncate flex-1">{{ e.label }}</span>
            <span class="text-[9px] font-mono text-white/35 truncate max-w-[70px]">{{ e.trigger }}</span>
            <Check v-if="isStyleSelected({ type: 'curated', entry: e })" class="size-3.5 text-violet-300 shrink-0" />
          </button>
        </div>
      </div>

      <!-- ── Scales (only once a character is chosen) ─────────────────── -->
      <div v-if="selectedCharacter" class="px-3 pt-4">
        <div class="text-[11px] uppercase tracking-[0.1em] font-semibold text-white/45 mb-2">Strength</div>
        <div class="space-y-2.5">
          <label class="block">
            <div class="flex items-center justify-between text-[10.5px] text-white/55 mb-1">
              <span>Character</span><span class="tabular-nums text-white/70">{{ charScale.toFixed(2) }}</span>
            </div>
            <input v-model.number="charScale" type="range" min="0" max="1.5" step="0.05" class="w-full accent-violet-400" />
          </label>
          <label v-if="selectedStyle.type !== 'none'" class="block">
            <div class="flex items-center justify-between text-[10.5px] text-white/55 mb-1">
              <span>Style</span><span class="tabular-nums text-white/70">{{ styleScale.toFixed(2) }}</span>
            </div>
            <input v-model.number="styleScale" type="range" min="0" max="1.5" step="0.05" class="w-full accent-violet-400" />
          </label>
        </div>
      </div>
    </div>

    <!-- Footer: generate -->
    <div class="px-3 py-3 border-t border-white/[0.06]">
      <button
        class="w-full inline-flex items-center justify-center gap-2 h-9 rounded-lg text-[13px] font-semibold transition-colors"
        :class="canGenerate
          ? 'bg-violet-500 hover:bg-violet-400 text-white cursor-pointer'
          : 'bg-white/[0.06] text-white/35 cursor-not-allowed'"
        :disabled="!canGenerate"
        @click="generate"
      >
        <Wand2 class="size-4" />
        <span>Add to canvas</span>
      </button>
      <p class="text-[10px] text-white/35 leading-snug mt-2 text-center">
        <template v-if="!selectedCharacter">Pick a character to start.</template>
        <template v-else-if="selectedStyle.type === 'none'">{{ selectedCharacter.name }} · no style</template>
        <template v-else>{{ selectedCharacter.name }} + {{ styleLabel }}</template>
      </p>
    </div>
  </div>
</template>
