<script setup lang="ts">
/** Right-side properties panel — shown when an element is selected. */
import { ChevronLeft, ChevronRight, Layers, Trash2, X as XIcon } from 'lucide-vue-next'

import type { Anchor, ImageElement, LayoutElement, ShapeElement, TextElement } from '~~/server/templates/schema'

const ctx = inject<ReturnType<typeof useTemplateEditor>>('templateEditor')!
const {
  selectedElement, patchElement, patchEffective, deleteElement,
  editingOverride, currentAspect, defaultAspect,
  clearOverrideField, clearOverrideStyleField, clearAllOverrides,
  hasOverride, hasStyleOverride,
} = ctx

// SmartLayout variant context — provided by SmartLayoutEditorModal when the
// editor is embedded for a SmartLayout node. The cycler below only renders
// when the selected element is a `text_layer_N` with >1 wired variant.
const variantCtx = inject<{
  variantsByLayer: { value: Record<string, string[]> }
  activeVariantByLayer: { value: Record<string, number> }
} | null>('smartLayoutVariants', null)

const variantsForSelected = computed<string[]>(() => {
  if (!variantCtx || !selectedElement.value) return []
  const id = selectedElement.value.id
  return variantCtx.variantsByLayer.value[id] ?? []
})

const activeVariantIdx = computed<number>({
  get() {
    if (!variantCtx || !selectedElement.value) return 0
    return variantCtx.activeVariantByLayer.value[selectedElement.value.id] ?? 0
  },
  set(v: number) {
    if (!variantCtx || !selectedElement.value) return
    const id = selectedElement.value.id
    const total = variantsForSelected.value.length || 1
    const clamped = ((v % total) + total) % total
    variantCtx.activeVariantByLayer.value = {
      ...variantCtx.activeVariantByLayer.value,
      [id]: clamped,
    }
  },
})

function prevVariant() { activeVariantIdx.value = activeVariantIdx.value - 1 }
function nextVariant() { activeVariantIdx.value = activeVariantIdx.value + 1 }

// Google Fonts on-demand loader — wired further down (after `eff` is in
// scope). Declaring the ensure handle up here would TDZ the watcher because
// `immediate: true` evaluates the getter synchronously during setup.
const { ensure: ensureGoogleFont } = useGoogleFontPreview()

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

function applyFontFamily(value: string) {
  const fam = value.trim()
  if (!fam) return
  ensureGoogleFont(fam)
  updateStyle('fontFamily', fam)
}

