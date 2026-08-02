<script setup lang="ts">
/**
 * LoraGalleryModal — visual gallery for picking a trained LoRA, opened from the
 * FluxLoRARemoteNode `lora_name` launcher (WidgetLoraPicker). Reuses the generic
 * CatalogModal shell. On confirm it writes to the node's widgets directly:
 *   lora_name = filename                  (drives the run; lora_url is cleared)
 *   prompt    = "<aesthetic> <trigger>, "  (style kept in the prompt — no
 *                separate node input, so the ComfyUI schema stays stable)
 */
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { Sparkles, Loader2, Pencil, Check, X, RefreshCcw, Copy, Trash2 } from 'lucide-vue-next'
import { HOUSE_STYLES, houseStyleStyleBlock, type HouseStyle } from '~/data/house-styles'
import { nextCopyName } from '~/lib/lora/copyName'
import {
  type LoraGalleryTab,
  initialLoraGalleryTab,
  loraGallerySource,
  isCharacterItem,
} from '~/lib/graph/loraGalleryTabs'
import { slotAestheticKey } from '~/lib/graph/loraStyleBlocks'

const props = defineProps<{
  nodeId: string
  nodes: any[]
  widgetName?: string          // which combo to write (default 'lora_name')
  kind?: 'character' | 'style'  // 'character' → browse characters, not styles
}>()
const emit = defineEmits<{ close: [] }>()

// The combo this gallery edits, and whether it browses characters or styles.
const targetWidget = computed(() => props.widgetName || 'lora_name')
const isCharacter = computed(() => props.kind === 'character')

// FluxMultiLoRARemoteNode's slots (lora_a..lora_d) each carry a `lora_<letter>_url`
// override sibling and a `scale_<letter>` sibling. Derive both from the slot
// letter so every slot behaves alike — hardcoding just 'lora_a'/'lora_b' left
// lora_c/lora_d (and, for the house-style path below, even lora_a) silently
// writing to the single-LoRA node's 'lora_url', which this node doesn't have.
// Anything that isn't a lora_<letter> slot (e.g. the single-LoRA node's
// 'lora_name') keeps today's 'lora_url' fallback and no scale sibling.
function loraSlotSiblings(target: string): { url: string; scale: string | null } {
  const m = /^lora_([a-d])$/.exec(target)
  return m ? { url: `lora_${m[1]}_url`, scale: `scale_${m[1]}` } : { url: 'lora_url', scale: null }
}

// One-time migration: before per-slot style blocks existed, only slot B could
// ever receive a style (slot A was character-only and the House tab was
// hidden there), so a workflow saved pre-migration has its slot-B style
// sitting in plain `properties.aesthetic`. composeLoraStyle still reads that
// fine on load (the node-level block is always included) — but if the user
// then re-picks a style into slot B, writing `aesthetic_b` while the stale
// `aesthetic` still holds the old B text would double-count both. So: right
// before writing any slot key on a multi-slot node, if `aesthetic` is
// non-empty and no aesthetic_a..d has been set yet, move it into aesthetic_b.
function migrateLegacyAestheticIfNeeded(properties: Record<string, any>) {
  const hasSlotKey = (['aesthetic_a', 'aesthetic_b', 'aesthetic_c', 'aesthetic_d'] as const)
    .some((k) => String(properties[k] || '').trim())
  if (hasSlotKey) return
  const legacy = String(properties.aesthetic || '').trim()
  if (!legacy) return
  properties.aesthetic_b = legacy
  delete properties.aesthetic
}

// Shared write path for both the house-style and local-style branches below:
// per-slot key on multi-slot nodes (running the migration first), plain
// `aesthetic` everywhere else (the single-LoRA node's `lora_name` slot).
function writeAesthetic(data: any, targetWidgetName: string, style: string) {
  if (!data.properties) data.properties = {}
  const slotKey = slotAestheticKey(targetWidgetName)
  if (slotKey) {
    migrateLegacyAestheticIfNeeded(data.properties)
    data.properties[slotKey] = style
  } else {
    data.properties.aesthetic = style
  }
}
const noun = computed(() => (isCharacter.value ? 'Character' : 'Style'))
const nounPlural = computed(() => (isCharacter.value ? 'Characters' : 'Styles'))

