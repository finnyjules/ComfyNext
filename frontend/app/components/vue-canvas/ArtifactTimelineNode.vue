<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { Loader2, Play, Pencil, Clapperboard } from 'lucide-vue-next'
import { getTypeColor } from '~/composables/useVueNodes'

// The "Timeline" as a first-class artifact card — same visual language as the
// Frame / Image / Video artifacts. Edge-mounted round handles, a tight dark
// shell, and a live animated preview as the main content. The full multi-track
// editor still opens in its modal ("Open timeline"); this card is the on-canvas
// face of it. Mirrors ArtifactFrameNode's chrome + resize.
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
  }
}>()

const MAX_CLIPS = 16
const isMuted = computed(() => props.data.mode === 2)
const isBypassed = computed(() => props.data.mode === 4)
const imageColor = computed(() => getTypeColor('IMAGE'))
const injectedEdges = inject<any>('vueFlowEdges', null)

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)) }
function outputIdx(name: string): number {
  const i = props.data.outputs?.findIndex(o => o.name === name) ?? -1
  return i >= 0 ? i : 0
}
function widgetIdx(name: string): number { return props.data.widgetDefs?.findIndex((w: any) => w.name === name) ?? -1 }
function widgetVal(name: string): number { const i = widgetIdx(name); return i >= 0 ? Number(props.data.widgetsValues?.[i] ?? 0) : 0 }
const framesOutIdx = computed(() => outputIdx('frames'))

// ── Clip input handles (grow-on-connect, mirrors the Frame's layerSlots) ─────
function slotConnected(slotIdx: number): boolean {
  if (props.data.inputs?.[slotIdx]?.link != null) return true
  const edges = injectedEdges?.value ?? []
  return edges.some((e: any) => e.target === props.id && e.targetHandle === `input-${slotIdx}`)
}
const clipSlots = computed<number[]>(() => {
  const connected: number[] = []
  for (let i = 0; i < MAX_CLIPS; i++) if (slotConnected(i)) connected.push(i)
  const next = connected.length ? Math.max(...connected) + 1 : 0
  const slots = [...connected]
  if (next < MAX_CLIPS) slots.push(next)
  return slots
})
function handleTop(idx: number, count: number): string {
  if (count <= 1) return '50%'
  const pad = 14
  return `calc(${pad}px + ${(idx / (count - 1)) * 100}% - ${(pad * 2 * idx) / (count - 1)}px)`
}

// ── Header summary (prefer the editor's edit_state; fall back to widgets) ─────
const editState = computed<any>(() => {
  const raw = props.data.properties?.edit_state
  if (!raw) return null
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return null }
})
const summary = computed<string>(() => {
  const es = editState.value
  if (es?.version === 1) {
    const fps = es.canvas?.fps || 30
    const frames = es.total_frames || 0
    const clips = (es.tracks ?? []).reduce((n: number, t: any) => n + (t.clips?.length ?? 0), 0)
    if (frames > 0) return `${(frames / fps).toFixed(1)}s · ${clips} clip${clips === 1 ? '' : 's'}`
    return clips ? `${clips} clip${clips === 1 ? '' : 's'}` : ''
  }
  const fps = widgetVal('output_fps') || 30
  const dur = widgetVal('total_duration')
  return dur > 0 ? `${(dur / fps).toFixed(1)}s` : ''
})

// ── Resize (zoom-aware, width-based; persists on the node) ───────────────────
const DEFAULT_W = 320, MIN_W = 240, MAX_W = 920
const shellRef = ref<HTMLElement | null>(null)
const nodeW = computed<number>(() => {
  const v = Number(props.data.properties?.comfynext_nodeW)
  return v >= MIN_W && v <= MAX_W ? v : DEFAULT_W
})
function setNodeW(v: number) {
  if (!props.data.properties) (props.data as any).properties = {}
  ;(props.data.properties as any).comfynext_nodeW = Math.round(clamp(v, MIN_W, MAX_W))
}
let resize: { startW: number; sx: number; zoom: number } | null = null
function onResizeDown(e: PointerEvent) {
  e.preventDefault(); e.stopPropagation()
  const r = shellRef.value?.getBoundingClientRect()
  const zoom = r && nodeW.value ? r.width / nodeW.value : 1
  resize = { startW: nodeW.value, sx: e.clientX, zoom: zoom || 1 }
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', onResizeUp, { once: true })
}
function onResizeMove(e: PointerEvent) {
  if (!resize) return
  setNodeW(resize.startW + (e.clientX - resize.sx) / resize.zoom)
}
function onResizeUp() { resize = null; window.removeEventListener('pointermove', onResizeMove) }
onUnmounted(() => window.removeEventListener('pointermove', onResizeMove))

