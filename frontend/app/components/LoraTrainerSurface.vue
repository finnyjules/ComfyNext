<script setup lang="ts">
/**
 * Train LoRA — top-level surface for training SDXL/SD1.5/Flux LoRAs.
 *
 * The trainer engine is the existing TrainLoraNode in comfy_extras/nodes_train.py.
 * This page builds the workflow graph in code and submits it to /prompt, the
 * same pattern the Apps use.
 *
 * Flow:
 *   1. Upload images to input/<sessionFolder>/  via /upload/image
 *   2. Post captions to /comfynext/lora/save_captions  → writes .txt sidecars
 *   3. Build graph: CheckpointLoaderSimple → LoadImageTextDataSetFromFolder
 *      → MakeTrainingDataset → TrainLoraNode → SaveLoRA
 *   4. POST /prompt, poll /history/<id>
 */
import { ArrowRight, ChevronDown, ChevronRight, Cloud, Cpu, Download, Loader2, Plus, RefreshCcw, Sparkles, Upload, Wand, X } from 'lucide-vue-next'
import JSZip from 'jszip'

// ----- Compute mode (Local vs Cloud) ------------------------------------

type ComputeMode = 'local' | 'cloud'
const computeMode = ref<ComputeMode>('local')

// Cloud family — what Replicate trainer to use. Independent of the local
// checkpoint picker (which is moot in cloud mode).
type CloudFamily = 'flux' | 'sdxl_sd15'
const cloudFamily = ref<CloudFamily>('flux')

// Cloud training state — populated when a prediction is in flight.
interface CloudJob {
  predictionId: string
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled'
  logs?: string
  error?: string | null
  localFilename?: string | null
  replicateUrl?: string | null
}
const cloudJob = ref<CloudJob | null>(null)

// ----- Downloadable base checkpoints -------------------------------------

interface DownloadableCheckpoint {
  key: string         // matches the server-side bundle key
  label: string
  family: 'SDXL' | 'SD1.5' | 'Flux'
  sizeBytes: number
  blurb: string
}

const DOWNLOADABLE_CHECKPOINTS: DownloadableCheckpoint[] = [
  {
    key: 'lora-base-sdxl',
    label: 'SDXL Base 1.0',
    family: 'SDXL',
    sizeBytes: 6_938_078_334,
    blurb: 'Best default for character / style LoRAs. 1024×1024 native.',
  },
  {
    key: 'lora-base-sd15',
    label: 'Stable Diffusion 1.5',
    family: 'SD1.5',
    sizeBytes: 4_265_146_304,
    blurb: 'Faster to train, smaller VRAM footprint. 512×512 native.',
  },
  {
    key: 'lora-base-flux-schnell',
    label: 'Flux.1 Schnell',
    family: 'Flux',
    sizeBytes: 23_782_506_688 + 335_304_388 + 246_144_152 + 4_893_934_904,
    blurb: 'Open-license Flux. Heavy download (~29 GB across 4 files), high VRAM. Enable CPU offload in Advanced.',
  },
]

// Synthetic option value the picker uses to represent the Flux multi-file
// setup. Detected by buildTrainingPrompt to switch workflow shape.
const FLUX_OPTION_VALUE = '__flux_schnell__'
const FLUX_FILES = {
  unet: 'flux1-schnell.safetensors',
  vae: 'ae.safetensors',
  clipL: 'clip_l.safetensors',
  t5: 't5xxl_fp8_e4m3fn.safetensors',
}
const fluxReady = ref(false)

async function probeFluxReady() {
  try {
    const r = await fetch('/comfynext/models/status?key=lora-base-flux-schnell')
    if (r.ok) {
      const status = await r.json()
      fluxReady.value = !!status.ready
    }
  } catch { /* silent — surface will just hide the option */ }
}

interface CheckpointDownloadState {
  phase: 'idle' | 'checking' | 'downloading' | 'preparing' | 'done' | 'error'
  downloaded: number
  total: number
  message?: string
}
const downloadStates = reactive<Record<string, CheckpointDownloadState>>({})
for (const c of DOWNLOADABLE_CHECKPOINTS) {
  downloadStates[c.key] = { phase: 'idle', downloaded: 0, total: c.sizeBytes }
}

function fmtGB(bytes: number): string {
  return (bytes / 1024 / 1024 / 1024).toFixed(1)
}
function downloadPct(key: string): number {
  const s = downloadStates[key]
  if (!s?.total) return 0
  return Math.round((s.downloaded / s.total) * 100)
}

async function downloadCheckpoint(key: string) {
  const state = downloadStates[key]
  if (!state || state.phase === 'downloading' || state.phase === 'preparing') return
  state.phase = 'checking'
  state.message = undefined
  state.downloaded = 0

  try {
    // Quick status probe first — if already on disk we can skip the stream.
    const probe = await fetch(`/comfynext/models/status?key=${key}`)
    if (probe.ok) {
      const status = await probe.json()
      if (status.ready) {
        state.phase = 'done'
        state.downloaded = state.total
        await loadCheckpoints()
        return
      }
    }
  } catch {
    state.phase = 'error'
    state.message = 'Could not reach the model server. Is ComfyUI running?'
    return
  }

  await new Promise<void>((resolve) => {
    const es = new EventSource(`/comfynext/models/download?key=${key}`)
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.phase === 'downloading') {
          state.phase = 'downloading'
          state.downloaded = msg.downloaded ?? 0
          state.total = msg.total ?? state.total
        } else if (msg.phase === 'preparing') {
          state.phase = 'preparing'
        } else if (msg.phase === 'done') {
          state.phase = 'done'
          state.downloaded = state.total
          es.close()
          loadCheckpoints().finally(() => resolve())
        } else if (msg.phase === 'error') {
          state.phase = 'error'
          state.message = msg.message || 'Download failed.'
          es.close()
          resolve()
        }
      } catch {}
    }
    es.onerror = () => {
      if (state.phase !== 'done' && state.phase !== 'error') {
        state.phase = 'error'
        state.message = 'Lost connection to the model server.'
      }
      es.close()
      resolve()
    }
  })
}

// ----- Dataset state -----------------------------------------------------

interface DatasetImage {
  file: File
  filename: string       // server-side filename after /upload/image
  previewUrl: string     // local blob: URL for preview
  caption: string
  captionState: 'idle' | 'captioning' | 'done' | 'error'
}

const sessionFolder = `lora_dataset_${Date.now()}`
const images = ref<DatasetImage[]>([])
const status = ref<'idle' | 'uploading' | 'captioning' | 'submitting' | 'training' | 'done' | 'error'>('idle')
const errorMessage = ref<string | null>(null)
const progressLabel = ref('')
const progressPct = ref(0)
const outputFilename = ref<string | null>(null)
const lossGraphUrl = ref<string | null>(null)

// ----- Hyperparameters ---------------------------------------------------

const checkpoints = ref<string[]>([])
const checkpointsLoading = ref(false)
const checkpointsError = ref<string | null>(null)