interface LoraItem {
  id: string                 // filename (the value lora_name stores), or `house:<id>`
  name: string
  trigger: string | null
  aesthetic: string | null
  baseModel: string | null
  provider: string
  sizeBytes: number | null
  coverUrl: string | null
  canGenerateCover: boolean
  duplicateOf: string | null // set on copies (see duplicateItem) — gates Delete
  houseStyle?: HouseStyle    // present only for House-tab entries (drives onConfirm)
  kind?: string              // 'character' | 'style' (as reported by /api/loras-local) — drives trigger routing in onConfirm, NOT the slot's own kind
}

const items = ref<LoraItem[]>([])
const searchQuery = ref('')
const loading = ref(true)

// House tab — published, all-user style LoRAs (Task 1 data). Modeled as
// LoraItem so the existing card/detail templates and search filter Just Work;
// canGenerateCover: false hides the cover-generate affordance (no local
// sidecar to run against), and houseStyle is the onConfirm discriminator.
const kindTab = ref<LoraGalleryTab>(initialLoraGalleryTab(props.kind))
const houseItems = computed<LoraItem[]>(() => HOUSE_STYLES.map((s) => ({
  id: `house:${s.id}`,
  name: s.label,
  trigger: s.trigger,
  aesthetic: s.tasteProfile,
  baseModel: null,
  provider: 'house',
  sizeBytes: null,
  coverUrl: s.thumbnails[0] ?? null,
  canGenerateCover: false,
  duplicateOf: null,
  houseStyle: s,
})))
// Every slot can browse every library now — no more hard-gating by the
// slot's own kind. Local LoRAs are fetched unfiltered (see onMounted) and
// partitioned here at render time.
const characterItems = computed<LoraItem[]>(() => items.value.filter((l) => l.kind === 'character'))
const styleItems = computed<LoraItem[]>(() => items.value.filter((l) => l.kind !== 'character'))
// House chip shows whenever a published library exists, regardless of slot.
const showHouseTab = computed(() => HOUSE_STYLES.length > 0)
const filters = computed(() => {
  const entries: { id: LoraGalleryTab; label: string; count: number }[] = [
    { id: 'characters', label: 'Characters', count: characterItems.value.length },
    { id: 'yours', label: 'Your Styles', count: styleItems.value.length },
  ]
  if (showHouseTab.value) entries.push({ id: 'house', label: 'House Library', count: houseItems.value.length })
  // Hide the strip entirely if there's nothing meaningful to switch between.
  return entries.length > 1 ? entries : undefined
})

const node = computed(() => props.nodes.find((n) => n.id === props.nodeId))

function widgetIndex(name: string): number {
  const defs = (node.value?.data?.widgetDefs ?? []) as any[]
  return defs.findIndex((d) => d.name === name)
}

const currentId = computed<string | null>(() => {
  const idx = widgetIndex(targetWidget.value)
  const v = idx >= 0 ? node.value?.data?.widgetsValues?.[idx] : null
  return v && v !== '[None]' ? String(v) : null
})

const focusedId = ref<string | null>(null)

const visibleItems = computed<LoraItem[]>(() => {
  const source = loraGallerySource(characterItems.value, styleItems.value, houseItems.value, kindTab.value)
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return source
  return source.filter((l) =>
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
      // Keep ALL local LoRAs (characters and styles alike) — the tab strip
      // partitions them at render time via characterItems/styleItems, so any
      // slot can browse either library.
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
        duplicateOf: l.duplicateOf ?? null,
        kind: l.kind,
      }))
    }
  } catch { /* offline — empty gallery */ } finally {
    loading.value = false
    focusedId.value = currentId.value ?? visibleItems.value[0]?.id ?? null
  }
})

