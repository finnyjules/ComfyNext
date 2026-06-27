<script setup lang="ts">
/**
 * Opening step of the Smart Layout editor: instead of a template gallery, the
 * user picks which formats (deliverables) they'll design for. On confirm the
 * editor opens blank with those formats as the output tabs. Multi-select;
 * 1x1 becomes the master/design format when chosen.
 */
import { computed, ref } from 'vue'

import type { GridEditorContext } from '~/composables/useGridEditor'
import type { FormatSpec } from '~~/shared/template-grid/types'

const emit = defineEmits<{ confirm: [keys: string[]] }>()

const ctx = inject<GridEditorContext>('gridEditor')!
const { template } = ctx

interface FmtCard { key: string; spec: FormatSpec; w: number; h: number }

// Lay each format out as a proportional thumbnail (longest side = 96px).
function thumb(spec: FormatSpec): { w: number; h: number } {
  const ar = spec.w / spec.h
  return ar >= 1 ? { w: 96, h: Math.round(96 / ar) } : { w: Math.round(96 * ar), h: 96 }
}

const allCards = computed<FmtCard[]>(() =>
  Object.entries(template.value.formats).map(([key, spec]) => {
    const t = thumb(spec)
    return { key, spec, w: t.w, h: t.h }
  }))

// Group by intent for scannability.
const SOCIAL = new Set(['1x1', '4x5', '9x16', '16x9'])
const groups = computed(() => ([
  { name: 'Social', cards: allCards.value.filter(c => SOCIAL.has(c.key)) },
  { name: 'Ads & display', cards: allCards.value.filter(c => !SOCIAL.has(c.key)) },
]).filter(g => g.cards.length))

const selected = ref<Set<string>>(new Set(
  template.value.formats['1x1'] ? ['1x1'] : Object.keys(template.value.formats).slice(0, 1),
))

function toggle(key: string) {
  if (selected.value.has(key)) selected.value.delete(key)
  else selected.value.add(key)
  selected.value = new Set(selected.value)   // trigger reactivity
}

const count = computed(() => selected.value.size)

function start() {
  if (!count.value) return
  // Preserve preset order (the formats dict order) for stable tabs.
  const keys = allCards.value.map(c => c.key).filter(k => selected.value.has(k))
  emit('confirm', keys)
}
</script>

<template>
  <div class="absolute inset-0 z-10 overflow-y-auto bg-[#121212]/95 backdrop-blur-sm">
    <div class="max-w-3xl mx-auto px-8 py-10 pb-28">
      <h2 class="text-[16px] text-white/90 font-medium">What are you designing for?</h2>
      <p class="text-[12px] text-white/45 mt-1">
        Pick the formats you want to work on. You start on a blank canvas and can add or remove formats anytime.
      </p>

      <div v-for="g in groups" :key="g.name" class="mt-7">
        <h3 class="text-[11px] uppercase tracking-[0.12em] text-white/35 mb-3">{{ g.name }}</h3>
        <div class="grid grid-cols-3 gap-3">
          <button
            v-for="c in g.cards"
            :key="c.key"
            class="relative rounded-xl border bg-[#0e0e10] p-4 flex flex-col items-center gap-3 transition-colors cursor-pointer"
            :class="selected.has(c.key)
              ? 'border-emerald-400/70 bg-emerald-400/[0.06]'
              : 'border-white/[0.08] hover:border-white/25'"
            @click="toggle(c.key)"
          >
            <!-- selected check -->
            <div
              class="absolute top-2.5 right-2.5 size-4 rounded-full flex items-center justify-center text-[10px] transition-colors"
              :class="selected.has(c.key) ? 'bg-emerald-400 text-[#06281d]' : 'bg-white/10 text-transparent'"
            >✓</div>
            <div class="h-[96px] flex items-center justify-center">
              <div
                class="rounded-sm"
                :style="{
                  width: c.w + 'px', height: c.h + 'px',
                  background: selected.has(c.key) ? 'rgba(52,211,153,0.25)' : 'rgba(255,255,255,0.07)',
                  outline: selected.has(c.key) ? '1px solid rgba(52,211,153,0.6)' : '1px solid rgba(255,255,255,0.12)',
                }"
              />
            </div>
            <div class="text-center">
              <div class="text-[12px]" :class="selected.has(c.key) ? 'text-white' : 'text-white/80'">
                {{ c.spec.label ?? c.key }}
              </div>
              <div class="text-[10px] text-white/35 tabular-nums mt-0.5">{{ c.spec.w }} × {{ c.spec.h }}</div>
            </div>
          </button>
        </div>
      </div>
    </div>

    <!-- Sticky action bar -->
    <div class="absolute bottom-0 inset-x-0 border-t border-white/[0.06] bg-[#121212]/90 backdrop-blur-sm">
      <div class="max-w-3xl mx-auto px-8 py-4 flex items-center justify-between">
        <span class="text-[12px] text-white/45">
          {{ count }} format{{ count === 1 ? '' : 's' }} selected
        </span>
        <button
          class="h-9 px-4 rounded-lg bg-emerald-400 hover:bg-emerald-300 text-[13px] font-medium text-[#06281d] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default"
          :disabled="!count"
          @click="start"
        >
          Start designing →
        </button>
      </div>
    </div>
  </div>
</template>
