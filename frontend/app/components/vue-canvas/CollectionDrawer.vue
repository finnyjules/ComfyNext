<!-- frontend/app/components/vue-canvas/CollectionDrawer.vue -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import JSZip from 'jszip'
import { X, Plus, Upload, ClipboardPaste, Trash2, Play } from 'lucide-vue-next'
import { deriveOutputs } from '~~/shared/template-grid/resolve'
import { BINDINGS_PROP, COLLECTION_PROP, type CollectionData, type VarBinding, type VariableType } from '~/lib/collection/types'
import { addColumn, addRow, removeColumn, removeRow, setCell, clampPreviewRow, rowLabel } from '~/lib/collection/model'
import { importTable } from '~/lib/collection/parse'
import { autoAlign, listSmartLayoutBindables, readTemplateFromNode, typeCompatible, type Bindable } from '~/lib/collection/bindables'
import { resolveBindings, validateRun } from '~/lib/collection/resolve'
import { wiredTargets, pushVarPreview } from '~/lib/collection/preview'
import { planBatch, runBatch, type BatchItem, type BatchStatus } from '~/lib/collection/batch'
import { buildRenderItem, estimateBatch, sanitize } from '~/lib/collection/generate'

const props = defineProps<{ nodeId: string; nodes: any[]; edges: any[] }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const node = computed(() => props.nodes.find(n => String(n.id) === String(props.nodeId)))
const collection = computed<CollectionData | null>(() =>
  (node.value?.data?.properties?.[COLLECTION_PROP] as CollectionData) ?? null)

const TYPES: VariableType[] = ['text', 'color', 'number', 'image', 'font', 'select']

// --- Bindings strip -------------------------------------------------------
// Smart Layout targets wired from this collection's output-0. We only bind
// against the first one — multiple targets on one collection is an edge case
// the UI doesn't need to solve for yet.
const targets = computed(() => wiredTargets(props.nodeId, props.nodes, props.edges)
  .filter(n => n?.data?.nodeType === 'SmartLayout'))
const target = computed(() => targets.value[0] ?? null)

const bindables = computed<Bindable[]>(() =>
  target.value ? listSmartLayoutBindables(readTemplateFromNode(target.value)) : [])

function targetBindings(): Record<string, VarBinding> {
  if (!target.value) return {}
  if (!target.value.data.properties) target.value.data.properties = {}
  if (!target.value.data.properties[BINDINGS_PROP]) target.value.data.properties[BINDINGS_PROP] = {}
  return target.value.data.properties[BINDINGS_PROP]
}

function compatibleColumns(bindable: Bindable) {
  return collection.value ? collection.value.columns.filter(c => typeCompatible(bindable.type, c.type)) : []
}

function bindingFor(path: string): VarBinding | undefined {
  return targetBindings()[path]
}

function onBindingChange(bindable: Bindable, e: Event) {
  if (!collection.value) return
  const columnKey = (e.target as HTMLSelectElement).value
  const bindings = targetBindings()
  if (!columnKey) {
    delete bindings[bindable.path]
    // Leave the (possibly now-empty) bindings object in place — its mere
    // presence marks "explicitly cleared" so the auto-align watcher below
    // does not silently reseed it on next drawer open.
    return
  }
  // Preserve/refresh lastLiteral: the current resolved value for this path
  // (row cell if present, else whatever literal was previously recorded) —
  // cheap to read off the existing binding/collection, so we do; we do not
  // reach into the SmartLayout template's actual widget defaults since that
  // would require parsing per-path template state, which is out of scope.
  const prevLiteral = bindings[bindable.path]?.lastLiteral
  const { values } = resolveBindings(collection.value, { [bindable.path]: { collectionId: collection.value.id, columnKey } }, collection.value.previewRow)
  const lastLiteral = values[bindable.path] ?? prevLiteral
  bindings[bindable.path] = { collectionId: collection.value.id, columnKey, ...(lastLiteral !== undefined ? { lastLiteral } : {}) }
}

// Auto-init bindings for a freshly wired target that has none yet. Seed only
// when the bindings object is absent (undefined) — never when it already
// exists, even as `{}`, since an empty object means the user explicitly
// cleared all bindings and that choice must stick.
watch([target, bindables, collection], () => {
  if (!target.value || !collection.value || !bindables.value.length) return
  const existing = target.value.data.properties?.[BINDINGS_PROP]
  if (existing !== undefined) return
  if (!target.value.data.properties) target.value.data.properties = {}
  target.value.data.properties[BINDINGS_PROP] = autoAlign(bindables.value, collection.value.columns, collection.value.id)
}, { immediate: true })

