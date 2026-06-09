<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { PersonStanding, Wand2 } from 'lucide-vue-next'
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

const characterInIdx = computed(() => Math.max(0, inputIdx('character')))
const imageOutIdx = computed(() => outputIdx('image'))

function openEditor() {
  window.dispatchEvent(new CustomEvent('comfynext:openPose', { detail: { nodeId: props.id } }))
}
</script>

<template>
  <div
    class="pose-mannequin-node relative select-none w-[200px]"
    :class="{ 'opacity-45 grayscale': isMuted, 'opacity-85': isBypassed }"
    :style="{ '--port-color': imageColor } as any"
    :data-running="data.running || undefined"
  >
    <Handle
      :id="`input-${characterInIdx}`" type="target" :position="Position.Left"
      class="!w-3 !h-3 !rounded-full !border-2 !bg-[#1a1a1a]"
      :style="{ borderColor: imageColor, top: '50%' }"
    />
    <Handle
      :id="`output-${imageOutIdx}`" type="source" :position="Position.Right"
      class="!w-3 !h-3 !rounded-full !border-2 !bg-[#1a1a1a]"
      :style="{ borderColor: imageColor, top: '50%' }"
    />

    <div
      class="pose-shell rounded-lg overflow-hidden bg-[#0e0e0e] border backdrop-blur-sm"
      :class="data.error ? 'border-red-500 ring-2 ring-red-500' : 'border-white/10'"
    >
      <!-- Header -->
      <div class="flex items-center gap-1.5 px-2 py-1.5 border-b border-white/5">
        <PersonStanding class="size-3.5 text-violet-400 shrink-0" />
        <span class="text-[11px] text-white/70 font-medium truncate">Pose Mannequin</span>
      </div>

      <!-- Mannequin pose preview -->
      <div class="relative bg-checker aspect-[3/4] flex items-center justify-center overflow-hidden cursor-pointer" @dblclick.stop="openEditor">
        <img v-if="mannequinUrl" :src="mannequinUrl" class="absolute inset-0 w-full h-full object-contain" draggable="false" />
        <div v-else class="flex flex-col items-center justify-center gap-1.5 text-white/35 pointer-events-none">
          <PersonStanding class="size-8" :stroke-width="1.5" />
          <span class="text-[10px]">No pose yet</span>
        </div>
      </div>

      <!-- Footer action -->
      <div class="flex items-center gap-1.5 px-2 py-1.5 border-t border-white/5">
        <button
          class="nopan nodrag flex-1 h-7 rounded-md bg-violet-500/90 hover:bg-violet-500 text-white text-[11px] font-medium flex items-center justify-center gap-1.5 cursor-pointer"
          title="Open the 3D pose editor" @click.stop="openEditor">
          <Wand2 class="size-3.5" /> {{ hasPose ? 'Edit pose' : 'Pose & Generate' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pose-shell { box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4), 0 1px 4px rgba(0, 0, 0, 0.2); }
.pose-mannequin-node[data-running] .pose-shell { box-shadow: 0 0 0 2px var(--port-color, #fff), 0 4px 16px rgba(0, 0, 0, 0.4); }
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