const form = reactive({
  checkpoint: '',
  outputName: 'my_lora',
  triggerWord: '',
  steps: 1000,
  learningRate: 0.0004,
  rank: 16,
  // Advanced
  batchSize: 1,
  gradAccumulationSteps: 1,
  optimizer: 'AdamW',
  lossFunction: 'MSE',
  trainingDtype: 'bf16',
  loraDtype: 'bf16',
  algorithm: 'lora',
  gradientCheckpointing: true,
  checkpointDepth: 1,
  offloading: false,
  seed: 0,
  bucketMode: false,
  bypassMode: false,
})

const advancedOpen = ref(false)

// Load checkpoint list from /object_info
async function loadCheckpoints() {
  checkpointsLoading.value = true
  checkpointsError.value = null
  try {
    const res = await fetch('/object_info/CheckpointLoaderSimple')
    if (!res.ok) throw new Error(`Server returned ${res.status}`)
    const data = await res.json()
    const ckptList = data?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? []
    checkpoints.value = Array.isArray(ckptList) ? ckptList : []
  } catch (e: any) {
    checkpointsError.value = e?.message ?? 'Failed to load checkpoints. Is ComfyUI running?'
  } finally {
    checkpointsLoading.value = false
  }
}

// Combined picker options: real SDXL/SD1.5 checkpoints + synthetic Flux entry.
interface CheckpointOption { value: string; label: string; family: 'sdxl_sd15' | 'flux' }
const checkpointOptions = computed<CheckpointOption[]>(() => {
  const opts: CheckpointOption[] = checkpoints.value.map(c => ({ value: c, label: c, family: 'sdxl_sd15' as const }))
  if (fluxReady.value) opts.push({ value: FLUX_OPTION_VALUE, label: 'Flux.1 Schnell (multi-file)', family: 'flux' as const })
  return opts
})

const selectedFamily = computed<'sdxl_sd15' | 'flux'>(() => {
  const opt = checkpointOptions.value.find(o => o.value === form.checkpoint)
  return opt?.family ?? 'sdxl_sd15'
})

// Cloud cost + time estimate. Numbers based on Replicate's ostris trainers
// running on H100 80GB ($0.001525/sec = $5.49/hr). Step times are observed
// averages — rough but in the right ballpark.
const REPLICATE_H100_PER_SEC = 0.001525

const costEstimate = computed(() => {
  const steps = Math.max(1, form.steps || 1000)
  if (cloudFamily.value === 'flux') {
    // ostris/flux-dev-lora-trainer: ~60s setup + 1.5–2.5s/step on H100.
    const lowSec = 60 + steps * 1.5
    const highSec = 90 + steps * 2.5
    return {
      cost: `~$${(lowSec * REPLICATE_H100_PER_SEC).toFixed(2)}–${(highSec * REPLICATE_H100_PER_SEC).toFixed(2)}`,
      time: `~${Math.round(lowSec / 60)}–${Math.round(highSec / 60)} min`,
      note: 'Cold starts add a minute or two. Long jobs can hit the upper bound.',
    }
  }
  // ostris/sdxl-lora-trainer: ~30s setup + 0.5–0.9s/step on H100.
  const lowSec = 30 + steps * 0.5
  const highSec = 45 + steps * 0.9
  return {
    cost: `~$${(lowSec * REPLICATE_H100_PER_SEC).toFixed(2)}–${(highSec * REPLICATE_H100_PER_SEC).toFixed(2)}`,
    time: `~${Math.max(1, Math.round(lowSec / 60))}–${Math.round(highSec / 60)} min`,
    note: 'SDXL is the cheaper, faster choice when you don\'t need Flux quality.',
  }
})

// Auto-select the first option (SDXL/SD1.5 checkpoint first; Flux if it's the
// only choice). Runs whenever the option list changes.
watch(checkpointOptions, (opts) => {
  if (!form.checkpoint && opts.length > 0) {
    form.checkpoint = opts[0].value
  }
}, { immediate: true })

// After a Flux download finishes, mark Flux as ready and refresh the picker.
watch(downloadStates, () => {
  const flux = downloadStates['lora-base-flux-schnell']
  if (flux?.phase === 'done') fluxReady.value = true
}, { deep: true })

onMounted(() => {
  loadCheckpoints()
  probeFluxReady()
})

// ----- Upload helpers ----------------------------------------------------

async function uploadImage(file: File): Promise<string> {
  const fd = new FormData()
  fd.append('image', file)
  fd.append('subfolder', sessionFolder)
  fd.append('overwrite', 'true')
  const res = await fetch('/upload/image', { method: 'POST', body: fd })
  if (!res.ok) throw new Error(`Upload failed (${res.status})`)
  const data = await res.json()
  return data?.name ?? file.name
}

async function addFiles(fileList: FileList | File[] | null | undefined) {
  if (!fileList) return
  const arr = Array.from(fileList).filter((f) => f.type.startsWith('image/'))
  if (arr.length === 0) return
  errorMessage.value = null
  status.value = 'uploading'
  try {
    for (const file of arr) {
      const filename = await uploadImage(file)
      images.value.push({
        file,
        filename,
        previewUrl: URL.createObjectURL(file),
        caption: '',
        captionState: 'idle',
      })
    }
    status.value = 'idle'
  } catch (e: any) {
    errorMessage.value = e?.message ?? 'Upload failed.'
    status.value = 'error'
  }
}

function removeImage(idx: number) {
  const img = images.value[idx]
  if (img) URL.revokeObjectURL(img.previewUrl)
  images.value.splice(idx, 1)
}

function clearDataset() {
  for (const img of images.value) URL.revokeObjectURL(img.previewUrl)
  images.value = []
  outputFilename.value = null
  lossGraphUrl.value = null
  errorMessage.value = null
  status.value = 'idle'
}

// ----- Drag-drop ---------------------------------------------------------

const dropZoneActive = ref(false)
function onDrop(e: DragEvent) {
  e.preventDefault()
  dropZoneActive.value = false
  addFiles(e.dataTransfer?.files)
}
function onDragOver(e: DragEvent) {
  e.preventDefault()
  dropZoneActive.value = true
}
function onDragLeave() {
  dropZoneActive.value = false
}

const fileInputRef = ref<HTMLInputElement | null>(null)

// ----- Auto-caption via Claude vision -----------------------------------

const CAPTION_SYSTEM = 'You write concise, training-friendly image captions for LoRA training. '
  + 'Describe the subject, key visual attributes, style, and composition in one or two short sentences. '
  + 'Do not start with "an image of" or "a photo of". No quotes, no markdown. Just the caption text.'

