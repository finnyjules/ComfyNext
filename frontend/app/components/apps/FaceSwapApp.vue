<script setup lang="ts">
/**
 * Face Swap app page — the first single-purpose surface built on the node engine.
 *
 * This is intentionally a *page* design (hero, copy, generous spacing), not a
 * canvas. The same FaceSwap node powers it under the hood — we just construct
 * the prompt graph in code and submit it directly to /prompt.
 */
import { ArrowRight, Download, Image as ImageIcon, Loader2, RefreshCcw, Upload, X } from 'lucide-vue-next'
import TakesStrip from '~/components/vue-canvas/TakesStrip.vue'

interface UploadedFile {
  file: File
  filename: string  // server-side filename returned by /upload/image
  previewUrl: string
}

const sourceFace = ref<UploadedFile | null>(null)
const targetImage = ref<UploadedFile | null>(null)
const status = ref<'idle' | 'uploading' | 'running' | 'done' | 'error'>('idle')
const errorMessage = ref<string | null>(null)
// Each run stacks as a take; the displayed result is the active take.
const { takes, activeTakeId, activeTake, addTake, selectTake, pinTake, discardTake, reset: resetTakes } = useAppTakes()
const outputUrl = computed<string | null>(() => activeTake.value?.images?.[0] ?? null)
const progressLabel = ref('')

// ----- Upload helpers ----------------------------------------------------

async function uploadFile(file: File): Promise<UploadedFile> {
  const fd = new FormData()
  fd.append('image', file)
  fd.append('overwrite', 'true')
  const res = await fetch('/upload/image', { method: 'POST', body: fd })
  if (!res.ok) throw new Error(`Upload failed (${res.status})`)
  const data = await res.json()
  return {
    file,
    filename: data?.name ?? file.name,
    previewUrl: URL.createObjectURL(file),
  }
}

async function pickFile(role: 'source' | 'target', file: File | undefined | null) {
  if (!file) return
  errorMessage.value = null
  status.value = 'uploading'
  try {
    const uploaded = await uploadFile(file)
    if (role === 'source') sourceFace.value = uploaded
    else targetImage.value = uploaded
    status.value = 'idle'
  } catch (e: any) {
    errorMessage.value = e?.message ?? 'Upload failed.'
    status.value = 'error'
  }
}

function clearSlot(role: 'source' | 'target') {
  const ref = role === 'source' ? sourceFace : targetImage
  if (ref.value) URL.revokeObjectURL(ref.value.previewUrl)
  ref.value = null
  resetTakes()
  status.value = 'idle'
}

// ----- Prompt construction + submission ----------------------------------

function buildPrompt(srcFilename: string, tgtFilename: string) {
  // Hand-built graph: two LoadImage → FaceSwap → SaveImage. Hardcoded node ids
  // because there's only one shape this template ever runs.
  return {
    '1': { class_type: 'LoadImage', inputs: { image: srcFilename } },
    '2': { class_type: 'LoadImage', inputs: { image: tgtFilename } },
    '3': {
      class_type: 'FaceSwap',
      inputs: {
        source_face: ['1', 0],
        target_frames: ['2', 0],
        face_index: 0,
        threshold: 0.5,
      },
    },
    '4': {
      class_type: 'SaveImage',
      // Sailor's SaveImage requires the full export-param set, not just
      // images + filename_prefix like stock ComfyUI.
      inputs: {
        images: ['3', 0],
        filename_prefix: 'faceswap_template',
        format: 'png',
        quality: 90,
        lossless_webp: false,
        png_compression: 4,
        scale: 1.0,
        max_dimension: 0,
        embed_metadata: true,
      },
    },
  }
}

const canRun = computed(() =>
  !!sourceFace.value && !!targetImage.value && status.value !== 'running' && status.value !== 'uploading',
)

