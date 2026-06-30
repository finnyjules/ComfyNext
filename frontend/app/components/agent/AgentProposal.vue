<script setup lang="ts">
// The agent's proposal: each change is a rounded pastel card (new value primary,
// old struck) with its rationale and centred per-change actions (dismiss · re-roll
// · keep). Hovering a row asks the host to highlight that section on the canvas.
// Presentational; parent owns useLayoutAgent.
import { Check, Dices, Play, X } from 'lucide-vue-next'
import type { ProposedChange, VisualReview } from '~/composables/useLayoutAgent'
import type { LayoutIssue } from '~/lib/agent/verify'

defineProps<{ changes: ProposedChange[]; busy: boolean; issues?: LayoutIssue[]; review?: VisualReview | null; reviewing?: boolean; runnable?: boolean }>()
const emit = defineEmits<{
  accept: [i: number]
  reject: [i: number]
  reroll: [i: number]
  keep: []
  keepRun: []
  revert: []
  hover: [i: number | null]
}>()
</script>

<template>
  <div class="px-0.5">
    <div class="mb-3 flex items-center gap-1.5">
      <span class="text-[12px] text-white/80">✦</span>
      <span class="shimmer text-[12.5px]">{{ changes.length }} proposed change{{ changes.length === 1 ? '' : 's' }}</span>
    </div>

    <div v-if="issues && issues.length" class="mb-2.5 space-y-1">
      <p v-for="(iss, k) in issues" :key="k" class="flex items-start gap-1.5 text-[11px] leading-snug text-amber-300/80">
        <span class="shrink-0">⚠</span><span>{{ iss.message }}</span>
      </p>
    </div>

    <div
      v-for="(c, i) in changes" :key="i"
      class="change-card relative mb-2.5 overflow-hidden rounded-xl px-3.5 py-3 last:mb-0"
      @mouseenter="emit('hover', i)" @mouseleave="emit('hover', null)"
    >
      <div class="relative flex items-start gap-2.5">
        <div class="min-w-0 flex-1" :class="{ 'opacity-45': !c.accepted }">
          <div class="mb-[3px] flex items-center gap-1.5 text-[10px] text-white/45">
            <span>{{ c.label }}</span>
            <span v-if="c.fromReview" class="rounded-full bg-amber-300/15 px-1.5 py-px text-[9px] uppercase tracking-wide text-amber-300/80">visual review</span>
          </div>
          <div class="text-[14px] leading-tight">
            <span v-if="c.before" class="text-white/35 line-through">{{ c.before }}</span>
            <span v-if="c.before" class="mx-1.5 text-white/30">→</span>
            <span class="font-medium text-white/95">{{ c.after }}</span>
          </div>
          <div v-if="c.rationale" class="mt-1.5 text-[11.5px] italic leading-snug text-white/45">{{ c.rationale }}</div>
        </div>
        <div class="flex shrink-0 gap-1 pt-0.5">
          <button class="action" title="Dismiss" @click="emit('reject', i)"><X class="size-[14px]" /></button>
          <button v-if="c.rerollable" class="action" :disabled="busy" title="Re-roll" @click="emit('reroll', i)"><Dices class="size-[14px]" /></button>
          <button class="action" title="Keep" :class="c.accepted ? 'text-emerald-300' : ''" @click="emit('accept', i)"><Check class="size-[14px]" /></button>
        </div>
      </div>
    </div>

    <!-- Visual self-review: a designer's-eye critique of the rendered result. -->
    <div v-if="reviewing" class="mt-1 mb-1 flex items-center gap-1.5 text-[11px] text-white/45">
      <span class="text-white/65">✦</span> Reviewing the result<span class="animate-pulse">…</span>
    </div>
    <div v-else-if="review && (review.assessment || review.issues.length)" class="mb-1 mt-1">
      <div class="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-white/40">
        <span class="text-white/65">✦</span> Visual review
      </div>
      <p v-if="review.assessment" class="mb-1.5 text-[11.5px] leading-snug text-white/60">{{ review.assessment }}</p>
      <p v-for="(iss, k) in review.issues" :key="k" class="flex items-start gap-1.5 text-[11px] leading-snug text-amber-300/80">
        <span class="shrink-0">⚠</span><span>{{ iss }}</span>
      </p>
    </div>

    <div class="mt-3.5 flex items-stretch gap-2.5">
      <button
        :disabled="busy" class="flex-1 rounded-[8px] px-3.5 py-1.5 text-center text-[11.5px] text-white/50 hover:bg-white/[0.05] hover:text-white/85 disabled:opacity-40"
        @click="emit('revert')"
      >Dismiss all</button>
      <!-- Runnable surface (the canvas): Keep is the quiet option; Keep & Run is
           the primary, since running the just-built graph is the usual next step. -->
      <template v-if="runnable">
        <button
          :disabled="busy" class="flex-1 rounded-[8px] px-3.5 py-1.5 text-center text-[11.5px] text-white/75 bg-white/[0.06] hover:bg-white/[0.1] disabled:opacity-40"
          @click="emit('keep')"
        >Keep all</button>
        <button
          :disabled="busy" class="keep-all flex-1 inline-flex items-center justify-center gap-1.5 rounded-[8px] px-3.5 py-1.5 text-center text-[11.5px] font-semibold text-neutral-900 disabled:opacity-40"
          @click="emit('keepRun')"
        ><Play class="size-3" fill="currentColor" /> Keep &amp; Run</button>
      </template>
      <button
        v-else
        :disabled="busy" class="keep-all flex-1 rounded-[8px] px-3.5 py-1.5 text-center text-[11.5px] font-semibold text-neutral-900 disabled:opacity-40"
        @click="emit('keep')"
      >Keep all</button>
    </div>
  </div>
</template>

<style scoped>
/* Each change is a rounded card tinted with the canonical pastel gradient at 20%. */
.change-card::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: var(--pastel-gradient);
  opacity: 0.1;
  border-radius: inherit;
}

/* Per-change action buttons — borderless so they don't read as inputs. */
.action {
  display: grid;
  place-items: center;
  height: 24px;
  width: 26px;
  border-radius: 7px;
  color: rgba(255, 255, 255, 0.55);
  transition: background-color 0.15s ease, color 0.15s ease;
}
.action:hover { color: #fff; background-color: rgba(255, 255, 255, 0.08); }
.action:disabled { opacity: 0.4; }

/* Keep all carries the pastel gradient; stretched wide so the colour transitions
   read smooth rather than compressed. */
.keep-all {
  background-image: var(--pastel-gradient);
  background-size: 300% 100%;
  background-position: center;
}

/* A soft light shimmer sweeping the header text. */
.shimmer {
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.4) 0%, rgba(255, 255, 255, 0.95) 50%, rgba(255, 255, 255, 0.4) 100%);
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: shimmer 3s linear infinite;
}
@keyframes shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}
</style>
