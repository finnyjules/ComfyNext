<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { Upload, Loader2, Film, Play, RefreshCw, Download, Pencil, ArrowRight, MoreHorizontal } from 'lucide-vue-next'
import { onClickOutside } from '@vueuse/core'
import { getTypeColor, fetchObjectInfo } from '~/composables/useVueNodes'
import { ACTION_CATALOG } from '~/data/action-catalog'
import { getGeneratorIcon } from '~/data/generator-icons'
import { parseBadgeUsd } from '~/lib/costEstimate'

// Visual half of the unified `Video` artifact node. Same state machine as
// the Image / Audio cards. Result lands in `data.images` (PreviewVideo's
// UI envelope reuses the images key with animated=true), so we treat
// `data.images[0]` as the video URL.
const props = defineProps<{
  id: string
  selected?: boolean
  data: {
    nodeType: string
    title: string
    inputs: { name: string; type: string; link: number | null }[]
    outputs: { name: string; type: string; links: number[] | null }[]
    widgetsValues: any[]
    widgetDefs?: any[]
    mode: number
    running?: boolean
    error?: boolean
    images?: string[]
    animated?: boolean
    outputNode?: boolean
  }
}>()

const isMuted = computed(() => props.data.mode === 2)
const isBypassed = computed(() => props.data.mode === 4)
const videoColor = computed(() => getTypeColor('VIDEO'))

const injectedEdges = inject<any>('vueFlowEdges', null)

function inputIdx(name: string): number {
  return props.data.inputs?.findIndex(i => i.name === name) ?? -1
}
function outputIdx(name: string): number {
  return props.data.outputs?.findIndex(o => o.name === name) ?? -1
}
function widgetIdx(name: string): number {
  return props.data.widgetDefs?.findIndex((w: any) => w.name === name) ?? -1
}

const sourceInputIdx = computed(() => inputIdx('source'))
const videoOutputIdx = computed(() => outputIdx('video'))
const fileWidgetIdx = computed(() => widgetIdx('file'))

const widgetFilename = computed<string>(() => {
  const i = fileWidgetIdx.value
  return i >= 0 ? (props.data.widgetsValues?.[i] || '') : ''
})

const hasUpstream = computed(() => {
  const idx = sourceInputIdx.value
  if (idx < 0) return false
  if (props.data.inputs?.[idx]?.link != null) return true
  const edges = injectedEdges?.value ?? []
  return edges.some((e: any) => e.target === props.id && e.targetHandle === `input-${idx}`)
})

const videoUrl = computed<string | null>(() => {
  if (props.data.images?.length) return props.data.images[0]!
  if (!hasUpstream.value && widgetFilename.value) {
    return `/view?${new URLSearchParams({ filename: widgetFilename.value, type: 'input' })}`
  }
  return null
})

// Format seconds as M:SS (or H:MM:SS past an hour). Null for unknown/streamed
// durations (some sources report Infinity until fully buffered).
function fmtDuration(s: number): string | null {
  if (!isFinite(s) || s <= 0) return null
  const t = Math.round(s)
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return (h > 0 ? `${h}:` : '') + `${mm}:${String(sec).padStart(2, '0')}`
}

// Footer label: dimensions · duration, read from the <video> metadata on load.
// Reset when the source changes so stale values don't linger.
const meta = ref<string | null>(null)
watch(videoUrl, () => { meta.value = null })
function onVideoMeta(e: Event) {
  const v = e.target as HTMLVideoElement
  const dims = v.videoWidth ? `${v.videoWidth} × ${v.videoHeight}` : null
  meta.value = [dims, fmtDuration(v.duration)].filter(Boolean).join(' · ') || null
}

const filenameLabel = computed<string | null>(() => {
  if (widgetFilename.value) return widgetFilename.value
  const url = videoUrl.value
  if (!url) return null
  const m = url.match(/[?&]filename=([^&]+)/)
  if (m && m[1]) {
    try { return decodeURIComponent(m[1]) } catch { return m[1] }
  }
  return null
})

const showUpload = computed(() => !videoUrl.value && !hasUpstream.value)
const showRender = computed(() => !videoUrl.value && hasUpstream.value)

