<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { Loader2, Type, Download, Play } from 'lucide-vue-next'
import { getTypeColor } from '~/composables/useVueNodes'

// Visual half of the unified `Text` artifact node. Textarea bound to the
// `text` widget value — user types in place. Switches to displaying the
// executed result (data.text) once that's set.
const props = defineProps<{
  id: string
  data: {
    nodeType: string
    title: string
    inputs: { name: string; type: string; link: number | null }[]
    outputs: { name: string; type: string; links: number[] | null }[]
    widgetsValues: any[]
    widgetDefs?: any[]
    mode: number
    running?: boolean
    error?: boolean
    text?: string
    outputNode?: boolean
  }
}>()

const isMuted = computed(() => props.data.mode === 2)
const isBypassed = computed(() => props.data.mode === 4)
const stringColor = computed(() => getTypeColor('STRING'))

const injectedEdges = inject<any>('vueFlowEdges', null)

function inputIdx(name: string): number {
  return props.data.inputs?.findIndex(i => i.name === name) ?? -1
}
function outputIdx(name: string): number {
  return props.data.outputs?.findIndex(o => o.name === name) ?? -1
}
function widgetIdx(name: string): number {
  return props.data.widgetDefs?.findIndex((w: any) => w.name === name) ?? -1
}

const sourceInputIdx = computed(() => inputIdx('source'))
const textOutputIdx = computed(() => outputIdx('text'))
const textWidgetIdx = computed(() => widgetIdx('text'))

const widgetValue = computed<string>({
  get: () => {
    const i = textWidgetIdx.value
    return i >= 0 ? (props.data.widgetsValues?.[i] || '') : ''
  },
  set: (v) => {
    const i = textWidgetIdx.value
    if (i >= 0 && props.data.widgetsValues) {
      props.data.widgetsValues[i] = v
    }
  },
})

const hasUpstream = computed(() => {
  const idx = sourceInputIdx.value
  if (idx < 0) return false
  if (props.data.inputs?.[idx]?.link != null) return true
  const edges = injectedEdges?.value ?? []
  return edges.some((e: any) => e.target === props.id && e.targetHandle === `input-${idx}`)
})

// Effective text — execution output wins, then widget value. The textarea
// is bound to a wrapper that writes to the widget but reads from whatever
// the user/upstream most recently produced.
const effectiveText = computed(() => {
  if (props.data.text != null && props.data.text !== '') return props.data.text
  return widgetValue.value
})

function onTextInput(e: Event) {
  widgetValue.value = (e.target as HTMLTextAreaElement).value
}

// Per-node run for the live preview after typing.
function runThisNode() {
  if (isMuted.value || isBypassed.value || props.data.running) return
  window.dispatchEvent(
    new CustomEvent('comfynext:runFiltered', { detail: { targetIds: [props.id] } }),
  )
}

async function downloadText() {
  const value = effectiveText.value
  if (!value) return
  try {
    const blob = new Blob([value], { type: 'text/plain' })
    const obj = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = obj
    a.download = 'text.txt'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(obj)
  } catch (err) {
    console.error('[ArtifactText] download failed:', err)
  }
}

const charCount = computed(() => effectiveText.value.length)
</script>

<template>
  <div
    class="artifact-text relative w-[300px] select-none"
    :class="{
      'artifact-text--muted': isMuted,
      'artifact-text--bypassed': isBypassed,
    }"
    :data-running="data.running || undefined"
    :style="{ '--port-color': stringColor } as any"
  >
    <!-- Upstream STRING input -->
    <Handle
      v-if="sourceInputIdx >= 0"
      :id="`input-${sourceInputIdx}`"
      type="target"
      :position="Position.Left"
      class="!w-3 !h-3 !rounded-full !border-2 !bg-[#1a1a1a]"
      :style="{ borderColor: stringColor, top: '50%' }"
    />
    <!-- STRING output -->
    <Handle
      v-if="textOutputIdx >= 0"
      :id="`output-${textOutputIdx}`"
      type="source"
      :position="Position.Right"
      class="!w-3 !h-3 !rounded-full !border-2 !bg-[#1a1a1a]"
      :style="{ borderColor: stringColor, top: '50%' }"
    />

    <div
      class="artifact-frame relative rounded-lg overflow-hidden bg-black/40 border border-white/10 backdrop-blur-sm"
      :class="{ 'ring-2 ring-red-500': data.error }"
    >
      <!-- The text body. Editable textarea bound to the widget; users type
           directly into the card. After execution, data.text takes over the
           display (still editable — typing returns control to the widget). -->
      <textarea
        class="nopan nodrag w-full min-h-[160px] max-h-[400px] resize-none bg-transparent text-[12px] leading-snug text-white/85 p-3 outline-none placeholder:text-white/30 font-mono"
        :value="effectiveText"
        :placeholder="hasUpstream ? 'Wired to upstream. Type to override.' : 'Type text…'"
        @input="onTextInput"
      />
      <!-- Footer: char count + actions. -->
      <div class="flex items-center gap-1.5 px-2 py-1.5 border-t border-white/5">
        <span class="text-[10px] text-white/55 tabular-nums">
          {{ charCount }} {{ charCount === 1 ? 'char' : 'chars' }}
        </span>
        <span class="flex-1" />
        <button
          class="nopan nodrag shrink-0 size-5 rounded flex items-center justify-center text-white/45 hover:text-white/85 hover:bg-white/[0.08] transition-colors cursor-pointer disabled:opacity-50"
          :disabled="!charCount"
          title="Download as .txt"
          @click.stop="downloadText"
        >
          <Download class="size-2.5" />
        </button>
        <button
          class="nopan nodrag shrink-0 size-5 rounded flex items-center justify-center text-white/45 hover:text-white/85 hover:bg-white/[0.08] transition-colors cursor-pointer disabled:opacity-50"
          :disabled="data.running || isMuted || isBypassed"
          :title="data.running ? 'Running…' : 'Re-render'"
          @click.stop="runThisNode"
        >
          <Loader2 v-if="data.running" class="size-3 animate-spin" />
          <Play v-else class="size-2.5" fill="currentColor" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.artifact-text[data-running] .artifact-frame {
  box-shadow:
    0 0 0 2px var(--port-color, #fff),
    0 4px 16px rgba(0, 0, 0, 0.4);
}
.artifact-frame {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4), 0 1px 4px rgba(0, 0, 0, 0.2);
}
.artifact-text--muted { opacity: 0.45; filter: grayscale(0.8); }
.artifact-text--bypassed { opacity: 0.85; }
.artifact-text--bypassed .artifact-frame {
  border-style: dashed;
  border-color: rgba(251, 191, 36, 0.35);
}
</style>