// Generate (or refresh) a cover thumbnail — cached on disk server-side; the
// endpoint overwrites any existing cover and returns a cache-busted URL, so the
// same call powers both first-time generate and refresh. Explicit per-LoRA
// action — one Replicate generation each (~$0.04), never automatic.
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
  if (!data || !Array.isArray(data.widgetsValues)) { emit('close'); return }
  const set = (name: string, value: any) => {
    const idx = widgetIndex(name)
    if (idx >= 0) data.widgetsValues[idx] = value
  }

  // The LoRA this slot held before the swap — its trigger may sit in the
  // visible prompt (nodes created from the Characters panel write triggers
  // there), so replace/strip it regardless of which tier the new pick belongs
  // to (house styles never write a trigger into the prompt, so they pass
  // `null` and the old token is dropped outright rather than replaced).
  const prevTrig = items.value.find((i) => i.id === currentId.value)?.trigger?.trim()
  const stripOrReplacePrevTrig = (newTrig: string | null | undefined) => {
    if (!prevTrig || prevTrig === newTrig) return
    const pIdx = widgetIndex('prompt')
    const cur = pIdx >= 0 ? String(data.widgetsValues[pIdx] ?? '') : ''
    if (pIdx < 0 || !cur.includes(prevTrig)) return
    const escaped = prevTrig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    data.widgetsValues[pIdx] = newTrig && !cur.includes(newTrig)
      ? cur.replace(prevTrig, newTrig)
      // New trigger already present (or none) — just drop the old token.
      : cur.replace(new RegExp(`${escaped}\\s*,?\\s*`), '')
  }

  // House style: no local file to select, so drive the run entirely off the
  // URL-override sibling widget. A multi-LoRA slot (lora_a-lora_d) loads the
  // multi-lora stack from the trained WEIGHTS tarball; the single-LoRA node's
  // 'lora_name' direct-runs the private Replicate model. '[None]' is the
  // combo's actual none sentinel — see FluxLoRARemoteNode /
  // FluxMultiLoRARemoteNode combo options in comfy_api_nodes/nodes_replicate.py
  // (options end with ["[None]"], default "[None]") — matches how currentId
  // already treats it as "unset" above.
  if (item.houseStyle) {
    const houseStyle = item.houseStyle
    stripOrReplacePrevTrig(null)
    const { url: urlWidget, scale: scaleWidget } = loraSlotSiblings(targetWidget.value)
    const isMultiSlot = scaleWidget !== null
    set(urlWidget, isMultiSlot ? houseStyle.weightsUrl : houseStyle.replicateModel)
    set(targetWidget.value, '[None]')
    if (scaleWidget) set(scaleWidget, houseStyle.suggestedScale ?? 0.8)
    writeAesthetic(data, targetWidget.value, houseStyleStyleBlock(houseStyle))
    emit('close')
    return
  }

  const trig = item.trigger?.trim()
  stripOrReplacePrevTrig(trig)
  // The URL-override sibling for this slot, cleared so the picked name drives.
  const urlOverride = loraSlotSiblings(targetWidget.value).url
  set(targetWidget.value, item.id)
  set(urlOverride, '')

  if (isCharacterItem(item)) {
    // Character: put its trigger in the prompt (activates the LoRA). Leave the
    // "Style" aesthetic property alone — the character's own look would fight
    // the style (and the multi-LoRA node's single Style slot holds the style's).
    if (trig) {
      const pIdx = widgetIndex('prompt')
      if (pIdx >= 0) {
        const cur = String(data.widgetsValues[pIdx] ?? '')
        if (!cur.includes(trig)) data.widgetsValues[pIdx] = cur ? `${trig}, ${cur}` : `${trig}, `
      }
    }
  } else {
    // Style: fold aesthetic + trigger into the node's "Style" PROPERTY (prepended
    // to the prompt at run time). Schema stays stable; prompt box stays clean.
    const style = [item.aesthetic?.trim(), trig ? `${trig},` : ''].filter(Boolean).join(' ')
    writeAesthetic(data, targetWidget.value, style)
  }
  emit('close')
}

function fmtMB(bytes: number | null): string {
  return bytes ? `${Math.round(bytes / 1024 / 1024)} MB` : ''
}

// --- Inline metadata edit — writes the on-disk .json sidecar via PATCH -------
const editing = ref(false)
const saving = ref(false)
const editError = ref('')
const editName = ref('')
const editTrigger = ref('')
const editAesthetic = ref('')

// Switching cards cancels any in-progress edit so fields never show stale data.
watch(focusedId, () => { editing.value = false; editError.value = ''; actionError.value = '' })

function startEdit(item: LoraItem) {
  editName.value = item.name || ''
  editTrigger.value = item.trigger || ''
  editAesthetic.value = item.aesthetic || ''
  editError.value = ''
  editing.value = true
}

function cancelEdit() {
  editing.value = false
  editError.value = ''
}

