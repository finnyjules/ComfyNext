<script setup lang="ts">
import { computed } from 'vue'
import { Play, Square, RotateCw, AlertCircle } from 'lucide-vue-next'
import type { NodeIcon } from '~/lib/canvas/nodeIcon'

const props = defineProps<{
  title: string
  readout: string | null
  icon: NodeIcon
  state: 'ready' | 'running' | 'done' | 'failed'
  /** Input type colour — left end of the running sweep gradient. */
  borderLeft: string
  /** Output type colour — right end of the running sweep gradient. */
  borderRight: string
}>()

const emit = defineEmits<{ action: []; expand: [] }>()

const actionIcon = computed(() => {
  if (props.state === 'running') return Square
  if (props.state === 'failed') return AlertCircle
  if (props.state === 'done') return RotateCw
  return Play
})

const actionLabel = computed(() => {
  if (props.state === 'running') return 'Stop'
  if (props.state === 'failed') return 'Show the error'
  if (props.state === 'done') return 'Run again'
  return 'Run'
})
</script>

<template>
  <div
    class="node-capsule relative flex w-[228px] items-center gap-[9px] rounded-[11px] border p-[6px_7px] text-left"
    :class="{
      'node-capsule--running': state === 'running',
      'node-capsule--failed': state === 'failed',
    }"
    :style="{ '--border-left': borderLeft, '--border-right': borderRight }"
    @click="emit('expand')"
  >
    <span class="flex size-[26px] flex-none items-center justify-center rounded-[7px] bg-white/[0.07] text-white/70">
      <img v-if="icon?.kind === 'url'" :src="icon.value" class="size-[15px]" alt="">
      <component :is="icon.value" v-else-if="icon?.kind === 'component'" class="size-[15px]" :stroke-width="1.75" />
    </span>

    <span class="flex min-w-0 flex-1 flex-col gap-px">
      <span class="truncate text-[12.5px] leading-[1.25] text-white/[0.88]">{{ title }}</span>
      <span v-if="readout" class="truncate text-[10.5px] leading-[1.25] tabular-nums text-white/40">{{ readout }}</span>
    </span>

    <button
      type="button"
      class="node-capsule__action flex size-[26px] flex-none items-center justify-center rounded-[7px] transition-all"
      :title="actionLabel"
      :aria-label="actionLabel"
      @click.stop="emit('action')"
    >
      <component :is="actionIcon" class="size-[13px]" :stroke-width="1.9" />
    </button>
  </div>
</template>

<style scoped>
.node-capsule {
  background: #1f1f1f;
  border-color: rgba(255, 255, 255, 0.13);
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.4);
}

/* Action blue at three intensities: dim at rest, solid on hover, solid while
   running. One accent, used where the work happens. */
.node-capsule__action {
  background: color-mix(in oklab, var(--action) 20%, transparent);
  color: color-mix(in oklab, var(--action) 58%, white);
  opacity: 0.62;
}
.node-capsule:hover .node-capsule__action {
  background: var(--action);
  color: #fff;
  opacity: 1;
}

/* Running: the border sweep carries it. The button reverts to a plain control
   — a coral stop square on a neutral chip, matching the canvas toolbar at
   layouts/default.vue:4226. No spinner, no solid fill: the sweep already says
   "this is working" and a second moving thing just competes with it. */
.node-capsule--running {
  border-color: transparent;
  /* REQUIRED. The sweep pseudo-element is z-index:-1, which only stays inside
     its parent when the parent forms a stacking context. On a card that came
     free from vue-flow's transformed wrapper; standing alone the sweep paints
     behind the canvas and vanishes with no error. */
  isolation: isolate;
}
.node-capsule--running .node-capsule__action,
.node-capsule--running:hover .node-capsule__action {
  background: rgba(255, 255, 255, 0.07);
  color: var(--palette-coral);
  opacity: 1;
}

/* Lifted verbatim from ComfyNode.vue:1927-1950. Only the duration differs: a
   capsule's perimeter is about a third of a card's, so at the card's 2s the
   beam laps three times as fast and reads as a strobe. */
.node-capsule--running::before {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: inherit;
  padding: 2px;
  background: linear-gradient(to right, var(--border-left), var(--border-right));
  -webkit-mask:
    conic-gradient(from var(--sweep-angle), transparent 0%, white 6%, white 18%, transparent 26%),
    linear-gradient(white 0 0) content-box,
    linear-gradient(white 0 0);
  -webkit-mask-composite: source-in, xor;
  mask:
    conic-gradient(from var(--sweep-angle), transparent 0%, white 6%, white 18%, transparent 26%),
    linear-gradient(white 0 0) content-box,
    linear-gradient(white 0 0);
  mask-composite: intersect, exclude;
  animation: border-sweep 2.4s linear infinite;
  pointer-events: none;
  z-index: -1;
}

.node-capsule--failed {
  border-color: color-mix(in oklab, var(--palette-coral) 45%, transparent);
}
.node-capsule--failed .node-capsule__action {
  background: color-mix(in oklab, var(--palette-coral) 20%, transparent);
  color: var(--palette-coral);
  opacity: 1;
}
.node-capsule--failed:hover .node-capsule__action {
  background: var(--palette-coral);
  color: #fff;
}

@media (prefers-reduced-motion: reduce) {
  .node-capsule--running::before { animation: none; --sweep-angle: 140deg; }
}
</style>
