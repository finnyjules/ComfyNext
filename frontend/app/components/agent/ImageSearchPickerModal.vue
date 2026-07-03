<script setup lang="ts">
/**
 * ImageSearchPickerModal — the "pick" half of the canvas agent's web-image
 * search. The agent's `searchImages` command opens it with a query; it runs
 * the search (/api/image-search, Brave), shows a thumbnail grid, and imports
 * the user's picks: each becomes a ComfyUI input file via /api/image-fetch,
 * then an Image node on the canvas through the same `comfynext:addAssetNode`
 * path the Assets panel uses.
 *
 * The search box stays editable so the user can refine + re-search without
 * another LLM round-trip. Multi-select: click toggles, Import brings in all.
 */
import { computed, ref, watch } from 'vue'
import { $fetch } from 'ofetch'
import { Check, Globe, Search, X } from 'lucide-vue-next'
import type { ImageSearchResult } from '~~/server/utils/imageSearch'
import { isSmallImage, orderBySize } from '~/lib/imageSearchResults'

const props = defineProps<{ open: boolean; query: string }>()
const emit = defineEmits<{ close: []; done: [imported: number, failed: number] }>()

const { getLocalSetting, setLocalSetting } = useLocalSettings()
const braveKey = ref('')
const keyDraft = ref('')

const q = ref('')
const results = ref<ImageSearchResult[]>([])
const selected = ref<Set<string>>(new Set())
const searching = ref(false)
const importing = ref(false)
const importedCount = ref(0)
const error = ref('')

watch(() => props.open, (isOpen) => {
  if (!isOpen) return
  braveKey.value = getLocalSetting('ComfyNext.AI.BraveApiKey') ?? ''
  q.value = props.query
  results.value = []
  selected.value = new Set()
  error.value = ''
  if (braveKey.value) search()
}, { immediate: true })

async function search() {
  const query = q.value.trim()
  if (!query || searching.value || !braveKey.value) return
  searching.value = true; error.value = ''; selected.value = new Set()
  try {
    const res = await $fetch<{ results: ImageSearchResult[] }>('/api/image-search', {
      method: 'POST',
      body: { apiKey: braveKey.value, query, count: 24 },
      timeout: 30_000,
    })
    // Known-small (thumbnail-grade) images sink to the end of the grid so the
    // top rows are always worth importing.
    results.value = orderBySize(res.results)
    if (!res.results.length) error.value = 'No images found for that — try different words.'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    searching.value = false
  }
}

function saveKey() {
  const k = keyDraft.value.trim()
  if (!k) return
  setLocalSetting('ComfyNext.AI.BraveApiKey', k)
  braveKey.value = k
  keyDraft.value = ''
  search()
}

