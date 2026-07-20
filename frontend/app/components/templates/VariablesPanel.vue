<script setup lang="ts">
/**
 * Variables panel — a per-variable value navigator for the Smart Layout left
 * column. One row per bound Collection column, each with its own ‹ value ›
 * pager that steps through the distinct values that column takes across the
 * collection's rows. Stepping (or selecting) a variable writes the chosen value
 * into the editor's live preview (`sampleProps` / `sampleBrand`) and selects the
 * bound element on the canvas.
 *
 * Editor-preview scope: paging here overrides only what the canvas shows while
 * designing — it does NOT touch the collection or the exported rows (each
 * exported variant is still a coupled row via `previewRow`). Independent
 * per-variable browsing is the point: different columns have different value
 * counts (2/5, 1/3, …), so they're navigated independently, not row-locked.
 */
import { ChevronLeft, ChevronRight, Image as ImageIcon } from 'lucide-vue-next'

import { COLLECTION_PROP } from '~/lib/collection/types'
import type { CollectionData, VarBindings, VariableType } from '~/lib/collection/types'
import type { SmartLayoutBindingContext } from '~/lib/collection/layoutBinding'
import { isBoundToken } from '~/lib/collection/layoutPromote'
import type { GridEditorContext } from '~/composables/useGridEditor'
import { allElements } from '~~/shared/template-grid/sections'

const ctx = inject<GridEditorContext>('gridEditor')!
const smb = inject<SmartLayoutBindingContext | null>('smartLayoutBinding', null)

const { template, selectedId, sampleProps, sampleBrand } = ctx
const selectedSectionId = (ctx as any).selectedSectionId as { value: string | null } | undefined

const collection = computed<CollectionData | undefined>(() =>
  smb?.collectionNode.value?.data?.properties?.[COLLECTION_PROP] as CollectionData | undefined)
const bindings = computed<VarBindings>(() => smb?.bindings.value ?? {})

interface VarRow {
  path: string
  short: string
  isBrand: boolean
  label: string
  type: VariableType
  values: (string | number)[]
  index: number
  current: string | number
  count: number
  elementId: string | null
}

/** Map a bound `props.<socket>` path to the layout element that carries it. */
function elementIdForSocket(socket: string): string | null {
  const el = allElements(template.value).find(e => isBoundToken((e as any).content) === socket)
  return el ? el.id : null
}

const rows = computed<VarRow[]>(() => {
  const c = collection.value
  if (!c) return []
  const out: VarRow[] = []
  for (const [path, b] of Object.entries(bindings.value)) {
    if (!b || b.collectionId !== c.id) continue
    const col = c.columns.find(x => x.key === b.columnKey)
    if (!col) continue

    // Distinct, non-empty values in first-seen order — the pager's stops.
    const seen = new Set<string>()
    const values: (string | number)[] = []
    for (const row of c.rows) {
      const v = row.values[col.key]
      if (v === undefined || String(v).trim() === '') continue
      const k = String(v)
      if (seen.has(k)) continue
      seen.add(k)
      values.push(v)
    }
    if (!values.length) continue

    const isBrand = path.startsWith('brand.')
    const short = path.slice(path.indexOf('.') + 1)
    const live = isBrand ? sampleBrand.value[short] : sampleProps.value[short]
    const cell = c.rows[c.previewRow]?.values[col.key]
    const currentStr = live !== undefined && String(live).trim() !== ''
      ? String(live)
      : (cell !== undefined ? String(cell) : String(values[0]))
    let index = values.findIndex(v => String(v) === currentStr)
    if (index < 0) index = 0

    out.push({
      path, short, isBrand,
      label: col.label || short,
      type: col.type,
      values,
      index,
      current: values[index]!,
      count: values.length,
      elementId: isBrand ? null : elementIdForSocket(short),
    })
  }
  return out
})

function applyValue(row: VarRow, value: string | number) {
  if (row.isBrand) sampleBrand.value[row.short] = String(value)
  else sampleProps.value[row.short] = value
}

function selectElement(row: VarRow) {
  if (!row.elementId) return
  if (selectedSectionId) selectedSectionId.value = null
  selectedId.value = row.elementId
}

function step(row: VarRow, delta: number) {
  const n = row.count
  if (n <= 1) { selectElement(row); return }
  const next = (row.index + delta + n) % n
  applyValue(row, row.values[next]!)
  selectElement(row)
}

function isColor(v: string | number): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(v))
}
</script>

<template>
  <div v-if="rows.length" class="flex flex-col border-t border-white/[0.06]">
    <div class="px-3 pt-2.5 pb-1.5 flex items-center justify-between">
      <span class="panel-heading flex items-center gap-1.5">
        <svg width="11" height="12" viewBox="0 0 20 22" aria-hidden="true">
          <path d="M10 1 L18.66 6 V16 L10 21 L1.34 16 V6 Z" fill="var(--var-accent)" />
        </svg>
        Variables
      </span>
      <span class="text-[10px] text-white/30">{{ rows.length }}</span>
    </div>

    <div class="px-2 pb-2 flex flex-col gap-1.5">
      <div
        v-for="row in rows"
        :key="row.path"
        class="rounded-lg bg-white/[0.03]"
      >
        <!-- variable name + position -->
        <button
          class="w-full flex items-center gap-1.5 px-2 pt-1.5 pb-1 text-left cursor-pointer"
          :title="row.elementId ? 'Select on canvas' : row.label"
          @click="selectElement(row)"
        >
          <svg width="11" height="12" viewBox="0 0 20 22" class="shrink-0" aria-hidden="true">
            <path
              d="M10 1 L18.66 6 V16 L10 21 L1.34 16 V6 Z"
              :fill="selectedId === row.elementId && row.elementId ? 'var(--var-accent)' : 'none'"
              stroke="var(--var-accent)"
              stroke-width="2"
            />
          </svg>
          <span
            class="flex-1 min-w-0 truncate text-[11px]"
            :class="selectedId === row.elementId && row.elementId ? 'text-white/90' : 'text-white/55'"
          >{{ row.label }}</span>
          <span class="shrink-0 text-[9px] text-white/30 tabular-nums tracking-wide">{{ row.index + 1 }}/{{ row.count }}</span>
        </button>

        <!-- value pager -->
        <div class="flex items-center gap-1 px-1.5 pb-1.5">
          <button
            class="size-6 shrink-0 flex items-center justify-center rounded-md bg-white/[0.05] text-white/55 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-white/[0.05] cursor-pointer disabled:cursor-default transition-colors"
            :disabled="row.count <= 1"
            title="Previous value"
            @click="step(row, -1)"
          >
            <ChevronLeft class="size-3.5" />
          </button>

          <div class="flex-1 min-w-0 flex items-center justify-center gap-1.5 px-1">
            <span
              v-if="row.type === 'color' && isColor(row.current)"
              class="size-3.5 shrink-0 rounded-[3px] border border-white/20"
              :style="{ background: String(row.current) }"
            />
            <span
              v-else-if="row.type === 'image'"
              class="shrink-0 text-white/40"
            >
              <ImageIcon class="size-3.5" />
            </span>
            <span class="min-w-0 truncate text-center text-[12px] text-white">{{ row.current }}</span>
          </div>

          <button
            class="size-6 shrink-0 flex items-center justify-center rounded-md bg-white/[0.05] text-white/70 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-white/[0.05] cursor-pointer disabled:cursor-default transition-colors"
            :disabled="row.count <= 1"
            title="Next value"
            @click="step(row, 1)"
          >
            <ChevronRight class="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