async function captionOne(idx: number) {
  const img = images.value[idx]
  if (!img) return
  img.captionState = 'captioning'
  try {
    // Single-node Claude workflow. The Anthropic node uploads to ComfyAPI then
    // calls Claude. We point its "image_1" input at the already-uploaded file.
    const prompt = {
      '1': {
        class_type: 'LoadImage',
        inputs: { image: img.filename ? `${sessionFolder}/${img.filename}` : img.filename },
      },
      '2': {
        class_type: 'ClaudeNode',
        inputs: {
          prompt: 'Caption this image for LoRA training.',
          system_prompt: CAPTION_SYSTEM,
          model: 'claude-sonnet-4-5',
          max_tokens: 256,
          temperature: 0.3,
          image_1: ['1', 0],
        },
      },
      '3': {
        class_type: 'ShowText|pysssss',
        inputs: { text: ['2', 0] },
      },
    }
    const res = await fetch('/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    })
    if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`)
    const data = await res.json()
    const promptId = data?.prompt_id
    if (!promptId) throw new Error('No prompt_id from /prompt')
    const text = await pollForText(promptId)
    if (text) {
      img.caption = text.trim()
      img.captionState = 'done'
    } else {
      throw new Error('Claude returned no text.')
    }
  } catch (e: any) {
    img.captionState = 'error'
    console.error('caption error', e)
  }
}

async function captionAll() {
  errorMessage.value = null
  status.value = 'captioning'
  const targets = images.value
    .map((_, i) => i)
    .filter((i) => !images.value[i].caption.trim())
  for (const i of targets) {
    await captionOne(i)
  }
  status.value = 'idle'
}

async function pollForText(promptId: string): Promise<string | null> {
  const deadline = Date.now() + 2 * 60 * 1000
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
        // Claude node returns its text in the first string output
        if (typeof node?.text === 'string') return node.text
        if (Array.isArray(node?.text) && node.text.length > 0) return String(node.text[0])
        if (Array.isArray(node?.string) && node.string.length > 0) return String(node.string[0])
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Comfy:')) throw e
    }
  }
  return null
}

// ----- Training ----------------------------------------------------------

const canRun = computed(() =>
  images.value.length >= 2
  && (computeMode.value === 'cloud' || form.checkpoint)
  && form.outputName.trim().length > 0
  && status.value !== 'uploading'
  && status.value !== 'submitting'
  && status.value !== 'training'
  && status.value !== 'captioning',
)

function onStartClicked() {
  if (computeMode.value === 'cloud') startCloudTraining()
  else startTraining()
}

function buildTrainingPrompt() {
  const safeName = form.outputName.trim().replace(/[^a-zA-Z0-9_-]+/g, '_') || 'my_lora'
  const prefix = `loras/${safeName}`

  // Model loading branch: SDXL/SD1.5 use one all-in-one node; Flux uses three.
  const isFlux = selectedFamily.value === 'flux'

  const modelNodes = isFlux
    ? {
        '1a': {
          class_type: 'UNETLoader',
          inputs: { unet_name: FLUX_FILES.unet, weight_dtype: 'default' },
        },
        '1b': {
          class_type: 'DualCLIPLoader',
          inputs: { clip_name1: FLUX_FILES.t5, clip_name2: FLUX_FILES.clipL, type: 'flux' },
        },
        '1c': {
          class_type: 'VAELoader',
          inputs: { vae_name: FLUX_FILES.vae },
        },
      }
    : {
        '1': {
          class_type: 'CheckpointLoaderSimple',
          inputs: { ckpt_name: form.checkpoint },
        },
      }

  // Output socket refs differ between the two paths.
  const modelRef: [string, number] = isFlux ? ['1a', 0] : ['1', 0]
  const clipRef: [string, number]  = isFlux ? ['1b', 0] : ['1', 1]
  const vaeRef: [string, number]   = isFlux ? ['1c', 0] : ['1', 2]

  return {
    ...modelNodes,
    '2': {
      class_type: 'LoadImageTextDataSetFromFolder',
      inputs: { folder: sessionFolder },
    },
    '3': {
      class_type: 'MakeTrainingDataset',
      inputs: {
        images: ['2', 0],
        vae: vaeRef,
        clip: clipRef,
        texts: ['2', 1],
      },
    },
    '4': {
      class_type: 'TrainLoraNode',
      inputs: {
        model: modelRef,
        latents: ['3', 0],
        positive: ['3', 1],
        batch_size: form.batchSize,
        grad_accumulation_steps: form.gradAccumulationSteps,
        steps: form.steps,
        learning_rate: form.learningRate,
        rank: form.rank,
        optimizer: form.optimizer,
        loss_function: form.lossFunction,
        seed: form.seed,
        training_dtype: form.trainingDtype,
        lora_dtype: form.loraDtype,
        algorithm: form.algorithm,
        gradient_checkpointing: form.gradientCheckpointing,
        checkpoint_depth: form.checkpointDepth,
        offloading: form.offloading,
        existing_lora: '[None]',
        bucket_mode: form.bucketMode,
        bypass_mode: form.bypassMode,
      },
    },
    '5': {
      class_type: 'SaveLoRA',
      inputs: {
        lora: ['4', 0],
        prefix,
        steps: ['4', 2],
      },
    },
    '6': {
      class_type: 'LossGraphNode',
      inputs: {
        loss_map: ['4', 1],
        filename_prefix: `loss_${safeName}`,
      },
    },
  }
}

async function saveCaptionsToDisk() {
  const captions: Record<string, string> = {}
  for (const img of images.value) {
    captions[img.filename] = img.caption ?? ''
  }
  const res = await fetch('/comfynext/lora/save_captions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder: sessionFolder, captions }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Saving captions failed: ${text || res.status}`)
  }
}

async function startTraining() {
  if (!canRun.value) return
  errorMessage.value = null
  outputFilename.value = null
  lossGraphUrl.value = null
  progressPct.value = 0

  try {
    status.value = 'submitting'
    progressLabel.value = 'Writing captions to disk…'
    await saveCaptionsToDisk()

    progressLabel.value = 'Submitting training workflow…'
    const res = await fetch('/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: buildTrainingPrompt() }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(text || `Comfy returned ${res.status}`)
    }
    const data = await res.json()
    const promptId: string | undefined = data?.prompt_id
    if (!promptId) throw new Error('No prompt_id in response — is ComfyUI running?')

    status.value = 'training'
    progressLabel.value = `Training (0 / ${form.steps} steps)…`
    const result = await pollForTrainingResult(promptId)
    if (!result) throw new Error('Training finished but produced no output.')

    outputFilename.value = result.loraFilename
    lossGraphUrl.value = result.lossGraphUrl
    status.value = 'done'
    progressLabel.value = 'Done.'
    progressPct.value = 100
  } catch (e: any) {
    errorMessage.value = humanizeError(e?.message ?? String(e))
    status.value = 'error'
  }
}