async function run() {
  if (!canRun.value || !sourceFace.value || !targetImage.value) return
  errorMessage.value = null
  status.value = 'running'
  progressLabel.value = 'Submitting…'

  try {
    const res = await fetch('/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: buildPrompt(sourceFace.value.filename, targetImage.value.filename) }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(text || `Comfy returned ${res.status}`)
    }
    const data = await res.json()
    const promptId: string | undefined = data?.prompt_id
    if (!promptId) throw new Error('No prompt_id in response — is ComfyUI running?')

    progressLabel.value = 'Running face swap…'
    const output = await pollForOutput(promptId)
    if (!output) throw new Error('Run finished but produced no output.')
    const url = `/view?${new URLSearchParams({
      filename: output.filename,
      type: output.type,
      ...(output.subfolder ? { subfolder: output.subfolder } : {}),
      t: String(Date.now()),
    })}`
    addTake({ images: [url], promptId, sig: `${output.subfolder || ''}/${output.filename}` })
    status.value = 'done'
  } catch (e: any) {
    errorMessage.value = humanizeError(e?.message ?? String(e))
    status.value = 'error'
  }
}

async function pollForOutput(promptId: string): Promise<{ filename: string; subfolder: string; type: string } | null> {
  // Poll /history/<id> every 600ms. Comfy returns {} until execution finishes,
  // then a single key matching our id with `outputs` populated.
  const deadline = Date.now() + 5 * 60 * 1000  // 5 min timeout
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 600))
    try {
      const r = await fetch(`/history/${promptId}`)
      if (!r.ok) continue
      const data = await r.json()
      const entry = data?.[promptId]
      if (!entry) continue
      if (entry?.status?.status_str === 'error') {
        throw new Error(extractComfyError(entry))
      }
      const outputs = entry?.outputs
      if (!outputs) continue
      for (const node of Object.values(outputs) as any[]) {
        if (Array.isArray(node?.images) && node.images.length > 0) return node.images[0]
      }
    } catch (e) {
      // Polling errors are transient unless they came from our own throw above.
      if (e instanceof Error && e.message.startsWith('Comfy:')) throw e
    }
  }
  return null
}

function extractComfyError(entry: any): string {
  const messages: any[] = entry?.status?.messages ?? []
  const errMsg = messages.find((m) => m[0] === 'execution_error')?.[1]
  if (errMsg?.exception_message) return `Comfy: ${errMsg.exception_message}`
  return 'Comfy: execution failed.'
}

function humanizeError(msg: string): string {
  if (msg.includes('No face found in source_face')) {
    return "Couldn't detect a face in your reference photo. Try a clearer, well-lit close-up."
  }
  if (msg.includes('inswapper_128.onnx not found')) {
    return 'Face Swap model is missing. Open the Toolbox panel and click Face Swap to download it (~530 MB).'
  }
  if (msg.includes('No prompt_id')) {
    return "Couldn't reach the engine. Is ComfyUI running on port 8188?"
  }
  return msg
}

// ----- File-slot interactions -------------------------------------------

const sourceInputRef = ref<HTMLInputElement | null>(null)
const targetInputRef = ref<HTMLInputElement | null>(null)

function onDrop(role: 'source' | 'target', e: DragEvent) {
  e.preventDefault()
  const file = e.dataTransfer?.files?.[0]
  if (file) pickFile(role, file)
}

function preventDefault(e: Event) { e.preventDefault() }

function reset() {
  if (sourceFace.value) URL.revokeObjectURL(sourceFace.value.previewUrl)
  if (targetImage.value) URL.revokeObjectURL(targetImage.value.previewUrl)
  sourceFace.value = null
  targetImage.value = null
  resetTakes()
  errorMessage.value = null
  status.value = 'idle'
}

function download() {
  if (!outputUrl.value) return
  const a = document.createElement('a')
  a.href = outputUrl.value
  a.download = 'face-swap.png'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}
</script>

