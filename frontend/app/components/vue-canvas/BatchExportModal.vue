<script setup lang="ts">
// Batch export sheet for a Smart Layout node: pick formats + bound-variable
// values, render the cartesian product through the existing runBatch
// pipeline, then emit `spawn` with the successful items so the canvas can
// drop a BatchGrid node. Spec: docs/superpowers/specs/
// 2026-07-11-smart-layout-batch-export-design.md
import { Grid3X3, Loader2, X } from 'lucide-vue-next'
import { planMatrix, columnPool, comboFilename, buildBatchPayload, type MatrixPool, type MatrixCombo, type BatchGridPayload } from '~/lib/collection/matrix'
import { buildMatrixRenderItem } from '~/lib/collection/generate'
import { runBatch, type BatchItem } from '~/lib/collection/batch'
import { readTemplateFromNode } from '~/lib/collection/bindables'
import { resolveBindings } from '~/lib/collection/resolve'
import { deriveOutputs } from '~~/shared/template-grid/resolve'
import { findWiredCollectionNode } from '~/composables/useStudioVarBindings'
import { BINDINGS_PROP, COLLECTION_PROP } from '~/lib/collection/types'
import type { CollectionData, VarBindings } from '~/lib/collection/types'

const props = defineProps<{ nodeId: string; nodes: any[]; edges: any[] }>()
const emit = defineEmits<{ close: []; spawn: [payload: BatchGridPayload] }>()

const node = computed(() => props.nodes.find((n: any) => String(n.id) === String(props.nodeId)))
const template = computed(() => readTemplateFromNode(node.value))
const layoutName = computed(() => (template.value as any)?.name || 'Layout')

const collection = computed<CollectionData | undefined>(() => {
  const colNode = findWiredCollectionNode(props.nodes, props.edges, String(props.nodeId))
  return colNode?.data?.properties?.[COLLECTION_PROP]
})
const bindings = computed<VarBindings>(() =>
  (node.value?.data?.properties?.[BINDINGS_PROP] ?? {}) as VarBindings)

/** All crossable pools with their FULL value lists (selection is separate). */
const pools = computed<MatrixPool[]>(() => {
  const out: MatrixPool[] = []
  const outputs = template.value ? deriveOutputs(template.value as any) : []
  out.push({
    key: 'format', label: 'Formats', kind: 'format',
    values: outputs.map((o: any) => ({ value: o.id, label: o.label ?? o.format ?? o.id })),
  })
  const c = collection.value
  if (c) {
    for (const [path, b] of Object.entries(bindings.value)) {
      if (!path.startsWith('props.') || !b || b.collectionId !== c.id) continue
      const col = c.columns.find(x => x.key === b.columnKey)
      if (!col) continue
      out.push({
        key: path,
        label: col.label || col.key,
        kind: col.type === 'image' ? 'image' : 'text',
        values: columnPool(c, col.key),
      })
    }
  }
  return out.filter(p => p.values.length > 0)
})

/** pool key → Set of selected values. Defaults: formats all; variables just
 *  the preview-row value (so the count starts at N formats). */
const selected = ref<Record<string, Set<string>>>({})
watch(pools, (ps) => {
  const next: Record<string, Set<string>> = {}
  const c = collection.value
  const previewValues = c ? resolveBindings(c, bindings.value, c.previewRow).values : {}
  for (const p of ps) {
    if (selected.value[p.key]) { next[p.key] = selected.value[p.key]!; continue }
    if (p.key === 'format') next[p.key] = new Set(p.values.map(v => v.value))
    else {
      const pv = String(previewValues[p.key] ?? '')
      next[p.key] = new Set(pv && p.values.some(v => v.value === pv) ? [pv] : [p.values[0]!.value])
    }
  }
  selected.value = next
}, { immediate: true })

function toggle(poolKey: string, value: string) {
  const set = new Set(selected.value[poolKey] ?? [])
  if (set.has(value)) set.delete(value)
  else set.add(value)
  selected.value = { ...selected.value, [poolKey]: set }
}

const selectedPools = computed<MatrixPool[]>(() => pools.value.map(p => ({
  ...p, values: p.values.filter(v => selected.value[p.key]?.has(v.value)),
})))
const total = computed(() => selectedPools.value.reduce((acc, p) => acc * Math.max(1, p.values.length), 1))
const countLine = computed(() =>
  selectedPools.value.map(p => `${p.values.length} ${p.label.toLowerCase()}`).join(' × ') + ` = ${total.value} outputs`)
const canGenerate = computed(() =>
  !running.value && selectedPools.value.every(p => p.values.length >= 1) && total.value >= 1)

// -- Run ----------------------------------------------------------------------
const running = ref(false)
const confirmBig = ref(false)
const items = ref<BatchItem[]>([])
let combos: MatrixCombo[] = []
const runSignal = ref<{ cancelled: boolean } | null>(null)
const doneCount = computed(() => items.value.filter(i => i.status === 'done').length)
const failedItems = computed(() => items.value.filter(i => i.status === 'failed'))

