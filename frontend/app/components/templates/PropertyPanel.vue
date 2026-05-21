<script setup lang="ts">
/** Right-side properties panel — shown when an element is selected. */
import { Trash2, X as XIcon } from 'lucide-vue-next'

import type { Anchor, ImageElement, LayoutElement, ShapeElement, TextElement } from '~~/server/templates/schema'

const ctx = inject<ReturnType<typeof useTemplateEditor>>('templateEditor')!
const {
  selectedElement, patchElement, patchEffective, deleteElement,
  editingOverride, currentAspect, defaultAspect,
  clearOverrideField, clearOverrideStyleField, clearAllOverrides,
  hasOverride, hasStyleOverride,
} = ctx

const ANCHORS: Anchor[] = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
]

// The panel reads the *effective* element (base merged with current aspect's
// override) so the inputs show what the user actually sees on the canvas.
// Writes flow through patchEffective, which decides where the change lands.
function effective<E extends LayoutElement>(el: E): E {
  if (!editingOverride.value) return el
  const ov = el.overrides?.[currentAspect.value]
  if (!ov) return el
  return {
    ...el,
    ...ov,
    style: { ...(el as any).style, ...((ov as any).style ?? {}) },
  } as E
}

const eff = computed(() => selectedElement.value ? effective(selectedElement.value) : null)

// `update` / `updateStyle` mutate via patchEffective — writes to base or
// override depending on which aspect is currently active.
function update<K extends keyof LayoutElement>(key: K, value: any) {
  if (!selectedElement.value) return
  patchEffective(selectedElement.value.id, { [key]: value } as any)
}

function updateStyle(key: string, value: any) {
  if (!selectedElement.value) return
  patchEffective(selectedElement.value.id, { style: { [key]: value } } as any)
}

function setOffset(x?: string, y?: string) {
  if (!eff.value) return
  const cur = eff.value.offset
  patchEffective(selectedElement.value!.id, {
    offset: {
      x: x !== undefined ? parseLength(x, cur.x) : cur.x,
      y: y !== undefined ? parseLength(y, cur.y) : cur.y,
    },
  } as any)
}

function setSize(w?: string, h?: string) {
  if (!eff.value) return
  const cur = eff.value.size
  patchEffective(selectedElement.value!.id, {
    size: {
      w: w !== undefined ? parseLength(w, cur.w) : cur.w,
      h: h !== undefined ? parseLength(h, cur.h) : cur.h,
    },
  } as any)
}

// id/role/type/shape are base-only — they don't make sense to vary per aspect.
function updateBase<K extends keyof LayoutElement>(key: K, value: any) {
  if (!selectedElement.value) return
  patchElement(selectedElement.value.id, { [key]: value } as any)
}

// "Has override" wrappers for templates — work on the selected element directly.
function hasOv(field: keyof LayoutElement): boolean {
  return selectedElement.value ? hasOverride(selectedElement.value, field) : false
}
function hasStyleOv(field: string): boolean {
  return selectedElement.value ? hasStyleOverride(selectedElement.value, field) : false
}
function resetField(field: keyof LayoutElement) {
  if (selectedElement.value) clearOverrideField(selectedElement.value.id, field)
}
function resetStyleField(field: string) {
  if (selectedElement.value) clearOverrideStyleField(selectedElement.value.id, field)
}

// User types "60%" or "240" or "auto" or "fill" — convert to our Length type.
function parseLength(input: string, fallback: any) {
  const v = input.trim()
  if (v === 'auto' || v === 'fill') return v
  if (v.endsWith('%')) return v as any
  const n = Number(v)
  if (Number.isFinite(n)) return n
  return fallback
}

function lengthStr(v: any): string {
  if (typeof v === 'number') return String(v)
  return String(v ?? '')
}
</script>