<template>
  <div class="h-full overflow-y-auto bg-[#0a0a0a]">
    <div class="max-w-[920px] mx-auto px-10 py-12">
      <!-- Header -->
      <div class="mb-14">
        <div class="text-[11px] uppercase tracking-[0.16em] text-white/35 font-medium mb-3">
          App · Image
        </div>
        <h1 class="text-[44px] font-medium text-white tracking-tight leading-[1.05] mb-4">
          Face Swap
        </h1>
        <p class="text-[15px] text-white/60 max-w-[560px] leading-relaxed">
          Drop a reference photo of the face you want to use, then drop the photo you want to put it into.
          Works best when the reference is well-lit and looking roughly at camera.
        </p>
      </div>

      <!-- Inputs -->
      <div class="grid grid-cols-2 gap-5 mb-8">
        <!-- Source face -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="text-[12px] font-medium text-white/85 tracking-[0.01em]">Reference face</label>
            <span class="text-[11px] text-white/35">Step 1</span>
          </div>
          <input
            ref="sourceInputRef"
            type="file"
            accept="image/*"
            class="hidden"
            @change="(e) => pickFile('source', (e.target as HTMLInputElement).files?.[0])"
          />
          <div
            v-if="!sourceFace"
            class="group relative aspect-[4/3] rounded-xl border border-dashed border-white/12 bg-white/[0.015] hover:bg-white/[0.04] hover:border-white/25 cursor-pointer transition-colors flex flex-col items-center justify-center gap-3"
            @click="sourceInputRef?.click()"
            @dragover="preventDefault"
            @drop="(e) => onDrop('source', e)"
          >
            <div class="size-10 rounded-full bg-white/[0.04] flex items-center justify-center">
              <Upload class="size-4 text-white/45 group-hover:text-white/70 transition-colors" :stroke-width="1.75" />
            </div>
            <div class="text-center">
              <div class="text-[13px] text-white/70 mb-0.5">Drop a face photo</div>
              <div class="text-[11px] text-white/35">or click to browse</div>
            </div>
          </div>
          <div
            v-else
            class="relative aspect-[4/3] rounded-xl overflow-hidden bg-black border border-white/10"
          >
            <img :src="sourceFace.previewUrl" class="absolute inset-0 size-full object-cover" />
            <button
              class="absolute top-2 right-2 size-7 rounded-full bg-black/70 hover:bg-black/90 backdrop-blur-sm flex items-center justify-center text-white/80 hover:text-white transition-colors cursor-pointer"
              @click="clearSlot('source')"
            >
              <X class="size-3.5" />
            </button>
            <div class="absolute bottom-0 left-0 right-0 px-3 py-2 bg-gradient-to-t from-black/80 to-transparent">
              <div class="text-[11px] text-white/80 truncate">{{ sourceFace.file.name }}</div>
            </div>
          </div>
        </div>

        <!-- Target image -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="text-[12px] font-medium text-white/85 tracking-[0.01em]">Target photo</label>
            <span class="text-[11px] text-white/35">Step 2</span>
          </div>
          <input
            ref="targetInputRef"
            type="file"
            accept="image/*"
            class="hidden"
            @change="(e) => pickFile('target', (e.target as HTMLInputElement).files?.[0])"
          />
          <div
            v-if="!targetImage"
            class="group relative aspect-[4/3] rounded-xl border border-dashed border-white/12 bg-white/[0.015] hover:bg-white/[0.04] hover:border-white/25 cursor-pointer transition-colors flex flex-col items-center justify-center gap-3"
            @click="targetInputRef?.click()"
            @dragover="preventDefault"
            @drop="(e) => onDrop('target', e)"
          >
            <div class="size-10 rounded-full bg-white/[0.04] flex items-center justify-center">
              <ImageIcon class="size-4 text-white/45 group-hover:text-white/70 transition-colors" :stroke-width="1.75" />
            </div>
            <div class="text-center">
              <div class="text-[13px] text-white/70 mb-0.5">Drop the photo to edit</div>
              <div class="text-[11px] text-white/35">or click to browse</div>
            </div>
          </div>
          <div
            v-else
            class="relative aspect-[4/3] rounded-xl overflow-hidden bg-black border border-white/10"
          >
            <img :src="targetImage.previewUrl" class="absolute inset-0 size-full object-cover" />
            <button
              class="absolute top-2 right-2 size-7 rounded-full bg-black/70 hover:bg-black/90 backdrop-blur-sm flex items-center justify-center text-white/80 hover:text-white transition-colors cursor-pointer"
              @click="clearSlot('target')"
            >
              <X class="size-3.5" />
            </button>
            <div class="absolute bottom-0 left-0 right-0 px-3 py-2 bg-gradient-to-t from-black/80 to-transparent">
              <div class="text-[11px] text-white/80 truncate">{{ targetImage.file.name }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Run -->
      <div class="flex items-center justify-between mb-12">
        <p v-if="status === 'running'" class="text-[12px] text-white/55 flex items-center gap-2">
          <Loader2 class="size-3.5 animate-spin" />
          <span>{{ progressLabel }}</span>
        </p>
        <p v-else-if="status === 'uploading'" class="text-[12px] text-white/55 flex items-center gap-2">
          <Loader2 class="size-3.5 animate-spin" />
          <span>Uploading…</span>
        </p>
        <p v-else-if="errorMessage" class="text-[12px] text-rose-400 max-w-md">
          {{ errorMessage }}
        </p>
        <span v-else class="text-[12px] text-white/35">
          {{ sourceFace && targetImage ? 'Ready to swap.' : 'Add both photos above to start.' }}
        </span>
        <button
          class="inline-flex items-center gap-2 h-10 px-5 rounded-full bg-white text-[#0a0a0a] font-medium text-[13px] hover:bg-white/90 transition-colors cursor-pointer disabled:bg-white/15 disabled:text-white/40 disabled:cursor-not-allowed"
          :disabled="!canRun"
          @click="run"
        >
          <span>{{ status === 'running' ? 'Swapping…' : 'Swap faces' }}</span>
          <ArrowRight v-if="status !== 'running'" class="size-4" />
          <Loader2 v-else class="size-4 animate-spin" />
        </button>
      </div>

      <!-- Output -->
      <div v-if="outputUrl || status === 'running'" class="border-t border-white/[0.06] pt-10">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-[20px] font-medium text-white tracking-tight">Result</h2>
          <div v-if="outputUrl" class="flex items-center gap-2">
            <button
              class="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-[12px] text-white/80 hover:text-white transition-colors cursor-pointer"
              @click="reset"
            >
              <RefreshCcw class="size-3.5" />
              Start over
            </button>
            <button
              class="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-[#96b4ff] hover:bg-[#a8c2ff] text-[#0a0a0a] text-[12px] font-medium transition-colors cursor-pointer"
              @click="download"
            >
              <Download class="size-3.5" />
              Download
            </button>
          </div>
        </div>
        <div class="rounded-xl overflow-hidden bg-black border border-white/[0.06] min-h-[320px] flex items-center justify-center">
          <img v-if="outputUrl" :src="outputUrl" class="w-full max-h-[640px] object-contain" />
          <div v-else class="flex flex-col items-center gap-3 py-16">
            <Loader2 class="size-6 text-white/30 animate-spin" />
            <div class="text-[12px] text-white/40">{{ progressLabel || 'Working…' }}</div>
          </div>
        </div>
        <TakesStrip
          v-if="takes.length >= 1"
          :takes="takes"
          :active-take-id="activeTakeId"
          class="mt-3 rounded-lg bg-black/40 border border-white/10"
          @select="selectTake"
          @pin="pinTake"
          @discard="discardTake"
        />
      </div>
    </div>
  </div>
</template>
