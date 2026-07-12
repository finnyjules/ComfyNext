<script setup lang="ts">
import { Check, Plus } from 'lucide-vue-next'
import type { AspectSpec } from '~~/server/templates/schema'

interface Preset {
  key: string
  label: string
  w: number
  h: number
}

interface PresetGroup {
  group: string
  items: Preset[]
}

const PRESETS: PresetGroup[] = [
  {
    group: 'Social Media',
    items: [
      { key: '1x1', label: 'Square 1:1', w: 1080, h: 1080 },
      { key: '4x5', label: 'Portrait 4:5', w: 1080, h: 1350 },
      { key: '9x16', label: 'Story / Reel', w: 1080, h: 1920 },
      { key: '1.91x1', label: 'Landscape 1.91:1', w: 1200, h: 628 },
      { key: 'tw', label: 'Twitter / X post', w: 1200, h: 675 },
      { key: 'li', label: 'LinkedIn post', w: 1200, h: 627 },
      { key: 'fb-cover', label: 'Facebook cover', w: 820, h: 312 },
    ],
  },
  {
    group: 'Video',
    items: [
      { key: '16x9', label: 'YouTube / 16:9', w: 1920, h: 1080 },
      { key: '21x9', label: 'Cinematic 21:9', w: 2560, h: 1080 },
      { key: '4x3', label: 'Classic 4:3', w: 1440, h: 1080 },
    ],
  },
  {
    group: 'Display Ads',
    items: [
      { key: '300x250', label: 'Medium Rectangle', w: 300, h: 250 },
      { key: '728x90', label: 'Leaderboard', w: 728, h: 90 },
      { key: '970x250', label: 'Billboard', w: 970, h: 250 },
      { key: '300x600', label: 'Half Page', w: 300, h: 600 },
      { key: '160x600', label: 'Wide Skyscraper', w: 160, h: 600 },
      { key: '336x280', label: 'Large Rectangle', w: 336, h: 280 },
    ],
  },
  {
    group: 'Print',
    items: [
      { key: 'a4-p', label: 'A4 Portrait', w: 2480, h: 3508 },
      { key: 'a4-l', label: 'A4 Landscape', w: 3508, h: 2480 },
      { key: 'letter-p', label: 'US Letter Portrait', w: 2550, h: 3300 },
      { key: 'biz-card', label: 'Business Card', w: 1050, h: 600 },
    ],
  },
]

const props = defineProps<{
  existingKeys: string[]
  triggerRef: HTMLElement | null
}>()

const emit = defineEmits<{
  add: [key: string, spec: AspectSpec]
  close: []
}>()

const dropdownPos = ref({ top: 0, left: 0 })
const customW = ref(1080)
const customH = ref(1080)
const customLabel = ref('')

onMounted(() => {
  if (props.triggerRef) {
    const r = props.triggerRef.getBoundingClientRect()
    const top = r.bottom + 4
    // Align right edge of popover to right edge of trigger
    const left = r.right - 272
    dropdownPos.value = { top, left: Math.max(8, left) }
  }
  document.addEventListener('mousedown', onClickOutside, true)
})
onUnmounted(() => document.removeEventListener('mousedown', onClickOutside, true))

function onClickOutside(e: MouseEvent) {
  const dp = document.getElementById('aspect-picker-dp')
  if (!dp?.contains(e.target as Node) && !props.triggerRef?.contains(e.target as Node)) {
    emit('close')
  }
}

function selectPreset(p: Preset) {
  // Deduplicate key if already in use
  let key = p.key
  let n = 2
  while (props.existingKeys.includes(key)) key = `${p.key}_${n++}`
  emit('add', key, { w: p.w, h: p.h, label: p.label })
}

function addCustom() {
  const w = Math.max(1, Math.round(customW.value))
  const h = Math.max(1, Math.round(customH.value))
  const label = customLabel.value.trim() || `${w}×${h}`
  let key = `${w}x${h}`
  let n = 2
  while (props.existingKeys.includes(key)) key = `${w}x${h}_${n++}`
  emit('add', key, { w, h, label })
}

function isAdded(p: Preset) {
  return props.existingKeys.includes(p.key)
}
</script>

<template>
  <Teleport to="body">
    <div
      id="aspect-picker-dp"
      class="fixed z-[9999] w-[272px] flex flex-col bg-[#1a1a1e] border border-white/[0.1] rounded-xl shadow-[0_12px_48px_rgba(0,0,0,0.7)] overflow-hidden"
      :style="{ top: `${dropdownPos.top}px`, left: `${dropdownPos.left}px` }"
    >
      <!-- Presets -->
      <div class="overflow-y-auto" style="max-height: 360px;">
        <template v-for="group in PRESETS" :key="group.group">
          <div class="px-3 pt-2.5 pb-1 text-[9px] uppercase tracking-[0.14em] text-white/25 font-medium select-none border-t border-white/[0.04] first:border-t-0">
            {{ group.group }}
          </div>
          <button
            v-for="p in group.items"
            :key="p.key"
            type="button"
            class="w-full px-3 py-1.5 flex items-center gap-2 transition-colors cursor-pointer"
            :class="isAdded(p) ? 'opacity-40 cursor-default' : 'hover:bg-white/[0.05]'"
            :disabled="isAdded(p)"
            @click="selectPreset(p)"
          >
            <span class="flex-1 text-left text-[12px] text-white">{{ p.label }}</span>
            <span class="text-[10px] text-white/30 tabular-nums shrink-0">{{ p.w }}×{{ p.h }}</span>
            <Check v-if="isAdded(p)" class="size-3 text-action shrink-0" />
          </button>
        </template>
      </div>

      <!-- Custom size -->
      <div class="border-t border-white/[0.08] px-3 py-2.5 flex flex-col gap-2">
        <div class="text-[9px] uppercase tracking-[0.14em] text-white/25 font-medium select-none">Custom</div>
        <input
          v-model="customLabel"
          placeholder="Label (optional)"
          class="w-full h-7 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[11px] text-white placeholder-white/25 focus:outline-none focus:border-action/50"
        />
        <div class="flex items-center gap-2">
          <div class="flex items-center gap-1.5 flex-1">
            <input
              v-model.number="customW"
              type="number"
              min="1"
              placeholder="W"
              class="w-full h-7 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[11px] text-white text-center focus:outline-none focus:border-action/50 tabular-nums"
            />
            <span class="text-[10px] text-white/30 shrink-0">×</span>
            <input
              v-model.number="customH"
              type="number"
              min="1"
              placeholder="H"
              class="w-full h-7 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[11px] text-white text-center focus:outline-none focus:border-action/50 tabular-nums"
            />
            <span class="text-[10px] text-white/30 shrink-0">px</span>
          </div>
          <button
            type="button"
            class="h-7 px-3 rounded-md bg-action/15 text-action text-[11px] font-medium hover:bg-action/25 transition-colors cursor-pointer shrink-0 flex items-center gap-1"
            @click="addCustom"
          >
            <Plus class="size-3" />
            Add
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
