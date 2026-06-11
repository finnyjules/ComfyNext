<script setup lang="ts">
/**
 * SlateGalleryModal — picker for Kinetic Slate motion templates. The left pane
 * lists the six slate primitives as cards (a 3-bar brand-aware color preview +
 * label + pitch); the right pane is a slot-filling form (text inputs per
 * textSlot, image upload per mediaSlot) plus a "Create slate" action that emits
 * the instantiated `{ layers, motion }` payload.
 *
 * Overlay / panel / close styling mirrors CatalogModal (used by
 * ShotPresetGalleryModal): Teleport + opacity Transition, fixed inset-0
 * backdrop (bg-black/70 backdrop-blur-sm, click-to-close), centered
 * bg-[#161616] rounded-xl panel, X close button. No search / category filter —
 * only six templates.
 *
 * The /upload/image FormData flow matches brand/KitPanel.vue's onLogoFile; we
 * additionally read the file's natural aspect so image layers aren't distorted.
 */
import { ref, computed } from 'vue'
import { X, Check } from 'lucide-vue-next'
import type { BrandKit } from '~~/shared/brand/types'
import type { LocalLayer } from '~/composables/useCompositorLayers'
import type { FrameMotion } from '~/lib/motion/types'
import type { SlateMediaFill } from '~/lib/slates/types'
import { SLATE_TEMPLATES, SLATE_TEMPLATES_BY_ID } from '~/data/slate-templates'
import { instantiateSlate, resolveThumb } from '~/lib/slates/instantiate'

const props = defineProps<{ activeKit?: BrandKit | null }>()
const emit = defineEmits<{
  close: []
  create: [payload: { layers: LocalLayer[]; motion: FrameMotion }]
}>()

const selectedId = ref<string | null>(SLATE_TEMPLATES[0]?.id ?? null)
const selected = computed(() => selectedId.value ? SLATE_TEMPLATES_BY_ID[selectedId.value] : null)
const texts = ref<Record<string, string>>({})
const media = ref<Record<string, SlateMediaFill>>({})

function thumbColors(t: typeof SLATE_TEMPLATES[number]): string[] {
  return resolveThumb(t.thumb, props.activeKit ?? {})
}

async function onMediaFile(slotKey: string, e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  // Need the natural aspect (w/h) so the image layer isn't distorted.
  const aspect = await new Promise<number>((res) => {
    const img = new Image()
    img.onload = () => res(img.naturalWidth / Math.max(1, img.naturalHeight))
    img.onerror = () => res(1)
    img.src = URL.createObjectURL(file)
  })
  const fd = new FormData()
  fd.append('image', file)
  fd.append('overwrite', 'true')
  const r = await fetch('/upload/image', { method: 'POST', body: fd })
  if (r.ok) {
    const data = await r.json() as { name?: string; subfolder?: string }
    const filename = data.subfolder ? `${data.subfolder}/${data.name}` : (data.name ?? '')
    if (filename) media.value = { ...media.value, [slotKey]: { filename, aspect } }
  }
}

function create() {
  const t = selected.value
  if (!t) return
  emit('create', instantiateSlate(t, { brand: props.activeKit ?? {}, texts: texts.value, media: media.value }))
}
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-150 ease-out"
      enter-from-class="opacity-0 pointer-events-none"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-100 ease-in pointer-events-none"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0 pointer-events-none"
    >
      <div class="fixed inset-0 z-[100] flex items-center justify-center p-6">
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/70 backdrop-blur-sm" @click="emit('close')" />

        <!-- Panel -->
        <div
          class="relative z-10 w-full max-w-[1024px] h-[85vh] max-h-[760px] flex flex-col bg-[#161616] rounded-xl border border-white/10 shadow-[0_24px_64px_rgba(0,0,0,0.55)] overflow-hidden"
        >
          <!-- Header -->
          <div class="flex items-start gap-4 px-5 pt-4 pb-3 border-b border-white/[0.06]">
            <div class="flex-1 min-w-0">
              <h2 class="text-sm font-semibold text-white/95 truncate">Kinetic Slate</h2>
              <p class="text-[11px] text-white/45 mt-0.5 truncate">Pick a motion slate, fill the slots, and drop an editable Frame on the canvas.</p>
            </div>
            <button
              class="shrink-0 size-7 rounded-md hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-white/90 cursor-pointer transition-colors"
              title="Close (Esc)"
              @click="emit('close')"
            >
              <X class="size-4" />
            </button>
          </div>

          <!-- Body: template list (left) + slot form (right) -->
          <div class="flex-1 flex min-h-0">
            <!-- Template list -->
            <div class="w-[44%] min-w-0 overflow-y-auto px-4 py-4 border-r border-white/[0.06] scrollbar-thin">
              <div class="grid grid-cols-1 gap-2">
                <button
                  v-for="t in SLATE_TEMPLATES"
                  :key="t.id"
                  class="text-left rounded-lg border overflow-hidden transition-colors cursor-pointer"
                  :class="selectedId === t.id
                    ? 'border-white/30 bg-white/[0.06]'
                    : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/20'"
                  @click="selectedId = t.id"
                >
                  <!-- 3-bar brand-aware color preview -->
                  <div class="flex flex-col">
                    <div
                      v-for="(c, i) in thumbColors(t)"
                      :key="i"
                      class="h-1.5"
                      :style="{ background: c }"
                    />
                  </div>
                  <div class="px-3 pt-2 pb-2.5 flex flex-col gap-0.5">
                    <div class="text-[12px] font-medium text-white/90 leading-tight">{{ t.label }}</div>
                    <div class="text-[10px] text-white/45 leading-snug">{{ t.pitch }}</div>
                  </div>
                </button>
              </div>
            </div>

            <!-- Slot form -->
            <div class="flex-1 min-w-0 flex flex-col min-h-0">
              <div v-if="selected" class="flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">
                <div class="text-[13px] font-semibold text-white/90 mb-0.5">{{ selected.label }}</div>
                <div class="text-[11px] text-white/45 mb-4">{{ selected.pitch }}</div>

                <!-- Text slots -->
                <div v-for="slot in selected.textSlots" :key="slot.key" class="mb-3">
                  <label class="block text-[11px] text-white/55 mb-1">{{ slot.label }}</label>
                  <input
                    v-model="texts[slot.key]"
                    type="text"
                    :placeholder="slot.default"
                    class="w-full bg-white/[0.04] border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-white/85 placeholder-white/30 outline-none focus:bg-white/[0.06] focus:border-white/20 transition-colors"
                  >
                </div>

                <!-- Media slots -->
                <div v-for="slot in selected.mediaSlots" :key="slot.key" class="mb-3">
                  <label class="block text-[11px] text-white/55 mb-1">{{ slot.label }}</label>
                  <div class="flex items-center gap-2">
                    <label
                      class="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] bg-white/[0.06] hover:bg-white/[0.1] text-white/80 cursor-pointer transition-colors whitespace-nowrap"
                    >
                      <span>{{ media[slot.key] ? 'Replace image' : 'Upload image' }}</span>
                      <input type="file" accept="image/*" class="hidden" @change="onMediaFile(slot.key, $event)">
                    </label>
                    <span v-if="media[slot.key]" class="text-[10px] text-white/45 truncate min-w-0">{{ media[slot.key]!.filename }}</span>
                  </div>
                </div>
              </div>

              <!-- Footer action -->
              <div class="px-5 py-3 border-t border-white/[0.06] flex justify-end">
                <button
                  class="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-md text-xs font-medium bg-white text-black hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                  :disabled="!selected"
                  @click="create"
                >
                  <Check class="size-3.5" />
                  <span>Create slate</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
