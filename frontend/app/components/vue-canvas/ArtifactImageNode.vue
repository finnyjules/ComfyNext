<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { Upload, Loader2, Image as ImageIcon, ImagePlus, Play, Download, RefreshCw, Lock, LockOpen, Eraser, Brush, Sparkles, Pencil, Wand2, Drama, Gem, ZoomIn, Lamp, Aperture, Shuffle, Clapperboard } from 'lucide-vue-next'
import { onClickOutside } from '@vueuse/core'
import { getTypeColor } from '~/composables/useVueNodes'
import { useAgentActivity } from '~/composables/useAgentActivity'
import TakesStrip from '~/components/vue-canvas/TakesStrip.vue'
import NextStepsStrip from '~/components/vue-canvas/NextStepsStrip.vue'
import { useNextStepsStrip } from '~/composables/useNextStepsStrip'
import { projectTake, type Take } from '~/composables/useTakes'
import { uploadRefFile } from '~/lib/shotdirector/refUpload'
import { ACTION_HINTS } from '~/lib/artifact/nextSteps'
import { toast } from 'vue-sonner'

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

// The agent is reviewing THIS node → show the white scanning overlay.
const { analyzingNodeIds } = useAgentActivity()
const isAnalyzing = computed(() => analyzingNodeIds.value.has(props.id))

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

// "Is my upstream generator running right now?" VueNodeCanvas lights
// `edge.data.running` on every edge leaving the executing node, so an incoming
// edge with running=true means the node feeding us is mid-generation. Also true
// if this node itself is executing (output sinks that run).
const upstreamRunning = computed(() => {
  if (props.data.running) return true
  const edges = injectedEdges?.value ?? []
  return edges.some((e: any) => e.target === props.id && e.data?.running)
})

// Glimm "prism" sweep overlay while generating — same effect the Frame modal
// shows during a generative fill. Created lazily on the overlay canvas, driven
// by a rAF loop only while upstreamRunning, and torn down when it stops.
const sweepCanvas = ref<HTMLCanvasElement | null>(null)
let sweepCtrl: any = null
let sweepCreating = false
let sweepRaf = 0
let sweepStart = 0
const SWEEP_PERIOD = 1.6   // seconds per prism cycle
const SWEEP_ALPHA = 0.6    // peak band opacity
function ensureSweepCtrl() {
  if (sweepCtrl || sweepCreating) return
  const cv = sweepCanvas.value
  if (!cv || cv.clientWidth < 1 || cv.clientHeight < 1) return
  sweepCreating = true
  import('glimm').then(({ createShader, resolvePalette }) => {
    sweepCreating = false
    if (sweepCtrl || !sweepCanvas.value) return
    sweepCtrl = createShader({ canvas: sweepCanvas.value, palette: resolvePalette('citrus'), brightness: 0.85, swellAmount: 0.7 })
  }).catch(() => { sweepCreating = false })
}
function destroySweepCtrl() {
  sweepCtrl?.destroy?.()
  sweepCtrl = null
  sweepCreating = false
}
function tickSweep() {
  sweepRaf = requestAnimationFrame(tickSweep)
  if (!upstreamRunning.value) return
  ensureSweepCtrl()
  if (!sweepCtrl) return
  const tt = (performance.now() - sweepStart) / 1000
  sweepCtrl.setProgress((tt % SWEEP_PERIOD) / SWEEP_PERIOD)
  sweepCtrl.setAlpha(SWEEP_ALPHA)
}
watch(upstreamRunning, (on) => {
  if (on) {
    sweepStart = performance.now()
    if (!sweepRaf) sweepRaf = requestAnimationFrame(tickSweep)
  } else {
    if (sweepRaf) { cancelAnimationFrame(sweepRaf); sweepRaf = 0 }
    destroySweepCtrl()
  }
}, { immediate: true })
onUnmounted(() => {
  if (sweepRaf) cancelAnimationFrame(sweepRaf)
  destroySweepCtrl()
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
    new CustomEvent('comfynext:runFiltered', { detail: { targetIds: [props.id], rerollScope: 'self' } }),
  )
}

// Critique: have the agent LOOK at this result and suggest fixes (run→look→fix).
// Surfaced in the Edit menu as "Fix" (label only — the pipeline is unchanged).
function critiqueResult() {
  window.dispatchEvent(new CustomEvent('comfynext:critiqueNode', { detail: { nodeId: props.id } }))
}

// Wire an "Edit an image" (Nano Banana) generator downstream of this image, so
// the user can describe an edit in natural language. Same splice path Remove BG
// uses; the model is forced to Nano Banana 2 (EditImageNode's strong editor).
function editWithNanoBanana() {
  window.dispatchEvent(new CustomEvent('comfynext:applyEffect', {
    detail: {
      nodeId: props.id,
      nodeType: 'EditImageNode',
      output: 'IMAGE',
      widgetOverrides: { model: 'Nano Banana 2' },
    },
  }))
}