async function generate() {
  if (!canGenerate.value || !node.value) return
  if (total.value > 100 && !confirmBig.value) { confirmBig.value = true; return }
  confirmBig.value = false
  running.value = true
  const signal = { cancelled: false }
  runSignal.value = signal
  try {
    const runStamp = Date.now().toString(36)
    combos = planMatrix(selectedPools.value)
      .map((c, i) => ({ ...c, filename: comboFilename(layoutName.value, c, i) }))
    items.value = combos.map((c, i) => ({
      id: `m-${runStamp}-${i}`, rowIndex: i, rowId: '', outputId: c.format, status: 'queued' as const,
    }))
    const renderItem = buildMatrixRenderItem(node.value, collection.value, bindings.value, combos, runStamp)
    await runBatch(items.value, renderItem, {
      concurrency: 3, signal,
      onUpdate: () => { items.value = [...items.value] },
    })
    if (signal.cancelled) return
    const urls = items.value.map(i => (i.status === 'done' ? i.url : undefined))
    const payload = buildBatchPayload(
      String(props.nodeId), layoutName.value, selectedPools.value, combos, urls, new Date().toISOString())
    if (payload.items.length) {
      emit('spawn', payload)
      if (!failedItems.value.length) emit('close')
    }
  } finally {
    running.value = false
    runSignal.value = null
  }
}

async function retryFailed() {
  const failed = items.value.filter(i => i.status === 'failed')
  if (!failed.length || !node.value) return
  for (const f of failed) { f.status = 'queued'; f.error = undefined }
  running.value = true
  const signal = { cancelled: false }
  runSignal.value = signal
  try {
    const renderItem = buildMatrixRenderItem(node.value, collection.value, bindings.value, combos, 'retry')
    await runBatch(failed, renderItem, { concurrency: 3, signal, onUpdate: () => { items.value = [...items.value] } })
  } finally {
    running.value = false
    runSignal.value = null
  }
}

function cancel() { if (runSignal.value) runSignal.value.cancelled = true }
function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !running.value) emit('close') }
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="fixed inset-0 z-[95] bg-black/70 flex items-center justify-center p-6" @click.self="!running && emit('close')">
    <div class="w-full max-w-2xl max-h-[85vh] rounded-xl bg-[#141419] border border-white/10 flex flex-col overflow-hidden">
      <div class="flex items-center gap-2 px-4 h-12 border-b border-white/[0.08] shrink-0">
        <Grid3X3 class="size-4 text-white/60" />
        <p class="text-sm text-white/90">Batch export · {{ layoutName }}</p>
        <button class="ml-auto size-7 rounded-md hover:bg-white/10 flex items-center justify-center text-white/60 cursor-pointer" :disabled="running" @click="emit('close')">
          <X class="size-4" />
        </button>
      </div>

      <div class="overflow-y-auto p-4 flex flex-col gap-4">
        <section v-for="pool in pools" :key="pool.key">
          <p class="text-[11px] uppercase tracking-wide text-white/40 mb-1.5">{{ pool.label }}</p>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="v in pool.values" :key="v.value"
              class="cursor-pointer rounded-md border transition-colors"
              :class="[
                pool.kind === 'image' ? 'p-0.5' : 'px-2 py-1 text-xs',
                selected[pool.key]?.has(v.value)
                  ? 'border-[#96b4ff]/70 bg-[#96b4ff]/15 text-white'
                  : 'border-white/10 bg-white/[0.04] text-white/60 hover:border-white/25',
              ]"
              @click="toggle(pool.key, v.value)"
            >
              <img v-if="pool.kind === 'image'" :src="v.value" class="size-12 rounded object-cover" draggable="false">
              <template v-else>{{ v.label }}</template>
            </button>
          </div>
        </section>

        <!-- Progress -->
        <section v-if="items.length">
          <div class="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div class="h-full bg-[#96b4ff] transition-all" :style="{ width: `${(doneCount / items.length) * 100}%` }" />
          </div>
          <p class="mt-1.5 text-[11px] text-white/50">
            {{ doneCount }}/{{ items.length }} rendered
            <template v-if="failedItems.length"> · <span class="text-red-400">{{ failedItems.length }} failed</span></template>
          </p>
          <button v-if="failedItems.length && !running" class="mt-1 text-[11px] text-[#96b4ff] cursor-pointer hover:underline" @click="retryFailed">
            Retry failed
          </button>
        </section>
      </div>

      <div class="px-4 h-14 border-t border-white/[0.08] flex items-center gap-3 shrink-0">
        <p class="text-xs text-white/60">{{ countLine }}</p>
        <div class="ml-auto flex items-center gap-2">
          <button v-if="running" class="h-8 px-3 rounded-md bg-white/10 text-xs text-white/80 cursor-pointer" @click="cancel">Cancel</button>
          <button
            class="h-8 px-4 rounded-md bg-[#96b4ff] text-neutral-900 text-xs font-medium cursor-pointer disabled:opacity-40 disabled:cursor-default flex items-center gap-1.5"
            :disabled="!canGenerate"
            @click="generate"
          >
            <Loader2 v-if="running" class="size-3.5 animate-spin" />
            {{ confirmBig ? `Really render ${total} images?` : 'Generate' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