async function pollForTrainingResult(
  promptId: string,
): Promise<{ loraFilename: string | null; lossGraphUrl: string | null } | null> {
  // No fine-grained step progress from /history — TrainLoraNode runs in one
  // execute() call. We do show a coarse running/done state via /queue.
  const deadline = Date.now() + 6 * 60 * 60 * 1000 // 6 hours
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500))
    try {
      // Bump the progress bar so the user knows we're alive
      if (progressPct.value < 95) progressPct.value = Math.min(95, progressPct.value + 0.5)

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

      let lossGraphUrl: string | null = null
      // LossGraphNode produces an image output
      for (const node of Object.values(outputs) as any[]) {
        if (Array.isArray(node?.images) && node.images.length > 0) {
          const img = node.images[0]
          lossGraphUrl = `/view?${new URLSearchParams({
            filename: img.filename,
            type: img.type,
            ...(img.subfolder ? { subfolder: img.subfolder } : {}),
            t: String(Date.now()),
          })}`
          break
        }
      }
      // We can't read the SaveLoRA filename from /history (no output declared),
      // but we know the prefix → just report the safe name.
      const safeName = form.outputName.trim().replace(/[^a-zA-Z0-9_-]+/g, '_') || 'my_lora'
      return { loraFilename: safeName, lossGraphUrl }
    } catch (e) {
      if (e instanceof Error && (e.message.startsWith('Comfy:') || e.message.includes('LoRA'))) throw e
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

// ----- Cloud training (Replicate) ---------------------------------------

async function buildDatasetZip(): Promise<Blob> {
  // Browser-side zip: <i>_<sanitizedName>.png + matching .txt with the caption.
  // Replicate's trainers expect image + .txt pairs (same convention as kohya).
  const zip = new JSZip()
  for (let i = 0; i < images.value.length; i++) {
    const img = images.value[i]
    const ext = (img.file.name.split('.').pop() || 'png').toLowerCase()
    const base = String(i + 1).padStart(4, '0')
    const imgName = `${base}.${ext}`
    zip.file(imgName, img.file)
    zip.file(`${base}.txt`, img.caption || '')
  }
  return await zip.generateAsync({ type: 'blob', compression: 'STORE' })
}

async function startCloudTraining() {
  if (images.value.length < 2) return
  errorMessage.value = null
  outputFilename.value = null
  lossGraphUrl.value = null
  progressPct.value = 0
  cloudJob.value = null

  try {
    status.value = 'submitting'
    progressLabel.value = 'Zipping dataset…'
    const zipBlob = await buildDatasetZip()

    progressLabel.value = 'Uploading dataset to Replicate…'
    const fd = new FormData()
    fd.append('file', zipBlob, 'dataset.zip')
    const upRes = await fetch('/api/cloud-train/upload', { method: 'POST', body: fd })
    if (!upRes.ok) {
      const text = await upRes.text()
      throw new Error(text || `Upload failed: ${upRes.status}`)
    }
    const upJson = await upRes.json() as { url: string }

    progressLabel.value = 'Starting Replicate training…'
    const safeName = form.outputName.trim().replace(/[^a-zA-Z0-9_-]+/g, '_') || 'my_lora'
    const startRes = await fetch('/api/cloud-train/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        family: cloudFamily.value,
        datasetUrl: upJson.url,
        outputName: safeName,
        triggerWord: form.triggerWord || undefined,
        steps: form.steps,
        learningRate: form.learningRate,
        loraRank: form.rank,
        batchSize: form.batchSize,
        seed: form.seed,
      }),
    })
    if (!startRes.ok) {
      const text = await startRes.text()
      throw new Error(text || `Start failed: ${startRes.status}`)
    }
    const startJson = await startRes.json() as { id: string; status: any }
    cloudJob.value = { predictionId: startJson.id, status: startJson.status }

    status.value = 'training'
    progressLabel.value = 'Replicate is provisioning a GPU…'
    const final = await pollCloudJob(startJson.id, safeName, cloudFamily.value)
    if (!final) throw new Error('Polling stopped without a final status.')

    cloudJob.value = final
    if (final.status === 'succeeded') {
      outputFilename.value = final.localFilename ?? safeName
      status.value = 'done'
      progressLabel.value = 'Done.'
      progressPct.value = 100
    } else if (final.status === 'failed') {
      throw new Error(final.error || 'Training failed on Replicate.')
    } else if (final.status === 'canceled') {
      throw new Error('Training was canceled.')
    }
  } catch (e: any) {
    errorMessage.value = humanizeError(e?.message ?? String(e))
    status.value = 'error'
  }
}

async function pollCloudJob(
  predictionId: string,
  outputName: string,
  family: CloudFamily,
): Promise<CloudJob | null> {
  const deadline = Date.now() + 2 * 60 * 60 * 1000 // 2 hours
  let lastStatus = ''
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000))
    try {
      const r = await fetch(`/api/cloud-train/status?id=${predictionId}&outputName=${encodeURIComponent(outputName)}&family=${family}`)
      if (!r.ok) continue
      const data = await r.json() as {
        id: string
        status: CloudJob['status']
        output: string | string[] | null
        error: string | null
        logs?: string
        localFilename: string | null
      }

      const replicateUrl = Array.isArray(data.output) ? data.output[0] : data.output
      const job: CloudJob = {
        predictionId: data.id,
        status: data.status,
        logs: data.logs,
        error: data.error,
        localFilename: data.localFilename,
        replicateUrl,
      }
      cloudJob.value = job

      if (data.status !== lastStatus) {
        if (data.status === 'starting') progressLabel.value = 'Replicate is provisioning a GPU…'
        else if (data.status === 'processing') progressLabel.value = 'Training in progress on Replicate…'
        else if (data.status === 'succeeded') progressLabel.value = 'Downloading LoRA…'
        else if (data.status === 'failed') progressLabel.value = 'Training failed.'
        else if (data.status === 'canceled') progressLabel.value = 'Training canceled.'
        lastStatus = data.status
      }

      // Inch the progress bar so the user knows we're alive.
      if (data.status === 'processing' && progressPct.value < 90) {
        progressPct.value = Math.min(90, progressPct.value + 0.7)
      }

      if (data.status === 'succeeded' || data.status === 'failed' || data.status === 'canceled') {
        return job
      }
    } catch {
      // network blip — keep polling
    }
  }
  return null
}

// ----- Error message normalization --------------------------------------

function humanizeError(msg: string): string {
  if (msg.includes('out of memory') || msg.includes('CUDA out of memory')) {
    return 'Out of GPU memory. Try enabling Offloading or lowering rank/batch size in Advanced.'
  }
  if (msg.includes('No prompt_id')) {
    return "Couldn't reach the engine. Is ComfyUI running on port 8188?"
  }
  if (msg.includes('LoadImageTextDataSetFromFolder')) {
    return "Couldn't load the dataset. Check that images uploaded successfully."
  }
  return msg
}

// ----- Cleanup ----------------------------------------------------------

onBeforeUnmount(() => {
  for (const img of images.value) URL.revokeObjectURL(img.previewUrl)
})
</script>

