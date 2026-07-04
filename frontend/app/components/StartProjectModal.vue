<script setup lang="ts">
/**
 * "Get Started" modal — the taxonomy's front door, shown on every fresh
 * blank project. Deliberately a CAPABILITY SHOWCASE, not an intent
 * collector: no prompt field (a prompt is untrustworthy before the user
 * knows what the product can do), no long-tail browse (that's the Actions
 * panel's job). 8 hero verbs + 6 studios, one glance, no scrolling.
 *
 * Picking an action drops the node — plus a pre-wired source artifact when
 * the action consumes one (entry.source) — so beginners land on a runnable
 * graph in one click. Studio tiles route through the same handler as the
 * toolbar's Studios door. Skip leaves a blank canvas.
 */
import { X, Image as ImageIcon, Film, Sparkles } from 'lucide-vue-next'
import { modalHero, type ActionSource } from '~/data/action-catalog'
import { STUDIO_OPTIONS, type StudioOption } from '~/data/studio-options'
import { getGeneratorIcon, getModelBrand } from '~/data/generator-icons'

const emit = defineEmits<{
  start: [payload: { nodeType: string; source?: ActionSource }]
  studio: [opt: StudioOption]
  skip: []
}>()

const heroCards = modalHero()

const SOURCE_HINT: Partial<Record<ActionSource, { label: string; icon: any }>> = {
  image: { label: 'from an image', icon: ImageIcon },
  video: { label: 'from a video', icon: Film },
}

function pickAction(nodeType: string, source?: ActionSource) {
  emit('start', { nodeType, source })
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
      <div class="px-8 pt-8 pb-4 shrink-0">
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
          Pick an action — or skip and build freely.
        </p>
      </div>

      <!-- Hero tier -->
      <div class="px-8 grid grid-cols-4 gap-2">
        <button
          v-for="h in heroCards"
          :key="h.nodeType"
          class="group/card relative flex flex-col items-start gap-2.5 p-3 min-h-[104px] rounded-xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/25 text-left transition-colors cursor-pointer"
          @click="pickAction(h.nodeType, h.entry.source)"
        >
          <span class="shrink-0 size-9 rounded-lg bg-white/[0.05] group-hover/card:bg-white/[0.09] flex items-center justify-center transition-colors">
            <component :is="getGeneratorIcon(h.nodeType) || Sparkles" class="size-5 text-white/85" :stroke-width="1.75" />
          </span>
          <div class="flex flex-col min-w-0 w-full">
            <span class="text-[12.5px] text-white/90 leading-tight line-clamp-2">{{ h.entry.useCase }}</span>
            <span class="text-[10.5px] text-white/40 truncate mt-0.5">{{ h.entry.model }}</span>
            <span
              v-if="h.entry.source && SOURCE_HINT[h.entry.source]"
              class="mt-1 inline-flex items-center gap-1 text-[10px] text-white/35"
            >
              <component :is="SOURCE_HINT[h.entry.source]!.icon" class="size-3" :stroke-width="1.75" />
              {{ SOURCE_HINT[h.entry.source]!.label }}
            </span>
          </div>
          <span v-if="getModelBrand(h.nodeType)" class="absolute top-2.5 right-2.5 text-[9px] uppercase tracking-wider text-white/25">
            {{ getModelBrand(h.nodeType) }}
          </span>
        </button>
      </div>

      <!-- Studios row -->
      <div class="px-8 pt-6 pb-2">
        <div class="mb-2.5 text-[11px] font-medium uppercase tracking-wider text-white/40">
          Craft it by hand
        </div>
        <div class="grid grid-cols-6 gap-2">
          <button
            v-for="opt in STUDIO_OPTIONS"
            :key="opt.label"
            class="group/studio relative flex flex-col items-center gap-1.5 py-3 px-1 rounded-xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/25 transition-colors cursor-pointer"
            @click="emit('studio', opt)"
          >
            <component :is="opt.icon" class="size-5 text-white/80" :stroke-width="1.75" />
            <span class="text-[11px] text-white/75 leading-tight text-center">{{ opt.label }}</span>
            <span
              v-if="opt.pastel"
              class="gen-pastel absolute top-2 right-2 size-1.5 rounded-full"
              style="--gen-pastel: linear-gradient(90deg, rgba(255,214,231,.85), rgba(207,232,255,.85), rgba(214,255,224,.85), rgba(255,244,204,.85), rgba(231,214,255,.85), rgba(255,214,231,.85));"
              title="Uses AI credits"
            />
          </button>
        </div>
      </div>

      <!-- Footer -->
      <div class="px-8 py-4 shrink-0 flex items-center justify-end">
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