// Live preview: any change to the collection (cells, preview row) or to the
// bindings themselves re-pushes the resolved preview row onto the target.
// Must never deep-watch the whole target properties object — VAR_PREVIEW_PROP
// and BINDINGS_PROP have to stay disjoint watched keys, or writes to
// comfynext_varPreview below would retrigger this watcher (infinite loop).
watch(
  [collection, () => target.value?.data?.properties?.[BINDINGS_PROP]],
  () => { if (node.value) pushVarPreview(node.value, targets.value) },
  { deep: true, immediate: true },
)

// --- Generate ---------------------------------------------------------
const outputs = computed(() => {
  if (!target.value) return []
  const template = readTemplateFromNode(target.value)
  if (!template) return []
  try { return deriveOutputs(template as any) } catch { return [] }
})
const generateN = computed(() => (collection.value?.rows.length ?? 0) * outputs.value.length)

const confirmOpen = ref(false)
const items = ref<BatchItem[]>([])
const running = ref(false)
const runSignal = ref<{ cancelled: boolean } | null>(null)

const estimate = computed(() => estimateBatch(generateN.value))
const warnings = computed(() => (collection.value ? validateRun(collection.value, targetBindings()) : []))
const warningsShown = computed(() => warnings.value.slice(0, 5))
const warningsMore = computed(() => Math.max(0, warnings.value.length - 5))

const STATUS_RANK: Record<BatchStatus, number> = { queued: 0, rendering: 1, done: 2, failed: 3 }
const rowStatus = computed(() => {
  const map = new Map<string, BatchStatus>()
  for (const item of items.value) {
    const prev = map.get(item.rowId)
    if (!prev || STATUS_RANK[item.status] > STATUS_RANK[prev]) map.set(item.rowId, item.status)
  }
  return map
})
const rowError = computed(() => {
  const map = new Map<string, string>()
  for (const item of items.value) {
    if (item.status === 'failed' && item.error) map.set(item.rowId, item.error)
  }
  return map
})
const hasFailed = computed(() => items.value.some(i => i.status === 'failed'))

// --- Table / Results view toggle -----------------------------------------
const view = ref<'table' | 'results'>('table')
const hasResults = computed(() => items.value.length > 0 && !running.value)

// Auto-switch to Results the moment a full-batch run finishes; the user can
// always click back to Table manually afterwards. Only full-batch entry
// points (confirmGenerate / retryFailed) arm this flag — single-item
// retryItem runs must not yank the user out of Table mid-workflow.
const autoShowResults = ref(false)
watch(running, (isRunning, wasRunning) => {
  if (wasRunning && !isRunning && items.value.length && autoShowResults.value) view.value = 'results'
  if (wasRunning && !isRunning) autoShowResults.value = false
})

function selectItem(item: BatchItem) {
  if (item.status !== 'done' || !collection.value) return
  collection.value.previewRow = item.rowIndex
}

async function retryItem(item: BatchItem) {
  item.status = 'queued'
  item.error = undefined
  items.value = [...items.value]
  await runItems([item])
}

const exporting = ref(false)
async function exportZip() {
  if (!collection.value || exporting.value) return
  const done = items.value.filter(i => i.status === 'done' && i.url)
  if (!done.length) return
  exporting.value = true
  try {
    const zip = new JSZip()
    // Precompute which label+outputId combinations are duplicated across rows
    // so we can disambiguate with rowIndex only when needed.
    const keyCounts = new Map<string, number>()
    for (const item of done) {
      const key = `${sanitize(rowLabel(collection.value!, item.rowIndex))}_${item.outputId}`
      keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1)
    }
    for (const item of done) {
      const label = sanitize(rowLabel(collection.value!, item.rowIndex))
      const baseKey = `${label}_${item.outputId}`
      const isDupe = (keyCounts.get(baseKey) ?? 0) > 1
      const fname = isDupe ? `${baseKey}_${item.rowIndex + 1}.png` : `${baseKey}.png`
      const blob = await fetch(item.url!).then(r => r.blob())
      zip.file(fname, blob)
    }
    const out = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(out)
    const a = document.createElement('a')
    a.href = url
    a.download = `${sanitize(collection.value.name)}_batch.zip`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  } finally {
    exporting.value = false
  }
}

function openConfirm() {
  if (!collection.value || !target.value || !generateN.value) return
  confirmOpen.value = true
}

