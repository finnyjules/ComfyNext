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
  metrics, formatClass, isMaster, currentFormat, regionScope,
  selectedElement, selectedResolved, sampleProps, effectiveBrand,
  setRegion, hasClassRegion, clearClassRegion, hasFormatOverride, clearFormatOverride,
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

// -- Brand binding -----------------------------------------------------------
// A style value bound to a brand slot is stored as a `{{ brand.<key> }}` token
// and resolved live from the brand kit. Only show swatches for slots the kit
// actually defines.

const BRAND_COLOR_SLOTS = ['primary', 'secondary', 'accent', 'foreground', 'background'] as const
const brandColorSlots = computed(() =>
  BRAND_COLOR_SLOTS.filter(k => typeof (effectiveBrand.value as any)[k] === 'string'))

function brandTokenKey(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = v.match(/^\{\{\s*brand\.(\w+)\s*\}\}$/)
  return m ? m[1] : null
}
function brandSwatch(key: string): string {
  return String((effectiveBrand.value as any)[key] ?? '#888')
}
/** Resolve a style colour through the brand kit for the native colour input. */
function resolvedColor(v: unknown, fallback: string): string {
  const k = brandTokenKey(v)
  if (k) return brandSwatch(k)
  return typeof v === 'string' && v.startsWith('#') ? v : fallback
}
function bindColorToBrand(styleKey: 'color' | 'fill', slot: string) {
  if (el.value) patchStyle(el.value.id, { [styleKey]: `{{ brand.${slot} }}` })
}

const brandFontSlots = computed(() => {
  const out: Array<{ slot: 'fontDisplay' | 'fontBody'; label: string; family: string }> = []
  const b = effectiveBrand.value as any
  if (typeof b.fontDisplay === 'string') out.push({ slot: 'fontDisplay', label: 'Brand display', family: b.fontDisplay })
  if (typeof b.fontBody === 'string') out.push({ slot: 'fontBody', label: 'Brand body', family: b.fontBody })
  return out
})
const fontBoundLabel = computed(() => {
  const k = brandTokenKey(styleOf().fontFamily)
  return k === 'fontDisplay' ? 'Brand display' : k === 'fontBody' ? 'Brand body' : null
})
function bindFontToBrand(slot: 'fontDisplay' | 'fontBody') {
  if (el.value) patchStyle(el.value.id, { fontFamily: `{{ brand.${slot} }}` })
}
const hasBrandLogo = computed(() => typeof (effectiveBrand.value as any).logo === 'string')
const usingBrandLogo = computed(() => el.value?.type === 'image' && (el.value as any).content === '{{ brand.logo }}')