<template>
  <div v-if="selectedElement && eff" class="flex flex-col">
    <!-- Header -->
    <div class="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
      <div class="flex flex-col">
        <div class="text-[11px] uppercase tracking-[0.12em] text-white/35 font-medium">
          {{ selectedElement.type }}
        </div>
        <input
          :value="selectedElement.id"
          class="bg-transparent text-[13px] text-white/85 font-mono mt-0.5 px-1 -ml-1 rounded hover:bg-white/[0.04] focus:bg-white/[0.06] focus:outline-none w-[200px]"
          @input="(e) => updateBase('id', (e.target as HTMLInputElement).value)"
        />
      </div>
      <button
        class="p-1.5 rounded hover:bg-rose-500/15 text-white/40 hover:text-rose-300 transition-colors cursor-pointer"
        title="Delete element"
        @click="deleteElement(selectedElement!.id)"
      >
        <Trash2 class="size-3.5" />
      </button>
    </div>

    <!-- Override-mode banner: lets the user know writes will land in the
         current aspect's override delta, not on the base. -->
    <div
      v-if="editingOverride"
      class="px-4 py-2.5 border-b border-[#96b4ff]/15 bg-[#96b4ff]/[0.06] flex items-center justify-between gap-3"
    >
      <div class="text-[11px] leading-snug text-[#c9d6ff]">
        Editing <span class="font-medium">{{ currentAspect }}</span> overrides.
        Default is <span class="font-medium">{{ defaultAspect }}</span>.
      </div>
      <button
        class="text-[10px] text-[#c9d6ff]/70 hover:text-white px-1.5 py-0.5 rounded hover:bg-[#96b4ff]/15 transition-colors cursor-pointer whitespace-nowrap"
        title="Remove every override on this element for the current aspect"
        @click="clearAllOverrides(selectedElement!.id)"
      >
        Reset all
      </button>
    </div>

    <!-- Position -->
    <div class="px-4 py-3 border-b border-white/[0.06] flex flex-col gap-3">
      <div class="text-[10px] uppercase tracking-[0.12em] text-white/35 font-medium">Position</div>
      <div>
        <div class="flex items-center gap-1.5 mb-1.5">
          <label class="text-[11px] text-white/55">Anchor</label>
          <button
            v-if="hasOv('anchor')"
            class="text-[9px] text-[#96b4ff] hover:text-white px-1 py-0.5 rounded hover:bg-[#96b4ff]/15 transition-colors cursor-pointer inline-flex items-center gap-0.5"
            title="Reset to default"
            @click="resetField('anchor')"
          ><XIcon class="size-2.5" />reset</button>
        </div>
        <div class="grid grid-cols-3 gap-0.5 w-fit rounded border border-white/[0.06] p-0.5 bg-white/[0.02]">
          <button
            v-for="a in ANCHORS"
            :key="a"
            class="size-7 rounded transition-colors cursor-pointer"
            :class="eff.anchor === a
              ? 'bg-[#96b4ff]/30 ring-1 ring-[#96b4ff]'
              : 'hover:bg-white/[0.06]'"
            :title="a"
            @click="update('anchor', a)"
          >
            <div
              class="size-1.5 rounded-full mx-auto"
              :class="eff.anchor === a ? 'bg-[#96b4ff]' : 'bg-white/30'"
            />
          </button>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <label class="block">
          <div class="flex items-center gap-1.5 mb-1">
            <div class="text-[11px] text-white/55">Offset X</div>
            <button v-if="hasOv('offset')" class="text-[9px] text-[#96b4ff] hover:text-white px-1 py-0.5 rounded hover:bg-[#96b4ff]/15 transition-colors cursor-pointer" title="Reset to default" @click="resetField('offset')"><XIcon class="size-2.5 inline" /></button>
          </div>
          <input
            :value="lengthStr(eff.offset.x)"
            class="w-full h-8 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white focus:outline-none focus:border-[#96b4ff]/50"
            placeholder="60 or 8%"
            @change="(e) => setOffset((e.target as HTMLInputElement).value)"
          />
        </label>
        <label class="block">
          <div class="text-[11px] text-white/55 mb-1">Offset Y</div>
          <input
            :value="lengthStr(eff.offset.y)"
            class="w-full h-8 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white focus:outline-none focus:border-[#96b4ff]/50"
            placeholder="60 or 8%"
            @change="(e) => setOffset(undefined, (e.target as HTMLInputElement).value)"
          />
        </label>
      </div>
    </div>

    <!-- Size -->
    <div class="px-4 py-3 border-b border-white/[0.06] flex flex-col gap-3">
      <div class="flex items-center gap-1.5">
        <div class="text-[10px] uppercase tracking-[0.12em] text-white/35 font-medium">Size</div>
        <button v-if="hasOv('size')" class="text-[9px] text-[#96b4ff] hover:text-white px-1 py-0.5 rounded hover:bg-[#96b4ff]/15 transition-colors cursor-pointer" title="Reset to default" @click="resetField('size')"><XIcon class="size-2.5 inline" /></button>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <label class="block">
          <div class="text-[11px] text-white/55 mb-1">Width</div>
          <input
            :value="lengthStr(eff.size.w)"
            class="w-full h-8 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white focus:outline-none focus:border-[#96b4ff]/50"
            placeholder="200, 60%, auto, fill"
            @change="(e) => setSize((e.target as HTMLInputElement).value)"
          />
        </label>
        <label class="block">
          <div class="text-[11px] text-white/55 mb-1">Height</div>
          <input
            :value="lengthStr(eff.size.h)"
            class="w-full h-8 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white focus:outline-none focus:border-[#96b4ff]/50"
            placeholder="200, 60%, auto"
            @change="(e) => setSize(undefined, (e.target as HTMLInputElement).value)"
          />
        </label>
      </div>
    </div>

    <!-- Type-specific style -->
    <div v-if="selectedElement.type === 'text'" class="px-4 py-3 border-b border-white/[0.06] flex flex-col gap-3">
      <div class="text-[10px] uppercase tracking-[0.12em] text-white/35 font-medium">Text</div>
      <label class="block">
        <div class="flex items-center gap-1.5 mb-1">
          <div class="text-[11px] text-white/55">Content</div>
          <button v-if="hasOv('content' as any)" class="text-[9px] text-[#96b4ff] hover:text-white px-1 py-0.5 rounded hover:bg-[#96b4ff]/15 transition-colors cursor-pointer" title="Reset to default" @click="resetField('content' as any)"><XIcon class="size-2.5 inline" /></button>
        </div>
        <textarea
          :value="(eff as any).content"
          rows="2"
          class="w-full px-2 py-1.5 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white font-mono focus:outline-none focus:border-[#96b4ff]/50"
          @change="(e) => update('content' as any, (e.target as HTMLTextAreaElement).value)"
        />
      </label>
      <div class="grid grid-cols-2 gap-2">
        <label class="block">
          <div class="flex items-center gap-1.5 mb-1">
            <div class="text-[11px] text-white/55">Size (px)</div>
            <button v-if="hasStyleOv('fontSize')" class="text-[9px] text-[#96b4ff] hover:text-white px-1 py-0.5 rounded hover:bg-[#96b4ff]/15 transition-colors cursor-pointer" title="Reset to default" @click="resetStyleField('fontSize')"><XIcon class="size-2.5 inline" /></button>
          </div>
          <input
            type="number"
            :value="(eff as any).style?.fontSize ?? 48"
            class="w-full h-8 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white focus:outline-none focus:border-[#96b4ff]/50"
            @change="(e) => updateStyle('fontSize', Number((e.target as HTMLInputElement).value))"
          />
        </label>
        <label class="block">
          <div class="flex items-center gap-1.5 mb-1">
            <div class="text-[11px] text-white/55">Weight</div>
            <button v-if="hasStyleOv('fontWeight')" class="text-[9px] text-[#96b4ff] hover:text-white px-1 py-0.5 rounded hover:bg-[#96b4ff]/15 transition-colors cursor-pointer" title="Reset to default" @click="resetStyleField('fontWeight')"><XIcon class="size-2.5 inline" /></button>
          </div>
          <select
            :value="(eff as any).style?.fontWeight ?? 400"
            class="w-full h-8 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white focus:outline-none focus:border-[#96b4ff]/50"
            @change="(e) => updateStyle('fontWeight', Number((e.target as HTMLSelectElement).value))"
          >
            <option value="400">Regular</option>
            <option value="700">Bold</option>
          </select>
        </label>
      </div>
      <label class="block">
        <div class="flex items-center gap-1.5 mb-1">
          <div class="text-[11px] text-white/55">Color</div>
          <button v-if="hasStyleOv('color')" class="text-[9px] text-[#96b4ff] hover:text-white px-1 py-0.5 rounded hover:bg-[#96b4ff]/15 transition-colors cursor-pointer" title="Reset to default" @click="resetStyleField('color')"><XIcon class="size-2.5 inline" /></button>
        </div>
        <div class="flex items-center gap-2">
          <input
            type="color"
            :value="(eff as any).style?.color ?? '#ffffff'"
            class="size-8 rounded cursor-pointer bg-transparent border border-white/[0.06]"
            @input="(e) => updateStyle('color', (e.target as HTMLInputElement).value)"
          />
          <input
            :value="(eff as any).style?.color ?? '#ffffff'"
            class="flex-1 h-8 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white font-mono focus:outline-none focus:border-[#96b4ff]/50"
            placeholder="#ffffff or {{ brand.foreground }}"
            @change="(e) => updateStyle('color', (e.target as HTMLInputElement).value)"
          />
        </div>
      </label>
      <label class="block">
        <div class="flex items-center gap-1.5 mb-1">
          <div class="text-[11px] text-white/55">Align</div>
          <button v-if="hasStyleOv('align')" class="text-[9px] text-[#96b4ff] hover:text-white px-1 py-0.5 rounded hover:bg-[#96b4ff]/15 transition-colors cursor-pointer" title="Reset to default" @click="resetStyleField('align')"><XIcon class="size-2.5 inline" /></button>
        </div>
        <div class="grid grid-cols-3 gap-0.5 rounded border border-white/[0.06] p-0.5 bg-white/[0.02]">
          <button
            v-for="a in (['left', 'center', 'right'] as const)"
            :key="a"
            class="h-7 text-[11px] rounded transition-colors cursor-pointer"
            :class="(((eff as any).style?.align ?? 'left') === a)
              ? 'bg-[#96b4ff]/25 text-white'
              : 'text-white/55 hover:bg-white/[0.06]'"
            @click="updateStyle('align', a)"
          >{{ a }}</button>
        </div>
      </label>
    </div>

    <div v-else-if="selectedElement.type === 'image'" class="px-4 py-3 border-b border-white/[0.06] flex flex-col gap-3">
      <div class="text-[10px] uppercase tracking-[0.12em] text-white/35 font-medium">Image</div>
      <label class="block">
        <div class="flex items-center gap-1.5 mb-1">
          <div class="text-[11px] text-white/55">Source (URL or token)</div>
          <button v-if="hasOv('content' as any)" class="text-[9px] text-[#96b4ff] hover:text-white px-1 py-0.5 rounded hover:bg-[#96b4ff]/15 transition-colors cursor-pointer" title="Reset to default" @click="resetField('content' as any)"><XIcon class="size-2.5 inline" /></button>
        </div>
        <input
          :value="(eff as any).content"
          class="w-full h-8 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white font-mono focus:outline-none focus:border-[#96b4ff]/50"
          placeholder="https://… or {{ props.hero }}"
          @change="(e) => update('content' as any, (e.target as HTMLInputElement).value)"
        />
      </label>
      <label class="block">
        <div class="flex items-center gap-1.5 mb-1">
          <div class="text-[11px] text-white/55">Fit</div>
          <button v-if="hasStyleOv('fit')" class="text-[9px] text-[#96b4ff] hover:text-white px-1 py-0.5 rounded hover:bg-[#96b4ff]/15 transition-colors cursor-pointer" title="Reset to default" @click="resetStyleField('fit')"><XIcon class="size-2.5 inline" /></button>
        </div>
        <select
          :value="(eff as any).style?.fit ?? 'cover'"
          class="w-full h-8 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white focus:outline-none focus:border-[#96b4ff]/50"
          @change="(e) => updateStyle('fit', (e.target as HTMLSelectElement).value)"
        >
          <option value="cover">Cover (fill, may crop)</option>
          <option value="contain">Contain (fit, may letterbox)</option>
          <option value="stretch">Stretch (distort)</option>
          <option value="smart_crop">Smart crop (saliency)</option>
        </select>
      </label>
      <label class="block">
        <div class="flex items-center gap-1.5 mb-1">
          <div class="text-[11px] text-white/55">Border radius (px)</div>
          <button v-if="hasStyleOv('borderRadius')" class="text-[9px] text-[#96b4ff] hover:text-white px-1 py-0.5 rounded hover:bg-[#96b4ff]/15 transition-colors cursor-pointer" title="Reset to default" @click="resetStyleField('borderRadius')"><XIcon class="size-2.5 inline" /></button>
        </div>
        <input
          type="number"
          :value="(eff as any).style?.borderRadius ?? 0"
          class="w-full h-8 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white focus:outline-none focus:border-[#96b4ff]/50"
          @change="(e) => updateStyle('borderRadius', Number((e.target as HTMLInputElement).value))"
        />
      </label>
    </div>

    <div v-else-if="selectedElement.type === 'shape'" class="px-4 py-3 border-b border-white/[0.06] flex flex-col gap-3">
      <div class="text-[10px] uppercase tracking-[0.12em] text-white/35 font-medium">Shape</div>
      <label class="block">
        <div class="text-[11px] text-white/55 mb-1">Type</div>
        <div class="grid grid-cols-2 gap-0.5 rounded border border-white/[0.06] p-0.5 bg-white/[0.02]">
          <button
            v-for="s in (['rect', 'circle'] as const)"
            :key="s"
            class="h-7 text-[11px] rounded transition-colors cursor-pointer"
            :class="(selectedElement as ShapeElement).shape === s
              ? 'bg-[#96b4ff]/25 text-white'
              : 'text-white/55 hover:bg-white/[0.06]'"
            @click="updateBase('shape' as any, s)"
          >{{ s }}</button>
        </div>
      </label>
      <label class="block">
        <div class="flex items-center gap-1.5 mb-1">
          <div class="text-[11px] text-white/55">Fill</div>
          <button v-if="hasStyleOv('fill')" class="text-[9px] text-[#96b4ff] hover:text-white px-1 py-0.5 rounded hover:bg-[#96b4ff]/15 transition-colors cursor-pointer" title="Reset to default" @click="resetStyleField('fill')"><XIcon class="size-2.5 inline" /></button>
        </div>
        <div class="flex items-center gap-2">
          <input
            type="color"
            :value="(eff as any).style?.fill ?? '#000000'"
            class="size-8 rounded cursor-pointer bg-transparent border border-white/[0.06]"
            @input="(e) => updateStyle('fill', (e.target as HTMLInputElement).value)"
          />
          <input
            :value="(eff as any).style?.fill ?? '#000000'"
            class="flex-1 h-8 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white font-mono focus:outline-none focus:border-[#96b4ff]/50"
            @change="(e) => updateStyle('fill', (e.target as HTMLInputElement).value)"
          />
        </div>
      </label>
      <label v-if="(selectedElement as ShapeElement).shape === 'rect'" class="block">
        <div class="flex items-center gap-1.5 mb-1">
          <div class="text-[11px] text-white/55">Border radius (px)</div>
          <button v-if="hasStyleOv('borderRadius')" class="text-[9px] text-[#96b4ff] hover:text-white px-1 py-0.5 rounded hover:bg-[#96b4ff]/15 transition-colors cursor-pointer" title="Reset to default" @click="resetStyleField('borderRadius')"><XIcon class="size-2.5 inline" /></button>
        </div>
        <input
          type="number"
          :value="(eff as any).style?.borderRadius ?? 0"
          class="w-full h-8 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white focus:outline-none focus:border-[#96b4ff]/50"
          @change="(e) => updateStyle('borderRadius', Number((e.target as HTMLInputElement).value))"
        />
      </label>
    </div>
  </div>
</template>