const fileInputRef = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const hovered = ref(false)

async function uploadFile(file: File) {
  uploading.value = true
  try {
    const fd = new FormData()
    fd.append('image', file)
    fd.append('overwrite', 'true')
    const res = await fetch('/upload/image', { method: 'POST', body: fd })
    if (!res.ok) throw new Error(`upload returned ${res.status}`)
    const json = await res.json()
    const name = json?.name ?? file.name
    const idx = fileWidgetIdx.value
    if (idx >= 0 && props.data.widgetsValues) {
      props.data.widgetsValues[idx] = name
    }
    const def = props.data.widgetDefs?.find((d: any) => d.name === 'file')
    if (def && Array.isArray(def.options) && !def.options.includes(name)) {
      def.options.push(name)
    }
  } catch (err) {
    console.error('[ArtifactVideo] upload failed:', err)
  } finally {
    uploading.value = false
  }
}

async function onFileChange(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (file) await uploadFile(file)
  target.value = ''
}

// Drop accepts a file whenever the asset is local (empty or already loaded) —
// upstream-fed nodes get their media from the wire, so a dropped file wouldn't show.
const canReplace = computed(() => !hasUpstream.value)
function onDrop(event: DragEvent) {
  if (!canReplace.value) return
  event.preventDefault()
  const file = event.dataTransfer?.files?.[0]
  if (file) uploadFile(file)
}
function onDragOver(event: DragEvent) {
  if (!canReplace.value) return
  event.preventDefault()
}
function triggerUpload() { fileInputRef.value?.click() }

function runThisNode() {
  if (isMuted.value || isBypassed.value || props.data.running) return
  window.dispatchEvent(
    new CustomEvent('sailor:runFiltered', { detail: { targetIds: [props.id], rerollScope: 'self' } }),
  )
}

async function downloadVideo() {
  const url = videoUrl.value
  if (!url) return
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    const obj = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = obj
    a.download = filenameLabel.value || 'video.mp4'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(obj)
  } catch (err) {
    console.error('[ArtifactVideo] download failed:', err)
  }
}

// ── Edit…/Develop… footer — same idiom as ArtifactImageNode: two hover-free
// buttons below the media, each opening a teleported dropdown. Rows fire the
// same sailor:applyEffect the old SelectionActionChips used, so branching
// behavior is unchanged — only the presentation moved into a footer.
const REFINE_ACTIONS = [
  { nodeType: 'LipsyncNode', label: 'Sync lips' },
  { nodeType: 'EnhanceVideoNode', label: 'Enhance' },
] as const
const NEXT_ACTIONS = [
  { nodeType: 'DescribeVideoNode', label: 'Describe' },
] as const

// Truthful $ hints from the same price_badge the nodes themselves show —
// fetched once on mount, same mechanism SelectionActionChips used.
const priceHints = ref<Record<string, string>>({})
onMounted(async () => {
  const info = await fetchObjectInfo()
  const out: Record<string, string> = {}
  for (const action of [...REFINE_ACTIONS, ...NEXT_ACTIONS]) {
    const cost = parseBadgeUsd(info?.[action.nodeType]?.price_badge?.expr)
    if (cost) out[action.nodeType] = `${cost.approximate ? '~' : ''}$${cost.usd.toFixed(2)}`
  }
  priceHints.value = out
})

function fireAction(nodeType: string) {
  window.dispatchEvent(new CustomEvent('sailor:applyEffect', {
    detail: { nodeId: props.id, nodeType, output: 'VIDEO', branch: true, focus: true },
  }))
}
function openAllActions() {
  window.dispatchEvent(new CustomEvent('sailor:openActions', { detail: { domain: 'video' } }))
}

