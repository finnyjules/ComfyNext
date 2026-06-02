<script setup lang="ts">
/**
 * LoraGalleryModal — visual gallery for picking a trained LoRA, opened from the
 * FluxLoRARemoteNode `lora_name` launcher (WidgetLoraPicker). Reuses the generic
 * CatalogModal shell. On confirm it writes to the node's widgets directly:
 *   lora_name = filename                  (drives the run; lora_url is cleared)
 *   prompt    = "<aesthetic> <trigger>, "  (style kept in the prompt — no
 *                separate node input, so the ComfyUI schema stays stable)
 */
import { ref, computed, onMounted } from 'vue'
import { Sparkles, Loader2 } from 'lucide-vue-next'

const props = defineProps<{
  nodeId: string
  nodes: any[]
}>()
const emit = defineEmits<{ close: [] }>()

interface LoraItem {
  id: string                 // filename (the value lora_name stores)
  name: string
  trigger: string | null
  aesthetic: string | null
  baseModel: string | null
  provider: string
  sizeBytes: number | null
  coverUrl: string | null
  canGenerateCover: boolean
}

const items = ref<LoraItem[]>([])
const searchQuery = ref('')
const loading = ref(true)

const node = computed(() => props.nodes.find((n) => n.id === props.nodeId))

function widgetIndex(name: string): number {
  const defs = (node.value?.data?.widgetDefs ?? []) as any[]
  return defs.findIndex((d) => d.name === name)
}

const currentId = computed<string | null>(() => {
  const idx = widgetIndex('lora_name')
  const v = idx >= 0 ? node.value?.data?.widgetsValues?.[idx] : null
  return v && v !== '[None]' ? String(v) : null
})

const focusedId = ref<string | null>(null)

const visibleItems = computed<LoraItem[]>(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return items.value
  return items.value.filter((l) =>
    l.name.toLowerCase().includes(q)
    || (l.trigger || '').toLowerCase().includes(q)
    || (l.aesthetic || '').toLowerCase().includes(q))
})

const focusedItem = computed<LoraItem | null>(() =>
  visibleItems.value.find((i) => i.id === focusedId.value) ?? null)

onMounted(async () => {
  try {
    const res = await fetch('/api/loras-local')
    if (res.ok) {
      const data = await res.json() as { loras?: any[] }
      items.value = (data.loras || []).map((l) => ({
        id: l.filename,
        name: l.name,
        trigger: l.trigger ?? null,
        aesthetic: l.aesthetic ?? null,
        baseModel: l.baseModel ?? null,
        provider: l.provider ?? 'local',
        sizeBytes: l.sizeBytes ?? null,
        coverUrl: l.coverUrl ?? null,
        canGenerateCover: !!l.canGenerateCover,
      }))
    }
  } catch { /* offline — empty gallery */ } finally {
    loading.value = false
    focusedId.value = currentId.value ?? items.value[0]?.id ?? null
  }
})

// Generate-on-demand cover thumbnails (cached on disk server-side). Explicit
// per-LoRA action — one Replicate generation each (~$0.04), never automatic.
const generating = ref<Set<string>>(new Set())
const coverError = ref<Record<string, string>>({})

async function generateCover(item: LoraItem, e?: Event) {
  e?.stopPropagation() // don't also select the card
  if (generating.value.has(item.id)) return
  generating.value = new Set(generating.value).add(item.id)
  coverError.value = { ...coverError.value, [item.id]: '' }
  try {
    const res = await fetch('/api/lora-cover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: item.id }),
    })
    const data = await res.json() as { coverUrl?: string, message?: string }
    if (!res.ok) throw new Error(data?.message || `Failed (${res.status})`)
    if (data.coverUrl) item.coverUrl = data.coverUrl // reactive — card shows it
  } catch (err: any) {
    coverError.value = { ...coverError.value, [item.id]: err?.message || 'Generation failed' }
  } finally {
    const next = new Set(generating.value); next.delete(item.id); generating.value = next
  }
}

function onConfirm(item: LoraItem) {
  const data = node.value?.data
  if (!data) { emit('close'); return }
  const set = (name: string, value: any) => {
    const idx = widgetIndex(name)
    if (idx >= 0) data.widgetsValues[idx] = value
  }
  // Style block (aesthetic + trigger) → the node's "Style" PROPERTY (folded
  // into the prompt at run time). Schema stays stable; prompt box stays clean.
  const trig = item.trigger?.trim()
  const style = [item.aesthetic?.trim(), trig ? `${trig},` : ''].filter(Boolean).join(' ')
  set('lora_name', item.id)
  set('lora_url', '')                            // clear override so the name drives
  if (!data.properties) data.properties = {}
  data.properties.aesthetic = style
  emit('close')
}

function fmtMB(bytes: number | null): string {
  return bytes ? `${Math.round(bytes / 1024 / 1024)} MB` : ''
}
</script>

