<script setup lang="ts">
/**
 * "Get Started" modal — appears on a fresh blank project.
 *
 * A scannable grid of starting points grouped by what you want to make
 * (Image · Video · Audio · Text · 3D). One click on a card emits the
 * chosen capability; the parent layout drops the generator node — plus a
 * pre-wired source artifact when the capability consumes an upstream asset
 * (from ≠ 'prompt') — so beginners land on a runnable graph in a single
 * click. Skip leaves a blank canvas for power users.
 */
import { X, Search, Sparkles, Image as ImageIcon, Film, AudioWaveform, MessageSquareText, Box as BoxIcon } from 'lucide-vue-next'
import {
  type IOType,
  type Capability,
  CAPABILITIES,
  OUTPUT_TYPES,
} from '~/data/node-capabilities'
import { getGeneratorIcon, getModelBrand } from '~/data/generator-icons'

const emit = defineEmits<{
  start: [payload: { capability: Capability }]
  skip: []
}>()

const OUTPUT_ICONS: Record<string, any> = {
  image: ImageIcon,
  video: Film,
  audio: AudioWaveform,
  text:  MessageSquareText,
  '3d':  BoxIcon,
}
const INPUT_ICONS: Record<string, any> = {
  prompt: Sparkles,
  image:  ImageIcon,
  video:  Film,
  audio:  AudioWaveform,
  text:   MessageSquareText,
}
// Short hint shown on cards that consume an upstream asset.
const FROM_LABEL: Partial<Record<IOType, string>> = {
  image: 'from an image',
  video: 'from a video',
  audio: 'from audio',
  text:  'from text',
}

const query = ref('')

interface Group {
  id: string
  label: string
  icon: any
  caps: Capability[]
}

// Capabilities grouped by output type, in OUTPUT_TYPES order, filtered live
// by the search box. Empty groups are dropped.
const groups = computed<Group[]>(() => {
  const q = query.value.trim().toLowerCase()
  const match = (c: Capability) =>
    !q ||
    c.useCase.toLowerCase().includes(q) ||
    c.model.toLowerCase().includes(q)

  return OUTPUT_TYPES.map((o) => ({
    id: o.id,
    label: o.label,
    icon: OUTPUT_ICONS[o.id],
    caps: CAPABILITIES.filter((c) => c.to === o.id && match(c)),
  })).filter((g) => g.caps.length > 0)
})

const hasResults = computed(() => groups.value.length > 0)

function pick(cap: Capability) {
  emit('start', { capability: cap })
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('skip')
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <!-- Backdrop -->
  <div class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-6" @click.self="emit('skip')">
    <!-- Modal panel -->
    <div class="relative w-[760px] max-w-full max-h-[85vh] flex flex-col bg-[#161616] border border-white/10 rounded-2xl shadow-2xl">
      <!-- Header -->
      <div class="px-8 pt-8 pb-5 shrink-0">
        <button
          class="absolute top-4 right-4 size-7 rounded-md flex items-center justify-center text-white/40 hover:text-white/85 hover:bg-white/[0.06] transition-colors cursor-pointer"
          title="Skip — open a blank canvas"
          @click="emit('skip')"
        >
          <X class="size-4" />
        </button>

        <h2 class="text-[20px] font-medium text-white tracking-[0.1px] mb-1">
          What do you want to make?
        </h2>
        <p class="text-[13px] text-white/45">
          Pick a starting point — we'll set up the canvas for you.
        </p>

        <!-- Search -->
        <div class="mt-5 relative">
          <Search class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-white/35" :stroke-width="1.75" />
          <input
            v-model="query"
            type="text"
            placeholder="Search starting points…"
            autofocus
            class="w-full h-10 pl-9 pr-3 rounded-lg bg-white/[0.03] border border-white/10 text-[14px] text-white placeholder:text-white/35 outline-none focus:border-white/25 focus:bg-white/[0.05] transition-colors"
          />
        </div>
      </div>

      <!-- Card grid -->
      <div class="px-8 pb-2 overflow-y-auto flex-1 min-h-0">
        <div v-for="group in groups" :key="group.id" class="mb-6 last:mb-2">
          <div class="flex items-center gap-2 mb-2.5 text-[11px] font-medium uppercase tracking-wider text-white/40">
            <component :is="group.icon" class="size-3.5" :stroke-width="2" />
            <span>{{ group.label }}</span>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="cap in group.caps"
              :key="`${cap.nodeType}-${cap.from}`"
              class="group/card flex items-start gap-2.5 p-3 min-h-[84px] rounded-xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/25 text-left transition-colors cursor-pointer"
              @click="pick(cap)"
            >
              <span class="shrink-0 size-8 rounded-lg bg-white/[0.05] group-hover/card:bg-white/[0.09] flex items-center justify-center transition-colors">
                <component :is="getGeneratorIcon(cap.nodeType) || Sparkles" class="size-4 text-white/85" :stroke-width="1.75" />
              </span>
              <div class="flex flex-col min-w-0 flex-1">
                <span class="text-[13px] text-white/90 truncate">{{ cap.useCase }}</span>
                <span class="text-[11px] text-white/45 truncate">{{ cap.model }}</span>
                <span
                  v-if="cap.from !== 'prompt' && FROM_LABEL[cap.from]"
                  class="mt-1 inline-flex items-center gap-1 text-[10px] text-white/35"
                >
                  <component :is="INPUT_ICONS[cap.from]" class="size-3" :stroke-width="1.75" />
                  {{ FROM_LABEL[cap.from] }}
                </span>
              </div>
              <span v-if="getModelBrand(cap.nodeType)" class="shrink-0 text-[10px] uppercase tracking-wider text-white/30 mt-0.5">
                {{ getModelBrand(cap.nodeType) }}
              </span>
            </button>
          </div>
        </div>

        <!-- Empty state -->
        <div v-if="!hasResults" class="py-12 text-center text-[13px] text-white/40">
          No starting points match “{{ query }}”.
        </div>
      </div>

      <!-- Footer -->
      <div class="px-8 py-4 shrink-0 border-t border-white/[0.06] flex items-center justify-end">
        <button
          class="text-[12px] text-white/45 hover:text-white/85 transition-colors cursor-pointer"
          @click="emit('skip')"
        >
          Skip — start with a blank canvas
        </button>
      </div>
    </div>
  </div>
</template>
