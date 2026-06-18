<script setup lang="ts">
/**
 * Drop-zone + preview pair used by every App page (FaceSwap, Karaoke, Subtitle).
 *
 * Caller passes `accept` (mime), `kind` (decides preview rendering), and a
 * v-model'd `UploadedFile | null`. The component handles drag/drop, picker
 * click, upload to /upload/image, preview, and clear.
 */
import { Image as ImageIcon, Music, Upload, Video as VideoIcon, X } from 'lucide-vue-next'

export interface UploadedFile {
  file: File
  filename: string  // server-side name returned by /upload/image
  previewUrl: string
}

const props = defineProps<{
  label: string
  hint?: string
  step?: string                       // small "Step 1" badge next to label
  accept: string                      // e.g. 'image/*', 'video/*', 'audio/*'
  kind: 'image' | 'video' | 'audio'
}>()

const modelValue = defineModel<UploadedFile | null>({ required: true })
const uploading = ref(false)
const error = ref<string | null>(null)

const inputRef = ref<HTMLInputElement | null>(null)

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

async function pick(file: File | undefined | null) {
  if (!file) return
  error.value = null
  uploading.value = true
  try {
    const uploaded = await uploadFile(file)
    if (modelValue.value) URL.revokeObjectURL(modelValue.value.previewUrl)
    modelValue.value = uploaded
  } catch (e: any) {
    error.value = e?.message ?? 'Upload failed.'
  } finally {
    uploading.value = false
  }
}

function clear() {
  if (modelValue.value) URL.revokeObjectURL(modelValue.value.previewUrl)
  modelValue.value = null
  error.value = null
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  pick(e.dataTransfer?.files?.[0])
}
function preventDefault(e: Event) { e.preventDefault() }

const emptyIcon = computed(() => {
  if (props.kind === 'video') return VideoIcon
  if (props.kind === 'audio') return Music
  return ImageIcon
})
const emptyHint = computed(() => {
  if (props.hint) return props.hint
  if (props.kind === 'video') return 'Drop a video file'
  if (props.kind === 'audio') return 'Drop an audio file'
  return 'Drop an image'
})
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-2">
      <label class="text-[12px] font-medium text-white/85 tracking-[0.01em]">{{ label }}</label>
      <span v-if="step" class="text-[11px] text-white/35">{{ step }}</span>
    </div>
    <input
      ref="inputRef"
      type="file"
      :accept="accept"
      class="hidden"
      @change="(e) => pick((e.target as HTMLInputElement).files?.[0])"
    />
    <div
      v-if="!modelValue"
      class="group relative aspect-[4/3] rounded-xl border border-dashed border-white/12 bg-white/[0.015] hover:bg-white/[0.04] hover:border-white/25 cursor-pointer transition-colors flex flex-col items-center justify-center gap-3"
      :class="{ 'opacity-60 cursor-wait': uploading }"
      @click="!uploading && inputRef?.click()"
      @dragover="preventDefault"
      @drop="onDrop"
    >
      <div class="size-10 rounded-full bg-white/[0.04] flex items-center justify-center">
        <Upload v-if="uploading" class="size-4 text-white/45 animate-pulse" :stroke-width="1.75" />
        <component v-else :is="emptyIcon" class="size-4 text-white/45 group-hover:text-white/70 transition-colors" :stroke-width="1.75" />
      </div>
      <div class="text-center">
        <div class="text-[13px] text-white/70 mb-0.5">{{ uploading ? 'Uploading…' : emptyHint }}</div>
        <div v-if="!uploading" class="text-[11px] text-white/35">or click to browse</div>
      </div>
    </div>
    <div
      v-else
      class="relative aspect-[4/3] rounded-xl overflow-hidden bg-black border border-white/10"
    >
      <img
        v-if="kind === 'image'"
        :src="modelValue.previewUrl"
        class="absolute inset-0 size-full object-cover"
      />
      <video
        v-else-if="kind === 'video'"
        :src="modelValue.previewUrl"
        class="absolute inset-0 size-full object-cover"
        muted
        autoplay
        loop
        playsinline
      />
      <div
        v-else
        class="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-white/10 to-white/[0.04]"
      >
        <svg viewBox="0 0 80 24" class="size-20 text-white/70" fill="currentColor">
          <rect x="0" y="9" width="3" height="6" rx="1.5" />
          <rect x="6" y="6" width="3" height="12" rx="1.5" />
          <rect x="12" y="2" width="3" height="20" rx="1.5" />
          <rect x="18" y="7" width="3" height="10" rx="1.5" />
          <rect x="24" y="4" width="3" height="16" rx="1.5" />
          <rect x="30" y="9" width="3" height="6" rx="1.5" />
          <rect x="36" y="0" width="3" height="24" rx="1.5" />
          <rect x="42" y="5" width="3" height="14" rx="1.5" />
          <rect x="48" y="8" width="3" height="8" rx="1.5" />
          <rect x="54" y="3" width="3" height="18" rx="1.5" />
          <rect x="60" y="6" width="3" height="12" rx="1.5" />
          <rect x="66" y="9" width="3" height="6" rx="1.5" />
          <rect x="72" y="4" width="3" height="16" rx="1.5" />
        </svg>
      </div>
      <button
        class="absolute top-2 right-2 size-7 rounded-full bg-black/70 hover:bg-black/90 backdrop-blur-sm flex items-center justify-center text-white/80 hover:text-white transition-colors cursor-pointer"
        @click="clear"
      >
        <X class="size-3.5" />
      </button>
      <div class="absolute bottom-0 left-0 right-0 px-3 py-2 bg-gradient-to-t from-black/80 to-transparent">
        <div class="text-[11px] text-white/80 truncate">{{ modelValue.file.name }}</div>
      </div>
    </div>
    <p v-if="error" class="mt-2 text-[11px] text-rose-400">{{ error }}</p>
  </div>
</template>
