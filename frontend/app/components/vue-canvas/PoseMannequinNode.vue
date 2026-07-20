<script setup lang="ts">
import { Handle, Position, useHandleConnections } from '@vue-flow/core'
import { RefreshCw, Image, Loader2, PersonStanding, Play, Wand2 } from 'lucide-vue-next'
import { getTypeColor } from '~/composables/useVueNodes'

// Pose Mannequin artifact node. Shows ONLY the posed mannequin render (the gray
// figure). The wired character + the generated result live elsewhere: the
// character comes in the input port, and the result flows OUT of the IMAGE
// output into a downstream artifact-image node (created on generate).
const props = defineProps<{
  id: string
  data: {
    nodeType: string
    title: string
    inputs: { name: string; type: string; link: number | null }[]
    outputs: { name: string; type: string; links: number[] | null }[]
    widgetsValues: any[]
    widgetDefs?: any[]
    properties?: Record<string, any>
    mode: number
    running?: boolean
    error?: boolean
    images?: string[]
  }
}>()

const isMuted = computed(() => props.data.mode === 2)
const isBypassed = computed(() => props.data.mode === 4)
const imageColor = computed(() => getTypeColor('IMAGE'))

function widgetIdx(name: string): number { return props.data.widgetDefs?.findIndex((w: any) => w.name === name) ?? -1 }
function widgetStr(name: string): string { const i = widgetIdx(name); return i >= 0 ? String(props.data.widgetsValues?.[i] ?? '') : '' }
function inputIdx(name: string): number { return props.data.inputs?.findIndex(i => i.name === name) ?? -1 }
function outputIdx(name: string): number { const i = props.data.outputs?.findIndex(o => o.name === name) ?? -1; return i >= 0 ? i : 0 }

const mannequinUrl = computed<string | null>(() => {
  const fn = widgetStr('mannequin_image')
  return fn ? `/view?${new URLSearchParams({ filename: fn, type: 'input' })}` : null
})
const hasPose = computed(() => !!mannequinUrl.value)

type PoseMode = 'mannequin' | 'image' | 'prompt'

const poseSource = computed<PoseMode>(() => {
  const v = widgetStr('pose_source')
  return (v === 'image' || v === 'prompt') ? v : 'mannequin'
})

function setWidget(name: string, v: any) {
  const i = widgetIdx(name)
  if (i < 0) return
  if (!Array.isArray(props.data.widgetsValues)) props.data.widgetsValues = []
  props.data.widgetsValues[i] = v
}

function setMode(m: PoseMode) { setWidget('pose_source', m) }

const posePrompt = computed<string>({
  get: () => widgetStr('pose_prompt'),
  set: (v: string) => setWidget('pose_prompt', v),
})

const poseImageInIdx = computed(() => { const i = inputIdx('pose_image'); return i >= 0 ? i : 1 })
// Source of truth for "is a pose image wired" is VueFlow's live edge store, NOT
// data.inputs[i].link — that field is only populated when loading a saved
// workflow, so a freshly drawn edge would read as unconnected. The node has two
// target handles, so the handle id is required to disambiguate.
const poseImageConnections = useHandleConnections({
  type: 'target',
  id: () => `input-${poseImageInIdx.value}`,
})
const poseImageLinked = computed(() => poseImageConnections.value.length > 0)

const MODES: { id: PoseMode; label: string }[] = [
  { id: 'mannequin', label: 'Mannequin' },
  { id: 'image', label: 'Image' },
  { id: 'prompt', label: 'Prompt' },
]

const accentColor = computed(() => imageColor.value)
// Image mode needs a wired pose image before it can generate; the other modes
// can always run (prompt falls back to a default pose, mannequin to passthrough).
const canGenerate = computed(() => !(poseSource.value === 'image' && !poseImageLinked.value))

// Header ▶ Run: ensure a downstream sink + scope-run this node (handled in
// VueNodeCanvas). Mirrors a regular node's run button.
function runThisNode() {
  if (isMuted.value || isBypassed.value || props.data.running || !canGenerate.value) return
  window.dispatchEvent(new CustomEvent('sailor:poseGenerate', { detail: { nodeId: props.id } }))
}
// Header ↻ Re-render: re-pose again for a fresh variation, reusing cached upstream.
function rerollThisNode() {
  if (isMuted.value || isBypassed.value || props.data.running || !canGenerate.value) return
  window.dispatchEvent(new CustomEvent('sailor:poseGenerate', { detail: { nodeId: props.id, rerollScope: 'self' } }))
}