async function runItems(toRun: BatchItem[]) {
  if (!collection.value || !target.value) return
  running.value = true
  const signal = { cancelled: false }
  runSignal.value = signal
  const runStamp = Date.now().toString(36)
  const renderItem = buildRenderItem(target.value, collection.value, targetBindings(), runStamp)
  try {
    await runBatch(toRun, renderItem, {
      concurrency: 3,
      signal,
      onUpdate: () => { items.value = [...items.value] },
    })
  } finally {
    running.value = false
    runSignal.value = null
  }
}

async function confirmGenerate() {
  if (!collection.value) return
  confirmOpen.value = false
  const planned = planBatch(collection.value.rows, outputs.value)
  items.value = planned
  autoShowResults.value = true
  await runItems(planned)
}

function cancelRun() {
  if (runSignal.value) runSignal.value.cancelled = true
}

async function retryFailed() {
  const failed = items.value.filter(i => i.status === 'failed')
  for (const item of failed) { item.status = 'queued'; item.error = undefined }
  items.value = [...items.value]
  autoShowResults.value = true
  await runItems(failed)
}

const pasteOpen = ref(false)
const pasteText = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

function onAddRow() { if (!running.value && collection.value) addRow(collection.value) }
function onAddColumn() { if (!running.value && collection.value) addColumn(collection.value, `Column ${collection.value.columns.length + 1}`, 'text') }
function onRemoveRow(rowId: string) {
  if (running.value || !collection.value) return
  removeRow(collection.value, rowId)
  clampPreviewRow(collection.value)
}
function onRemoveColumn(key: string) { if (!running.value && collection.value) removeColumn(collection.value, key) }
function onCell(rowId: string, key: string, e: Event) {
  if (!collection.value) return
  setCell(collection.value, rowId, key, (e.target as HTMLInputElement).value)
}
function selectRow(i: number) { if (collection.value) collection.value.previewRow = i }
function applyPaste() {
  if (running.value || !collection.value || !pasteText.value.trim()) return
  importTable(collection.value, pasteText.value)
  pasteOpen.value = false
  pasteText.value = ''
}
async function onFile(e: Event) {
  if (running.value) return
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f || !collection.value) return
  importTable(collection.value, await f.text())
  if (fileInput.value) fileInput.value.value = ''
}
function isImageUrl(v: unknown): boolean {
  const s = String(v ?? '')
  return /(\.(png|jpe?g|webp|gif|svg)(\?|#|$))|(^\/view\?)/i.test(s) || /^https?:\/\//i.test(s)
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="collection"
      class="fixed left-0 right-0 bottom-0 z-[9000] h-[320px] bg-[#141414] border-t border-[#2a2a2a] flex flex-col text-white/90"
    >
      <div class="flex items-center gap-2 px-4 h-10 border-b border-white/10 shrink-0">
        <input
          v-model="collection.name"
          class="bg-transparent text-[12px] font-medium outline-none w-40 border-b border-transparent focus:border-white/20"
        />
        <span class="text-[11px] text-white/40">
          {{ collection.rows.length }} rows · {{ collection.columns.length }} columns
        </span>

        <div v-if="hasResults" class="flex items-center gap-0.5 rounded-md bg-white/5 border border-white/10 p-0.5 ml-2">
          <button
            class="px-2 h-5 rounded text-[11px] leading-5 transition"
            :class="view === 'table' ? 'bg-white/15 text-white/90' : 'text-white/50 hover:text-white/70'"
            @click="view = 'table'"
          >
            Table
          </button>
          <button
            class="px-2 h-5 rounded text-[11px] leading-5 transition"
            :class="view === 'results' ? 'bg-white/15 text-white/90' : 'text-white/50 hover:text-white/70'"
            @click="view = 'results'"
          >
            Results
          </button>
        </div>

        <div class="flex-1" />
        <button v-if="view === 'results'" class="drawer-btn" :disabled="exporting" :class="{ 'opacity-40 cursor-not-allowed': exporting }" @click="exportZip">
          <Upload class="size-3.5" /> Export zip
        </button>
        <template v-if="view === 'table'">
          <button class="drawer-btn" :disabled="running" :class="{ 'opacity-40 cursor-not-allowed': running }" @click="pasteOpen = !pasteOpen">
            <ClipboardPaste class="size-3.5" /> Paste data
          </button>
          <button class="drawer-btn" :disabled="running" :class="{ 'opacity-40 cursor-not-allowed': running }" @click="fileInput?.click()">
            <Upload class="size-3.5" /> Import CSV
          </button>
          <input ref="fileInput" type="file" accept=".csv,.tsv,.txt" class="hidden" @change="onFile" />
          <button class="drawer-btn" :disabled="running" :class="{ 'opacity-40 cursor-not-allowed': running }" @click="onAddColumn"><Plus class="size-3.5" /> Column</button>
        </template>
        <button class="p-1.5 rounded hover:bg-white/10" @click="emit('close')"><X class="size-4" /></button>
      </div>

      <div v-if="pasteOpen && view === 'table'" class="px-4 py-2 border-b border-white/10 shrink-0">
        <textarea
          v-model="pasteText"
          rows="4"
          placeholder="Paste CSV or spreadsheet cells — first row is headers"
          class="w-full bg-white/5 border border-white/10 rounded-md p-2 text-[12px] outline-none focus:border-white/25"
        />
        <div class="flex justify-end gap-2 mt-1">
          <button class="drawer-btn" @click="pasteOpen = false">Cancel</button>
          <button class="drawer-btn !bg-white/15" @click="applyPaste">Replace table</button>
        </div>
      </div>

      <div v-if="view === 'table'" class="flex items-center gap-3 px-4 py-2 border-b border-white/10 shrink-0 overflow-x-auto">
        <span class="text-[11px] text-white/40 shrink-0">Bindings</span>
        <template v-if="target">
          <div v-for="b in bindables" :key="b.path" class="flex items-center gap-1.5 shrink-0">
            <span class="text-[11px] text-white/60">{{ b.label }}</span>
            <select
              class="bg-white/5 border border-white/10 rounded text-[11px] text-white/80 px-1.5 py-1 outline-none focus:border-white/25"
              :value="bindingFor(b.path)?.columnKey ?? ''"
              @change="onBindingChange(b, $event)"
            >
              <option value="">—</option>
              <option v-for="col in compatibleColumns(b)" :key="col.key" :value="col.key">{{ col.label }}</option>
            </select>
          </div>
        </template>
        <span v-else class="text-[11px] text-white/30">Wire this collection to a Smart Layout node to bind columns</span>
      </div>

      <div v-if="view === 'results'" class="flex-1 overflow-auto p-3">
        <div class="grid grid-cols-6 gap-2">
          <div
            v-for="item in items"
            :key="item.id"
            class="rounded-md border overflow-hidden"
            :class="item.status === 'failed' ? 'border-red-400/30 bg-red-500/10' : 'border-white/10 bg-white/5'"
          >
            <button
              v-if="item.status === 'done' && item.url"
              class="block w-full aspect-square cursor-pointer group relative"
              :class="{ 'ring-2 ring-white/40': item.rowIndex === collection.previewRow }"
              @click="selectItem(item)"
            >
              <img :src="item.url" class="w-full h-full object-cover" />
            </button>
            <div
              v-else-if="item.status === 'failed'"
              class="w-full aspect-square flex flex-col items-center justify-center gap-1.5 p-2 text-center"
            >
              <span class="text-[10px] text-red-300/90 line-clamp-3">{{ item.error || 'Failed' }}</span>
              <button class="drawer-btn !h-5 !px-1.5 !text-[10px]" @click="retryItem(item)">Retry</button>
            </div>
            <div v-else class="w-full aspect-square flex items-center justify-center">
              <span
                class="inline-block size-2 rounded-full"
                :class="item.status === 'rendering' ? 'bg-white/60 animate-pulse' : 'bg-white/20'"
              />
            </div>
            <div class="px-1.5 py-1 text-[10px] text-white/50 truncate">
              {{ rowLabel(collection, item.rowIndex) }} · {{ item.outputId }}
            </div>
          </div>
        </div>
      </div>

      <div v-if="view === 'table'" class="flex-1 overflow-auto">
        <table class="w-full text-[12px] border-collapse">
          <thead>
            <tr class="text-white/40 sticky top-0 bg-[#141414]">
              <th class="w-9 border-b border-white/10" />
              <th v-if="items.length" class="w-6 border-b border-white/10" />
              <th v-for="col in collection.columns" :key="col.key" class="text-left font-normal px-2 py-1.5 border-b border-white/10 min-w-[140px]">
                <div class="flex items-center gap-1.5">
                  <input v-model="col.label" class="bg-transparent outline-none w-24 text-white/70" />
                  <select v-model="col.type" class="bg-[#141414] text-white/40 text-[11px] outline-none">
                    <option v-for="t in TYPES" :key="t" :value="t">{{ t }}</option>
                  </select>
                  <button class="opacity-40 hover:opacity-100" @click="onRemoveColumn(col.key)">
                    <Trash2 class="size-3" />
                  </button>
                </div>
              </th>
              <th class="border-b border-white/10 w-full" />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, i) in collection.rows"
              :key="row.id"
              class="cursor-pointer group"
              :class="i === collection.previewRow ? 'bg-white/10' : 'hover:bg-white/5'"
              @click="selectRow(i)"
            >
              <td class="px-2 py-1 text-white/30 tabular-nums border-b border-white/5 text-right">{{ i + 1 }}</td>
              <td v-if="items.length" class="px-1 py-1 border-b border-white/5 text-center">
                <span
                  class="inline-block size-2 rounded-full"
                  :class="{
                    'bg-white/20': rowStatus.get(row.id) === 'queued',
                    'bg-white/60 animate-pulse': rowStatus.get(row.id) === 'rendering',
                    'bg-emerald-400': rowStatus.get(row.id) === 'done',
                    'bg-red-400': rowStatus.get(row.id) === 'failed',
                  }"
                  :title="rowError.get(row.id) ?? ''"
                />
              </td>
              <td v-for="col in collection.columns" :key="col.key" class="px-2 py-1 border-b border-white/5">
                <div class="flex items-center gap-1.5">
                  <template v-if="col.type === 'color'">
                    <input
                      type="color"
                      :value="/^#([0-9a-f]{6})$/i.test(String(row.values[col.key] ?? '')) ? String(row.values[col.key]) : '#000000'"
                      class="size-4 rounded border-0 bg-transparent p-0 cursor-pointer"
                      @input="onCell(row.id, col.key, $event)"
                      @click.stop
                    />
                  </template>
                  <img
                    v-else-if="col.type === 'image' && isImageUrl(row.values[col.key])"
                    :src="String(row.values[col.key])"
                    class="size-5 rounded object-cover border border-white/10"
                  />
                  <input
                    :value="row.values[col.key] ?? ''"
                    class="bg-transparent outline-none flex-1 min-w-[60px] focus:bg-white/5 rounded px-1"
                    @input="onCell(row.id, col.key, $event)"
                    @click.stop
                  />
                </div>
              </td>
              <td class="border-b border-white/5 pr-2 text-right">
                <button class="opacity-0 group-hover:opacity-40 hover:!opacity-100" :class="{ 'opacity-0 cursor-not-allowed': running }" :disabled="running" @click.stop="onRemoveRow(row.id)">
                  <Trash2 class="size-3" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <button class="drawer-btn m-2" :disabled="running" :class="{ 'opacity-40 cursor-not-allowed': running }" @click="onAddRow"><Plus class="size-3.5" /> Row</button>
      </div>

      <div class="relative flex items-center gap-3 px-4 h-9 border-t border-white/10 shrink-0 text-[11px] text-white/40">
        <span>Click a row to preview it on canvas</span>
        <div class="flex-1" />

        <span v-if="running" class="text-white/50">Generating…</span>
        <button v-if="running" class="drawer-btn" @click="cancelRun">Cancel</button>
        <button v-if="!running && hasFailed" class="drawer-btn" @click="retryFailed">Retry failed</button>

        <button
          v-if="!running"
          class="flex items-center gap-1.5 px-3 h-7 rounded-md text-[11px] font-medium bg-emerald-500/15 text-emerald-300 transition hover:bg-emerald-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!generateN"
          @click="openConfirm"
        >
          <Play class="size-3.5" /> Generate {{ generateN }}
        </button>

        <div
          v-if="confirmOpen"
          class="absolute bottom-10 right-4 w-72 rounded-lg border border-white/10 bg-[#1a1a1a] shadow-xl p-3 text-white/80 z-10"
        >
          <div class="text-[12px] font-medium text-white/90">{{ estimate.label }}</div>
          <div v-if="warnings.length" class="mt-2 space-y-1 max-h-32 overflow-auto">
            <div v-for="(w, wi) in warningsShown" :key="wi" class="text-[11px] text-amber-300/80">
              Row {{ w.rowIndex + 1 }}: {{ w.message }}
            </div>
            <div v-if="warningsMore" class="text-[11px] text-white/40">…and {{ warningsMore }} more</div>
          </div>
          <div class="flex justify-end gap-2 mt-3">
            <button class="drawer-btn" @click="confirmOpen = false">Cancel</button>
            <button
              class="flex items-center gap-1.5 px-3 h-7 rounded-md text-[11px] font-medium bg-emerald-500/15 text-emerald-300 transition hover:bg-emerald-500/25"
              @click="confirmGenerate"
            >
              <Play class="size-3.5" /> Generate
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.drawer-btn {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0 0.625rem;
  height: 1.75rem;
  border-radius: 0.375rem;
  font-size: 11px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.8);
}
.drawer-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}
</style>
