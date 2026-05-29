<script setup lang="ts">
// Floating contextual toolbar for the Frame's inline editing — the common,
// high-frequency controls for the selected local layer. The parent positions it
// (screen-space, above the selection). Full/precise controls live in the modal.
import { Bold, AlignLeft, AlignCenter, AlignRight, ArrowUp, ArrowDown, Trash2, Ban } from 'lucide-vue-next'
import { TEMPLATE_FONTS } from '~~/shared/template-fonts'

const props = defineProps<{
  layer: any       // the selected LocalLayer
  pxBase: number   // canvas width in logical px — for norm↔px size conversions
}>()
const emit = defineEmits<{ set: [patch: Record<string, any>]; movez: [dir: number]; remove: [] }>()

const FONT_NAMES = TEMPLATE_FONTS.map(f => f.name)
const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'soft_light', 'hard_light', 'difference', 'lighten', 'darken', 'add']

function px(norm: number) { return Math.round((norm || 0) * props.pxBase) }
function setPx(key: string, v: string) { emit('set', { [key]: Math.max(0, parseFloat(v) || 0) / props.pxBase }) }
const hasFill = computed(() => props.layer.fill && props.layer.fill !== 'none')
</script>

<template>
  <div
    class="ll-toolbar flex items-center gap-1 px-1.5 py-1 rounded-lg bg-[#1c1c1c] border border-white/12 shadow-xl text-white/80"
    @pointerdown.stop
    @click.stop
  >
    <!-- TEXT -->
    <template v-if="layer.kind === 'text'">
      <input type="color" :value="layer.color" title="Color"
        class="size-6 shrink-0 rounded cursor-pointer bg-transparent border border-white/10 p-0"
        @input="emit('set', { color: ($event.target as HTMLInputElement).value })" />
      <select :value="layer.fontFamily" title="Font"
        class="h-6 max-w-[96px] bg-white/[0.06] rounded text-[11px] text-white/85 px-1 outline-none cursor-pointer"
        @change="emit('set', { fontFamily: ($event.target as HTMLSelectElement).value })">
        <option v-for="f in FONT_NAMES" :key="f" :value="f">{{ f }}</option>
      </select>
      <input type="number" min="1" :value="px(layer.fontSize)" title="Size"
        class="w-11 h-6 bg-white/[0.06] rounded text-[11px] text-center text-white/85 outline-none"
        @input="setPx('fontSize', ($event.target as HTMLInputElement).value)" />
      <button class="ll-btn" :class="layer.fontWeight === 700 ? 'is-on' : ''" title="Bold"
        @click="emit('set', { fontWeight: layer.fontWeight === 700 ? 400 : 700 })"><Bold class="size-3.5" /></button>
      <button v-for="a in (['left','center','right'] as const)" :key="a" class="ll-btn" :class="layer.align === a ? 'is-on' : ''" :title="`Align ${a}`"
        @click="emit('set', { align: a })">
        <component :is="a === 'left' ? AlignLeft : a === 'center' ? AlignCenter : AlignRight" class="size-3.5" />
      </button>
    </template>

    <!-- RECT / ELLIPSE -->
    <template v-else-if="layer.kind === 'rect' || layer.kind === 'ellipse'">
      <input type="color" :value="hasFill ? layer.fill : '#3b82f6'" title="Fill"
        class="size-6 shrink-0 rounded cursor-pointer bg-transparent border border-white/10 p-0"
        @input="emit('set', { fill: ($event.target as HTMLInputElement).value })" />
      <button class="ll-btn" :class="!hasFill ? 'is-on' : ''" title="No fill"
        @click="emit('set', { fill: hasFill ? 'none' : '#3b82f6' })"><Ban class="size-3.5" /></button>
      <span class="ll-sep" />
      <input type="color" :value="layer.stroke || '#ffffff'" title="Stroke"
        class="size-6 shrink-0 rounded cursor-pointer bg-transparent border border-white/10 p-0"
        @input="emit('set', { stroke: ($event.target as HTMLInputElement).value })" />
      <input type="number" min="0" :value="px(layer.strokeWidth)" title="Stroke width"
        class="w-11 h-6 bg-white/[0.06] rounded text-[11px] text-center text-white/85 outline-none"
        @input="setPx('strokeWidth', ($event.target as HTMLInputElement).value)" />
      <input v-if="layer.kind === 'rect'" type="number" min="0" :value="px(layer.radius)" title="Corner radius"
        class="w-11 h-6 bg-white/[0.06] rounded text-[11px] text-center text-white/85 outline-none"
        @input="setPx('radius', ($event.target as HTMLInputElement).value)" />
    </template>

    <!-- LINE -->
    <template v-else-if="layer.kind === 'line'">
      <input type="color" :value="layer.stroke" title="Color"
        class="size-6 shrink-0 rounded cursor-pointer bg-transparent border border-white/10 p-0"
        @input="emit('set', { stroke: ($event.target as HTMLInputElement).value })" />
      <input type="number" min="1" :value="px(layer.strokeWidth)" title="Thickness"
        class="w-11 h-6 bg-white/[0.06] rounded text-[11px] text-center text-white/85 outline-none"
        @input="setPx('strokeWidth', ($event.target as HTMLInputElement).value)" />
    </template>

    <!-- IMAGE (dropped/local) -->
    <template v-else-if="layer.kind === 'image'">
      <span class="text-[10px] uppercase tracking-wide text-white/40 pl-1">Opacity</span>
      <input type="number" min="0" max="100" :value="Math.round((layer.opacity ?? 1) * 100)" title="Opacity"
        class="w-11 h-6 bg-white/[0.06] rounded text-[11px] text-center text-white/85 outline-none"
        @input="emit('set', { opacity: Math.max(0, Math.min(1, (parseFloat(($event.target as HTMLInputElement).value) || 0) / 100)) })" />
    </template>

    <!-- WIRED / generated layer — opacity + blend (transform is via the handles) -->
    <template v-else-if="layer.kind === 'wired'">
      <span class="text-[10px] uppercase tracking-wide text-white/40 pl-1">Opacity</span>
      <input type="number" min="0" max="100" :value="Math.round((layer.opacity ?? 1) * 100)" title="Opacity"
        class="w-11 h-6 bg-white/[0.06] rounded text-[11px] text-center text-white/85 outline-none"
        @input="emit('set', { opacity: Math.max(0, Math.min(1, (parseFloat(($event.target as HTMLInputElement).value) || 0) / 100)) })" />
      <select :value="layer.blend || 'normal'" title="Blend mode"
        class="h-6 bg-white/[0.06] rounded text-[11px] text-white/85 px-1 outline-none cursor-pointer"
        @change="emit('set', { blend: ($event.target as HTMLSelectElement).value })">
        <option v-for="m in BLEND_MODES" :key="m" :value="m">{{ m.replace('_', ' ') }}</option>
      </select>
    </template>

    <!-- z-order — every layer (wired or local) shares one depth stack -->
    <span class="ll-sep" />
    <button class="ll-btn" title="Bring forward" @click="emit('movez', 1)"><ArrowUp class="size-3.5" /></button>
    <button class="ll-btn" title="Send backward" @click="emit('movez', -1)"><ArrowDown class="size-3.5" /></button>
    <!-- delete: local layers only (wired layers are removed by disconnecting) -->
    <button v-if="layer.kind !== 'wired'" class="ll-btn ll-btn--danger" title="Delete" @click="emit('remove')"><Trash2 class="size-3.5" /></button>
  </div>
</template>

<style scoped>
.ll-toolbar { backdrop-filter: blur(6px); }
.ll-btn {
  display: flex; align-items: center; justify-content: center;
  width: 1.5rem; height: 1.5rem; border-radius: 0.375rem;
  color: rgba(255, 255, 255, 0.6); cursor: pointer; transition: all 0.12s;
}
.ll-btn:hover { color: #fff; background: rgba(255, 255, 255, 0.1); }
.ll-btn.is-on { color: #22d3ee; background: rgba(34, 211, 238, 0.12); }
.ll-btn--danger:hover { color: #fb7185; background: rgba(244, 63, 94, 0.12); }
.ll-sep { width: 1px; height: 1rem; background: rgba(255, 255, 255, 0.12); margin: 0 0.125rem; }
</style>
