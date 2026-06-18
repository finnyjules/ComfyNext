<script setup lang="ts">
import { X, Info } from 'lucide-vue-next'

const props = defineProps<{
  nodeId: string
  nodes: any[]
}>()

const emit = defineEmits<{ close: [] }>()

const node = computed(() => props.nodes.find((n: any) => n.id === props.nodeId))

// Read/write a widget by name.
function widgetIdx(name: string): number {
  return (node.value?.data?.widgetDefs as any[] | undefined)?.findIndex(
    (d: any) => d.name === name,
  ) ?? -1
}
function getValue(name: string): any {
  const i = widgetIdx(name)
  if (i < 0) return undefined
  return node.value.data.widgetsValues[i]
}
function setValue(name: string, v: any) {
  const i = widgetIdx(name)
  if (i < 0) return
  node.value.data.widgetsValues[i] = v
}
function getDef(name: string): any {
  return (node.value?.data?.widgetDefs as any[] | undefined)?.find((d: any) => d.name === name)
}

// Slider value (0..1 normalized) → display number using the def's min/max/step.
function pctLeft(name: string, val: number): number {
  const d = getDef(name)
  if (!d) return 0
  const min = Number(d.min ?? 0)
  const max = Number(d.max ?? 100)
  if (max === min) return 0
  return ((val - min) / (max - min)) * 100
}

// Esc to close
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', handleKeydown))
onUnmounted(() => window.removeEventListener('keydown', handleKeydown))

// Group fields shown in the panel. Order mirrors the reference design.
const presetOptions = computed<string[]>(() => getDef('preset')?.options ?? [])
const colorModeOptions = computed<string[]>(() => getDef('color_mode')?.options ?? [])
const blendModeOptions = computed<string[]>(() => getDef('blend_mode')?.options ?? [])
</script>