const characterInIdx = computed(() => Math.max(0, inputIdx('character')))
const imageOutIdx = computed(() => outputIdx('image'))

function openEditor() {
  window.dispatchEvent(new CustomEvent('sailor:openPose', { detail: { nodeId: props.id } }))
}
</script>

<template>
  <div
    class="pose-node relative select-none w-[260px] rounded-xl border"
    :class="data.error ? 'border-red-500 ring-2 ring-red-500' : 'border-white/10'"
    :style="{
      background: 'linear-gradient(180deg, #252525 0%, #1e1e1e 100%)',
      '--port-color': imageColor,
    } as any"
    :data-running="data.running || undefined"
  >
    <Handle
      :id="`input-${characterInIdx}`" type="target" :position="Position.Left"
      class="!w-3 !h-3 !rounded-full !border-2 !bg-[#1a1a1a]"
      :style="{ borderColor: imageColor, top: '50%' }"
    />
    <Handle
      :id="`input-${poseImageInIdx}`" type="target" :position="Position.Left"
      class="!w-3 !h-3 !rounded-full !border-2 !bg-[#1a1a1a] transition-opacity"
      :class="poseSource === 'image' ? 'opacity-100' : 'opacity-25'"
      :style="{ borderColor: imageColor, top: '72%' }"
      title="Pose reference image"
    />
    <Handle
      :id="`output-${imageOutIdx}`" type="source" :position="Position.Right"
      class="!w-3 !h-3 !rounded-full !border-2 !bg-[#1a1a1a]"
      :style="{ borderColor: imageColor, top: '50%' }"
    />

    <!-- Mode overlay: bypass shows diagonal stripes; mute shows a soft scrim -->
    <div
      v-if="isMuted || isBypassed"
      class="pointer-events-none absolute inset-0 rounded-xl z-[5]"
      :class="isBypassed ? 'pose-node-stripes' : 'bg-black/30'"
    />
    <!-- Mode badge (top-right) -->
    <div
      v-if="isMuted || isBypassed"
      class="pointer-events-none absolute top-1.5 right-1.5 z-[6] text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
      :class="isBypassed
        ? 'bg-amber-500/25 text-amber-200 border border-amber-400/30'
        : 'bg-white/15 text-white/70 border border-white/15'"
    >
      {{ isBypassed ? 'Bypass' : 'Mute' }}
    </div>

    <!-- Title bar -->
    <div
      class="flex items-center gap-2 px-3 py-2 border-b border-white/5 rounded-t-xl"
      :style="{ background: `linear-gradient(135deg, ${accentColor}15 0%, transparent 60%)` }"
    >
      <PersonStanding class="size-4 shrink-0 text-white/70" :stroke-width="1.75" />
      <span class="text-xs font-semibold text-white/90 truncate flex-1">Pose Mannequin</span>
      <!-- Re-pose again: a fresh variation reusing cached upstream -->
      <button
        v-if="!isMuted && !isBypassed"
        class="nopan nodrag shrink-0 size-5 rounded flex items-center justify-center transition-colors cursor-pointer"
        :class="(data.running || !canGenerate)
          ? 'text-white/25 cursor-not-allowed'
          : 'text-white/55 hover:text-white/90 hover:bg-white/10'"
        :disabled="data.running || !canGenerate"
        title="Re-render — a fresh pose reusing the same inputs"
        @click.stop="rerollThisNode"
      >
        <RefreshCw class="size-3" />
      </button>
      <!-- Generate / run this node -->
      <button
        v-if="!isMuted && !isBypassed"
        class="nopan nodrag shrink-0 size-5 rounded flex items-center justify-center transition-colors cursor-pointer"
        :class="data.running
          ? 'text-action bg-action/15'
          : !canGenerate
            ? 'text-white/25 cursor-not-allowed'
            : 'text-white/55 hover:text-action hover:bg-action/15'"
        :disabled="data.running || !canGenerate"
        :title="data.running ? 'Running…'
          : !canGenerate ? 'Wire a pose image first'
          : 'Generate — re-pose the character'"
        @click.stop="runThisNode"
      >
        <Loader2 v-if="data.running" class="size-3 animate-spin" />
        <Play v-else class="size-3" fill="currentColor" />
      </button>
    </div>

    <!-- Body -->
    <div class="overflow-hidden rounded-b-xl">

      <!-- Mode toggle -->
      <div class="flex gap-0.5 p-1 bg-black/20">
        <button
          v-for="m in MODES" :key="m.id"
          class="nopan nodrag flex-1 h-6 rounded text-[10px] font-medium cursor-pointer transition-colors"
          :class="poseSource === m.id ? 'bg-white/15 text-white' : 'text-white/45 hover:text-white/70 hover:bg-white/5'"
          @click.stop="setMode(m.id)">
          {{ m.label }}
        </button>
      </div>

      <!-- Mannequin: posed-figure preview -->
      <div v-if="poseSource === 'mannequin'" class="relative bg-checker aspect-[3/4] flex items-center justify-center overflow-hidden cursor-pointer" @dblclick.stop="openEditor">
        <img v-if="mannequinUrl" :src="mannequinUrl" class="absolute inset-0 w-full h-full object-contain" draggable="false" />
        <div v-else class="flex flex-col items-center justify-center gap-1.5 text-white/35 pointer-events-none">
          <PersonStanding class="size-8" :stroke-width="1.5" />
          <span class="text-[10px]">No pose yet</span>
        </div>
      </div>

      <!-- Image: wired pose-reference status -->
      <div v-else-if="poseSource === 'image'" class="relative bg-checker aspect-[3/4] flex flex-col items-center justify-center gap-1.5 overflow-hidden text-center px-3">
        <Image class="size-8" :class="poseImageLinked ? 'text-white/70' : 'text-white/35'" :stroke-width="1.5" />
        <span class="text-[10px]" :class="poseImageLinked ? 'text-white/70' : 'text-white/35'">
          {{ poseImageLinked ? 'Pose image connected' : 'Wire a pose image →' }}
        </span>
        <span class="text-[9px] text-white/30 leading-tight">Connect any image to the lower-left port; its body pose is copied onto your character.</span>
      </div>

      <!-- Prompt: describe the pose -->
      <div v-else class="relative bg-checker aspect-[3/4] p-2 flex flex-col">
        <textarea
          v-model="posePrompt"
          class="nopan nodrag flex-1 w-full resize-none rounded-md bg-black/40 border border-white/10 text-[11px] text-white/85 p-2 leading-snug placeholder:text-white/30 focus:outline-none focus:border-white/25"
          placeholder="Describe the pose — e.g. 'sitting cross-legged, leaning back on both hands, looking up'"
          @pointerdown.stop @dblclick.stop
        />
      </div>

      <!-- Mannequin: open the 3D editor. Image/Prompt modes generate from the
           header ▶ (run) control, like a regular node. -->
      <div v-if="poseSource === 'mannequin'" class="flex items-center gap-1.5 px-2 py-1.5 border-t border-white/5">
        <button
          class="nopan nodrag flex-1 h-7 rounded bg-white/10 hover:bg-white/15 border border-white/10 text-white/90 text-[11px] font-medium flex items-center justify-center gap-1.5 cursor-pointer"
          title="Open the 3D pose editor" @click.stop="openEditor">
          <Wand2 class="size-3.5" /> {{ hasPose ? 'Edit pose' : 'Pose & Generate' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pose-node { box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4), 0 1px 4px rgba(0, 0, 0, 0.2); }
.pose-node[data-running] { box-shadow: 0 0 0 2px var(--port-color, #fff), 0 4px 16px rgba(0, 0, 0, 0.4); }
.pose-node-stripes {
  background-image: repeating-linear-gradient(45deg,
    rgba(245, 158, 11, 0.18) 0, rgba(245, 158, 11, 0.18) 6px,
    transparent 6px, transparent 12px);
}
.bg-checker {
  background-color: #141414;
  background-image:
    linear-gradient(45deg, #1c1c1c 25%, transparent 25%),
    linear-gradient(-45deg, #1c1c1c 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #1c1c1c 75%),
    linear-gradient(-45deg, transparent 75%, #1c1c1c 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
}
</style>
