<script setup lang="ts">
/**
 * ModelGalleryModal — image-generation model picker for the "Generate an
 * image" node. Wraps CatalogModal with model-specific card + detail rendering
 * and writes the selected model + its per-model advanced settings back into
 * the node.
 *
 * State path:
 *   node.widgetsValues[model_idx]      = selected model id  (Combo widget)
 *   node.properties.modelOptions[id]   = per-model advanced bag (JSON)
 *
 * The shared inputs (prompt, aspect_ratio, seed) stay on the node as
 * regular widgets — only model selection + model-specific tuning lives
 * here.
 */
import { Sparkles, Zap, DollarSign, Type as TypeIcon, Layout, Box as VectorIcon,
  Camera, Film, Brush, Code2, Maximize2, Layers } from 'lucide-vue-next'
import {
  IMAGE_MODELS, IMAGE_MODELS_BY_ID, TAG_LABELS, activeTagsInCatalog,
  type ImageModel, type ImageModelTag, type ImageModelAdvancedField,
} from '~/data/image-models'

const props = defineProps<{
  nodeId: string
  nodes: any[]
}>()

const emit = defineEmits<{ close: [] }>()

const node = computed(() => props.nodes.find(n => n.id === props.nodeId))

// -- Read the node's current model + options ---------------------------------

const modelWidgetIdx = computed(() => {
  const defs = (node.value?.data?.widgetDefs ?? []) as any[]
  return defs.findIndex(d => d.name === 'model')
})

const currentModelId = computed<string | null>(() => {
  const idx = modelWidgetIdx.value
  if (idx < 0) return null
  const val = node.value?.data?.widgetsValues?.[idx]
  return typeof val === 'string' ? val : null
})

// per-node, per-model JSON bag stored in node.properties.modelOptions[modelId]
function getModelOptions(modelId: string): Record<string, any> {
  const bag = (node.value?.data?.properties as any)?.modelOptions
  if (bag && typeof bag === 'object' && bag[modelId]) return { ...bag[modelId] }
  // Seed with defaults from the catalog so the form has values to bind.
  const model = IMAGE_MODELS_BY_ID[modelId]
  if (!model) return {}
  return Object.fromEntries(model.advanced.map(f => [f.name, f.default]))
}

function setModelOptions(modelId: string, opts: Record<string, any>) {
  const data = node.value?.data
  if (!data) return
  if (!data.properties) data.properties = {}
  if (!data.properties.modelOptions) data.properties.modelOptions = {}
  data.properties.modelOptions = {
    ...data.properties.modelOptions,
    [modelId]: opts,
  }
  syncOptionsToHiddenWidget()
}

// Mirror the *active* model's options bag into the hidden `model_options`
// STRING widget so the backend's `execute()` receives the JSON without
// needing a separate `properties` channel. Idempotent — safe to call after
// every edit.
function syncOptionsToHiddenWidget() {
  const data = node.value?.data
  if (!data) return
  const defs = (data.widgetDefs ?? []) as any[]
  const optsIdx = defs.findIndex(d => d.name === 'model_options')
  if (optsIdx < 0) return
  const modelId = data.widgetsValues?.[modelWidgetIdx.value]
  const bag = (data.properties?.modelOptions ?? {})[modelId] ?? {}
  data.widgetsValues[optsIdx] = JSON.stringify(bag)
}

// Working draft — what the user is editing in the modal. Committed on
// "Use this model"; discarded on close. Keeps the canvas state stable
// while the user fiddles inside the modal.
const draftModelId = ref<string | null>(null)
const draftOptions = ref<Record<string, any>>({})

function loadDraftFor(modelId: string | null) {
  draftModelId.value = modelId
  draftOptions.value = modelId ? getModelOptions(modelId) : {}
}

onMounted(() => loadDraftFor(currentModelId.value))
// Re-seed when the node we're attached to changes (e.g. the modal is reused
// across different nodes via the same mount point).
watch(() => props.nodeId, () => loadDraftFor(currentModelId.value))

// -- Filtering + search ------------------------------------------------------

const searchQuery = ref('')
const activeFilterId = ref<string>('all')

