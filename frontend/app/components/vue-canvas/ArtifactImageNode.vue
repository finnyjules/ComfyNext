<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { Upload, Loader2, Image as ImageIcon, ImagePlus, Play, Download, RefreshCw, Lock, LockOpen, Eraser, Brush } from 'lucide-vue-next'
import { getTypeColor } from '~/composables/useVueNodes'
import TakesStrip from '~/components/vue-canvas/TakesStrip.vue'
import { projectTake, type Take } from '~/composables/useTakes'

// The visual half of the unified `Image` artifact node. State is derived from
// (upstream connection, file widget, execution output) rather than the node
// type — there's only one node type now, behaving like Load / Preview / Save
// depending on what the user wires and toggles.
const props = defineProps<{
  id: string
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
    outputNode?: boolean
    // Takes (non-destructive variation loop) — flag-gated, additive.
    takes?: Take[]
    activeTakeId?: string | null
  }
}>()

const isMuted = computed(() => props.data.mode === 2)
const isBypassed = computed(() => props.data.mode === 4)

const imageColor = computed(() => getTypeColor('IMAGE'))
const maskColor = computed(() => getTypeColor('MASK'))

// Vue Flow injects nodes/edges so we can ask "is anything wired to my image
// input right now?" — `inputs[i].link` lags behind in-session connections.
const injectedEdges = inject<any>('vueFlowEdges', null)

// Port indices by name — robust against schema reordering.
function inputIdx(name: string): number {
  return props.data.inputs?.findIndex(i => i.name === name) ?? -1
}
function outputIdx(name: string): number {
  return props.data.outputs?.findIndex(o => o.name === name) ?? -1
}
function widgetIdx(name: string): number {
  return props.data.widgetDefs?.findIndex((w: any) => w.name === name) ?? -1
}

const imagesInIdx = computed(() => inputIdx('images'))
const imageOutIdx = computed(() => outputIdx('image'))
const maskOutIdx = computed(() => outputIdx('mask'))

const imageWidgetIdx = computed(() => widgetIdx('image'))

const widgetFilename = computed<string>(() => {
  const i = imageWidgetIdx.value
  return i >= 0 ? (props.data.widgetsValues?.[i] || '') : ''
})

// "Is something wired into my images input right now?"
const hasUpstream = computed(() => {
  const idx = imagesInIdx.value
  if (idx < 0) return false
  if (props.data.inputs?.[idx]?.link != null) return true
  const edges = injectedEdges?.value ?? []
  return edges.some((e: any) => e.target === props.id && e.targetHandle === `input-${idx}`)
})

// Image URL — execution output wins, falling back to the file widget. When
// upstream is connected but the node hasn't run yet, this returns null (we
// show a "render to see preview" state).
const imageUrl = computed<string | null>(() => {
  if (props.data.images?.length) return props.data.images[0]!
  if (!hasUpstream.value && widgetFilename.value) {
    return `/view?${new URLSearchParams({ filename: widgetFilename.value, type: 'input' })}`
  }
  return null
})

// Lag the rendered <img> by one preload so cache-busting URLs don't flash
// white between updates.
const displayedUrl = ref<string | null>(null)
// Natural pixel dimensions of the shown image (e.g. "1024 × 1024"), captured
// during preload and displayed in the footer in place of the filename.
const dims = ref<string | null>(null)
let preloadGen = 0
watch(imageUrl, (url) => {
  if (!url) { displayedUrl.value = null; dims.value = null; return }
  const mine = ++preloadGen
  const img = new window.Image()
  const commit = () => {
    if (mine !== preloadGen) return
    displayedUrl.value = url
    dims.value = img.naturalWidth > 0 ? `${img.naturalWidth} × ${img.naturalHeight}` : null
  }
  img.onload = commit
  img.onerror = commit
  img.src = url
}, { immediate: true })

const filenameLabel = computed<string | null>(() => {
  if (widgetFilename.value) return widgetFilename.value
  const url = displayedUrl.value
  if (!url) return null
  const m = url.match(/[?&]filename=([^&]+)/)
  if (m && m[1]) {
    try { return decodeURIComponent(m[1]) } catch { return m[1] }
  }
  return null
})

// Empty state: no image, no upstream — show upload affordance.
// Waiting state: upstream wired, no image yet — show render button.
const showUpload = computed(() => !displayedUrl.value && !hasUpstream.value)
const showRender = computed(() => !displayedUrl.value && hasUpstream.value)

