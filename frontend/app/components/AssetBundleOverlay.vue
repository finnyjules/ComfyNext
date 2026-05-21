<script setup lang="ts">
/**
 * Overlay for a multi-image bundle (e.g. the 3 aspect variants emitted by a
 * single SmartLayout run). Shows all images in a grid with per-image download
 * and a "download all" button. Clicking an individual image opens its single
 * detail overlay (emitted up to the parent).
 */
import { Download, ExternalLink, X } from 'lucide-vue-next'

interface ImgRef { filename: string; subfolder: string; type: string }
interface HistoryItem {
  promptId: string
  status: 'completed' | 'failed'
  images: ImgRef[]
  executionTime: number | null
  timestamp: number
}

const props = defineProps<{ item: HistoryItem }>()
const emit = defineEmits<{
  close: []
  'open-image': [img: ImgRef]
}>()

function viewUrl(img: ImgRef): string {
  const params = new URLSearchParams({ filename: img.filename, type: img.type })
  if (img.subfolder) params.set('subfolder', img.subfolder)
  return `/view?${params}`
}

function isVideo(f: string) { return /\.(mp4|webm|mov|avi|mkv|m4v)$/i.test(f) }
function isAudio(f: string) { return /\.(mp3|wav|flac|ogg|m4a|aac|opus)$/i.test(f) }

function download(img: ImgRef) {
  const a = document.createElement('a')
  a.href = viewUrl(img)
  a.download = img.filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

function downloadAll() {
  // Browser sequential downloads — most browsers throttle / batch this fine
  // for small bundles. JSZip is the obvious upgrade if users complain.
  for (const img of props.item.images) {
    setTimeout(() => download(img), 50)
  }
}

const bundleLabel = computed(() => {
  // Best-effort axis hint: if every filename ends in a `_<token>` chunk before
  // the extension, surface those tokens as the axis labels. Otherwise just
  // count.
  const stems = props.item.images.map((i) => i.filename.replace(/\.[^.]+$/, ''))
  const tails = stems.map((s) => s.split('_').pop()!).filter(Boolean)
  if (new Set(tails).size === tails.length && tails.every((t) => /^[a-z0-9]+(?:x[a-z0-9]+)?$/i.test(t))) {
    return tails.join(' · ')
  }
  return `${props.item.images.length} variants`
})

const formattedDate = computed(() => {
  if (!props.item.timestamp) return null
  return new Date(props.item.timestamp).toLocaleString()
})

function onKeydown(e: KeyboardEvent) { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="h-full w-full flex bg-[#0a0a0a]">
    <!-- Main: grid of all images -->
    <div class="flex-1 overflow-y-auto p-8 min-w-0">
      <div class="max-w-[1200px] mx-auto">
        <div class="flex items-baseline justify-between mb-6">
          <div>
            <div class="text-[11px] uppercase tracking-[0.16em] text-white/35 font-medium mb-1">Bundle</div>
            <h1 class="text-[28px] font-medium text-white tracking-tight">{{ bundleLabel }}</h1>
            <div v-if="formattedDate" class="text-[12px] text-white/40 mt-1">{{ formattedDate }}</div>
          </div>
          <button
            class="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-[#96b4ff] hover:bg-[#a8c2ff] text-[#0a0a0a] text-[12px] font-medium transition-colors cursor-pointer"
            @click="downloadAll"
          >
            <Download class="size-3.5" />
            Download all
          </button>
        </div>

        <div class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
          <div
            v-for="(img, i) in item.images"
            :key="i"
            class="group rounded-xl overflow-hidden bg-black border border-white/[0.06] hover:border-white/15 transition-colors"
          >
            <div
              class="relative aspect-square cursor-pointer"
              @click="emit('open-image', img)"
            >
              <video
                v-if="isVideo(img.filename)"
                :src="viewUrl(img)"
                class="absolute inset-0 size-full object-cover"
                muted loop autoplay playsinline
              />
              <div
                v-else-if="isAudio(img.filename)"
                class="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-violet-900/30 to-violet-500/10"
              >
                <svg viewBox="0 0 80 24" class="size-16 text-violet-300/80" fill="currentColor">
                  <rect x="0" y="9" width="3" height="6" rx="1.5" />
                  <rect x="12" y="2" width="3" height="20" rx="1.5" />
                  <rect x="24" y="4" width="3" height="16" rx="1.5" />
                  <rect x="36" y="0" width="3" height="24" rx="1.5" />
                  <rect x="48" y="8" width="3" height="8" rx="1.5" />
                  <rect x="60" y="6" width="3" height="12" rx="1.5" />
                  <rect x="72" y="4" width="3" height="16" rx="1.5" />
                </svg>
              </div>
              <img
                v-else
                :src="viewUrl(img)"
                :alt="img.filename"
                class="absolute inset-0 size-full object-cover"
                loading="lazy"
              />
              <div class="absolute inset-0 flex items-end p-3 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-t from-black/65 to-transparent">
                <ExternalLink class="size-4 text-white" />
              </div>
            </div>
            <div class="px-3 py-2 flex items-center justify-between gap-2">
              <div class="text-[11px] text-white/65 truncate font-mono">{{ img.filename }}</div>
              <button
                class="shrink-0 p-1.5 rounded hover:bg-white/10 text-white/45 hover:text-white transition-colors cursor-pointer"
                title="Download"
                @click.stop="download(img)"
              >
                <Download class="size-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Right: metadata sidebar -->
    <div class="w-[320px] shrink-0 bg-[#18181b] border-l border-[#2a2a2a] overflow-y-auto flex flex-col">
      <div class="flex items-center justify-between p-5 border-b border-[#2a2a2a]">
        <h2 class="text-sm font-medium text-white truncate pr-3">
          {{ item.images.length }} files
        </h2>
        <button
          class="shrink-0 p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors cursor-pointer"
          @click="emit('close')"
        >
          <X class="size-4" />
        </button>
      </div>

      <div class="p-5 flex flex-col gap-4">
        <div v-if="formattedDate">
          <div class="text-[11px] font-medium text-white/30 uppercase tracking-wider mb-1">Created</div>
          <div class="text-sm text-white/70">{{ formattedDate }}</div>
        </div>
        <div v-if="item.executionTime != null">
          <div class="text-[11px] font-medium text-white/30 uppercase tracking-wider mb-1">Execution time</div>
          <div class="text-sm text-white/70">{{ item.executionTime.toFixed(1) }}s</div>
        </div>
        <div>
          <div class="text-[11px] font-medium text-white/30 uppercase tracking-wider mb-1">Prompt id</div>
          <div class="text-xs text-white/55 font-mono break-all">{{ item.promptId }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