// ── Actions ──────────────────────────────────────────────────────────────────
function openEditor() {
  window.dispatchEvent(new CustomEvent('comfynext:openTimeline', { detail: { nodeId: props.id } }))
}
function runThisNode() {
  if (isMuted.value || isBypassed.value || props.data.running) return
  window.dispatchEvent(new CustomEvent('comfynext:runFiltered', { detail: { targetIds: [props.id] } }))
}
</script>

<template>
  <div
    class="artifact-timeline relative select-none"
    :class="{ 'artifact-timeline--muted': isMuted, 'artifact-timeline--bypassed': isBypassed }"
    :style="{ width: nodeW + 'px', '--port-color': imageColor } as any"
    :data-running="data.running || undefined"
  >
    <!-- Clip inputs (left, grow-on-connect) -->
    <Handle
      v-for="(slot, i) in clipSlots" :key="slot" :id="`input-${slot}`"
      type="target" :position="Position.Left"
      class="!w-3 !h-3 !rounded-full !border-2 !bg-[#1a1a1a]"
      :style="{ borderColor: imageColor, top: handleTop(i, clipSlots.length) }"
    />
    <!-- Frames output (right) -->
    <Handle
      :id="`output-${framesOutIdx}`" type="source" :position="Position.Right"
      class="!w-3 !h-3 !rounded-full !border-2 !bg-[#1a1a1a]"
      :style="{ borderColor: imageColor, top: '50%' }"
    />

    <div
      ref="shellRef"
      class="artifact-frame relative rounded-lg overflow-hidden bg-[#0e0e0e] border backdrop-blur-sm"
      :class="data.error ? 'border-red-500 ring-2 ring-red-500' : 'border-white/10'"
    >
      <!-- Header -->
      <div class="flex items-center gap-1.5 px-2 py-1.5 border-b border-white/5">
        <Clapperboard class="size-3 text-white/45 shrink-0" />
        <span class="text-[10.5px] text-white/70">Timeline</span>
        <span class="flex-1" />
        <span v-if="summary" class="text-[10px] text-white/35 tabular-nums">{{ summary }}</span>
      </div>

      <!-- Live preview (main content, fills the card width) -->
      <div class="bg-black">
        <VueCanvasTimelineNodePreview :node-id="id" />
      </div>

      <!-- Footer: open editor + run -->
      <div class="flex items-center gap-1.5 px-2 py-1.5 border-t border-white/5">
        <button
          class="nopan nodrag flex-1 h-6 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-white/70 hover:text-white/90 text-[11px] flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          title="Open the full multi-track editor"
          @click.stop="openEditor"
        >
          <Pencil class="size-3" /> Open timeline
        </button>
        <button
          class="nopan nodrag shrink-0 size-6 rounded flex items-center justify-center text-white/45 hover:text-white/85 hover:bg-white/[0.08] transition-colors cursor-pointer disabled:opacity-40"
          :disabled="data.running || isMuted || isBypassed"
          :title="data.running ? 'Running…' : 'Render frames'"
          @click.stop="runThisNode"
        >
          <Loader2 v-if="data.running" class="size-3 animate-spin" />
          <Play v-else class="size-2.5" fill="currentColor" />
        </button>
      </div>
    </div>

    <!-- Mode badge -->
    <div
      v-if="isMuted || isBypassed"
      class="pointer-events-none absolute top-1.5 right-1.5 z-[6] text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
      :class="isBypassed ? 'bg-amber-500/25 text-amber-200 border border-amber-400/30' : 'bg-white/15 text-white/70 border border-white/15'"
    >{{ isBypassed ? 'Bypass' : 'Mute' }}</div>

    <!-- Corner resize grip — on-canvas display size -->
    <div
      class="nopan nodrag absolute -bottom-1.5 -right-1.5 size-4 cursor-nwse-resize group/resize z-[7]"
      title="Resize timeline card"
      @pointerdown="onResizeDown"
    >
      <div class="absolute bottom-1 right-1 size-2 border-b-2 border-r-2 border-white/30 group-hover/resize:border-cyan-400 rounded-[1px]" />
    </div>
  </div>
</template>

<style scoped>
.artifact-timeline[data-running] .artifact-frame {
  box-shadow: 0 0 0 2px var(--port-color, #fff), 0 4px 16px rgba(0, 0, 0, 0.4);
}
.artifact-frame {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4), 0 1px 4px rgba(0, 0, 0, 0.2);
}
.artifact-timeline--muted { opacity: 0.45; filter: grayscale(0.8); }
.artifact-timeline--bypassed { opacity: 0.85; }
.artifact-timeline--bypassed .artifact-frame {
  border-style: dashed;
  border-color: rgba(251, 191, 36, 0.35);
}
</style>