const filters = computed(() => {
  const tags = activeTagsInCatalog()
  const counts = new Map<ImageModelTag, number>()
  for (const m of IMAGE_MODELS) for (const t of m.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
  return [
    { id: 'all', label: 'All', count: IMAGE_MODELS.length },
    ...tags.map(t => ({ id: t, label: TAG_LABELS[t], count: counts.get(t) ?? 0 })),
  ]
})

const visibleItems = computed<ImageModel[]>(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return IMAGE_MODELS.filter((m) => {
    if (activeFilterId.value !== 'all' && !m.tags.includes(activeFilterId.value as ImageModelTag)) return false
    if (!q) return true
    return [m.label, m.brand, m.pitch, m.description ?? '', m.replicateSlug, ...m.tags]
      .some(s => s.toLowerCase().includes(q))
  })
})

// -- Tag → icon (small chip glyph) -------------------------------------------

const TAG_ICONS: Record<ImageModelTag, any> = {
  'flagship':    Sparkles,
  'fast':        Zap,
  'cheap':       DollarSign,
  'typography':  TypeIcon,
  'design':      Layout,
  'svg':         VectorIcon,
  'photoreal':   Camera,
  'cinematic':   Film,
  'anime':       Brush,
  'open-source': Code2,
  '4k':          Maximize2,
  'multi-image': Layers,
}

// -- Brand → swatch (deterministic, falls back to hash) ----------------------

const BRAND_COLORS: Record<string, string> = {
  'BFL':          '#ff6b8b',
  'Google':       '#4796ff',
  'OpenAI':       '#10a37f',
  'ByteDance':    '#26a6ff',
  'Ideogram':     '#a86bff',
  'Recraft':      '#ffb84d',
  'Stability AI': '#ff8a4d',
  'Alibaba':      '#ff7a3d',
  'Tencent':      '#48a8ff',
  'xAI':          '#cccccc',
  'Pruna':        '#9b6bff',
  'Meta':         '#3d7aff',
  'Other':        '#888',
}

function brandHue(brand: string): string {
  return BRAND_COLORS[brand] ?? '#888'
}

function priceLabel(p: number | null): string {
  if (p == null) return '—'
  if (p < 0.01) return `<$0.01`
  if (p < 1) return `$${p.toFixed(p < 0.1 ? 3 : 2).replace(/0$/, '')}`
  return `$${p.toFixed(2)}`
}

// -- Commit ------------------------------------------------------------------

function onConfirm(item: ImageModel) {
  const idx = modelWidgetIdx.value
  if (idx < 0) {
    emit('close')
    return
  }
  // 1) Set the model combo value.
  node.value!.data.widgetsValues[idx] = item.id
  // 2) Persist the per-model options bag.
  setModelOptions(item.id, draftOptions.value)
  emit('close')
}

// When the user focuses a different model in the gallery, load its draft
// options too so the right pane reflects that model's settings. Re-uses
// any prior state stored on the node.
watch(() => draftModelId.value, (id) => {
  if (id) draftOptions.value = getModelOptions(id)
})

const focusedModel = computed<ImageModel | null>(() =>
  draftModelId.value ? IMAGE_MODELS_BY_ID[draftModelId.value] ?? null : null,
)
</script>