// Per-side padding / per-corner radius. Stored on the element as either a
// single number (linked / uniform) or a 4-tuple. The UI exposes both modes
// via a link/unlink toggle; the underlying schema accepts both. Order:
//   padding tuple → [top, right, bottom, left]
//   radius  tuple → [tl,  tr,    br,     bl]
function _tuple4(v: number | number[] | undefined): [number, number, number, number] {
  if (Array.isArray(v) && v.length === 4) return [v[0], v[1], v[2], v[3]]
  const n = typeof v === 'number' ? v : 0
  return [n, n, n, n]
}
const paddingSides = computed(() => _tuple4((eff.value as any)?.style?.padding))
const radiusCorners = computed(() => _tuple4((eff.value as any)?.style?.backgroundRadius))
const paddingLinked = computed(() => {
  const v = (eff.value as any)?.style?.padding
  return v == null || typeof v === 'number'
})
const radiusLinked = computed(() => {
  const v = (eff.value as any)?.style?.backgroundRadius
  return v == null || typeof v === 'number'
})
function togglePaddingLink() {
  const sides = paddingSides.value
  if (paddingLinked.value) {
    // Unlink — write the current uniform value to all 4 sides.
    updateStyle('padding', [sides[0], sides[1], sides[2], sides[3]])
  } else {
    // Re-link — collapse to the top value (arbitrary but predictable).
    updateStyle('padding', sides[0])
  }
}
function toggleRadiusLink() {
  const corners = radiusCorners.value
  if (radiusLinked.value) {
    updateStyle('backgroundRadius', [corners[0], corners[1], corners[2], corners[3]])
  } else {
    updateStyle('backgroundRadius', corners[0])
  }
}
function setPaddingSide(i: number, value: number) {
  const next = paddingSides.value.slice() as [number, number, number, number]
  next[i] = value
  updateStyle('padding', next)
}
function setRadiusCorner(i: number, value: number) {
  const next = radiusCorners.value.slice() as [number, number, number, number]
  next[i] = value
  updateStyle('backgroundRadius', next)
}
// Also ensure the font for whatever the currently selected element already
// uses — covers loading a template that references a non-curated font.
watch(() => (eff.value as any)?.style?.fontFamily, (fam) => ensureGoogleFont(fam), { immediate: true })

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
  <div v-if="selectedElement && eff" class="flex flex-col h-full overflow-y-auto">
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

    <!-- Variant cycler — visible when this element is wired to a TextList
         (or any multi-entry source) via the SmartLayout's text_layer_<N>
         socket. Picks which variant the canvas previews; the rendered
         output at run time still fans out one image per variant. -->
    <div
      v-if="variantsForSelected.length > 1"
      class="px-4 py-3 border-b border-action/15 bg-action/[0.04] flex flex-col gap-2"
    >
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-[#c9d6ff]/85 font-medium">
          <Layers class="size-3" />
          <span>Variant {{ activeVariantIdx + 1 }} of {{ variantsForSelected.length }}</span>
        </div>
        <div class="flex items-center gap-0.5">
          <button
            class="size-6 rounded hover:bg-action/15 flex items-center justify-center text-white/65 hover:text-white cursor-pointer transition-colors"
            title="Previous variant"
            @click="prevVariant"
          >
            <ChevronLeft class="size-3.5" />
          </button>
          <button
            class="size-6 rounded hover:bg-action/15 flex items-center justify-center text-white/65 hover:text-white cursor-pointer transition-colors"
            title="Next variant"
            @click="nextVariant"
          >
            <ChevronRight class="size-3.5" />
          </button>
        </div>
      </div>
      <div class="text-[11px] text-white/65 leading-snug italic line-clamp-3 font-mono">
        "{{ variantsForSelected[activeVariantIdx] }}"
      </div>
      <div class="text-[10px] text-white/35 leading-snug">
        Render time still produces one image per variant — this picker is just
        for fine-tuning the layout against each version.
      </div>
    </div>

    <!-- Override-mode banner: lets the user know writes will land in the
         current aspect's override delta, not on the base. -->
    <div
      v-if="editingOverride"
      class="px-4 py-2.5 border-b border-action/15 bg-action/[0.06] flex items-center justify-between gap-3"
    >
      <div class="text-[11px] leading-snug text-[#c9d6ff]">
        Editing <span class="font-medium">{{ currentAspect }}</span> overrides.
        Default is <span class="font-medium">{{ defaultAspect }}</span>.
      </div>
      <button
        class="text-[10px] text-[#c9d6ff]/70 hover:text-white px-1.5 py-0.5 rounded hover:bg-action/15 transition-colors cursor-pointer whitespace-nowrap"
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
            class="text-[9px] text-action hover:text-white px-1 py-0.5 rounded hover:bg-action/15 transition-colors cursor-pointer inline-flex items-center gap-0.5"
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
              ? 'bg-action/30 ring-1 ring-action'
              : 'hover:bg-white/[0.06]'"
            :title="a"
            @click="update('anchor', a)"
          >
            <div
              class="size-1.5 rounded-full mx-auto"
              :class="eff.anchor === a ? 'bg-action' : 'bg-white/30'"
            />
          </button>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <label class="block">
          <div class="flex items-center gap-1.5 mb-1">
            <div class="text-[11px] text-white/55">Offset X</div>
            <button v-if="hasOv('offset')" class="text-[9px] text-action hover:text-white px-1 py-0.5 rounded hover:bg-action/15 transition-colors cursor-pointer" title="Reset to default" @click="resetField('offset')"><XIcon class="size-2.5 inline" /></button>
          </div>
          <input
            :value="lengthStr(eff.offset.x)"
            class="w-full h-8 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white focus:outline-none focus:border-action/50"
            placeholder="60 or 8%"
            @change="(e) => setOffset((e.target as HTMLInputElement).value)"
          />
        </label>
        <label class="block">
          <div class="text-[11px] text-white/55 mb-1">Offset Y</div>
          <input
            :value="lengthStr(eff.offset.y)"
            class="w-full h-8 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white focus:outline-none focus:border-action/50"
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
        <button v-if="hasOv('size')" class="text-[9px] text-action hover:text-white px-1 py-0.5 rounded hover:bg-action/15 transition-colors cursor-pointer" title="Reset to default" @click="resetField('size')"><XIcon class="size-2.5 inline" /></button>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <label class="block">
          <div class="text-[11px] text-white/55 mb-1">Width</div>
          <input
            :value="lengthStr(eff.size.w)"
            class="w-full h-8 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white focus:outline-none focus:border-action/50"
            placeholder="200, 60%, auto, fill"
            @change="(e) => setSize((e.target as HTMLInputElement).value)"
          />
        </label>
        <label class="block">
          <div class="text-[11px] text-white/55 mb-1">Height</div>
          <input
            :value="lengthStr(eff.size.h)"
            class="w-full h-8 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white focus:outline-none focus:border-action/50"
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
          <button v-if="hasOv('content' as any)" class="text-[9px] text-action hover:text-white px-1 py-0.5 rounded hover:bg-action/15 transition-colors cursor-pointer" title="Reset to default" @click="resetField('content' as any)"><XIcon class="size-2.5 inline" /></button>
        </div>
        <textarea
          :value="(eff as any).content"
          rows="2"
          class="w-full px-2 py-1.5 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white font-mono focus:outline-none focus:border-action/50"
          @change="(e) => update('content' as any, (e.target as HTMLTextAreaElement).value)"
        />
      </label>
      <div>
        <div class="flex items-center gap-1.5 mb-1">
          <div class="text-[11px] text-white/55">Font</div>
          <button v-if="hasStyleOv('fontFamily')" class="text-[9px] text-action hover:text-white px-1 py-0.5 rounded hover:bg-action/15 transition-colors cursor-pointer" title="Reset to default" @click="resetStyleField('fontFamily')"><XIcon class="size-2.5 inline" /></button>
        </div>
        <TemplatesFontPicker
          :model-value="(eff as any).style?.fontFamily ?? 'Inter'"
          @update:model-value="applyFontFamily"
        />
      </div>
      <div class="grid grid-cols-2 gap-2">
        <label class="block">
          <div class="flex items-center gap-1.5 mb-1">
            <div class="text-[11px] text-white/55">Size (px)</div>
            <button v-if="hasStyleOv('fontSize')" class="text-[9px] text-action hover:text-white px-1 py-0.5 rounded hover:bg-action/15 transition-colors cursor-pointer" title="Reset to default" @click="resetStyleField('fontSize')"><XIcon class="size-2.5 inline" /></button>
          </div>
          <input
            type="number"
            :value="(eff as any).style?.fontSize ?? 48"
            class="w-full h-8 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white focus:outline-none focus:border-action/50"
            @change="(e) => updateStyle('fontSize', Number((e.target as HTMLInputElement).value))"
          />
        </label>
        <label class="block">
          <div class="flex items-center gap-1.5 mb-1">
            <div class="text-[11px] text-white/55">Weight</div>
            <button v-if="hasStyleOv('fontWeight')" class="text-[9px] text-action hover:text-white px-1 py-0.5 rounded hover:bg-action/15 transition-colors cursor-pointer" title="Reset to default" @click="resetStyleField('fontWeight')"><XIcon class="size-2.5 inline" /></button>
          </div>
          <select
            :value="(eff as any).style?.fontWeight ?? 400"
            class="w-full h-8 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white focus:outline-none focus:border-action/50"
            @change="(e) => updateStyle('fontWeight', Number((e.target as HTMLSelectElement).value))"
          >
            <option value="400">Regular</option>
            <option value="700">Bold</option>
          </select>
        </label>
      </div>
      <!-- Auto-fit: shrink fontSize so text fits the bbox. Treat `Size (px)`
           above as the max; `Min size` is the floor. Same logic runs editor-
           side (DOM measure) and server-side (opentype measure) for parity. -->
      <div class="flex items-center justify-between gap-2">
        <label class="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
          <input
            type="checkbox"
            :checked="!!(eff as any).style?.autoFit"
            class="size-3.5 accent-action cursor-pointer"
            @change="(e) => updateStyle('autoFit', (e.target as HTMLInputElement).checked)"
          />
          <span class="text-[11px] text-white/70">Auto-fit to box</span>
          <button v-if="hasStyleOv('autoFit')" class="text-[9px] text-action hover:text-white px-1 py-0.5 rounded hover:bg-action/15 transition-colors cursor-pointer" title="Reset to default" @click.stop.prevent="resetStyleField('autoFit')"><XIcon class="size-2.5 inline" /></button>
        </label>
        <label v-if="(eff as any).style?.autoFit" class="flex items-center gap-1.5 shrink-0">
          <span class="text-[10px] text-white/45">Min</span>
          <input
            type="number"
            :value="(eff as any).style?.minSize ?? 12"
            min="6"
            max="200"
            class="w-14 h-7 px-1.5 bg-white/[0.04] border border-white/[0.06] rounded text-[11px] text-white focus:outline-none focus:border-action/50"
            @change="(e) => updateStyle('minSize', Number((e.target as HTMLInputElement).value))"
          />
        </label>
      </div>
      <!-- Color + glyph stroke live with the other glyph-level controls. -->
      <label class="block">
        <div class="flex items-center gap-1.5 mb-1">
          <div class="text-[11px] text-white/55">Color</div>
          <button v-if="hasStyleOv('color')" class="text-[9px] text-action hover:text-white px-1 py-0.5 rounded hover:bg-action/15 transition-colors cursor-pointer" title="Reset to default" @click="resetStyleField('color')"><XIcon class="size-2.5 inline" /></button>
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
            class="flex-1 h-8 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white font-mono focus:outline-none focus:border-action/50"
            placeholder="#ffffff or {{ brand.foreground }}"
            @change="(e) => updateStyle('color', (e.target as HTMLInputElement).value)"
          />
        </div>
      </label>
      <label class="block">
        <div class="flex items-center gap-1.5 mb-1">
          <div class="text-[11px] text-white/55">Glyph stroke</div>
          <button v-if="hasStyleOv('strokeColor') || hasStyleOv('strokeWidth') || hasStyleOv('strokePlacement')" class="text-[9px] text-action hover:text-white px-1 py-0.5 rounded hover:bg-action/15 transition-colors cursor-pointer" title="Reset to default" @click="() => { resetStyleField('strokeColor'); resetStyleField('strokeWidth'); resetStyleField('strokePlacement') }"><XIcon class="size-2.5 inline" /></button>
        </div>
        <div class="flex items-center gap-2">
          <input
            type="color"
            :value="(eff as any).style?.strokeColor ?? '#000000'"
            class="size-8 rounded cursor-pointer bg-transparent border border-white/[0.06]"
            @input="(e) => updateStyle('strokeColor', (e.target as HTMLInputElement).value)"
          />
          <input
            type="number"
            min="0"
            step="0.5"
            :value="(eff as any).style?.strokeWidth ?? 0"
            placeholder="Width"
            class="w-20 h-8 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white focus:outline-none focus:border-action/50"
            @change="(e) => updateStyle('strokeWidth', Number((e.target as HTMLInputElement).value))"
          />
          <span class="text-[10px] text-white/35">px</span>
        </div>
        <div class="mt-1.5 grid grid-cols-3 gap-0.5 rounded border border-white/[0.06] p-0.5 bg-white/[0.02]">
          <button
            v-for="p in (['inside', 'center', 'outside'] as const)"
            :key="p"
            class="h-6 text-[10px] rounded transition-colors cursor-pointer capitalize"
            :class="(((eff as any).style?.strokePlacement ?? 'center') === p)
              ? 'bg-action/25 text-white'
              : 'text-white/55 hover:bg-white/[0.06]'"
            @click="updateStyle('strokePlacement', p)"
          >{{ p }}</button>
        </div>
      </label>
      <label class="block">
        <div class="flex items-center gap-1.5 mb-1">
          <div class="text-[11px] text-white/55">Align</div>
          <button v-if="hasStyleOv('align')" class="text-[9px] text-action hover:text-white px-1 py-0.5 rounded hover:bg-action/15 transition-colors cursor-pointer" title="Reset to default" @click="resetStyleField('align')"><XIcon class="size-2.5 inline" /></button>
        </div>
        <div class="grid grid-cols-3 gap-0.5 rounded border border-white/[0.06] p-0.5 bg-white/[0.02]">
          <button
            v-for="a in (['left', 'center', 'right'] as const)"
            :key="a"
            class="h-7 text-[11px] rounded transition-colors cursor-pointer"
            :class="(((eff as any).style?.align ?? 'left') === a)
              ? 'bg-action/25 text-white'
              : 'text-white/55 hover:bg-white/[0.06]'"
            @click="updateStyle('align', a)"
          >{{ a }}</button>
        </div>
      </label>
    </div>

    <!-- Container — everything about the box that wraps the glyphs. Kept in
         its own section so glyph properties above don't get tangled with
         box-level fill/padding/border. -->
    <div v-if="selectedElement.type === 'text'" class="px-4 py-3 border-b border-white/[0.06] flex flex-col gap-3">
      <div class="text-[10px] uppercase tracking-[0.12em] text-white/35 font-medium">Container</div>
      <label class="block">
        <div class="flex items-center gap-1.5 mb-1">
          <div class="text-[11px] text-white/55">Background</div>
          <button v-if="hasStyleOv('backgroundColor')" class="text-[9px] text-action hover:text-white px-1 py-0.5 rounded hover:bg-action/15 transition-colors cursor-pointer" title="Reset to default" @click="resetStyleField('backgroundColor')"><XIcon class="size-2.5 inline" /></button>
        </div>
        <div class="flex items-center gap-2">
          <input
            type="color"
            :value="(eff as any).style?.backgroundColor ?? '#000000'"
            class="size-8 rounded cursor-pointer bg-transparent border border-white/[0.06]"
            @input="(e) => updateStyle('backgroundColor', (e.target as HTMLInputElement).value)"
          />
          <input
            :value="(eff as any).style?.backgroundColor ?? ''"
            class="flex-1 h-8 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white font-mono focus:outline-none focus:border-action/50"
            placeholder="transparent — type a color"
            @change="(e) => updateStyle('backgroundColor', (e.target as HTMLInputElement).value || undefined)"
          />
        </div>
      </label>
      <div class="block">
        <div class="flex items-center gap-1.5 mb-1">
          <div class="text-[11px] text-white/55">Padding (px)</div>
          <button class="text-[9px] text-white/45 hover:text-white px-1 py-0.5 rounded hover:bg-white/[0.06] transition-colors cursor-pointer" :title="paddingLinked ? 'Set per side' : 'Link all sides'" @click="togglePaddingLink">
            {{ paddingLinked ? '⛓' : '⌗' }}
          </button>
          <button v-if="hasStyleOv('padding')" class="text-[9px] text-action hover:text-white px-1 py-0.5 rounded hover:bg-action/15 transition-colors cursor-pointer" title="Reset to default" @click="resetStyleField('padding')"><XIcon class="size-2.5 inline" /></button>
        </div>
        <input
          v-if="paddingLinked"
          type="number"
          min="0"
          :value="paddingSides[0]"
          class="w-full h-8 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white focus:outline-none focus:border-action/50"
          @change="(e) => updateStyle('padding', Number((e.target as HTMLInputElement).value))"
        />
        <div v-else class="grid grid-cols-4 gap-1">
          <label v-for="(side, i) in ['top','right','bottom','left']" :key="side" class="block">
            <input
              type="number"
              min="0"
              :value="paddingSides[i]"
              :title="['Top','Right','Bottom','Left'][i]"
              class="w-full h-8 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[11px] text-white text-center focus:outline-none focus:border-action/50"
              @change="(e) => setPaddingSide(i, Number((e.target as HTMLInputElement).value))"
            />
            <!-- Tiny 3x3 square with one edge highlighted to label the side. -->
            <div class="flex justify-center mt-1">
              <div
                class="size-3 border border-white/25"
                :style="{
                  borderTopColor:    side === 'top'    ? 'var(--action)' : undefined,
                  borderRightColor:  side === 'right'  ? 'var(--action)' : undefined,
                  borderBottomColor: side === 'bottom' ? 'var(--action)' : undefined,
                  borderLeftColor:   side === 'left'   ? 'var(--action)' : undefined,
                  borderTopWidth:    side === 'top'    ? '2px' : undefined,
                  borderRightWidth:  side === 'right'  ? '2px' : undefined,
                  borderBottomWidth: side === 'bottom' ? '2px' : undefined,
                  borderLeftWidth:   side === 'left'   ? '2px' : undefined,
                }"
              />
            </div>
          </label>
        </div>
      </div>
      <div class="block">
        <div class="flex items-center gap-1.5 mb-1">
          <div class="text-[11px] text-white/55">Radius (px)</div>
          <button class="text-[9px] text-white/45 hover:text-white px-1 py-0.5 rounded hover:bg-white/[0.06] transition-colors cursor-pointer" :title="radiusLinked ? 'Set per corner' : 'Link all corners'" @click="toggleRadiusLink">
            {{ radiusLinked ? '⛓' : '⌗' }}
          </button>
          <button v-if="hasStyleOv('backgroundRadius')" class="text-[9px] text-action hover:text-white px-1 py-0.5 rounded hover:bg-action/15 transition-colors cursor-pointer" title="Reset to default" @click="resetStyleField('backgroundRadius')"><XIcon class="size-2.5 inline" /></button>
        </div>
        <input
          v-if="radiusLinked"
          type="number"
          min="0"
          :value="radiusCorners[0]"
          class="w-full h-8 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white focus:outline-none focus:border-action/50"
          @change="(e) => updateStyle('backgroundRadius', Number((e.target as HTMLInputElement).value))"
        />
        <div v-else class="grid grid-cols-4 gap-1">
          <label v-for="(corner, i) in ['tl','tr','br','bl']" :key="corner" class="block">
            <input
              type="number"
              min="0"
              :value="radiusCorners[i]"
              :title="['Top-left','Top-right','Bottom-right','Bottom-left'][i]"
              class="w-full h-8 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[11px] text-white text-center focus:outline-none focus:border-action/50"
              @change="(e) => setRadiusCorner(i, Number((e.target as HTMLInputElement).value))"
            />
            <!-- Tiny 3x3 square with one corner rounded, indicating which one
                 this input controls. The other corners stay sharp. -->
            <div class="flex justify-center mt-1">
              <div
                class="size-3 border border-white/55"
                :style="{
                  borderTopLeftRadius:     corner === 'tl' ? '6px' : '0',
                  borderTopRightRadius:    corner === 'tr' ? '6px' : '0',
                  borderBottomRightRadius: corner === 'br' ? '6px' : '0',
                  borderBottomLeftRadius:  corner === 'bl' ? '6px' : '0',
                }"
              />
            </div>
          </label>
        </div>
      </div>
      <label class="block">
        <div class="flex items-center gap-1.5 mb-1">
          <div class="text-[11px] text-white/55">Border</div>
          <button v-if="hasStyleOv('borderColor') || hasStyleOv('borderWidth') || hasStyleOv('borderPlacement')" class="text-[9px] text-action hover:text-white px-1 py-0.5 rounded hover:bg-action/15 transition-colors cursor-pointer" title="Reset to default" @click="() => { resetStyleField('borderColor'); resetStyleField('borderWidth'); resetStyleField('borderPlacement') }"><XIcon class="size-2.5 inline" /></button>
        </div>
        <div class="flex items-center gap-2">
          <input
            type="color"
            :value="(eff as any).style?.borderColor ?? '#000000'"
            class="size-8 rounded cursor-pointer bg-transparent border border-white/[0.06]"
            @input="(e) => updateStyle('borderColor', (e.target as HTMLInputElement).value)"
          />
          <input
            type="number"
            min="0"
            step="0.5"
            :value="(eff as any).style?.borderWidth ?? 0"
            placeholder="Width"
            class="w-20 h-8 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white focus:outline-none focus:border-action/50"
            @change="(e) => updateStyle('borderWidth', Number((e.target as HTMLInputElement).value))"
          />
          <span class="text-[10px] text-white/35">px</span>
        </div>
        <div class="mt-1.5 grid grid-cols-3 gap-0.5 rounded border border-white/[0.06] p-0.5 bg-white/[0.02]">
          <button
            v-for="p in (['inside', 'center', 'outside'] as const)"
            :key="p"
            class="h-6 text-[10px] rounded transition-colors cursor-pointer capitalize"
            :class="(((eff as any).style?.borderPlacement ?? 'center') === p)
              ? 'bg-action/25 text-white'
              : 'text-white/55 hover:bg-white/[0.06]'"
            @click="updateStyle('borderPlacement', p)"
          >{{ p }}</button>
        </div>
      </label>
    </div>

    <div v-else-if="selectedElement.type === 'image'" class="px-4 py-3 border-b border-white/[0.06] flex flex-col gap-3">
      <div class="text-[10px] uppercase tracking-[0.12em] text-white/35 font-medium">Image</div>
      <label class="block">
        <div class="flex items-center gap-1.5 mb-1">
          <div class="text-[11px] text-white/55">Source (URL or token)</div>
          <button v-if="hasOv('content' as any)" class="text-[9px] text-action hover:text-white px-1 py-0.5 rounded hover:bg-action/15 transition-colors cursor-pointer" title="Reset to default" @click="resetField('content' as any)"><XIcon class="size-2.5 inline" /></button>
        </div>
        <input
          :value="(eff as any).content"
          class="w-full h-8 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white font-mono focus:outline-none focus:border-action/50"
          placeholder="https://… or {{ props.hero }}"
          @change="(e) => update('content' as any, (e.target as HTMLInputElement).value)"
        />
      </label>
      <label class="block">
        <div class="flex items-center gap-1.5 mb-1">
          <div class="text-[11px] text-white/55">Fit</div>
          <button v-if="hasStyleOv('fit')" class="text-[9px] text-action hover:text-white px-1 py-0.5 rounded hover:bg-action/15 transition-colors cursor-pointer" title="Reset to default" @click="resetStyleField('fit')"><XIcon class="size-2.5 inline" /></button>
        </div>
        <select
          :value="(eff as any).style?.fit ?? 'cover'"
          class="w-full h-8 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white focus:outline-none focus:border-action/50"
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
          <button v-if="hasStyleOv('borderRadius')" class="text-[9px] text-action hover:text-white px-1 py-0.5 rounded hover:bg-action/15 transition-colors cursor-pointer" title="Reset to default" @click="resetStyleField('borderRadius')"><XIcon class="size-2.5 inline" /></button>
        </div>
        <input
          type="number"
          :value="(eff as any).style?.borderRadius ?? 0"
          class="w-full h-8 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white focus:outline-none focus:border-action/50"
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
              ? 'bg-action/25 text-white'
              : 'text-white/55 hover:bg-white/[0.06]'"
            @click="updateBase('shape' as any, s)"
          >{{ s }}</button>
        </div>
      </label>
      <label class="block">
        <div class="flex items-center gap-1.5 mb-1">
          <div class="text-[11px] text-white/55">Fill</div>
          <button v-if="hasStyleOv('fill')" class="text-[9px] text-action hover:text-white px-1 py-0.5 rounded hover:bg-action/15 transition-colors cursor-pointer" title="Reset to default" @click="resetStyleField('fill')"><XIcon class="size-2.5 inline" /></button>
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
            class="flex-1 h-8 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white font-mono focus:outline-none focus:border-action/50"
            @change="(e) => updateStyle('fill', (e.target as HTMLInputElement).value)"
          />
        </div>
      </label>
      <label v-if="(selectedElement as ShapeElement).shape === 'rect'" class="block">
        <div class="flex items-center gap-1.5 mb-1">
          <div class="text-[11px] text-white/55">Border radius (px)</div>
          <button v-if="hasStyleOv('borderRadius')" class="text-[9px] text-action hover:text-white px-1 py-0.5 rounded hover:bg-action/15 transition-colors cursor-pointer" title="Reset to default" @click="resetStyleField('borderRadius')"><XIcon class="size-2.5 inline" /></button>
        </div>
        <input
          type="number"
          :value="(eff as any).style?.borderRadius ?? 0"
          class="w-full h-8 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white focus:outline-none focus:border-action/50"
          @change="(e) => updateStyle('borderRadius', Number((e.target as HTMLInputElement).value))"
        />
      </label>
    </div>
  </div>
</template>