async function saveEdit(item: LoraItem) {
  if (saving.value) return
  saving.value = true
  editError.value = ''
  try {
    const res = await fetch('/api/loras-local', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: item.id,
        name: editName.value.trim(),
        trigger: editTrigger.value.trim(),
        aesthetic: editAesthetic.value.trim(),
      }),
    })
    const data = await res.json() as { name?: string, trigger?: string | null, aesthetic?: string | null, message?: string }
    if (!res.ok) throw new Error(data?.message || `Failed (${res.status})`)
    // Mutate the in-memory item (same object held in items.value) so the card
    // and detail pane reflect the edit immediately — no refetch needed.
    if (data.name) item.name = data.name
    item.trigger = data.trigger ?? null
    item.aesthetic = data.aesthetic ?? null
    editing.value = false
  } catch (e: any) {
    editError.value = e?.message || 'Save failed'
  } finally {
    saving.value = false
  }
}

// --- Duplicate / delete ------------------------------------------------------
// A duplicate is a second taste profile over the SAME trained weights: the server
// writes a new sidecar pointing at the same hosted model (no .safetensors copy).
// It lands focused and already in edit mode, since the copy is only useful once
// its aesthetic has been rewritten.
const duplicating = ref(false)
const deleting = ref(false)
const actionError = ref('')

async function duplicateItem(item: LoraItem, e?: Event) {
  e?.stopPropagation() // don't also select the card
  if (duplicating.value) return
  duplicating.value = true
  actionError.value = ''
  try {
    const name = nextCopyName(item.name, items.value.map(i => i.name))
    const res = await fetch('/api/loras-local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: item.id, name }),
    })
    const data = await res.json() as {
      filename?: string, name?: string, trigger?: string | null
      aesthetic?: string | null, message?: string
    }
    if (!res.ok || !data.filename) throw new Error(data?.message || `Failed (${res.status})`)

    const copy: LoraItem = {
      id: data.filename,
      name: data.name || name,
      trigger: data.trigger ?? null,
      aesthetic: data.aesthetic ?? null,
      baseModel: item.baseModel,
      provider: item.provider,
      sizeBytes: null,        // no weights of its own — it runs the original's
      coverUrl: null,         // starts blank; never shows an image this profile didn't make
      canGenerateCover: true, // it has a hosted model ref, so a cover can be baked
      duplicateOf: item.name,
      kind: item.kind,        // preserve character/style so it stays in the right tab
    }
    items.value.splice(items.value.indexOf(item) + 1, 0, copy)
    focusedId.value = copy.id
    // focusedId's watcher cancels any in-progress edit, so open the editor only
    // after it has run — otherwise the panel closes the instant it appears.
    await nextTick()
    startEdit(copy)
  } catch (err: any) {
    actionError.value = err?.message || 'Duplicate failed'
  } finally {
    duplicating.value = false
  }
}