// Two hover-free menus, teleported to <body> in screen space so they aren't
// clipped by the card's overflow — same mechanism as ArtifactImageNode.
const editMenuOpen = ref(false)
const editMenuRef = ref<HTMLElement | null>(null)
const editMenuPanelRef = ref<HTMLElement | null>(null)
const editMenuStyle = ref<Record<string, string>>({})
const nextMenuOpen = ref(false)
const nextMenuRef = ref<HTMLElement | null>(null)
const nextMenuPanelRef = ref<HTMLElement | null>(null)
const nextMenuStyle = ref<Record<string, string>>({})
onClickOutside(editMenuRef, () => { editMenuOpen.value = false }, { ignore: [editMenuPanelRef] })
onClickOutside(nextMenuRef, () => { nextMenuOpen.value = false }, { ignore: [nextMenuPanelRef] })

// Beside the node's right edge, top-aligned with the button; flips to the
// node's left when the viewport runs out. Vertical position clamps so the
// panel always fits, scrolling internally as a last resort.
function menuStyleFor(anchor: HTMLElement | null): Record<string, string> {
  const nodeR = (anchor?.closest('.artifact-video') as HTMLElement | null)?.getBoundingClientRect()
  const btnR = anchor?.getBoundingClientRect()
  if (!nodeR || !btnR) return {}
  const MENU_W = 210
  const MENU_H = 380
  const left = nodeR.right + 8 + MENU_W <= window.innerWidth
    ? nodeR.right + 8
    : Math.max(8, nodeR.left - 8 - MENU_W)
  const top = Math.max(8, Math.min(btnR.top, window.innerHeight - MENU_H - 8))
  return { left: `${left}px`, top: `${top}px`, maxHeight: `${window.innerHeight - top - 8}px` }
}
// Pan/zoom would leave the fixed panel floating at a stale spot — close instead.
function closeMenusOnWheel() { editMenuOpen.value = false; nextMenuOpen.value = false }
watch([editMenuOpen, nextMenuOpen], ([edit, next], [prevEdit, prevNext]) => {
  if (edit && !prevEdit) { nextMenuOpen.value = false; editMenuStyle.value = menuStyleFor(editMenuRef.value) }
  if (next && !prevNext) { editMenuOpen.value = false; nextMenuStyle.value = menuStyleFor(nextMenuRef.value) }
  if (edit || next) window.addEventListener('wheel', closeMenusOnWheel, { passive: true })
  else window.removeEventListener('wheel', closeMenusOnWheel)
})
onBeforeUnmount(() => window.removeEventListener('wheel', closeMenusOnWheel))

function runAction(action: () => void) {
  editMenuOpen.value = false
  nextMenuOpen.value = false
  action()
}
</script>