// Upload — same /upload/image endpoint everything else uses.
const fileInputRef = ref<HTMLInputElement | null>(null)
const uploading = ref(false)

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
    const idx = imageWidgetIdx.value
    if (idx >= 0 && props.data.widgetsValues) {
      props.data.widgetsValues[idx] = name
    }
    const def = props.data.widgetDefs?.find((d: any) => d.name === 'image')
    if (def && Array.isArray(def.options) && !def.options.includes(name)) {
      def.options.push(name)
    }
  } catch (err) {
    console.error('[ArtifactImage] upload failed:', err)
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

// A drop replaces the asset whenever it's local and unlocked (empty or already
// loaded) — upstream-fed/locked nodes ignore a dropped file.
const canReplace = computed(() => !hasUpstream.value && !isLocked.value)
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

function triggerUpload() {
  fileInputRef.value?.click()
}

// Open the dedicated inpaint editor for this image (the canvas owns the modal).
function openInpaint() {
  window.dispatchEvent(new CustomEvent('comfynext:openInpaint', { detail: { nodeId: props.id } }))
}

// Knock out the background: splice a local BackgroundRemove node after this image
// (default 'transparent' RGBA output) and re-point whatever the image fed. The
// canvas owns the graph mutation, so we just announce intent.
function removeBackground() {
  window.dispatchEvent(new CustomEvent('comfynext:applyEffect', {
    detail: {
      nodeId: props.id,
      nodeType: 'BackgroundRemove',
      output: 'IMAGE',
      widgetOverrides: { output: 'transparent' },
    },
  }))
}

// OUTPUT_NODE nodes get a per-node Run affordance — the existing event the
// canvas listens for. We surface it both as a fallback in the waiting state
// and as a small re-render button in the populated footer.
function runThisNode() {
  if (isMuted.value || isBypassed.value || props.data.running) return
  window.dispatchEvent(
    new CustomEvent('comfynext:runFiltered', { detail: { targetIds: [props.id] } }),
  )
}

// Browser-side download — same blob trick SmartLayout's carousel uses, so the
// saved filename is the real one instead of "view".
async function downloadImage() {
  const url = displayedUrl.value
  if (!url) return
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    const obj = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = obj
    a.download = filenameLabel.value || 'image.png'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(obj)
  } catch (err) {
    console.error('[ArtifactImage] download failed:', err)
  }
}

// Lock state: pin this image so upstream re-execution is skipped. We copy
// the current preview into the input directory and point the file widget
// at it; the canvas's workflow-build step then drops incoming edges to
// this node, so collectKeepSet stops walking upstream here.
const isLocked = computed(() => !!(props.data.properties as any)?.locked)
const locking = ref(false)

async function lockArtifact() {
  const url = displayedUrl.value
  if (!url || locking.value) return
  locking.value = true
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    const ext = blob.type === 'image/png' ? 'png'
      : blob.type === 'image/jpeg' ? 'jpg'
      : blob.type === 'image/webp' ? 'webp' : 'png'
    // Deterministic name so re-lock doesn't proliferate files.
    const filename = `locked_${props.id}.${ext}`
    const fd = new FormData()
    fd.append('image', new File([blob], filename, { type: blob.type }))
    fd.append('overwrite', 'true')
    const up = await fetch('/upload/image', { method: 'POST', body: fd })
    if (!up.ok) throw new Error(`upload returned ${up.status}`)
    const json = await up.json()
    const name = json?.name ?? filename
    const idx = imageWidgetIdx.value
    if (idx >= 0 && props.data.widgetsValues) {
      props.data.widgetsValues[idx] = name
    }
    const def = props.data.widgetDefs?.find((d: any) => d.name === 'image')
    if (def && Array.isArray(def.options) && !def.options.includes(name)) {
      def.options.push(name)
    }
    if (!props.data.properties) (props.data as any).properties = {}
    ;(props.data.properties as any).locked = true
  } catch (err) {
    console.error('[ArtifactImage] lock failed:', err)
  } finally {
    locking.value = false
  }
}

function unlockArtifact() {
  if (!props.data.properties) return
  ;(props.data.properties as any).locked = false
}

// --- Takes (non-destructive variation loop) --------------------------------
// Outputs materialize into this artifact node, so this is where takes land.
// projectTake mirrors the chosen take onto data.images → imageUrl recomputes.
function selectTake(id: string) {
  const t = (props.data.takes || []).find((x) => x.id === id)
  if (t) Object.assign(props.data, projectTake(props.data, t))
}
function pinTake(id: string) {
  const t = (props.data.takes || []).find((x) => x.id === id)
  if (t) t.pinned = !t.pinned
  // Phase 3: persist pinned takes to the asset library with provenance.
}
function discardTake(id: string) {
  const takes = (props.data.takes || []).filter((x) => x.id !== id)
  ;(props.data as any).takes = takes
  if (props.data.activeTakeId === id) {
    const fallback = takes.find((t) => t.pinned) || takes[takes.length - 1] || null
    Object.assign(props.data, projectTake(props.data, fallback))
  }
}
</script>

