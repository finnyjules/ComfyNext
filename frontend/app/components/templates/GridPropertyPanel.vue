<script setup lang="ts">
/**
 * Property panel for the v2 (Swiss grid) editor. Region edits go through
 * setRegion so master vs format-class semantics live in one place; everything
 * else patches the element directly (v2 has no per-aspect style overrides).
 */
import { ChevronLeft, ChevronRight, Layers, Trash2, Type as TypeIcon, Image as ImageIcon, Square } from 'lucide-vue-next'

import { useGoogleFontPreview } from '~/composables/useTemplateFonts'
import type { GridEditorContext } from '~/composables/useGridEditor'
import type { Region, TextElementV2 } from '~~/shared/template-grid/types'

const ctx = inject<GridEditorContext>('gridEditor')!
const {
  metrics, formatClass, isMaster, currentFormat,
  selectedElement, selectedResolved, sampleProps,
  setRegion, hasClassRegion, clearClassRegion,
  patchElement, patchStyle, removeElement,
} = ctx

const el = selectedElement
const region = computed<Region | null>(() => selectedResolved.value?.region ?? null)

function setRegionField(field: keyof Region, raw: string) {
  if (!el.value || !region.value) return
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n)) return
  const m = metrics.value
  const next = { ...region.value, [field]: n }
  next.col = Math.min(m.cols, Math.max(1, next.col))
  next.row = Math.min(m.rows, Math.max(1, next.row))
  next.colSpan = Math.min(m.cols - next.col + 1, Math.max(1, next.colSpan))
  next.rowSpan = Math.min(m.rows - next.row + 1, Math.max(1, next.rowSpan))
  setRegion(el.value.id, next)
}

/** Give a slotless (culled) element a region in the current class. */
function placeHere() {
  if (!el.value) return
  const m = metrics.value
  setRegion(el.value.id, { col: 1, colSpan: Math.min(3, m.cols), row: 1, rowSpan: 1 })
}

function styleOf(): Record<string, any> {
  return (el.value as any)?.style ?? {}
}

const textEl = computed(() => (el.value?.type === 'text' ? el.value as TextElementV2 : null))

// -- Variant cycler (multi-entry upstream Text nodes) ------------------------
// Provided by SmartLayoutEditorModal; layer ids match element ids.
const variantCtx = inject<{
  variantsByLayer: { value: Record<string, string[]> }
  activeVariantByLayer: { value: Record<string, number> }
} | null>('smartLayoutVariants', null)

const variantsForSelected = computed<string[]>(() => {
  if (!variantCtx || !el.value) return []
  return variantCtx.variantsByLayer.value[el.value.id] ?? []
})
const activeVariantIdx = computed<number>({
  get() {
    if (!variantCtx || !el.value) return 0
    const n = variantsForSelected.value.length
    return Math.min(Math.max(0, variantCtx.activeVariantByLayer.value[el.value.id] ?? 0), Math.max(0, n - 1))
  },
  set(v) {
    if (!variantCtx || !el.value) return
    variantCtx.activeVariantByLayer.value = {
      ...variantCtx.activeVariantByLayer.value,
      [el.value.id]: v,
    }
  },
})
function cycleVariant(dir: 1 | -1) {
  const n = variantsForSelected.value.length
  if (n < 2) return
  activeVariantIdx.value = (activeVariantIdx.value + dir + n) % n
}

// -- Font preview loading -----------------------------------------------------
const { ensure: ensureFont } = useGoogleFontPreview()
function setFontFamily(family: string) {
  if (!el.value) return
  ensureFont(family)
  patchStyle(el.value.id, { fontFamily: family })
}

/** Placeholder for the size input: the level-derived size in master px. */
const levelSizePlaceholder = computed(() => {
  if (!textEl.value) return ''
  const t = ctx.template.value
  const idx = ['caption', 'body', 'subhead', 'headline', 'display'].indexOf(textEl.value.level)
  return String(Math.round(t.typeScale.base * t.typeScale.ratio ** idx))
})

const focalSrc = computed(() => {
  if (el.value?.type !== 'image') return undefined
  const resolved = String(el.value.content ?? '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
    const [scope, key] = path.split('.')
    return scope === 'props' ? String((sampleProps.value as any)[key] ?? '') : ''
  })
  return resolved.startsWith('http') || resolved.startsWith('/') ? resolved : undefined
})

const inputCls = 'w-full h-7 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white focus:outline-none focus:border-[#96b4ff]/50'
const labelCls = 'text-[10px] uppercase tracking-[0.12em] text-white/35'
const btnRowCls = 'flex-1 h-7 rounded text-[11px] transition-colors cursor-pointer'
</script>