<template>
  <CatalogModal
    :open="true"
    :title="`Pick a model for &quot;Generate an image&quot;`"
    :subtitle="`${IMAGE_MODELS.length} models · Replicate`"
    :items="visibleItems"
    :selected-id="currentModelId"
    :filters="filters"
    :active-filter-id="activeFilterId"
    :search-query="searchQuery"
    search-placeholder="Search by name, brand, capability…"
    :confirm-label="focusedModel ? `Use ${focusedModel.label}` : 'Use this'"
    empty-message="No models match those filters."
    @close="emit('close')"
    @confirm="(item: any) => onConfirm(item as ImageModel)"
    @update:selected-id="(id: string) => loadDraftFor(id)"
    @update:active-filter-id="(id: string) => activeFilterId = id"
    @update:search-query="(q: string) => searchQuery = q"
  >
    <!-- Card -->
    <template #card="{ item, focused }">
      <!-- Thumbnail strip / brand swatch -->
      <div
        class="aspect-[16/10] w-full relative overflow-hidden"
        :style="!(item as ImageModel).thumb
          ? { background: `linear-gradient(135deg, ${brandHue((item as ImageModel).brand)}33 0%, ${brandHue((item as ImageModel).brand)}11 60%, transparent 100%)` }
          : {}"
      >
        <img
          v-if="(item as ImageModel).thumb"
          :src="(item as ImageModel).thumb"
          class="absolute inset-0 w-full h-full object-cover transition-transform duration-500"
          :class="focused ? 'scale-105' : 'group-hover:scale-105'"
          loading="lazy"
        />
        <!-- Brand wordmark when no thumb -->
        <div
          v-else
          class="absolute inset-0 flex items-center justify-center text-[28px] font-bold tracking-tight select-none"
          :style="{ color: brandHue((item as ImageModel).brand) }"
        >
          {{ (item as ImageModel).brand }}
        </div>
        <!-- Price badge -->
        <span
          v-if="(item as ImageModel).pricePerImage != null"
          class="absolute top-2 right-2 text-[9px] tabular-nums leading-none px-1.5 py-1 rounded bg-black/55 text-amber-200 border border-amber-400/20 backdrop-blur-sm"
        >{{ priceLabel((item as ImageModel).pricePerImage) }}</span>
      </div>
      <!-- Body -->
      <div class="px-3 pt-2.5 pb-3 flex flex-col gap-1.5">
        <div class="flex items-baseline gap-1.5 min-w-0">
          <span class="text-[13px] font-semibold text-white/90 truncate">{{ (item as ImageModel).label }}</span>
          <span class="text-[10px] text-white/35 uppercase tracking-[0.06em] shrink-0">{{ (item as ImageModel).brand }}</span>
        </div>
        <p class="text-[11px] leading-snug text-white/55 line-clamp-2 min-h-[2.4em]">
          {{ (item as ImageModel).pitch }}
        </p>
        <div class="flex flex-wrap gap-1 mt-0.5">
          <span
            v-for="t in (item as ImageModel).tags.slice(0, 3)"
            :key="t"
            class="inline-flex items-center gap-1 text-[9.5px] uppercase tracking-[0.05em] px-1.5 py-0.5 rounded bg-white/[0.05] text-white/55 border border-white/[0.05]"
          >
            <component :is="TAG_ICONS[t]" class="size-2.5" />
            {{ TAG_LABELS[t] }}
          </span>
        </div>
      </div>
    </template>

    <!-- Detail pane -->
    <template #detail="{ item }">
      <div class="p-5 space-y-5">
        <!-- Header -->
        <div>
          <div class="flex items-center gap-2 mb-1">
            <span class="text-sm font-semibold text-white/95">{{ (item as ImageModel).label }}</span>
            <span
              class="text-[10px] uppercase tracking-[0.08em] font-medium px-1.5 py-0.5 rounded"
              :style="{
                color: brandHue((item as ImageModel).brand),
                background: `${brandHue((item as ImageModel).brand)}1f`,
              }"
            >{{ (item as ImageModel).brand }}</span>
          </div>
          <p class="text-[11.5px] text-white/65 leading-relaxed">
            {{ (item as ImageModel).description ?? (item as ImageModel).pitch }}
          </p>
          <a
            :href="`https://replicate.com/${(item as ImageModel).replicateSlug}`"
            target="_blank"
            rel="noopener"
            class="inline-block mt-2 text-[10px] text-white/40 hover:text-white/70 font-mono transition-colors"
          >
            replicate.com/{{ (item as ImageModel).replicateSlug }} ↗
          </a>
        </div>

        <!-- Price + tag chips -->
        <div class="flex flex-wrap items-center gap-1.5">
          <span
            v-if="(item as ImageModel).pricePerImage != null"
            class="inline-flex items-center gap-1 text-[10px] tabular-nums px-2 py-1 rounded bg-amber-500/10 text-amber-200 border border-amber-400/15"
          >
            {{ priceLabel((item as ImageModel).pricePerImage) }} per image
          </span>
          <span
            v-for="t in (item as ImageModel).tags"
            :key="t"
            class="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.05em] px-1.5 py-0.5 rounded bg-white/[0.05] text-white/55 border border-white/[0.05]"
          >
            <component :is="TAG_ICONS[t]" class="size-2.5" />
            {{ TAG_LABELS[t] }}
          </span>
        </div>

        <!-- Advanced settings -->
        <div v-if="(item as ImageModel).advanced.length" class="space-y-3 pt-1 border-t border-white/[0.06]">
          <div class="text-[10px] uppercase tracking-[0.08em] text-white/40 font-semibold pt-3">
            Advanced settings
          </div>
          <div class="space-y-3">
            <div
              v-for="field in (item as ImageModel).advanced"
              :key="field.name"
              class="space-y-1"
            >
              <label class="block text-[10.5px] text-white/65" :title="field.description">
                {{ field.label }}
                <span v-if="field.description" class="text-white/30">— {{ field.description }}</span>
              </label>
              <!-- Select -->
              <select
                v-if="field.type === 'select'"
                :value="draftOptions[field.name] ?? field.default"
                class="w-full bg-white/[0.04] border border-white/10 rounded px-2 py-1.5 text-[11px] text-white/85 cursor-pointer outline-none focus:bg-white/[0.06] focus:border-white/20 transition-colors"
                @change="draftOptions = { ...draftOptions, [field.name]: ($event.target as HTMLSelectElement).value }"
              >
                <option v-for="opt in field.options" :key="opt" :value="opt" class="bg-[#1b1b1b]">{{ opt }}</option>
              </select>
              <!-- Integer / Float -->
              <input
                v-else-if="field.type === 'integer' || field.type === 'float'"
                type="number"
                :value="draftOptions[field.name] ?? field.default"
                :min="field.min"
                :max="field.max"
                :step="field.step ?? (field.type === 'integer' ? 1 : 0.1)"
                class="w-full bg-white/[0.04] border border-white/10 rounded px-2 py-1.5 text-[11px] text-white/85 outline-none focus:bg-white/[0.06] focus:border-white/20 transition-colors"
                @input="draftOptions = { ...draftOptions, [field.name]: field.type === 'integer'
                  ? parseInt(($event.target as HTMLInputElement).value, 10)
                  : parseFloat(($event.target as HTMLInputElement).value) }"
              />
              <!-- Boolean -->
              <label v-else-if="field.type === 'boolean'" class="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  :checked="!!(draftOptions[field.name] ?? field.default)"
                  class="size-3.5 rounded border-white/20 bg-white/[0.04] cursor-pointer accent-white"
                  @change="draftOptions = { ...draftOptions, [field.name]: ($event.target as HTMLInputElement).checked }"
                />
                <span class="text-[11px] text-white/65">
                  {{ (draftOptions[field.name] ?? field.default) ? 'On' : 'Off' }}
                </span>
              </label>
              <!-- String -->
              <input
                v-else
                type="text"
                :value="draftOptions[field.name] ?? field.default"
                class="w-full bg-white/[0.04] border border-white/10 rounded px-2 py-1.5 text-[11px] text-white/85 outline-none focus:bg-white/[0.06] focus:border-white/20 transition-colors"
                @input="draftOptions = { ...draftOptions, [field.name]: ($event.target as HTMLInputElement).value }"
              />
            </div>
          </div>
        </div>
        <div v-else class="pt-3 border-t border-white/[0.06] text-[11px] text-white/40 italic">
          No advanced settings — this model uses sane defaults.
        </div>

        <!-- Aspect ratios this model supports -->
        <div class="pt-3 border-t border-white/[0.06]">
          <div class="text-[10px] uppercase tracking-[0.08em] text-white/40 font-semibold mb-2">
            Supported aspect ratios
          </div>
          <div class="flex flex-wrap gap-1">
            <span
              v-for="ar in (item as ImageModel).aspectRatios"
              :key="ar"
              class="text-[10px] tabular-nums px-1.5 py-0.5 rounded bg-white/[0.04] text-white/55 border border-white/[0.05]"
            >
              {{ ar }}
            </span>
          </div>
        </div>
      </div>
    </template>
  </CatalogModal>
</template>