<template>
  <div
    class="artifact-image relative w-[240px] select-none"
    :class="{
      'artifact-image--muted': isMuted,
      'artifact-image--bypassed': isBypassed,
      'artifact-image--locked': isLocked,
    }"
    :data-running="data.running || undefined"
    :style="{ '--port-color': imageColor } as any"
    @dragover="onDragOver"
    @drop="onDrop"
  >
    <!-- Primary IMAGE input — vertically centered on the image frame.
         Conditionally rendered so empty Image nodes don't dangle a port. -->
    <Handle
      v-if="imagesInIdx >= 0"
      :id="`input-${imagesInIdx}`"
      type="target"
      :position="Position.Left"
      class="!w-3 !h-3 !rounded-full !border-2 !bg-[#1a1a1a]"
      :style="{ borderColor: imageColor, top: '50%' }"
    />
    <!-- Primary IMAGE output -->
    <Handle
      v-if="imageOutIdx >= 0"
      :id="`output-${imageOutIdx}`"
      type="source"
      :position="Position.Right"
      class="!w-3 !h-3 !rounded-full !border-2 !bg-[#1a1a1a]"
      :style="{ borderColor: imageColor, top: '50%' }"
    />

    <div
      class="artifact-frame relative rounded-lg overflow-hidden bg-black/40 border border-white/10 backdrop-blur-sm"
      :class="{ 'ring-2 ring-red-500': data.error }"
    >
      <!-- File picker — always mounted so Replace works in any state. -->
      <input
        ref="fileInputRef"
        type="file"
        accept="image/*"
        class="hidden"
        @change="onFileChange"
      />
      <!-- Inpaint affordance for the empty / waiting states (corner button so it
           doesn't fight the big upload/render targets). -->
      <button
        v-if="showUpload || showRender"
        class="nopan nodrag absolute top-1 left-1 z-10 flex items-center gap-1 h-6 px-1.5 rounded-md bg-black/50 hover:bg-black/70 text-white/55 hover:text-white/70 text-[10px] transition-colors cursor-pointer"
        title="Inpaint — paint a region and describe the change"
        @click.stop="openInpaint"
      >
        <Brush class="size-3" /> Inpaint
      </button>

      <!-- IMAGE PRESENT -->
      <template v-if="displayedUrl">
        <img
          :src="displayedUrl"
          class="block w-full max-h-[280px] object-contain bg-black/50"
          loading="lazy"
        />
        <!-- Footer: dimensions + actions. -->
        <div class="flex items-center gap-1.5 px-2 py-1.5 border-t border-white/5">
          <span class="truncate flex-1 text-[10px] tabular-nums text-white/55">
            {{ dims || (hasUpstream ? 'Preview' : 'Image') }}
          </span>
          <button
            v-if="canReplace"
            class="nopan nodrag shrink-0 size-5 rounded flex items-center justify-center text-white/45 hover:text-white/85 hover:bg-white/[0.08] transition-colors cursor-pointer disabled:opacity-50"
            :disabled="uploading"
            title="Replace image"
            @click.stop="triggerUpload"
          >
            <Loader2 v-if="uploading" class="size-3 animate-spin" />
            <Upload v-else class="size-2.5" />
          </button>
          <button
            class="nopan nodrag shrink-0 size-5 rounded flex items-center justify-center text-white/45 hover:text-white/85 hover:bg-white/[0.08] transition-colors cursor-pointer"
            title="Remove background (transparent)"
            @click.stop="removeBackground"
          >
            <Eraser class="size-2.5" />
          </button>
          <button
            class="nopan nodrag shrink-0 size-5 rounded flex items-center justify-center text-white/45 hover:text-white/70 hover:bg-white/[0.08] transition-colors cursor-pointer"
            title="Inpaint — paint a region and describe the change"
            @click.stop="openInpaint"
          >
            <Brush class="size-2.5" />
          </button>
          <button
            class="nopan nodrag shrink-0 size-5 rounded flex items-center justify-center text-white/45 hover:text-white/85 hover:bg-white/[0.08] transition-colors cursor-pointer"
            title="Download"
            @click.stop="downloadImage"
          >
            <Download class="size-2.5" />
          </button>
          <button
            class="nopan nodrag shrink-0 size-5 rounded flex items-center justify-center transition-colors cursor-pointer disabled:opacity-50"
            :class="isLocked
              ? 'text-amber-300 bg-amber-500/15 hover:bg-amber-500/25'
              : 'text-white/45 hover:text-white/85 hover:bg-white/[0.08]'"
            :disabled="locking"
            :title="isLocked ? 'Locked — pinned, upstream will be skipped on next Run. Click to unlock.' : 'Lock — pin this image so upstream generators don\'t re-run.'"
            @click.stop="isLocked ? unlockArtifact() : lockArtifact()"
          >
            <Loader2 v-if="locking" class="size-3 animate-spin" />
            <Lock v-else-if="isLocked" class="size-2.5" />
            <LockOpen v-else class="size-2.5" />
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
      </template>

      <!-- UPLOAD EMPTY STATE — no upstream, no file yet -->
      <template v-else-if="showUpload">
        <!-- Upload affordance — no nopan/nodrag so click-in-place opens
             the file picker but click-and-drag moves the card. -->
        <button
          class="w-full aspect-square flex flex-col items-center justify-center gap-2 text-white/45 hover:text-white/85 hover:bg-white/[0.04] transition-colors cursor-pointer disabled:opacity-50"
          :disabled="uploading"
          @click="triggerUpload"
        >
          <Loader2 v-if="uploading" class="size-7 animate-spin" />
          <ImagePlus v-else class="size-7" :stroke-width="1.5" />
          <span class="text-[11px]">{{ uploading ? 'Uploading…' : 'Drop or click an image' }}</span>
        </button>
      </template>

      <!-- RENDER STATE — upstream wired, waiting on an execution -->
      <template v-else-if="showRender">
        <div class="aspect-square flex flex-col items-center justify-center gap-2 text-white/35 px-4">
          <ImageIcon class="size-7" :stroke-width="1.5" />
          <template v-if="data.running">
            <Loader2 class="size-4 animate-spin text-white/55" />
            <span class="text-[11px] text-white/55">Rendering…</span>
          </template>
          <template v-else>
            <button
              class="nopan nodrag mt-1 flex items-center gap-1.5 px-3 h-7 rounded-md bg-white/[0.08] hover:bg-white/[0.15] text-white/75 hover:text-white text-[11px] transition-colors cursor-pointer disabled:opacity-50"
              :disabled="isMuted || isBypassed"
              @click.stop="runThisNode"
            >
              <Play class="size-2.5" fill="currentColor" />
              Render
            </button>
          </template>
        </div>
      </template>
    </div>

    <!-- Takes strip (flag-gated): switch / pin / discard this node's results -->
    <TakesStrip
      v-if="(data.takes?.length ?? 0) >= 1"
      :takes="data.takes!"
      :active-take-id="data.activeTakeId"
      class="mt-1 rounded-lg bg-black/40 border border-white/10"
      @select="selectTake"
      @pin="pinTake"
      @discard="discardTake"
    />

    <!-- Secondary MASK output — small port + label below the frame so the
         image stays the dominant visual but downstream MASK consumers stay
         wireable. -->
    <div
      v-if="maskOutIdx >= 0"
      class="mt-1 flex items-center gap-1 justify-end pr-1"
    >
      <span class="text-[9px] uppercase tracking-[0.04em] text-white/35">mask</span>
      <Handle
        :id="`output-${maskOutIdx}`"
        type="source"
        :position="Position.Right"
        class="!w-2 !h-2 !rounded-full !border !bg-[#1a1a1a] !relative !top-auto !right-auto !transform-none"
        :style="{ borderColor: maskColor }"
      />
    </div>
  </div>
</template>

<style scoped>
.artifact-image[data-running] .artifact-frame {
  box-shadow:
    0 0 0 2px var(--port-color, #fff),
    0 4px 16px rgba(0, 0, 0, 0.4);
}
.artifact-frame {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4), 0 1px 4px rgba(0, 0, 0, 0.2);
}
.artifact-image--muted { opacity: 0.45; filter: grayscale(0.8); }
.artifact-image--bypassed { opacity: 0.85; }
.artifact-image--bypassed .artifact-frame {
  border-style: dashed;
  border-color: rgba(251, 191, 36, 0.35);
}
.artifact-image--locked .artifact-frame {
  /* Amber tint to match the seed-lock toggle's visual language — same
     "frozen / pinned" signal across the canvas. */
  box-shadow:
    0 0 0 1px rgba(251, 191, 36, 0.4),
    0 4px 16px rgba(0, 0, 0, 0.4);
  border-color: rgba(251, 191, 36, 0.25);
}
</style>
