<script setup lang="ts">
import { computed } from 'vue'
import { Play, Square, RotateCw, AlertCircle } from 'lucide-vue-next'
import type { NodeIcon } from '~/lib/canvas/nodeIcon'
import { CAPSULE_ACTIONS, type CapsuleState, type CapsuleAction } from '~/lib/canvas/capsuleAction'

const props = defineProps<{
  title: string
  readout: string | null
  icon: NodeIcon
  state: CapsuleState
  /** Input type colour — left end of the running sweep gradient. */
  borderLeft: string
  /** Output type colour — right end of the running sweep gradient. */
  borderRight: string
}>()

const emit = defineEmits<{ action: [CapsuleAction]; expand: [] }>()

const actionIcon = computed(() => {
  if (props.state === 'running') return Square
  if (props.state === 'failed') return AlertCircle
  if (props.state === 'done') return RotateCw
  return Play
})

// Label AND behaviour come from the same table, so the button can never again
// promise one thing and dispatch another.
const actionLabel = computed(() => CAPSULE_ACTIONS[props.state].label)
function onAction() { emit('action', CAPSULE_ACTIONS[props.state].action) }

// The capsule is the ONLY way to open a collapsed node, so a mouse-only click
// handler makes those nodes unreachable from the keyboard entirely. Space is
// prevented because it scrolls the canvas otherwise.
function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Enter' && e.key !== ' ') return
  e.preventDefault()
  emit('expand')
}
</script>

<template>
  <div
    class="node-capsule"
    :class="{
      'node-capsule--running': state === 'running',
      'node-capsule--failed': state === 'failed',
    }"
    :style="{ '--border-left': borderLeft, '--border-right': borderRight }"
    role="button"
    tabindex="0"
    :aria-label="`Open ${title}`"
    @click="emit('expand')"
    @keydown="onKeydown"
  >
    <span v-if="icon" class="node-capsule__tile">
      <img v-if="icon.kind === 'url'" :src="icon.value" alt="">
      <component :is="icon.value" v-else :stroke-width="1.75" />
    </span>

    <span class="node-capsule__text">
      <span class="node-capsule__title">{{ title }}</span>
      <span v-if="readout" class="node-capsule__readout">{{ readout }}</span>
    </span>

    <button
      type="button"
      class="node-capsule__action"
      :title="actionLabel"
      :aria-label="actionLabel"
      @click.stop="onAction"
      @keydown.stop
    >
      <component :is="actionIcon" :stroke-width="1.9" />
    </button>
  </div>
</template>

<style scoped>
.node-capsule {
  /* Dimensions live here rather than in Tailwind utilities: they are the
     capsule's identity (the spec pins every one of them), and a component whose
     whole job is to look exactly right should not depend on the JIT having
     scanned this file. ComfyNode.vue keeps its own chrome the same way. */
  position: relative;
  display: flex;
  align-items: center;
  width: 228px;
  gap: 9px;
  padding: 6px 7px;
  border: 1px solid rgba(255, 255, 255, 0.13);
  border-radius: 11px;
  text-align: left;
  background: #1f1f1f;
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.4);
}

/* Rendered only when an icon actually resolves. Most core Comfy node types are
   in none of the three icon maps, and an empty 26px tile reads as a broken
   image — worse than no tile at all. The title just takes the space. */
.node-capsule__tile {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  /* Neutral by design — tinting this by output type would rebuild the
     schematic type legend the capsule exists to retire. */
  background: rgba(255, 255, 255, 0.07);
  color: rgba(255, 255, 255, 0.72);
}
.node-capsule__tile :is(svg, img) { width: 15px; height: 15px; display: block; }

.node-capsule__text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
  min-width: 0;
}
.node-capsule__title {
  font-size: 12.5px;
  line-height: 1.25;
  color: rgba(255, 255, 255, 0.88);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.node-capsule__readout {
  font-size: 10.5px;
  line-height: 1.25;
  color: rgba(255, 255, 255, 0.4);
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Action blue at three intensities: dim at rest, solid on hover, solid while
   running. One accent, used where the work happens. */
.node-capsule__action {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  transition: background 0.18s, color 0.18s, opacity 0.18s;
  background: color-mix(in oklab, var(--action) 20%, transparent);
  color: color-mix(in oklab, var(--action) 58%, white);
  opacity: 0.62;
}
.node-capsule:hover .node-capsule__action {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  transition: background 0.18s, color 0.18s, opacity 0.18s;
  background: var(--action);
  color: #fff;
  opacity: 1;
}

/* Running: the border sweep carries it. The button reverts to a plain control
   — a coral stop square on a neutral chip, matching the canvas toolbar at
   layouts/default.vue:4226. No spinner, no solid fill: the sweep already says
   "this is working" and a second moving thing just competes with it. */
.node-capsule__action svg { width: 13px; height: 13px; display: block; }

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