<template>
  <CatalogModal
    :open="true"
    title="Your LoRAs"
    :subtitle="loading ? 'Loading…' : `${items.length} trained`"
    :items="visibleItems"
    :selected-id="currentId"
    :search-query="searchQuery"
    search-placeholder="Search by name, trigger, style…"
    :confirm-label="focusedItem ? `Use ${focusedItem.name}` : 'Use this'"
    empty-message="No trained LoRAs yet — train one in the Train LoRA tab."
    @close="emit('close')"
    @confirm="(item: any) => onConfirm(item as LoraItem)"
    @update:selected-id="(id: string) => focusedId = id"
    @update:search-query="(q: string) => searchQuery = q"
  >
    <!-- Card -->
    <template #card="{ item }">
      <div class="aspect-[16/10] w-full relative overflow-hidden flex items-center justify-center bg-white/[0.05]">
        <!-- Generated cover thumbnail -->
        <img
          v-if="(item as LoraItem).coverUrl"
          :src="(item as LoraItem).coverUrl!"
          class="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
        />
        <!-- Generating spinner -->
        <div v-else-if="generating.has((item as LoraItem).id)" class="flex flex-col items-center gap-1 text-white/55">
          <Loader2 class="size-5 animate-spin" />
          <span class="text-[8.5px]">Generating…</span>
        </div>
        <!-- Placeholder + generate button -->
        <template v-else>
          <Sparkles class="size-6 text-white/20" />
          <button
            v-if="(item as LoraItem).canGenerateCover"
            class="absolute inset-x-1.5 bottom-1.5 h-6 rounded-md bg-black/50 hover:bg-black/70 backdrop-blur-sm text-[9px] text-white/85 transition-colors cursor-pointer flex items-center justify-center gap-1"
            title="Run this LoRA once (~$0.04) to make a preview"
            @click="(e: MouseEvent) => generateCover(item as LoraItem, e)"
          >
            <Sparkles class="size-2.5" /> Generate preview
          </button>
        </template>
        <span
          v-if="(item as LoraItem).baseModel"
          class="absolute top-1.5 right-1.5 text-[8.5px] uppercase tracking-wide text-white/70 bg-black/40 px-1 py-0.5 rounded"
        >{{ (item as LoraItem).baseModel }}</span>
      </div>
      <div class="p-2">
        <div class="text-[11px] font-medium text-white truncate">{{ (item as LoraItem).name }}</div>
        <div v-if="(item as LoraItem).trigger" class="text-[9.5px] font-mono text-white/45 truncate">
          {{ (item as LoraItem).trigger }}
        </div>
        <div v-if="coverError[(item as LoraItem).id]" class="text-[9px] text-red-300/80 truncate" :title="coverError[(item as LoraItem).id]">{{ coverError[(item as LoraItem).id] }}</div>
      </div>
    </template>

    <!-- Detail pane -->
    <template #detail="{ item }">
      <div class="space-y-3">
        <!-- Cover preview / generate -->
        <div class="aspect-square w-full rounded-lg overflow-hidden bg-white/[0.04] border border-white/[0.06] relative flex items-center justify-center">
          <img v-if="(item as LoraItem).coverUrl" :src="(item as LoraItem).coverUrl!" class="absolute inset-0 w-full h-full object-cover" />
          <div v-else-if="generating.has((item as LoraItem).id)" class="flex flex-col items-center gap-1.5 text-white/55">
            <Loader2 class="size-6 animate-spin" />
            <span class="text-[10px]">Generating preview… (~15s)</span>
          </div>
          <div v-else class="flex flex-col items-center gap-2 px-4 text-center">
            <Sparkles class="size-7 text-white/20" />
            <p class="text-[10.5px] text-white/40 leading-snug">No preview yet.</p>
            <button
              v-if="(item as LoraItem).canGenerateCover"
              class="inline-flex items-center gap-1.5 h-7 px-3 rounded-md bg-white/[0.08] hover:bg-white/[0.14] text-[11px] text-white/85 transition-colors cursor-pointer"
              title="Runs this LoRA once on Replicate (~$0.04) and caches the result"
              @click="generateCover(item as LoraItem)"
            >
              <Sparkles class="size-3" /> Generate preview
            </button>
            <span class="text-[9px] text-white/25">~$0.04 · one-time</span>
          </div>
        </div>
        <p v-if="coverError[(item as LoraItem).id]" class="text-[10px] text-red-300/80">{{ coverError[(item as LoraItem).id] }}</p>

        <div>
          <div class="text-[15px] font-semibold text-white">{{ (item as LoraItem).name }}</div>
          <div class="text-[11px] text-white/45 mt-0.5">
            {{ (item as LoraItem).provider === 'replicate' ? 'Trained · Replicate' : 'Local' }}<span v-if="fmtMB((item as LoraItem).sizeBytes)"> · {{ fmtMB((item as LoraItem).sizeBytes) }}</span>
          </div>
        </div>
        <div v-if="(item as LoraItem).trigger" class="flex items-center gap-2">
          <span class="text-[10px] uppercase tracking-wide text-white/40">Trigger</span>
          <code class="text-[11px] font-mono text-white/80 bg-white/[0.05] px-1.5 py-0.5 rounded">{{ (item as LoraItem).trigger }}</code>
        </div>
        <div v-if="(item as LoraItem).aesthetic">
          <div class="text-[10px] uppercase tracking-wide text-white/40 mb-1">Aesthetic</div>
          <p class="text-[11.5px] text-white/65 leading-relaxed">{{ (item as LoraItem).aesthetic }}</p>
        </div>
        <p v-else class="text-[11px] text-white/35 italic">No aesthetic attached.</p>
      </div>
    </template>
  </CatalogModal>
</template>