// -- Text panel / scrim ------------------------------------------------------
const panel = computed(() => textEl.value?.style?.panel ?? null)
function setPanel(patch: Record<string, unknown> | null) {
  if (!el.value) return
  if (patch === null) { patchStyle(el.value.id, { panel: undefined }); return }
  patchStyle(el.value.id, { panel: { ...(panel.value ?? { fill: '#000000', opacity: 0.5 }), ...patch } })
}
function bindPanelToBrand(slot: string) {
  setPanel({ fill: `{{ brand.${slot} }}` })
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

    <!-- Format-class banner + edit scope -->
    <div v-if="!isMaster" class="rounded-md bg-[#96b4ff]/[0.08] border border-[#96b4ff]/20 px-2.5 py-2 leading-snug">
      <div class="flex gap-1 mb-2">
        <button
          v-for="opt in (['class', 'format'] as const)" :key="opt"
          class="flex-1 h-6 rounded text-[10px] transition-colors cursor-pointer"
          :class="regionScope === opt ? 'bg-[#96b4ff]/30 text-white' : 'bg-white/[0.04] text-white/50 hover:bg-white/[0.08]'"
          @click="regionScope = opt"
        >{{ opt === 'class' ? `All ${formatClass}` : 'Only this' }}</button>
      </div>
      <p class="text-[11px] text-[#c9d6ff]/90">
        <template v-if="regionScope === 'class'">
          Region edits apply to every <span class="font-medium">{{ formatClass }}</span> format.
        </template>
        <template v-else>
          Region edits apply only to <span class="font-medium">{{ currentFormat }}</span>.
        </template>
      </p>
      <button
        v-if="regionScope === 'class' && hasClassRegion(el.id)"
        class="mt-1.5 block text-[11px] text-[#96b4ff] hover:text-white transition-colors cursor-pointer underline underline-offset-2"
        @click="clearClassRegion(el.id)"
      >
        Reset {{ formatClass }} to automatic
      </button>
      <button
        v-if="regionScope === 'format' && hasFormatOverride(el.id)"
        class="mt-1.5 block text-[11px] text-[#96b4ff] hover:text-white transition-colors cursor-pointer underline underline-offset-2"
        @click="clearFormatOverride(el.id)"
      >
        Clear {{ currentFormat }} override
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
          :model-value="fontBoundLabel ? (effectiveBrand as any)[brandTokenKey(styleOf().fontFamily)!] : (styleOf().fontFamily ?? 'Inter')"
          @update:model-value="setFontFamily"
        />
        <div v-if="brandFontSlots.length" class="flex items-center gap-1 mt-1.5">
          <span class="text-[10px] text-white/30">Brand:</span>
          <button
            v-for="f in brandFontSlots"
            :key="f.slot"
            class="px-1.5 h-6 rounded text-[10px] transition-colors cursor-pointer"
            :class="fontBoundLabel === f.label ? 'bg-[#96b4ff]/25 text-[#c9d6ff]' : 'bg-white/[0.04] text-white/45 hover:bg-white/[0.08]'"
            :title="`Bind to ${f.label} (${f.family})`"
            @click="bindFontToBrand(f.slot)"
          >{{ f.label.replace('Brand ', '') }}</button>
        </div>
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
        <div class="flex gap-2 items-center">
          <input
            type="color" :value="resolvedColor(styleOf().color, '#ffffff')"
            class="size-7 shrink-0 rounded border border-white/[0.06] bg-transparent cursor-pointer"
            @input="(e: any) => patchStyle(el!.id, { color: e.target.value })"
          >
          <input
            :value="brandTokenKey(styleOf().color) ? `brand.${brandTokenKey(styleOf().color)}` : (styleOf().color ?? '#ffffff')"
            :class="[inputCls, brandTokenKey(styleOf().color) ? 'text-[#c9d6ff]' : '']"
            @change="(e: any) => patchStyle(el!.id, { color: e.target.value })"
          >
        </div>
        <div v-if="brandColorSlots.length" class="flex items-center gap-1 mt-1.5">
          <span class="text-[10px] text-white/30">Brand:</span>
          <button
            v-for="slot in brandColorSlots"
            :key="slot"
            class="size-5 rounded-full border cursor-pointer transition"
            :class="brandTokenKey(styleOf().color) === slot ? 'border-white ring-1 ring-[#96b4ff]' : 'border-white/20 hover:border-white/50'"
            :style="{ background: brandSwatch(slot) }"
            :title="`Bind to brand.${slot}`"
            @click="bindColorToBrand('color', slot)"
          />
        </div>
      </div>

      <!-- Legibility panel / scrim -->
      <div>
        <div class="flex items-center justify-between mb-1.5">
          <p :class="labelCls">Panel / scrim</p>
          <label class="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" :checked="!!panel" @change="(e: any) => setPanel(e.target.checked ? {} : null)">
            <span class="text-[11px] text-white/50">behind text</span>
          </label>
        </div>
        <template v-if="panel">
          <div class="flex gap-2 items-center">
            <input
              type="color" :value="resolvedColor(panel.fill, '#000000')"
              class="size-7 shrink-0 rounded border border-white/[0.06] bg-transparent cursor-pointer"
              @input="(e: any) => setPanel({ fill: e.target.value })"
            >
            <input
              :value="brandTokenKey(panel.fill) ? `brand.${brandTokenKey(panel.fill)}` : (panel.fill ?? '#000000')"
              :class="[inputCls, brandTokenKey(panel.fill) ? 'text-[#c9d6ff]' : '']"
              @change="(e: any) => setPanel({ fill: e.target.value })"
            >
          </div>
          <div v-if="brandColorSlots.length" class="flex items-center gap-1 mt-1.5">
            <span class="text-[10px] text-white/30">Brand:</span>
            <button
              v-for="slot in brandColorSlots"
              :key="slot"
              class="size-5 rounded-full border cursor-pointer transition"
              :class="brandTokenKey(panel.fill) === slot ? 'border-white ring-1 ring-[#96b4ff]' : 'border-white/20 hover:border-white/50'"
              :style="{ background: brandSwatch(slot) }"
              :title="`Bind panel to brand.${slot}`"
              @click="bindPanelToBrand(slot)"
            />
          </div>
          <div class="grid grid-cols-2 gap-2 mt-2">
            <div>
              <p :class="labelCls" class="mb-1">Opacity</p>
              <div class="flex items-center gap-2">
                <input
                  type="range" min="0" max="1" step="0.05" :value="panel.opacity ?? 0.5"
                  class="flex-1"
                  @input="(e: any) => setPanel({ opacity: Number(e.target.value) })"
                >
                <span class="text-[11px] text-white/50 tabular-nums w-8">{{ Math.round((panel.opacity ?? 0.5) * 100) }}%</span>
              </div>
            </div>
            <div>
              <p :class="labelCls" class="mb-1">Radius</p>
              <input
                type="number" min="0" :value="panel.radius ?? 0" :class="inputCls"
                @change="(e: any) => setPanel({ radius: Math.max(0, Number(e.target.value) || 0) })"
              >
            </div>
          </div>
        </template>
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
        <button
          v-if="hasBrandLogo"
          class="mt-1.5 px-2 h-6 rounded text-[10px] transition-colors cursor-pointer"
          :class="usingBrandLogo ? 'bg-[#96b4ff]/25 text-[#c9d6ff]' : 'bg-white/[0.04] text-white/45 hover:bg-white/[0.08]'"
          @click="patchElement(el!.id, { content: '{{ brand.logo }}' })"
        >
          Use brand logo
        </button>
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
        <div class="flex gap-2 items-center">
          <input
            type="color" :value="resolvedColor(styleOf().fill, '#000000').slice(0, 7)"
            class="size-7 shrink-0 rounded border border-white/[0.06] bg-transparent cursor-pointer"
            @input="(e: any) => patchStyle(el!.id, { fill: e.target.value })"
          >
          <input
            :value="brandTokenKey(styleOf().fill) ? `brand.${brandTokenKey(styleOf().fill)}` : (styleOf().fill ?? '#000000')"
            :class="[inputCls, brandTokenKey(styleOf().fill) ? 'text-[#c9d6ff]' : '']"
            @change="(e: any) => patchStyle(el!.id, { fill: e.target.value })"
          >
        </div>
        <div v-if="brandColorSlots.length" class="flex items-center gap-1 mt-1.5">
          <span class="text-[10px] text-white/30">Brand:</span>
          <button
            v-for="slot in brandColorSlots"
            :key="slot"
            class="size-5 rounded-full border cursor-pointer transition"
            :class="brandTokenKey(styleOf().fill) === slot ? 'border-white ring-1 ring-[#96b4ff]' : 'border-white/20 hover:border-white/50'"
            :style="{ background: brandSwatch(slot) }"
            :title="`Bind to brand.${slot}`"
            @click="bindColorToBrand('fill', slot)"
          />
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