<template>
  <div v-if="el" class="h-full overflow-y-auto p-3 flex flex-col gap-4">
    <!-- Header -->
    <div class="flex items-center gap-2">
      <component
        :is="el.type === 'text' ? TypeIcon : el.type === 'image' ? ImageIcon : Square"
        class="size-3.5 text-white/45 shrink-0"
      />
      <input
        :value="el.id"
        :class="inputCls"
        @change="(e: any) => patchElement(el!.id, { id: e.target.value })"
      >
      <button
        class="size-7 shrink-0 rounded flex items-center justify-center text-white/40 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
        title="Delete element"
        @click="removeElement(el.id)"
      >
        <Trash2 class="size-3.5" />
      </button>
    </div>

    <!-- Variant cycler — visible when this element is wired to a multi-entry
         Text node. Picks which variant the canvas previews; run time still
         fans out one image per variant. -->
    <div v-if="variantsForSelected.length > 1" class="rounded-md bg-[#96b4ff]/[0.06] border border-[#96b4ff]/15 px-2.5 py-2 flex flex-col gap-1.5">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-[#c9d6ff]/85 font-medium">
          <Layers class="size-3" />
          <span>Variant {{ activeVariantIdx + 1 }} of {{ variantsForSelected.length }}</span>
        </div>
        <div class="flex items-center gap-0.5">
          <button class="size-6 rounded hover:bg-[#96b4ff]/15 flex items-center justify-center text-white/65 hover:text-white cursor-pointer transition-colors" title="Previous variant" @click="cycleVariant(-1)">
            <ChevronLeft class="size-3.5" />
          </button>
          <button class="size-6 rounded hover:bg-[#96b4ff]/15 flex items-center justify-center text-white/65 hover:text-white cursor-pointer transition-colors" title="Next variant" @click="cycleVariant(1)">
            <ChevronRight class="size-3.5" />
          </button>
        </div>
      </div>
      <div class="text-[11px] text-white/65 leading-snug italic line-clamp-3 font-mono">
        "{{ variantsForSelected[activeVariantIdx] }}"
      </div>
      <div class="text-[10px] text-white/35 leading-snug">
        Run time renders one image per variant — this just picks which one to lay out against.
      </div>
    </div>

    <!-- Format-class banner -->
    <div v-if="!isMaster" class="rounded-md bg-[#96b4ff]/[0.08] border border-[#96b4ff]/20 px-2.5 py-2 text-[11px] text-[#c9d6ff]/90 leading-snug">
      Editing <span class="font-medium">{{ formatClass }}</span> placement — applies to every {{ formatClass }} format, not just {{ currentFormat }}.
      <button
        v-if="hasClassRegion(el.id)"
        class="mt-1.5 block text-[11px] text-[#96b4ff] hover:text-white transition-colors cursor-pointer underline underline-offset-2"
        @click="clearClassRegion(el.id)"
      >
        Reset to automatic placement
      </button>
    </div>

    <!-- Region -->
    <div>
      <p :class="labelCls" class="mb-1.5">Grid region</p>
      <div v-if="region" class="grid grid-cols-2 gap-2">
        <label class="flex items-center gap-1.5">
          <span class="text-[11px] text-white/40 w-8">Col</span>
          <input type="number" min="1" :max="metrics.cols" :value="region.col" :class="inputCls" @change="(e: any) => setRegionField('col', e.target.value)">
        </label>
        <label class="flex items-center gap-1.5">
          <span class="text-[11px] text-white/40 w-8">Span</span>
          <input type="number" min="1" :max="metrics.cols" :value="region.colSpan" :class="inputCls" @change="(e: any) => setRegionField('colSpan', e.target.value)">
        </label>
        <label class="flex items-center gap-1.5">
          <span class="text-[11px] text-white/40 w-8">Row</span>
          <input type="number" min="1" :max="metrics.rows" :value="region.row" :class="inputCls" @change="(e: any) => setRegionField('row', e.target.value)">
        </label>
        <label class="flex items-center gap-1.5">
          <span class="text-[11px] text-white/40 w-8">Span</span>
          <input type="number" min="1" :max="metrics.rows" :value="region.rowSpan" :class="inputCls" @change="(e: any) => setRegionField('rowSpan', e.target.value)">
        </label>
      </div>
      <button
        v-else
        class="w-full h-8 rounded-md bg-amber-500/10 border border-amber-500/25 text-[11px] text-amber-200/90 hover:bg-amber-500/20 transition-colors cursor-pointer"
        @click="placeHere"
      >
        Culled in this format — place it here
      </button>
    </div>

    <!-- Priority -->
    <div>
      <p :class="labelCls" class="mb-1.5">Priority</p>
      <input
        type="number" min="1" max="9" :value="el.priority" :class="inputCls"
        @change="(e: any) => patchElement(el!.id, { priority: Math.max(1, Math.round(Number(e.target.value)) || 1) })"
      >
      <p class="mt-1 text-[10px] text-white/30">1 = most important; survives longest on small formats.</p>
    </div>

    <!-- Text -->
    <template v-if="textEl">
      <div>
        <p :class="labelCls" class="mb-1.5">Content</p>
        <textarea
          :value="textEl.content"
          rows="3"
          :class="inputCls"
          class="h-auto py-1.5 resize-y"
          @change="(e: any) => patchElement(el!.id, { content: e.target.value })"
        />
      </div>
      <div>
        <p :class="labelCls" class="mb-1.5">Font</p>
        <TemplatesFontPicker
          :model-value="styleOf().fontFamily ?? 'Inter'"
          @update:model-value="setFontFamily"
        />
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div>
          <p :class="labelCls" class="mb-1.5">Level</p>
          <select :value="textEl.level" :class="inputCls" @change="(e: any) => patchElement(el!.id, { level: e.target.value })">
            <option v-for="l in ['display', 'headline', 'subhead', 'body', 'caption']" :key="l" :value="l">{{ l }}</option>
          </select>
        </div>
        <div>
          <p :class="labelCls" class="mb-1.5" title="Master-format px. Still scales per format and auto-fits.">Size (px)</p>
          <input
            type="number" min="1" :value="styleOf().fontSize ?? ''" :placeholder="levelSizePlaceholder" :class="inputCls"
            @change="(e: any) => patchStyle(el!.id, { fontSize: e.target.value ? Math.max(1, Math.round(Number(e.target.value))) : undefined })"
          >
        </div>
        <div>
          <p :class="labelCls" class="mb-1.5">Weight</p>
          <select :value="styleOf().fontWeight ?? 400" :class="inputCls" @change="(e: any) => patchStyle(el!.id, { fontWeight: Number(e.target.value) })">
            <option :value="400">Regular</option>
            <option :value="700">Bold</option>
          </select>
        </div>
        <div>
          <p :class="labelCls" class="mb-1.5">Case</p>
          <select :value="styleOf().transform ?? 'none'" :class="inputCls" @change="(e: any) => patchStyle(el!.id, { transform: e.target.value === 'none' ? undefined : e.target.value })">
            <option value="none">As typed</option>
            <option value="uppercase">UPPERCASE</option>
          </select>
        </div>
        <div>
          <p :class="labelCls" class="mb-1.5" title="Unitless multiplier">Line height</p>
          <input
            type="number" step="0.05" min="0.5" :value="styleOf().lineHeight ?? 1.1" :class="inputCls"
            @change="(e: any) => patchStyle(el!.id, { lineHeight: Math.max(0.5, Number(e.target.value) || 1.1) })"
          >
        </div>
        <div>
          <p :class="labelCls" class="mb-1.5" title="Kerning, px">Letter spacing</p>
          <input
            type="number" step="0.5" :value="styleOf().letterSpacing ?? 0" :class="inputCls"
            @change="(e: any) => patchStyle(el!.id, { letterSpacing: Number(e.target.value) || 0 })"
          >
        </div>
        <div>
          <p :class="labelCls" class="mb-1.5">Overflow</p>
          <select :value="textEl.overflow ?? 'shrink-then-truncate'" :class="inputCls" @change="(e: any) => patchElement(el!.id, { overflow: e.target.value })">
            <option value="shrink-then-truncate">Shrink, then …</option>
            <option value="shrink">Shrink only</option>
            <option value="grow">Grow downward</option>
          </select>
        </div>
        <div>
          <p :class="labelCls" class="mb-1.5">Max lines</p>
          <input
            type="number" min="1" :value="textEl.maxLines ?? ''" placeholder="auto" :class="inputCls"
            @change="(e: any) => patchElement(el!.id, { maxLines: e.target.value ? Math.max(1, Math.round(Number(e.target.value))) : undefined })"
          >
        </div>
      </div>
      <div>
        <p :class="labelCls" class="mb-1.5">Align</p>
        <div class="flex gap-1 mb-2">
          <button
            v-for="a in ['left', 'center', 'right']" :key="a" :class="[btnRowCls, (styleOf().align ?? 'left') === a ? 'bg-[#96b4ff]/20 text-[#c9d6ff]' : 'bg-white/[0.04] text-white/50 hover:bg-white/[0.08]']"
            @click="patchStyle(el!.id, { align: a })"
          >{{ a }}</button>
        </div>
        <div class="flex gap-1">
          <button
            v-for="v in ['top', 'middle', 'bottom']" :key="v" :class="[btnRowCls, (styleOf().valign ?? 'top') === v ? 'bg-[#96b4ff]/20 text-[#c9d6ff]' : 'bg-white/[0.04] text-white/50 hover:bg-white/[0.08]']"
            @click="patchStyle(el!.id, { valign: v })"
          >{{ v }}</button>
        </div>
      </div>
      <div>
        <p :class="labelCls" class="mb-1.5">Color</p>
        <div class="flex gap-2">
          <input
            type="color" :value="styleOf().color ?? '#ffffff'"
            class="size-7 shrink-0 rounded border border-white/[0.06] bg-transparent cursor-pointer"
            @input="(e: any) => patchStyle(el!.id, { color: e.target.value })"
          >
          <input
            :value="styleOf().color ?? '#ffffff'" :class="inputCls"
            @change="(e: any) => patchStyle(el!.id, { color: e.target.value })"
          >
        </div>
      </div>
    </template>

    <!-- Image -->
    <template v-else-if="el.type === 'image'">
      <div>
        <p :class="labelCls" class="mb-1.5">Source</p>
        <input
          :value="el.content" placeholder="URL or {{ props.image_layer_1 }}" :class="inputCls"
          @change="(e: any) => patchElement(el!.id, { content: e.target.value })"
        >
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div>
          <p :class="labelCls" class="mb-1.5">Fit</p>
          <select :value="styleOf().fit ?? 'cover'" :class="inputCls" @change="(e: any) => patchStyle(el!.id, { fit: e.target.value })">
            <option value="cover">Cover</option>
            <option value="contain">Contain</option>
            <option value="stretch">Stretch</option>
          </select>
        </div>
        <div>
          <p :class="labelCls" class="mb-1.5">Radius</p>
          <input
            type="number" min="0" :value="styleOf().borderRadius ?? 0" :class="inputCls"
            @change="(e: any) => patchStyle(el!.id, { borderRadius: Math.max(0, Number(e.target.value) || 0) })"
          >
        </div>
      </div>
      <label class="flex items-center gap-2 text-[12px] text-white/70 cursor-pointer">
        <input
          type="checkbox" :checked="el.collapse === 'mark'"
          @change="(e: any) => patchElement(el!.id, { collapse: e.target.checked ? 'mark' : undefined })"
        >
        Collapse to square mark on small formats (logo behaviour)
      </label>
      <div>
        <p :class="labelCls" class="mb-1.5">Focal point</p>
        <TemplatesFocalPointPicker
          :focal="el.focal ?? { x: 0.5, y: 0.5 }"
          :src="focalSrc"
          @change="(f) => patchElement(el!.id, { focal: f })"
        />
      </div>
    </template>

    <!-- Shape -->
    <template v-else-if="el.type === 'shape'">
      <div>
        <p :class="labelCls" class="mb-1.5">Shape</p>
        <div class="flex gap-1">
          <button
            v-for="s in ['rect', 'circle']" :key="s" :class="[btnRowCls, el.shape === s ? 'bg-[#96b4ff]/20 text-[#c9d6ff]' : 'bg-white/[0.04] text-white/50 hover:bg-white/[0.08]']"
            @click="patchElement(el!.id, { shape: s })"
          >{{ s }}</button>
        </div>
      </div>
      <div>
        <p :class="labelCls" class="mb-1.5">Fill</p>
        <div class="flex gap-2">
          <input
            type="color" :value="(styleOf().fill ?? '#000000').slice(0, 7)"
            class="size-7 shrink-0 rounded border border-white/[0.06] bg-transparent cursor-pointer"
            @input="(e: any) => patchStyle(el!.id, { fill: e.target.value })"
          >
          <input
            :value="styleOf().fill ?? '#000000'" :class="inputCls"
            @change="(e: any) => patchStyle(el!.id, { fill: e.target.value })"
          >
        </div>
      </div>
      <div v-if="el.shape === 'rect'">
        <p :class="labelCls" class="mb-1.5">Radius</p>
        <input
          type="number" min="0" :value="styleOf().borderRadius ?? 0" :class="inputCls"
          @change="(e: any) => patchStyle(el!.id, { borderRadius: Math.max(0, Number(e.target.value) || 0) })"
        >
      </div>
    </template>
  </div>
</template>