<template>
  <div
    v-if="node"
    class="fixed top-0 right-0 h-full w-[340px] z-[90] bg-[#0e0e0e] border-l border-white/10 shadow-2xl flex flex-col text-white/85"
  >
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
      <div>
        <h2 class="text-sm font-semibold tracking-tight">Glyph dither</h2>
        <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mt-0.5">ASCII options</div>
      </div>
      <button
        class="flex items-center justify-center size-7 rounded-md hover:bg-white/10 transition-colors cursor-pointer"
        title="Close (Esc)"
        @click="emit('close')"
      >
        <X class="size-4" />
      </button>
    </div>

    <!-- Form -->
    <div class="flex-1 overflow-y-auto px-4 py-4 space-y-4 text-xs nopan nodrag">

      <!-- Position row (pos_x / pos_y inline) -->
      <div class="grid grid-cols-[80px_1fr] items-center gap-3">
        <label class="text-white/60">Position</label>
        <div class="grid grid-cols-2 gap-2">
          <div class="flex items-center gap-1.5 bg-[#1a1a1a] rounded px-2 py-1.5 border border-white/5">
            <span class="text-white/40 text-[10px]">X</span>
            <input type="number" :value="getValue('pos_x')" :min="getDef('pos_x')?.min" :max="getDef('pos_x')?.max"
              class="w-full bg-transparent outline-none text-white/90 text-xs"
              @input="setValue('pos_x', parseInt(($event.target as HTMLInputElement).value) || 0)" />
          </div>
          <div class="flex items-center gap-1.5 bg-[#1a1a1a] rounded px-2 py-1.5 border border-white/5">
            <span class="text-white/40 text-[10px]">Y</span>
            <input type="number" :value="getValue('pos_y')" :min="getDef('pos_y')?.min" :max="getDef('pos_y')?.max"
              class="w-full bg-transparent outline-none text-white/90 text-xs"
              @input="setValue('pos_y', parseInt(($event.target as HTMLInputElement).value) || 0)" />
          </div>
        </div>
      </div>

      <!-- Preset combo -->
      <div class="grid grid-cols-[80px_1fr] items-center gap-3">
        <label class="text-white/60 flex items-center gap-1">Preset <Info class="size-3 text-white/30" /></label>
        <select :value="getValue('preset')"
          class="bg-[#1a1a1a] border border-white/5 rounded px-2 py-1.5 text-white/90 outline-none cursor-pointer capitalize"
          @change="setValue('preset', ($event.target as HTMLSelectElement).value)">
          <option v-for="p in presetOptions" :key="p" :value="p" class="capitalize">{{ p }}</option>
        </select>
      </div>

      <!-- Characters string -->
      <div class="grid grid-cols-[80px_1fr] items-center gap-3">
        <label class="text-white/60 flex items-center gap-1">Characters <Info class="size-3 text-white/30" /></label>
        <input type="text" :value="getValue('characters')"
          :disabled="getValue('preset') !== 'custom'"
          class="bg-[#1a1a1a] border border-white/5 rounded px-2 py-1.5 text-white/90 outline-none font-mono text-xs disabled:opacity-40"
          @input="setValue('characters', ($event.target as HTMLInputElement).value)" />
      </div>

      <!-- Sliders -->
      <template v-for="f in [
        { name: 'cell_size', label: 'Scale' },
        { name: 'gamma',     label: 'Gamma',  info: true },
        { name: 'phase',     label: 'Phase',  info: true },
        { name: 'mix',       label: 'Mix' },
      ]" :key="f.name">
        <div class="grid grid-cols-[80px_1fr] items-center gap-3">
          <label class="text-white/60 flex items-center gap-1">
            {{ f.label }}
            <Info v-if="f.info" class="size-3 text-white/30" />
          </label>
          <div class="relative bg-[#1a1a1a] rounded border border-white/5 h-7 flex items-center px-2 cursor-pointer"
            @pointerdown="(e) => {
              const el = (e.currentTarget as HTMLElement)
              const d = getDef(f.name); if (!d) return
              const min = Number(d.min ?? 0), max = Number(d.max ?? 1), step = Number(d.step ?? 0.01)
              const update = (clientX: number) => {
                const r = el.getBoundingClientRect()
                const t = Math.max(0, Math.min(1, (clientX - r.left) / r.width))
                let v = min + t * (max - min)
                v = Math.round(v / step) * step
                if (Number.isInteger(step)) v = Math.round(v)
                else v = Math.round(v * 1000) / 1000
                setValue(f.name, v)
              }
              update(e.clientX)
              const move = (ev: PointerEvent) => update(ev.clientX)
              const up = () => {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
              }
              window.addEventListener('pointermove', move)
              window.addEventListener('pointerup', up)
            }"
          >
            <div class="absolute inset-y-0 left-0 bg-white/10 rounded"
              :style="{ width: pctLeft(f.name, Number(getValue(f.name) ?? 0)) + '%' }" />
            <span class="relative text-white/90 text-xs select-none">
              {{ Number.isInteger(getDef(f.name)?.step ?? 1)
                  ? Math.round(Number(getValue(f.name) ?? 0))
                  : Number(getValue(f.name) ?? 0).toFixed(2) }}
            </span>
          </div>
        </div>
      </template>

      <!-- Color mode -->
      <div class="grid grid-cols-[80px_1fr] items-center gap-3">
        <label class="text-white/60 flex items-center gap-1">Color mode <Info class="size-3 text-white/30" /></label>
        <select :value="getValue('color_mode')"
          class="bg-[#1a1a1a] border border-white/5 rounded px-2 py-1.5 text-white/90 outline-none cursor-pointer capitalize"
          @change="setValue('color_mode', ($event.target as HTMLSelectElement).value)">
          <option v-for="m in colorModeOptions" :key="m" :value="m" class="capitalize">{{ m }}</option>
        </select>
      </div>

      <!-- Background toggle -->
      <div class="grid grid-cols-[80px_1fr] items-center gap-3">
        <label class="text-white/60">Background</label>
        <button
          class="justify-self-end relative w-9 h-5 rounded-full transition-colors cursor-pointer"
          :class="getValue('background') ? 'bg-white/40' : 'bg-white/15'"
          @click="setValue('background', !getValue('background'))"
        >
          <span class="absolute top-0.5 size-4 bg-white rounded-full transition-all"
            :class="getValue('background') ? 'left-[18px]' : 'left-0.5'" />
        </button>
      </div>

      <!-- Invert order toggle -->
      <div class="grid grid-cols-[80px_1fr] items-center gap-3">
        <label class="text-white/60 flex items-center gap-1">Invert order <Info class="size-3 text-white/30" /></label>
        <button
          class="justify-self-end relative w-9 h-5 rounded-full transition-colors cursor-pointer"
          :class="getValue('invert_order') ? 'bg-white/40' : 'bg-white/15'"
          @click="setValue('invert_order', !getValue('invert_order'))"
        >
          <span class="absolute top-0.5 size-4 bg-white rounded-full transition-all"
            :class="getValue('invert_order') ? 'left-[18px]' : 'left-0.5'" />
        </button>
      </div>

      <!-- Blend mode -->
      <div class="grid grid-cols-[80px_1fr] items-center gap-3">
        <label class="text-white/60">Blend mode</label>
        <select :value="getValue('blend_mode')"
          class="bg-[#1a1a1a] border border-white/5 rounded px-2 py-1.5 text-white/90 outline-none cursor-pointer capitalize"
          @change="setValue('blend_mode', ($event.target as HTMLSelectElement).value)">
          <option v-for="m in blendModeOptions" :key="m" :value="m" class="capitalize">{{ m }}</option>
        </select>
      </div>

    </div>
  </div>
</template>