<template>
  <div
    class="artifact-video relative w-[280px] select-none"
    :class="{
      'artifact-video--muted': isMuted,
      'artifact-video--bypassed': isBypassed,
    }"
    :data-running="data.running || undefined"
    :style="{ '--port-color': videoColor } as any"
    @dragover="onDragOver"
    @drop="onDrop"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
  >
    <VueCanvasNodeReadyBadge :node-id="id" />
    <Handle
      v-if="sourceInputIdx >= 0"
      :id="`input-${sourceInputIdx}`"
      type="target"
      :position="Position.Left"
      class="!w-3 !h-3 !rounded-full !border-2 !bg-[#1a1a1a]"
      :style="{ borderColor: videoColor, top: '50%' }"
    />
    <Handle
      v-if="videoOutputIdx >= 0"
      :id="`output-${videoOutputIdx}`"
      type="source"
      :position="Position.Right"
      class="!w-3 !h-3 !rounded-full !border-2 !bg-[#1a1a1a]"
      :style="{ borderColor: videoColor, top: '50%' }"
    />

    <div
      class="artifact-frame relative rounded-lg overflow-hidden bg-black/40 border border-white/10"
      :class="{ 'ring-2 ring-red-500': data.error }"
    >
      <!-- File picker — always mounted so Replace works in any state. -->
      <input
        ref="fileInputRef"
        type="file"
        accept="video/*"
        class="hidden"
        @change="onFileChange"
      />
      <template v-if="videoUrl">
        <!-- Chrome toolbar, overlaid on the top of the video and revealed
             on hover — same idiom as ArtifactImageNode so the two artifact
             cards read identically. -->
        <div
          class="nopan nodrag absolute inset-x-0 top-0 z-30 flex items-center gap-1.5 px-2 py-1.5 bg-gradient-to-b from-black/70 to-transparent transition-opacity duration-150"
          :class="hovered ? 'opacity-100' : 'opacity-0 pointer-events-none'"
        >
          <span class="truncate flex-1 text-[10px] tabular-nums text-white/80 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
            {{ meta || (hasUpstream ? 'Video (upstream)' : 'Video') }}
          </span>
          <button
            v-if="canReplace"
            class="nopan nodrag shrink-0 size-5 rounded flex items-center justify-center text-white/45 hover:text-white/85 hover:bg-white/[0.08] transition-colors cursor-pointer disabled:opacity-50"
            :disabled="uploading"
            title="Replace video"
            @click.stop="triggerUpload"
          >
            <Loader2 v-if="uploading" class="size-3 animate-spin" />
            <Upload v-else class="size-2.5" />
          </button>
          <button
            class="nopan nodrag shrink-0 size-5 rounded flex items-center justify-center text-white/45 hover:text-white/85 hover:bg-white/[0.08] transition-colors cursor-pointer"
            title="Download"
            @click.stop="downloadVideo"
          >
            <Download class="size-2.5" />
          </button>
          <button
            class="nopan nodrag shrink-0 size-5 rounded flex items-center justify-center text-white/45 hover:text-white/85 hover:bg-white/[0.08] transition-colors cursor-pointer disabled:opacity-50"
            :disabled="data.running || isMuted || isBypassed"
            :title="data.running ? 'Running…' : 'Re-render'"
            @click.stop="runThisNode"
          >
            <Loader2 v-if="data.running" class="size-3 animate-spin" />
            <RefreshCw v-else class="size-3" />
          </button>
        </div>
        <video
          :src="videoUrl"
          class="block w-full max-h-[280px] object-contain bg-black"
          controls
          preload="metadata"
          playsinline
          @loadedmetadata="onVideoMeta"
        />
      </template>

      <template v-else-if="showUpload">
        <!-- Upload affordance — no nopan/nodrag so click-in-place opens
             the file picker but click-and-drag moves the card. -->
        <button
          class="w-full aspect-video flex flex-col items-center justify-center gap-2 text-white/45 hover:text-white/85 hover:bg-white/[0.04] transition-colors cursor-pointer disabled:opacity-50"
          :disabled="uploading"
          @click="triggerUpload"
        >
          <Loader2 v-if="uploading" class="size-7 animate-spin" />
          <Film v-else class="size-7" :stroke-width="1.5" />
          <span class="text-[11px]">{{ uploading ? 'Uploading…' : 'Drop or click a video' }}</span>
        </button>
      </template>

      <template v-else>
        <div class="aspect-video flex flex-col items-center justify-center gap-2 text-white/35 px-4">
          <Film class="size-7" :stroke-width="1.5" />
          <template v-if="data.running">
            <Loader2 class="size-4 animate-spin text-white/55" />
            <span class="text-[11px] text-white/55">Rendering…</span>
          </template>
          <template v-else>
            <button
              class="nopan nodrag mt-1 flex items-center gap-1.5 px-3 h-7 rounded bg-white/[0.08] hover:bg-white/[0.15] text-white/75 hover:text-white text-[11px] transition-colors cursor-pointer disabled:opacity-50"
              :disabled="isMuted || isBypassed"
              @click.stop="runThisNode"
            >
              <Play class="size-2.5" fill="currentColor" />
              Render
            </button>
          </template>
        </div>
      </template>

      <!-- Footer toolbar — Edit…/Develop… menus, same idiom as the image
           card's footer, replacing the old selection chips. -->
      <template v-if="videoUrl">
        <div class="nopan nodrag flex items-center gap-1.5 px-2 py-2 border-t border-white/5">
          <!-- EDIT — refine the current video -->
          <div ref="editMenuRef" class="relative flex-1">
            <button
              class="w-full flex items-center justify-center gap-1.5 rounded bg-white/10 hover:bg-white/20 px-2.5 py-1.5 text-[11px] font-medium text-white/80 hover:text-white transition-colors cursor-pointer"
              title="Edit — refine this video"
              @click.stop="editMenuOpen = !editMenuOpen"
            >
              <Pencil class="size-3" /> Edit…
            </button>
            <Teleport to="body">
            <div
              v-if="editMenuOpen"
              ref="editMenuPanelRef"
              class="nopan nodrag fixed z-[9999] min-w-[190px] overflow-y-auto rounded-md border border-white/10 bg-[#1a1a1a] shadow-lg py-1"
              :style="editMenuStyle"
            >
              <div class="px-2.5 pt-1 pb-0.5 text-[9px] uppercase tracking-wider text-white/30 select-none">Refine</div>
              <button
                v-for="action in REFINE_ACTIONS"
                :key="action.nodeType"
                class="edit-menu-item"
                :title="ACTION_CATALOG[action.nodeType]?.useCase"
                @click.stop="runAction(() => fireAction(action.nodeType))"
              >
                <component :is="getGeneratorIcon(action.nodeType)" class="size-3 shrink-0" /> {{ action.label }}
                <span v-if="priceHints[action.nodeType]" class="edit-menu-hint">{{ priceHints[action.nodeType] }}</span>
              </button>
            </div>
            </Teleport>
          </div>

          <!-- NEXT — turn this video into something new -->
          <div ref="nextMenuRef" class="relative flex-1">
            <button
              class="w-full flex items-center justify-center gap-1.5 rounded bg-white/10 hover:bg-white/20 px-2.5 py-1.5 text-[11px] font-medium text-white/80 hover:text-white transition-colors cursor-pointer"
              title="Develop — turn this into something new"
              @click.stop="nextMenuOpen = !nextMenuOpen"
            >
              <ArrowRight class="size-3" /> Develop…
            </button>
            <Teleport to="body">
            <div
              v-if="nextMenuOpen"
              ref="nextMenuPanelRef"
              class="nopan nodrag fixed z-[9999] min-w-[190px] overflow-y-auto rounded-md border border-white/10 bg-[#1a1a1a] shadow-lg py-1"
              :style="nextMenuStyle"
            >
              <div class="px-2.5 pt-1 pb-0.5 text-[9px] uppercase tracking-wider text-white/30 select-none">Next</div>
              <button
                v-for="action in NEXT_ACTIONS"
                :key="action.nodeType"
                class="edit-menu-item"
                :title="ACTION_CATALOG[action.nodeType]?.useCase"
                @click.stop="runAction(() => fireAction(action.nodeType))"
              >
                <component :is="getGeneratorIcon(action.nodeType)" class="size-3 shrink-0" /> {{ action.label }}
                <span v-if="priceHints[action.nodeType]" class="edit-menu-hint">{{ priceHints[action.nodeType] }}</span>
              </button>
              <div class="mt-1 border-t border-white/[0.06]" />
              <button class="edit-menu-item" @click.stop="runAction(openAllActions)">
                <MoreHorizontal class="size-3 shrink-0" /> All actions…
              </button>
            </div>
            </Teleport>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.artifact-video[data-running] .artifact-frame {
  box-shadow:
    0 0 0 2px var(--port-color, #fff),
    0 4px 16px rgba(0, 0, 0, 0.4);
}
.artifact-frame {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4), 0 1px 4px rgba(0, 0, 0, 0.2);
}
.artifact-video--muted { opacity: 0.45; filter: grayscale(0.8); }
.artifact-video--bypassed { opacity: 0.85; }
.artifact-video--bypassed .artifact-frame {
  border-style: dashed;
  border-color: rgba(251, 191, 36, 0.35);
}

/* Edit…/Develop… dropdown rows — copied verbatim from ArtifactImageNode
   (scoped styles don't cross components). */
.edit-menu-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.625rem;
  font-size: 11px;
  color: rgb(255 255 255 / 0.75);
  cursor: pointer;
  transition: color 0.15s, background-color 0.15s;
}
.edit-menu-item:hover:not(:disabled) {
  color: #fff;
  background-color: rgb(255 255 255 / 0.08);
}
.edit-menu-hint {
  margin-left: auto;
  padding-left: 0.75rem;
  font-size: 9px;
  font-variant-numeric: tabular-nums;
  color: rgb(255 255 255 / 0.35);
}
</style>