// ── Escalator actions (ARPU levers 2+5) ─────────────────────────────────────
// Enhance/Relight/Lens spawn their generator pre-wired and focused but UN-RUN
// (the user aims first, then pays). Upscale is a true one-tap: spawn + run,
// upstream artifact frozen so only the upscaler bills.
function spliceEffect(nodeType: string, opts: { run?: boolean; focus?: boolean } = {}, widgetOverrides?: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent('comfynext:applyEffect', {
    detail: { nodeId: props.id, nodeType, output: 'IMAGE', widgetOverrides, ...opts },
  }))
}
function spawnEnhanceDetail() { spliceEffect('EnhanceDetailNode', { focus: true }) }
function spawnUpscale() { spliceEffect('UpscaleImageNode', { run: true }) }
function spawnRelight() { spliceEffect('RelightNode', { focus: true }) }
function spawnLensReframe() { spliceEffect('LensReframe', { focus: true }) }

// Variations ×4: sequential re-runs of the producing generator with fresh
// seeds; results accumulate in the Takes strip. Needs something upstream to
// re-run, hence the hasUpstream gate (mirrored as a disabled menu row).
function runVariations() {
  window.dispatchEvent(new CustomEvent('comfynext:runVariations', { detail: { nodeId: props.id, count: 4 } }))
}

// Animate: spawn a Shot Director seeded with this image as reference.
function animateArtifact() {
  window.dispatchEvent(new CustomEvent('comfynext:animateArtifact', { detail: { nodeId: props.id } }))
}

// Save the current image as a character in the registry (phase 1: image-only,
// refs are stored in the input dir as /view URLs to avoid JSON bloat).
const savingAsCharacter = ref(false)
async function saveAsCharacter() {
  const src = (props.data as any)?.images?.[0]
  if (!src) return
  const name = window.prompt('Character name')?.trim()
  if (!name) return
  savingAsCharacter.value = true
  try {
    const blob = await (await fetch(src)).blob()
    const refUrl = await uploadRefFile(new File([blob], 'character.png', { type: blob.type || 'image/png' }))
    const filename = new URLSearchParams(refUrl.split('?')[1]).get('filename')!
    const created = await fetch('/api/characters-local', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    })
    if (!created.ok) throw new Error(`create ${created.status}`)
    const { slug } = await created.json() as { slug: string }
    const patched = await fetch('/api/characters-local', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, refImages: [filename] }),
    })
    if (!patched.ok) {
      // Don't leave an orphan zero-ref character behind.
      await fetch('/api/characters-local', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, remove: true }),
      }).catch(() => {})
      throw new Error(`attach ref ${patched.status}`)
    }
    window.dispatchEvent(new CustomEvent('comfynext:charactersChanged'))
    toast.success(`Saved ${name} to characters`, { description: 'Castable in the Shot Director' })
  } catch (e) {
    console.warn('[saveAsCharacter]', e)
    toast.error(`Couldn't save ${name} as a character — try again`)
  } finally {
    savingAsCharacter.value = false
  }
}