async function deleteItem(item: LoraItem) {
  if (deleting.value) return
  if (!window.confirm(`Delete "${item.name}"? The style it was copied from is not affected.`)) return
  deleting.value = true
  actionError.value = ''
  try {
    const res = await fetch('/api/loras-local', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: item.id }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { message?: string }
      throw new Error(data?.message || `Failed (${res.status})`)
    }
    items.value = items.value.filter(i => i.id !== item.id)
    editing.value = false
    focusedId.value = visibleItems.value[0]?.id ?? null
  } catch (err: any) {
    actionError.value = err?.message || 'Delete failed'
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <CatalogModal
    :open="true"
    :title="kindTab === 'house' ? 'House Library' : kindTab === 'characters' ? 'Characters' : 'Your Styles'"
    :subtitle="loading ? 'Loading…' : (kindTab === 'house' ? `${houseItems.length} published` : kindTab === 'characters' ? `${characterItems.length} trained` : `${styleItems.length} trained`)"
    :items="visibleItems"
    :selected-id="currentId"
    :filters="filters"
    :active-filter-id="kindTab"
    :search-query="searchQuery"
    :search-placeholder="`Search by name, trigger, ${noun.toLowerCase()}…`"
    :confirm-label="focusedItem ? `Use ${focusedItem.name}` : 'Use this'"
    :empty-message="kindTab === 'house' ? 'No house styles match your search.' : kindTab === 'characters' ? 'No characters yet — tag a trained LoRA as a character in the Characters panel.' : 'No styles yet — create one in the Create a Style tab.'"
    @close="emit('close')"
    @confirm="(item: any) => onConfirm(item as LoraItem)"
    @update:selected-id="(id: string) => focusedId = id"
    @update:active-filter-id="(id: string) => kindTab = (id as LoraGalleryTab)"
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
            class="absolute inset-x-1.5 bottom-1.5 h-6 rounded bg-black/50 hover:bg-black/70 backdrop-blur-sm text-[9px] text-white/85 transition-colors cursor-pointer flex items-center justify-center gap-1"
            title="Run this Style once (~$0.04) to make a preview"
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
        <!-- Cover preview / generate / refresh -->
        <div class="aspect-square w-full rounded-lg overflow-hidden bg-white/[0.04] border border-white/[0.06] relative flex items-center justify-center">
          <img v-if="(item as LoraItem).coverUrl" :src="(item as LoraItem).coverUrl!" class="absolute inset-0 w-full h-full object-cover" />

          <!-- Generating overlay (covers the old cover while a new one renders) -->
          <div v-if="generating.has((item as LoraItem).id)" class="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-white/75 bg-black/55 backdrop-blur-sm">
            <Loader2 class="size-6 animate-spin" />
            <span class="text-[10px]">Generating preview… (~15s)</span>
          </div>

          <!-- No cover yet → first-time generate -->
          <div v-else-if="!(item as LoraItem).coverUrl" class="flex flex-col items-center gap-2 px-4 text-center">
            <Sparkles class="size-7 text-white/20" />
            <p class="text-[10.5px] text-white/40 leading-snug">No preview yet.</p>
            <button
              v-if="(item as LoraItem).canGenerateCover"
              class="inline-flex items-center gap-1.5 h-7 px-3 rounded bg-white/[0.08] hover:bg-white/[0.14] text-[11px] text-white/85 transition-colors cursor-pointer"
              title="Runs this Style once on Replicate (~$0.04) and caches the result"
              @click="generateCover(item as LoraItem)"
            >
              <Sparkles class="size-3" /> Generate preview
            </button>
            <span class="text-[9px] text-white/25">~$0.04 · one-time</span>
          </div>

          <!-- Has a cover → refresh affordance (only while editing) -->
          <button
            v-else-if="editing && (item as LoraItem).canGenerateCover"
            class="absolute bottom-2 right-2 inline-flex items-center gap-1.5 h-7 px-2.5 rounded bg-black/55 hover:bg-black/75 backdrop-blur-sm text-[11px] text-white/85 transition-colors cursor-pointer"
            title="Regenerate this preview — runs the Style once on Replicate (~$0.04)"
            @click="generateCover(item as LoraItem)"
          >
            <RefreshCcw class="size-3" /> Refresh · ~$0.04
          </button>
        </div>
        <p v-if="coverError[(item as LoraItem).id]" class="text-[10px] text-red-300/80">{{ coverError[(item as LoraItem).id] }}</p>

        <!-- Name + edit toggle -->
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <input
              v-if="editing"
              v-model="editName"
              class="w-full text-[15px] font-semibold text-white bg-white/[0.06] border border-white/15 focus:border-white/30 focus:outline-none rounded px-2 py-1"
              placeholder="Style name"
            />
            <div v-else class="text-[15px] font-semibold text-white truncate">{{ (item as LoraItem).name }}</div>
            <div class="text-[11px] text-white/45 mt-0.5">
              {{ (item as LoraItem).provider === 'replicate' ? 'Trained · Replicate' : (item as LoraItem).provider === 'house' ? 'House style' : 'Local' }}<span v-if="fmtMB((item as LoraItem).sizeBytes)"> · {{ fmtMB((item as LoraItem).sizeBytes) }}</span><span v-if="(item as LoraItem).duplicateOf"> · copy of {{ (item as LoraItem).duplicateOf }}</span>
            </div>
          </div>
          <!-- House items have no local .json sidecar to PATCH — no Edit affordance. -->
          <div v-if="!editing && !(item as LoraItem).houseStyle" class="shrink-0 flex items-center gap-1.5">
            <button
              class="inline-flex items-center gap-1 h-7 px-2 rounded bg-white/[0.06] hover:bg-white/[0.12] text-[11px] text-white/70 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
              title="Make a second style over the same training — same weights, new aesthetic. Free."
              :disabled="duplicating"
              @click="duplicateItem(item as LoraItem, $event)"
            >
              <Loader2 v-if="duplicating" class="size-3 animate-spin" />
              <Copy v-else class="size-3" /> Duplicate
            </button>
            <button
              class="inline-flex items-center gap-1 h-7 px-2 rounded bg-white/[0.06] hover:bg-white/[0.12] text-[11px] text-white/70 hover:text-white transition-colors cursor-pointer"
              title="Edit name, trigger and aesthetic"
              @click="startEdit(item as LoraItem)"
            >
              <Pencil class="size-3" /> Edit
            </button>
          </div>
        </div>
        <p v-if="actionError" class="text-[11px] text-red-300/80">{{ actionError }}</p>

        <!-- Trigger -->
        <div v-if="editing" class="space-y-1">
          <div class="text-[10px] uppercase tracking-wide text-white/40">Trigger</div>
          <input
            v-model="editTrigger"
            class="w-full text-[12px] font-mono text-white/85 bg-white/[0.06] border border-white/15 focus:border-white/30 focus:outline-none rounded px-2 py-1"
            placeholder="e.g. mystyle"
          />
        </div>
        <div v-else-if="(item as LoraItem).trigger" class="flex items-center gap-2">
          <span class="text-[10px] uppercase tracking-wide text-white/40">Trigger</span>
          <code class="text-[11px] font-mono text-white/80 bg-white/[0.05] px-1.5 py-0.5 rounded">{{ (item as LoraItem).trigger }}</code>
        </div>

        <!-- Aesthetic -->
        <div v-if="editing" class="space-y-1">
          <div class="text-[10px] uppercase tracking-wide text-white/40">Aesthetic</div>
          <textarea
            v-model="editAesthetic"
            rows="4"
            class="w-full text-[11.5px] text-white/80 bg-white/[0.06] border border-white/15 focus:border-white/30 focus:outline-none rounded px-2 py-1.5 leading-relaxed resize-y"
            placeholder="Describe the aesthetic…"
          />
        </div>
        <template v-else>
          <div v-if="(item as LoraItem).aesthetic">
            <div class="text-[10px] uppercase tracking-wide text-white/40 mb-1">Aesthetic</div>
            <p class="text-[11.5px] text-white/65 leading-relaxed">{{ (item as LoraItem).aesthetic }}</p>
          </div>
          <p v-else class="text-[11px] text-white/35 italic">No aesthetic attached.</p>
        </template>

        <!-- Edit actions -->
        <div v-if="editing" class="flex items-center gap-2 pt-1">
          <button
            class="inline-flex items-center gap-1.5 h-8 px-3 rounded bg-white text-[#0a0a0a] text-[12px] font-medium hover:bg-white/90 transition-colors cursor-pointer disabled:opacity-50"
            :disabled="saving"
            @click="saveEdit(item as LoraItem)"
          >
            <Loader2 v-if="saving" class="size-3.5 animate-spin" /><Check v-else class="size-3.5" />
            Save
          </button>
          <button
            class="inline-flex items-center gap-1.5 h-8 px-3 rounded bg-white/[0.06] hover:bg-white/[0.12] text-[12px] text-white/80 transition-colors cursor-pointer disabled:opacity-50"
            :disabled="saving"
            @click="cancelEdit"
          >
            <X class="size-3.5" /> Cancel
          </button>
          <!-- Only duplicates are removable — a trained style has no Delete at all
               (the server refuses it too, so this is an affordance, not the guard). -->
          <button
            v-if="(item as LoraItem).duplicateOf"
            class="ml-auto inline-flex items-center gap-1.5 h-8 px-3 rounded text-[12px] text-red-300/80 hover:text-red-200 hover:bg-red-400/10 transition-colors cursor-pointer disabled:opacity-50"
            :disabled="saving || deleting"
            title="Delete this copy — the style it came from is not affected"
            @click="deleteItem(item as LoraItem)"
          >
            <Loader2 v-if="deleting" class="size-3.5 animate-spin" /><Trash2 v-else class="size-3.5" />
            Delete
          </button>
        </div>
        <p v-if="editError" class="text-[10.5px] text-red-300/80">{{ editError }}</p>
      </div>
    </template>
  </CatalogModal>
</template>