function toggle(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

const picks = computed(() => results.value.filter(r => selected.value.has(r.id)))

/** Import every pick: url → input-folder file → Image node on the canvas.
 *  Sequential so ComfyNext.addAssetNode cascade offsets land in order; failures
 *  skip that pick rather than aborting the batch. */
async function importPicks() {
  if (!picks.value.length || importing.value) return
  importing.value = true; error.value = ''; importedCount.value = 0
  let failed = 0
  for (const [i, r] of picks.value.entries()) {
    try {
      const { name } = await $fetch<{ name: string }>('/api/image-fetch', {
        method: 'POST',
        body: { url: r.imageUrl },
        timeout: 45_000,
      })
      window.dispatchEvent(new CustomEvent('comfynext:addAssetNode', {
        detail: { kind: 'image', filename: name, type: 'input', offsetX: i * 48, offsetY: i * 48 },
      }))
      importedCount.value++
    } catch {
      failed++
    }
  }
  importing.value = false
  emit('done', importedCount.value, failed)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm" @click.self="emit('close')">
      <div class="flex max-h-[82vh] w-[min(920px,92vw)] flex-col overflow-hidden rounded-[14px] border border-[#2a2a2a] bg-[#161616] shadow-2xl">
        <!-- Header: title + editable query -->
        <div class="flex items-center gap-3 border-b border-white/8 px-4 py-3">
          <Globe class="size-4 shrink-0 text-white/45" />
          <span class="shrink-0 text-[13px] font-medium text-white/85">Import images from the web</span>
          <div class="flex min-w-0 flex-1 items-center gap-2 rounded-[8px] bg-white/6 px-2.5 py-1.5">
            <Search class="size-3.5 shrink-0 text-white/35" />
            <input
              v-model="q" :disabled="searching || !braveKey" type="text"
              placeholder="Search the web for images…"
              class="min-w-0 flex-1 bg-transparent text-[12.5px] text-white/90 placeholder:text-white/30 outline-none"
              @keydown.enter="search"
            >
          </div>
          <button class="grid size-7 shrink-0 place-items-center rounded-md text-white/40 transition hover:bg-white/10 hover:text-white/80" title="Close" @click="emit('close')">
            <X class="size-4" />
          </button>
        </div>

        <!-- Body -->
        <div class="min-h-[260px] flex-1 overflow-y-auto p-4">
          <!-- No key yet: inline setup instead of an error -->
          <div v-if="!braveKey" class="mx-auto flex max-w-md flex-col items-center gap-3 py-10 text-center">
            <p class="text-[13px] text-white/80">Web image search needs a Brave Search API key.</p>
            <p class="text-[11.5px] leading-relaxed text-white/45">
              Free tier at <span class="text-white/70">brave.com/search/api</span> (~2,000 searches/month).
              Stored in this browser only, like your Anthropic key.
            </p>
            <div class="flex w-full items-center gap-2">
              <input
                v-model="keyDraft" type="password" placeholder="Paste your Brave Search API key"
                class="min-w-0 flex-1 rounded-[8px] bg-white/6 px-3 py-2 text-[12.5px] text-white/90 placeholder:text-white/30 outline-none ring-1 ring-white/10 focus:ring-white/30"
                @keydown.enter="saveKey"
              >
              <button
                class="shrink-0 rounded-[8px] bg-white px-3 py-2 text-[12px] font-medium text-neutral-900 transition hover:bg-white/90 disabled:opacity-40"
                :disabled="!keyDraft.trim()" @click="saveKey"
              >Save & search</button>
            </div>
          </div>

          <!-- Searching: pulse placeholders -->
          <div v-else-if="searching" class="grid grid-cols-4 gap-2">
            <div v-for="i in 12" :key="i" class="aspect-[4/3] animate-pulse rounded-[8px] bg-white/6" />
          </div>

          <p v-else-if="error" class="py-10 text-center text-[12.5px] text-red-400/90">{{ error }}</p>

          <!-- Results grid: click toggles selection -->
          <div v-else-if="results.length" class="grid grid-cols-4 gap-2">
            <button
              v-for="r in results" :key="r.id"
              class="group relative aspect-[4/3] overflow-hidden rounded-[8px] bg-white/4 ring-1 transition"
              :class="selected.has(r.id) ? 'ring-2 ring-white' : 'ring-white/8 hover:ring-white/30'"
              :title="r.title" @click="toggle(r.id)"
            >
              <img :src="r.thumbUrl" :alt="r.title" loading="lazy" class="size-full object-cover transition group-hover:scale-[1.03]" :class="isSmallImage(r) ? 'opacity-70' : ''">
              <span
                v-if="r.width && r.height"
                class="absolute left-1.5 top-1.5 rounded-[5px] bg-black/60 px-1.5 py-0.5 text-[10px] font-medium tabular-nums backdrop-blur-sm"
                :class="isSmallImage(r) ? 'text-amber-300/95' : 'text-white/80'"
              >{{ r.width }}×{{ r.height }}{{ isSmallImage(r) ? ' · small' : '' }}</span>
              <span
                v-if="selected.has(r.id)"
                class="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-white text-neutral-900 shadow"
              ><Check class="size-3.5" /></span>
              <span class="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-4 text-left text-[10px] text-white/75 opacity-0 transition group-hover:opacity-100">{{ r.source || r.title }}</span>
            </button>
          </div>

          <p v-else class="py-10 text-center text-[12.5px] text-white/40">Type a search above to find images.</p>
        </div>

        <!-- Footer -->
        <div class="flex items-center justify-between border-t border-white/8 px-4 py-3">
          <span class="text-[11.5px] text-white/40">
            {{ importing ? `Importing ${Math.min(importedCount + 1, picks.length)} of ${picks.length}…` : selected.size ? `${selected.size} selected` : 'Click images to select' }}
          </span>
          <div class="flex items-center gap-2">
            <button class="rounded-[8px] px-3 py-2 text-[12px] text-white/60 transition hover:bg-white/8 hover:text-white/90" @click="emit('close')">Cancel</button>
            <button
              class="rounded-[8px] bg-white px-3.5 py-2 text-[12px] font-medium text-neutral-900 transition hover:bg-white/90 disabled:opacity-40"
              :disabled="!selected.size || importing" @click="importPicks"
            >{{ importing ? 'Importing…' : `Import ${selected.size || ''}`.trim() }}</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