// Top-right "Edit" menu: Remove BG / Inpaint / Edit (Nano Banana) / Fix. Each item
// runs an existing action and closes the menu; clicking outside dismisses it.
const editMenuOpen = ref(false)
const editMenuRef = ref<HTMLElement | null>(null)
onClickOutside(editMenuRef, () => { editMenuOpen.value = false })
function runEdit(action: () => void) {
  editMenuOpen.value = false
  action()
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

// --- Post-render next-steps chip strip (ARPU lever 5) -----------------------
// Shows on THIS artifact only when a take lands while the canvas is open and
// this is the most recently rendered artifact (singleton). Baseline is taken
// at mount so restoring a saved canvas never pops strips.
const nextSteps = useNextStepsStrip()
watch(() => props.data.takes?.length ?? 0, (now, before) => {
  if (now > (before ?? 0)) nextSteps.announceFreshTake(props.id)
})
const showNextSteps = computed(() => nextSteps.active.value?.nodeId === props.id)
function openEditMenuFromStrip() {
  nextSteps.dismiss()
  editMenuOpen.value = true
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
      class="artifact-frame relative rounded-lg overflow-hidden bg-black/40 border border-white/10"
      :class="{ 'ring-2 ring-red-500': data.error }"
    >
      <!-- Glimm prism sweep — runs while the upstream generator is active. -->
      <canvas
        ref="sweepCanvas"
        class="absolute inset-0 w-full h-full pointer-events-none z-20 rounded-lg"
        :style="{ opacity: upstreamRunning ? 1 : 0, transition: 'opacity 240ms ease' }"
      />
      <!-- Agent "scanning" overlay — runs while the agent reviews THIS node. -->
      <VueCanvasAgentScanOverlay :active="isAnalyzing" />
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
        <!-- Edit menu (top-right): Remove BG / Inpaint / Fix. Clear of the
             right-edge output handle (which sits at vertical centre). -->
        <div ref="editMenuRef" class="nopan nodrag absolute top-1 right-1 z-30">
          <button
            class="gen-pastel flex items-center gap-1 h-6 px-2.5 rounded-md text-[9px] font-medium text-neutral-900 cursor-pointer backdrop-blur-sm transition-[filter] duration-200 ease-out"
            style="--gen-pastel: linear-gradient(90deg, rgba(255,214,231,.55), rgba(207,232,255,.55), rgba(214,255,224,.55), rgba(255,244,204,.55), rgba(231,214,255,.55), rgba(255,214,231,.55));"
            title="Edit"
            @click.stop="editMenuOpen = !editMenuOpen"
          >
            <Pencil class="size-3" /> Edit…
          </button>
          <div
            v-if="editMenuOpen"
            class="absolute top-full right-0 mt-1 min-w-[190px] rounded-md border border-white/10 bg-[#1a1a1a] shadow-lg py-1"
          >
            <div class="px-2.5 pt-1 pb-0.5 text-[9px] uppercase tracking-wider text-white/30 select-none">Retouch</div>
            <button class="edit-menu-item" @click.stop="runEdit(removeBackground)">
              <Eraser class="size-3 shrink-0" /> Remove BG
            </button>
            <button class="edit-menu-item" @click.stop="runEdit(openInpaint)">
              <Brush class="size-3 shrink-0" /> Inpaint
            </button>
            <button class="edit-menu-item" @click.stop="runEdit(editWithNanoBanana)">
              <Wand2 class="size-3 shrink-0" /> Edit (Nano Banana)
              <span class="edit-menu-hint">{{ ACTION_HINTS['nano-banana'] }}</span>
            </button>
            <button v-if="data.images?.length" class="edit-menu-item" @click.stop="runEdit(critiqueResult)">
              <Sparkles class="size-3 shrink-0" /> Fix
            </button>

            <div class="mt-1 border-t border-white/[0.06] px-2.5 pt-1.5 pb-0.5 text-[9px] uppercase tracking-wider text-white/30 select-none">Enhance</div>
            <button class="edit-menu-item" @click.stop="runEdit(spawnEnhanceDetail)">
              <Gem class="size-3 shrink-0" /> Enhance Detail
              <span class="edit-menu-hint">{{ ACTION_HINTS.enhance }}</span>
            </button>
            <button class="edit-menu-item" @click.stop="runEdit(spawnUpscale)">
              <ZoomIn class="size-3 shrink-0" /> Upscale
              <span class="edit-menu-hint">{{ ACTION_HINTS.upscale }}</span>
            </button>
            <button class="edit-menu-item" @click.stop="runEdit(spawnRelight)">
              <Lamp class="size-3 shrink-0" /> Relight
              <span class="edit-menu-hint">{{ ACTION_HINTS.relight }}</span>
            </button>
            <button class="edit-menu-item" @click.stop="runEdit(spawnLensReframe)">
              <Aperture class="size-3 shrink-0" /> Lens · Reframe
              <span class="edit-menu-hint">{{ ACTION_HINTS.lens }}</span>
            </button>

            <div class="mt-1 border-t border-white/[0.06] px-2.5 pt-1.5 pb-0.5 text-[9px] uppercase tracking-wider text-white/30 select-none">Create</div>
            <button
              class="edit-menu-item disabled:opacity-35 disabled:cursor-default"
              :disabled="!hasUpstream"
              :title="hasUpstream ? 'Re-run the generator 4× with fresh seeds' : 'Nothing upstream to re-run — this image was uploaded'"
              @click.stop="runEdit(runVariations)"
            >
              <Shuffle class="size-3 shrink-0" /> Variations ×4
              <span class="edit-menu-hint">{{ ACTION_HINTS.variations }}</span>
            </button>
            <button class="edit-menu-item" @click.stop="runEdit(animateArtifact)">
              <Clapperboard class="size-3 shrink-0" /> Animate
              <span class="edit-menu-hint">{{ ACTION_HINTS.animate }}</span>
            </button>
          </div>
        </div>
        <!-- Main image -->
        <img
          :src="displayedUrl"
          class="block w-full max-h-[280px] object-contain bg-black/50"
          loading="lazy"
        />
        <!-- Transient post-render escalator chips (latest-rendered artifact only). -->
        <NextStepsStrip
          v-if="showNextSteps && displayedUrl"
          :can-vary="hasUpstream"
          @variations="runVariations"
          @upscale="spawnUpscale"
          @animate="animateArtifact"
          @more="openEditMenuFromStrip"
          @dismiss="nextSteps.dismiss()"
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
          <button
            class="nopan nodrag shrink-0 size-5 rounded flex items-center justify-center text-white/45 hover:text-white/85 hover:bg-white/[0.08] transition-colors cursor-pointer disabled:opacity-50"
            :disabled="savingAsCharacter"
            title="Save as character"
            @click.stop="saveAsCharacter"
          >
            <Loader2 v-if="savingAsCharacter" class="size-3 animate-spin" />
            <Drama v-else class="size-3" />
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

/* Edit… dropdown rows — shared by all three sections. */
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
