<!-- frontend/app/components/vue-canvas/CollectionDrawer.vue -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { X, Plus, Upload, ClipboardPaste, Trash2 } from 'lucide-vue-next'
import { COLLECTION_PROP, type CollectionData, type VariableType } from '~/lib/collection/types'
import { addColumn, addRow, removeColumn, removeRow, setCell, clampPreviewRow } from '~/lib/collection/model'
import { importTable } from '~/lib/collection/parse'

const props = defineProps<{ nodeId: string; nodes: any[]; edges: any[] }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const node = computed(() => props.nodes.find(n => String(n.id) === String(props.nodeId)))
const collection = computed<CollectionData | null>(() =>
  (node.value?.data?.properties?.[COLLECTION_PROP] as CollectionData) ?? null)

const TYPES: VariableType[] = ['text', 'color', 'number', 'image', 'font', 'select']

const pasteOpen = ref(false)
const pasteText = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

function onAddRow() { if (collection.value) addRow(collection.value) }
function onAddColumn() { if (collection.value) addColumn(collection.value, `Column ${collection.value.columns.length + 1}`, 'text') }
function onRemoveRow(rowId: string) {
  if (!collection.value) return
  removeRow(collection.value, rowId)
  clampPreviewRow(collection.value)
}
function onRemoveColumn(key: string) { if (collection.value) removeColumn(collection.value, key) }
function onCell(rowId: string, key: string, e: Event) {
  if (!collection.value) return
  setCell(collection.value, rowId, key, (e.target as HTMLInputElement).value)
}
function selectRow(i: number) { if (collection.value) collection.value.previewRow = i }
function applyPaste() {
  if (collection.value && pasteText.value.trim()) importTable(collection.value, pasteText.value)
  pasteOpen.value = false
  pasteText.value = ''
}
async function onFile(e: Event) {
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
        <div class="flex-1" />
        <button class="drawer-btn" @click="pasteOpen = !pasteOpen">
          <ClipboardPaste class="size-3.5" /> Paste data
        </button>
        <button class="drawer-btn" @click="fileInput?.click()">
          <Upload class="size-3.5" /> Import CSV
        </button>
        <input ref="fileInput" type="file" accept=".csv,.tsv,.txt" class="hidden" @change="onFile" />
        <button class="drawer-btn" @click="onAddColumn"><Plus class="size-3.5" /> Column</button>
        <button class="p-1.5 rounded hover:bg-white/10" @click="emit('close')"><X class="size-4" /></button>
      </div>

      <div v-if="pasteOpen" class="px-4 py-2 border-b border-white/10 shrink-0">
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

      <div class="flex-1 overflow-auto">
        <table class="w-full text-[12px] border-collapse">
          <thead>
            <tr class="text-white/40 sticky top-0 bg-[#141414]">
              <th class="w-9 border-b border-white/10" />
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
                <button class="opacity-0 group-hover:opacity-40 hover:!opacity-100" @click.stop="onRemoveRow(row.id)">
                  <Trash2 class="size-3" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <button class="drawer-btn m-2" @click="onAddRow"><Plus class="size-3.5" /> Row</button>
      </div>

      <div class="flex items-center gap-3 px-4 h-9 border-t border-white/10 shrink-0 text-[11px] text-white/40">
        <span>Click a row to preview it on canvas</span>
        <div class="flex-1" />
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