<template>
  <div class="h-full overflow-y-auto bg-[#0a0a0a]">
    <div class="max-w-[1080px] mx-auto px-10 py-12">
      <!-- Header -->
      <div class="mb-12">
        <div class="text-[11px] uppercase tracking-[0.16em] text-white/35 font-medium mb-3">
          Training · LoRA
        </div>
        <h1 class="text-[44px] font-medium text-white tracking-tight leading-[1.05] mb-4">
          Train a LoRA
        </h1>
        <p class="text-[15px] text-white/60 max-w-[640px] leading-relaxed">
          Teach a Stable Diffusion or Flux model what a person, character, or style looks like.
          Drop in <span class="text-white/85">10–30 reference images</span>, give it a name, and
          the trainer produces a small <code class="text-[13px] text-white/75 bg-white/[0.04] px-1 py-0.5 rounded">.safetensors</code>
          file you can load into any workflow.
        </p>
      </div>

      <!-- Compute mode -->
      <section class="mb-8">
        <div class="flex items-center justify-between mb-2">
          <label class="text-[12px] font-medium text-white/85 tracking-[0.01em]">Compute</label>
          <span class="text-[11px] text-white/35">Step 1</span>
        </div>
        <div class="inline-flex rounded-lg bg-white/[0.03] border border-white/[0.06] p-0.5">
          <button
            class="inline-flex items-center gap-2 h-9 px-4 rounded-md text-[12.5px] font-medium transition-colors cursor-pointer"
            :class="computeMode === 'local'
              ? 'bg-white/[0.08] text-white'
              : 'text-white/55 hover:text-white/80'"
            @click="computeMode = 'local'"
          >
            <Cpu class="size-3.5" />
            Local
          </button>
          <button
            class="inline-flex items-center gap-2 h-9 px-4 rounded-md text-[12.5px] font-medium transition-colors cursor-pointer"
            :class="computeMode === 'cloud'
              ? 'bg-white/[0.08] text-white'
              : 'text-white/55 hover:text-white/80'"
            @click="computeMode = 'cloud'"
          >
            <Cloud class="size-3.5" />
            Cloud (Replicate)
          </button>
        </div>
        <p class="text-[11px] text-white/40 mt-2 leading-relaxed">
          <span v-if="computeMode === 'local'">Runs on this machine. Free, but slow on Apple Silicon (Flux ~8–16 hours).</span>
          <span v-else>Runs on a Replicate GPU. ~$3–5 per Flux LoRA, ~20–40 min wall time. Requires <code class="text-white/65 bg-white/[0.04] px-1 py-0.5 rounded">NUXT_REPLICATE_TOKEN</code>.</span>
        </p>
      </section>

      <!-- Cloud family picker (cloud mode only) -->
      <section v-if="computeMode === 'cloud'" class="mb-10">
        <div class="flex items-center justify-between mb-2">
          <label class="text-[12px] font-medium text-white/85 tracking-[0.01em]">Base model</label>
          <span class="text-[11px] text-white/35">Step 2</span>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <button
            class="text-left rounded-lg border p-4 transition-colors cursor-pointer"
            :class="cloudFamily === 'flux'
              ? 'bg-white/[0.05] border-white/25'
              : 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04]'"
            @click="cloudFamily = 'flux'"
          >
            <div class="flex items-center justify-between mb-1">
              <span class="text-[13px] text-white font-medium">Flux Dev</span>
              <span class="text-[10px] uppercase tracking-wider text-white/40 px-1.5 py-0.5 rounded bg-white/[0.04]">FLUX</span>
            </div>
            <p class="text-[11px] text-white/45 leading-snug">Highest quality. ~$3–5 per LoRA, ~25–40 min.</p>
          </button>
          <button
            class="text-left rounded-lg border p-4 transition-colors cursor-pointer"
            :class="cloudFamily === 'sdxl_sd15'
              ? 'bg-white/[0.05] border-white/25'
              : 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04]'"
            @click="cloudFamily = 'sdxl_sd15'"
          >
            <div class="flex items-center justify-between mb-1">
              <span class="text-[13px] text-white font-medium">SDXL</span>
              <span class="text-[10px] uppercase tracking-wider text-white/40 px-1.5 py-0.5 rounded bg-white/[0.04]">SDXL</span>
            </div>
            <p class="text-[11px] text-white/45 leading-snug">Faster + cheaper. ~$0.50–1 per LoRA, ~10–15 min.</p>
          </button>
        </div>
      </section>

      <!-- Local base-model picker (local mode only) -->
      <section v-if="computeMode === 'local'" class="mb-10">
        <div class="flex items-center justify-between mb-2">
          <label class="text-[12px] font-medium text-white/85 tracking-[0.01em]">Base model</label>
          <span class="text-[11px] text-white/35">Step 2</span>
        </div>
        <div v-if="checkpointsLoading" class="h-10 rounded-md bg-white/[0.04] border border-white/[0.06] flex items-center px-3 text-[12px] text-white/40">
          <Loader2 class="size-3.5 animate-spin mr-2" />
          Loading checkpoints…
        </div>
        <div v-else-if="checkpointsError" class="h-10 rounded-md bg-rose-500/[0.08] border border-rose-500/30 flex items-center px-3 text-[12px] text-rose-300">
          {{ checkpointsError }}
        </div>
        <select
          v-if="checkpointOptions.length > 0"
          v-model="form.checkpoint"
          class="w-full h-10 rounded-md bg-white/[0.04] border border-white/[0.08] hover:border-white/15 focus:border-white/25 focus:outline-none px-3 text-[13px] text-white/85 transition-colors"
        >
          <option v-for="o in checkpointOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <div v-else>
          <div class="text-[12px] text-white/55 mb-3 leading-relaxed">
            No checkpoints found in <code class="text-white/75 bg-white/[0.04] px-1.5 py-0.5 rounded">models/checkpoints/</code>. Download one to get started — or drop your own .safetensors file in.
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div
              v-for="c in DOWNLOADABLE_CHECKPOINTS"
              :key="c.key"
              class="rounded-lg bg-white/[0.02] border border-white/[0.06] p-4 flex flex-col gap-3"
            >
              <div>
                <div class="flex items-center justify-between gap-2 mb-1">
                  <span class="text-[13px] text-white font-medium truncate">{{ c.label }}</span>
                  <span class="shrink-0 text-[11px] text-white/45 tabular-nums">{{ fmtGB(c.sizeBytes) }} GB</span>
                </div>
                <div class="flex items-center gap-2 mb-1.5">
                  <span class="text-[10px] uppercase tracking-wider text-white/40 px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06]">{{ c.family }}</span>
                </div>
                <div class="text-[11px] text-white/45 leading-snug">{{ c.blurb }}</div>
              </div>

              <!-- Progress bar (downloading / preparing) -->
              <div v-if="downloadStates[c.key].phase === 'downloading' || downloadStates[c.key].phase === 'preparing' || downloadStates[c.key].phase === 'checking'" class="flex flex-col gap-1.5">
                <div class="h-1 rounded-full bg-white/[0.06] overflow-hidden">
                  <div class="h-full bg-white/70 transition-[width] duration-300" :style="{ width: `${downloadPct(c.key)}%` }" />
                </div>
                <div class="flex items-center justify-between text-[10.5px] text-white/45 tabular-nums">
                  <span v-if="downloadStates[c.key].phase === 'checking'">Checking…</span>
                  <span v-else-if="downloadStates[c.key].phase === 'preparing'">Finishing up…</span>
                  <span v-else>{{ fmtGB(downloadStates[c.key].downloaded) }} / {{ fmtGB(downloadStates[c.key].total) }} GB</span>
                  <span>{{ downloadPct(c.key) }}%</span>
                </div>
              </div>

              <!-- Error -->
              <div v-else-if="downloadStates[c.key].phase === 'error'" class="text-[11px] text-rose-300 leading-snug">
                {{ downloadStates[c.key].message }}
              </div>

              <!-- Done -->
              <div v-else-if="downloadStates[c.key].phase === 'done'" class="text-[11px] text-emerald-400">
                Downloaded — ready to use.
              </div>

              <!-- Download button -->
              <button
                v-if="downloadStates[c.key].phase === 'idle' || downloadStates[c.key].phase === 'error'"
                class="inline-flex items-center justify-center gap-1.5 h-8 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-[12px] text-white/85 hover:text-white transition-colors cursor-pointer"
                @click="downloadCheckpoint(c.key)"
              >
                <Download class="size-3.5" />
                {{ downloadStates[c.key].phase === 'error' ? 'Retry' : 'Download' }}
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- Dataset -->
      <section class="mb-10">
        <div class="flex items-center justify-between mb-2">
          <label class="text-[12px] font-medium text-white/85 tracking-[0.01em]">
            Training images
            <span class="text-white/35 font-normal ml-2">{{ images.length }} {{ images.length === 1 ? 'image' : 'images' }}</span>
          </label>
          <div class="flex items-center gap-2">
            <button
              v-if="images.length > 0"
              class="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-[11px] text-white/70 hover:text-white transition-colors cursor-pointer"
              @click="captionAll"
              :disabled="status === 'captioning'"
            >
              <Sparkles v-if="status !== 'captioning'" class="size-3.5" />
              <Loader2 v-else class="size-3.5 animate-spin" />
              Auto-caption all
            </button>
            <span class="text-[11px] text-white/35">Step 3</span>
          </div>
        </div>

        <input
          ref="fileInputRef"
          type="file"
          accept="image/*"
          multiple
          class="hidden"
          @change="(e) => addFiles((e.target as HTMLInputElement).files)"
        />

        <!-- What makes a good dataset (only when empty, before drop zone) -->
        <div v-if="images.length === 0" class="mb-3 rounded-lg bg-white/[0.02] border border-white/[0.05] px-4 py-3">
          <div class="text-[11.5px] text-white/75 font-medium mb-1.5">What makes a good dataset</div>
          <ul class="text-[11.5px] text-white/55 leading-relaxed space-y-0.5 list-disc list-inside marker:text-white/25">
            <li><span class="text-white/75">10–30 images</span> — more isn't always better; quality &gt; quantity.</li>
            <li><span class="text-white/75">Varied angles + lighting</span> — same subject, different shots. Don't use 20 near-duplicates.</li>
            <li><span class="text-white/75">Square-ish framing</span> works best; the trainer will resize to a square crop.</li>
            <li>For characters/people: include close-ups, mid-shots, and full-body shots.</li>
          </ul>
        </div>

        <!-- Drop zone (empty state) -->
        <div
          v-if="images.length === 0"
          class="group relative aspect-[16/7] rounded-xl border border-dashed transition-colors flex flex-col items-center justify-center gap-3 cursor-pointer"
          :class="dropZoneActive
            ? 'border-white/30 bg-white/[0.05]'
            : 'border-white/12 bg-white/[0.015] hover:bg-white/[0.04] hover:border-white/25'"
          @click="fileInputRef?.click()"
          @dragover="onDragOver"
          @dragleave="onDragLeave"
          @drop="onDrop"
        >
          <div class="size-12 rounded-full bg-white/[0.04] flex items-center justify-center">
            <Upload class="size-5 text-white/45 group-hover:text-white/70 transition-colors" :stroke-width="1.5" />
          </div>
          <div class="text-center">
            <div class="text-[14px] text-white/75 mb-1">Drop your reference images</div>
            <div class="text-[11px] text-white/35">or click to browse · PNG, JPG, WebP</div>
          </div>
        </div>

        <!-- Image grid + caption hint (shown only with images) -->
        <template v-if="images.length > 0">
          <p class="text-[11px] text-white/45 mb-3 leading-relaxed">
            Write a short caption per image describing what's in it — these teach the model what the
            trigger word should mean. Click <span class="text-white/65 inline-flex items-center gap-0.5"><Sparkles class="size-3 inline" />Auto-caption all</span>
            to fill empty ones with Claude vision.
          </p>
          <div
            class="grid grid-cols-3 gap-3"
            @dragover="onDragOver"
            @dragleave="onDragLeave"
            @drop="onDrop"
          >
          <div
            v-for="(img, idx) in images"
            :key="img.previewUrl"
            class="relative rounded-lg overflow-hidden bg-black border border-white/10 group"
          >
            <div class="aspect-square relative">
              <img :src="img.previewUrl" class="absolute inset-0 size-full object-cover" />
              <button
                class="absolute top-1.5 right-1.5 size-6 rounded-full bg-black/70 hover:bg-black/90 backdrop-blur-sm flex items-center justify-center text-white/80 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                @click="removeImage(idx)"
              >
                <X class="size-3" />
              </button>
              <!-- Caption state pill -->
              <div
                v-if="img.captionState === 'captioning'"
                class="absolute top-1.5 left-1.5 inline-flex items-center gap-1 h-5 px-1.5 rounded-full bg-black/70 backdrop-blur-sm text-[10px] text-white/80"
              >
                <Loader2 class="size-2.5 animate-spin" />
                Captioning
              </div>
              <div
                v-else-if="img.captionState === 'done'"
                class="absolute top-1.5 left-1.5 inline-flex items-center gap-1 h-5 px-1.5 rounded-full bg-emerald-500/80 backdrop-blur-sm text-[10px] text-white"
              >
                Auto
              </div>
              <div
                v-else-if="img.captionState === 'error'"
                class="absolute top-1.5 left-1.5 inline-flex items-center gap-1 h-5 px-1.5 rounded-full bg-rose-500/80 backdrop-blur-sm text-[10px] text-white"
              >
                Failed
              </div>
            </div>
            <div class="p-2 bg-white/[0.02] border-t border-white/[0.04]">
              <textarea
                v-model="img.caption"
                rows="2"
                placeholder="Describe this image…"
                class="w-full bg-transparent text-[11.5px] text-white/85 placeholder:text-white/25 resize-none focus:outline-none leading-snug"
              />
              <button
                class="text-[10px] text-white/40 hover:text-white/70 transition-colors cursor-pointer inline-flex items-center gap-1"
                @click="captionOne(idx)"
                :disabled="img.captionState === 'captioning'"
              >
                <Sparkles class="size-2.5" />
                {{ img.caption ? 'Re-caption' : 'Auto-caption' }}
              </button>
            </div>
          </div>

          <!-- Add more tile -->
          <button
            class="aspect-square rounded-lg border border-dashed border-white/12 hover:border-white/25 bg-white/[0.015] hover:bg-white/[0.04] flex flex-col items-center justify-center gap-2 text-white/45 hover:text-white/70 transition-colors cursor-pointer"
            @click="fileInputRef?.click()"
          >
            <Plus class="size-5" :stroke-width="1.5" />
            <span class="text-[11px]">Add images</span>
          </button>
          </div>
        </template>
      </section>

      <!-- Simple form -->
      <section class="mb-6">
        <div class="flex items-center justify-between mb-3">
          <label class="text-[12px] font-medium text-white/85 tracking-[0.01em]">Training settings</label>
          <span class="text-[11px] text-white/35">Step 4</span>
        </div>

        <div class="space-y-5">
          <!-- LoRA name -->
          <div>
            <label class="block text-[12px] font-medium text-white/80 mb-1">LoRA name</label>
            <p class="text-[11px] text-white/45 mb-2 leading-relaxed">
              What to call the trained file. Saved as <code class="text-white/65 bg-white/[0.04] px-1 py-0.5 rounded">models/loras/&lt;name&gt;.safetensors</code>.
            </p>
            <input
              v-model="form.outputName"
              type="text"
              placeholder="e.g. julien_portrait_v1"
              class="w-full h-9 rounded-md bg-white/[0.04] border border-white/[0.08] hover:border-white/15 focus:border-white/25 focus:outline-none px-3 text-[13px] text-white/85 placeholder:text-white/25"
            />
          </div>

          <!-- Trigger word -->
          <div>
            <label class="block text-[12px] font-medium text-white/80 mb-1">
              Trigger word
              <span class="text-white/35 font-normal ml-1">optional</span>
            </label>
            <p class="text-[11px] text-white/45 mb-2 leading-relaxed">
              A rare word that "activates" this LoRA when used in a prompt. Pick something that wouldn't normally show up in captions —
              <code class="text-white/65 bg-white/[0.04] px-1 py-0.5 rounded">ohwx</code>,
              <code class="text-white/65 bg-white/[0.04] px-1 py-0.5 rounded">sks</code>, or a made-up token like
              <code class="text-white/65 bg-white/[0.04] px-1 py-0.5 rounded">jln_2026</code> work well.
            </p>
            <input
              v-model="form.triggerWord"
              type="text"
              placeholder="e.g. ohwx"
              class="w-full h-9 rounded-md bg-white/[0.04] border border-white/[0.08] hover:border-white/15 focus:border-white/25 focus:outline-none px-3 text-[13px] text-white/85 placeholder:text-white/25"
            />
          </div>

          <!-- Steps, LR, Rank in a 3-column grid -->
          <div class="grid grid-cols-3 gap-4">
            <div>
              <label class="block text-[12px] font-medium text-white/80 mb-1">Training steps</label>
              <p class="text-[11px] text-white/45 mb-2 leading-relaxed">
                More = better fit, longer training.
                <span class="text-white/65">500</span> is a safe default;
                <span class="text-white/65">1000–2000</span> for tricky subjects.
              </p>
              <input
                v-model.number="form.steps"
                type="number"
                min="1"
                max="100000"
                class="w-full h-9 rounded-md bg-white/[0.04] border border-white/[0.08] hover:border-white/15 focus:border-white/25 focus:outline-none px-3 text-[13px] text-white/85"
              />
            </div>
            <div>
              <label class="block text-[12px] font-medium text-white/80 mb-1">Learning rate</label>
              <p class="text-[11px] text-white/45 mb-2 leading-relaxed">
                How fast the model adapts.
                <span class="text-white/65">0.0004</span> is the Flux default; lower for delicate styles.
              </p>
              <input
                v-model.number="form.learningRate"
                type="number"
                step="0.0001"
                min="0.0000001"
                max="1"
                class="w-full h-9 rounded-md bg-white/[0.04] border border-white/[0.08] hover:border-white/15 focus:border-white/25 focus:outline-none px-3 text-[13px] text-white/85"
              />
            </div>
            <div>
              <label class="block text-[12px] font-medium text-white/80 mb-1">
                LoRA size
                <span class="text-white/35 font-normal ml-1">rank</span>
              </label>
              <p class="text-[11px] text-white/45 mb-2 leading-relaxed">
                Higher = more capacity + bigger file.
                <span class="text-white/65">16</span> is the sweet spot;
                <span class="text-white/65">32–64</span> for complex styles.
              </p>
              <input
                v-model.number="form.rank"
                type="number"
                min="1"
                max="128"
                class="w-full h-9 rounded-md bg-white/[0.04] border border-white/[0.08] hover:border-white/15 focus:border-white/25 focus:outline-none px-3 text-[13px] text-white/85"
              />
            </div>
          </div>
        </div>
      </section>

      <!-- Cost + time estimate (cloud mode only) -->
      <section v-if="computeMode === 'cloud'" class="mb-6">
        <div class="rounded-lg bg-gradient-to-br from-emerald-500/[0.05] to-emerald-500/[0.02] border border-emerald-500/15 p-4 flex items-center gap-4">
          <div class="size-9 rounded-full bg-emerald-500/[0.12] flex items-center justify-center shrink-0">
            <Cloud class="size-4 text-emerald-300/85" :stroke-width="1.75" />
          </div>
          <div class="flex-1">
            <div class="text-[12.5px] text-white/85 mb-0.5">
              <span class="font-medium">Estimated cost: {{ costEstimate.cost }}</span>
              <span class="text-white/45"> · {{ costEstimate.time }}</span>
            </div>
            <p class="text-[11px] text-white/50 leading-relaxed">
              Billed to your Replicate account. {{ costEstimate.note }}
            </p>
          </div>
        </div>
      </section>

      <!-- Advanced disclosure (local mode only — Replicate doesn't expose these knobs) -->
      <section v-if="computeMode === 'local'" class="mb-10">
        <button
          class="inline-flex items-center gap-1.5 text-[12px] text-white/55 hover:text-white/85 transition-colors cursor-pointer mb-3"
          @click="advancedOpen = !advancedOpen"
        >
          <ChevronDown v-if="advancedOpen" class="size-3.5" />
          <ChevronRight v-else class="size-3.5" />
          Advanced settings
        </button>
        <div v-if="advancedOpen" class="grid grid-cols-3 gap-3 p-4 rounded-lg bg-white/[0.02] border border-white/[0.05]">
          <div>
            <label class="block text-[11px] text-white/50 mb-1.5">Optimizer</label>
            <select v-model="form.optimizer" class="w-full h-9 rounded-md bg-white/[0.04] border border-white/[0.08] hover:border-white/15 focus:border-white/25 focus:outline-none px-2 text-[12px] text-white/85">
              <option>AdamW</option><option>Adam</option><option>SGD</option><option>RMSprop</option>
            </select>
          </div>
          <div>
            <label class="block text-[11px] text-white/50 mb-1.5">Loss function</label>
            <select v-model="form.lossFunction" class="w-full h-9 rounded-md bg-white/[0.04] border border-white/[0.08] hover:border-white/15 focus:border-white/25 focus:outline-none px-2 text-[12px] text-white/85">
              <option>MSE</option><option>L1</option><option>Huber</option><option>SmoothL1</option>
            </select>
          </div>
          <div>
            <label class="block text-[11px] text-white/50 mb-1.5">Algorithm</label>
            <input v-model="form.algorithm" type="text" class="w-full h-9 rounded-md bg-white/[0.04] border border-white/[0.08] hover:border-white/15 focus:border-white/25 focus:outline-none px-2 text-[12px] text-white/85" />
          </div>
          <div>
            <label class="block text-[11px] text-white/50 mb-1.5">Batch size</label>
            <input v-model.number="form.batchSize" type="number" min="1" class="w-full h-9 rounded-md bg-white/[0.04] border border-white/[0.08] hover:border-white/15 focus:border-white/25 focus:outline-none px-2 text-[12px] text-white/85" />
          </div>
          <div>
            <label class="block text-[11px] text-white/50 mb-1.5">Grad accum steps</label>
            <input v-model.number="form.gradAccumulationSteps" type="number" min="1" class="w-full h-9 rounded-md bg-white/[0.04] border border-white/[0.08] hover:border-white/15 focus:border-white/25 focus:outline-none px-2 text-[12px] text-white/85" />
          </div>
          <div>
            <label class="block text-[11px] text-white/50 mb-1.5">Seed</label>
            <input v-model.number="form.seed" type="number" min="0" class="w-full h-9 rounded-md bg-white/[0.04] border border-white/[0.08] hover:border-white/15 focus:border-white/25 focus:outline-none px-2 text-[12px] text-white/85" />
          </div>
          <div>
            <label class="block text-[11px] text-white/50 mb-1.5">Training dtype</label>
            <select v-model="form.trainingDtype" class="w-full h-9 rounded-md bg-white/[0.04] border border-white/[0.08] hover:border-white/15 focus:border-white/25 focus:outline-none px-2 text-[12px] text-white/85">
              <option>bf16</option><option>fp32</option><option>none</option>
            </select>
          </div>
          <div>
            <label class="block text-[11px] text-white/50 mb-1.5">LoRA dtype</label>
            <select v-model="form.loraDtype" class="w-full h-9 rounded-md bg-white/[0.04] border border-white/[0.08] hover:border-white/15 focus:border-white/25 focus:outline-none px-2 text-[12px] text-white/85">
              <option>bf16</option><option>fp32</option>
            </select>
          </div>
          <div>
            <label class="block text-[11px] text-white/50 mb-1.5">Checkpoint depth</label>
            <input v-model.number="form.checkpointDepth" type="number" min="1" max="5" class="w-full h-9 rounded-md bg-white/[0.04] border border-white/[0.08] hover:border-white/15 focus:border-white/25 focus:outline-none px-2 text-[12px] text-white/85" />
          </div>
          <label class="flex items-center gap-2 col-span-3 text-[12px] text-white/70 mt-2">
            <input v-model="form.gradientCheckpointing" type="checkbox" class="accent-white" />
            Gradient checkpointing (slower per step, much less VRAM)
          </label>
          <label class="flex items-center gap-2 col-span-3 text-[12px] text-white/70">
            <input v-model="form.offloading" type="checkbox" class="accent-white" />
            CPU offload model weights (saves VRAM, slower)
          </label>
          <label class="flex items-center gap-2 col-span-3 text-[12px] text-white/70">
            <input v-model="form.bucketMode" type="checkbox" class="accent-white" />
            Resolution bucket mode
          </label>
          <label class="flex items-center gap-2 col-span-3 text-[12px] text-white/70">
            <input v-model="form.bypassMode" type="checkbox" class="accent-white" />
            Bypass mode (for quantized models)
          </label>
        </div>
      </section>

      <!-- Run -->
      <div class="flex items-center justify-between mb-12">
        <div class="text-[12px]">
          <p v-if="status === 'training' || status === 'submitting' || status === 'captioning'" class="text-white/65 flex items-center gap-2">
            <Loader2 class="size-3.5 animate-spin" />
            <span>{{ progressLabel }}</span>
          </p>
          <p v-else-if="status === 'uploading'" class="text-white/65 flex items-center gap-2">
            <Loader2 class="size-3.5 animate-spin" />
            <span>Uploading…</span>
          </p>
          <p v-else-if="errorMessage" class="text-rose-400 max-w-md">{{ errorMessage }}</p>
          <p v-else-if="status === 'done'" class="text-emerald-400 flex items-center gap-2">
            <span>Done — your LoRA was saved.</span>
          </p>
          <span v-else class="text-white/35">
            {{
              images.length < 2
                ? 'Add at least 2 images to start.'
                : computeMode === 'local' && !form.checkpoint
                  ? 'Select a base model.'
                  : computeMode === 'cloud'
                    ? `Ready to train on Replicate (${cloudFamily === 'flux' ? 'Flux Dev' : 'SDXL'}).`
                    : 'Ready to train.'
            }}
          </span>
        </div>
        <div class="flex items-center gap-2">
          <button
            v-if="images.length > 0 && status !== 'training'"
            class="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-[12px] text-white/70 hover:text-white transition-colors cursor-pointer"
            @click="clearDataset"
          >
            <RefreshCcw class="size-3.5" />
            Clear
          </button>
          <button
            class="inline-flex items-center gap-2 h-10 px-5 rounded-full bg-white text-[#0a0a0a] font-medium text-[13px] hover:bg-white/90 transition-colors cursor-pointer disabled:bg-white/15 disabled:text-white/40 disabled:cursor-not-allowed"
            :disabled="!canRun"
            @click="onStartClicked"
          >
            <span>{{ status === 'training' ? 'Training…' : 'Start training' }}</span>
            <ArrowRight v-if="status !== 'training'" class="size-4" />
            <Loader2 v-else class="size-4 animate-spin" />
          </button>
        </div>
      </div>

      <!-- Progress bar (during training) -->
      <div v-if="status === 'training'" class="mb-12">
        <div class="h-1 rounded-full bg-white/[0.06] overflow-hidden">
          <div class="h-full bg-white/70 transition-[width] duration-700" :style="{ width: `${progressPct}%` }" />
        </div>
        <p class="text-[11px] text-white/35 mt-2">
          <span v-if="computeMode === 'local'">Training runs in-process and can take many minutes. Leave this tab open.</span>
          <span v-else>Training is running on Replicate's GPUs (~20–40 min for Flux, ~10–15 min for SDXL). Keep this tab open so we can auto-download the LoRA when it's done.</span>
        </p>
      </div>

      <!-- Output -->
      <div v-if="status === 'done' || lossGraphUrl" class="border-t border-white/[0.06] pt-10">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-[20px] font-medium text-white tracking-tight">Result</h2>
        </div>
        <div v-if="outputFilename" class="rounded-xl bg-white/[0.02] border border-white/[0.06] p-5 mb-4">
          <div class="text-[11px] text-white/40 uppercase tracking-wider mb-2">LoRA saved</div>
          <div class="text-[15px] text-white font-mono mb-1">
            <span v-if="cloudJob?.localFilename">{{ cloudJob.localFilename }}</span>
            <span v-else>{{ outputFilename }}_*.safetensors</span>
          </div>
          <div v-if="computeMode === 'cloud' && cloudJob?.localFilename" class="text-[11px] text-white/45">
            Saved to <code class="text-white/65 bg-white/[0.04] px-1 py-0.5 rounded">models/loras/</code> — ready to use in workflows.
          </div>
          <div v-else class="text-[11px] text-white/45">
            Saved under output/loras/. Move or symlink to models/loras/ to use in workflows.
          </div>
          <a
            v-if="cloudJob?.replicateUrl"
            :href="cloudJob.replicateUrl"
            target="_blank"
            rel="noopener"
            class="mt-3 inline-flex items-center gap-1.5 text-[11.5px] text-white/55 hover:text-white/85 transition-colors"
          >
            <Cloud class="size-3" />
            Also available on Replicate's CDN ↗
          </a>
        </div>
        <div v-if="lossGraphUrl" class="rounded-xl overflow-hidden bg-black border border-white/[0.06]">
          <img :src="lossGraphUrl" class="w-full max-h-[420px] object-contain" />
        </div>

        <!-- Replicate logs tail (cloud mode) -->
        <details v-if="computeMode === 'cloud' && cloudJob?.logs" class="mt-3">
          <summary class="text-[11px] text-white/45 hover:text-white/70 cursor-pointer">View Replicate logs</summary>
          <pre class="mt-2 text-[10.5px] text-white/55 bg-black/40 border border-white/[0.06] rounded p-3 max-h-[240px] overflow-auto font-mono whitespace-pre-wrap">{{ cloudJob.logs }}</pre>
        </details>
      </div>
    </div>
  </div>
</template>
