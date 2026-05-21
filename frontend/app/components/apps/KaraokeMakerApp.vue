<script setup lang="ts">
/**
 * Karaoke Maker app — drop a song, get vocals + instrumental stems back.
 * Pipeline: LoadAudio → VocalSeparator → 2× SaveAudioMP3.
 */
import { ArrowRight, Download, Loader2, Music, RefreshCcw } from 'lucide-vue-next'

interface UploadedFile { file: File; filename: string; previewUrl: string }

const song = ref<UploadedFile | null>(null)
const status = ref<'idle' | 'running' | 'done' | 'error'>('idle')
const errorMessage = ref<string | null>(null)
const progressLabel = ref('')
const vocalsUrl = ref<string | null>(null)
const instrumentalUrl = ref<string | null>(null)

const canRun = computed(() => !!song.value && status.value !== 'running')

function buildPrompt(filename: string) {
  return {
    '1': { class_type: 'LoadAudio', inputs: { audio: filename } },
    '2': {
      class_type: 'VocalSeparator',
      inputs: { audio: ['1', 0], model: 'htdemucs', shifts: 1 },
    },
    '3': {
      class_type: 'SaveAudioMP3',
      inputs: { audio: ['2', 0], filename_prefix: 'karaoke_vocals', quality: 'V0' },
    },
    '4': {
      class_type: 'SaveAudioMP3',
      inputs: { audio: ['2', 1], filename_prefix: 'karaoke_instrumental', quality: 'V0' },
    },
  }
}

function viewUrl(f: { filename: string; subfolder: string; type: string }): string {
  return `/view?${new URLSearchParams({
    filename: f.filename,
    type: f.type,
    ...(f.subfolder ? { subfolder: f.subfolder } : {}),
    t: String(Date.now()),
  })}`
}

async function run() {
  if (!canRun.value || !song.value) return
  errorMessage.value = null
  vocalsUrl.value = null
  instrumentalUrl.value = null
  status.value = 'running'
  progressLabel.value = 'Submitting…'

  try {
    const res = await fetch('/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: buildPrompt(song.value.filename) }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(text || `Comfy returned ${res.status}`)
    }
    const data = await res.json()
    const promptId: string | undefined = data?.prompt_id
    if (!promptId) throw new Error('No prompt_id returned — is ComfyUI running?')

    progressLabel.value = 'Separating vocals from instrumental (this can take a minute)…'
    const result = await pollForResult(promptId)
    if (!result.vocals || !result.instrumental) {
      throw new Error('Run finished but produced incomplete output.')
    }
    vocalsUrl.value = viewUrl(result.vocals)
    instrumentalUrl.value = viewUrl(result.instrumental)
    status.value = 'done'
  } catch (e: any) {
    errorMessage.value = humanizeError(e?.message ?? String(e))
    status.value = 'error'
  }
}

interface AudioFile { filename: string; subfolder: string; type: string }

async function pollForResult(promptId: string): Promise<{ vocals?: AudioFile; instrumental?: AudioFile }> {
  // Each SaveAudioMP3 emits one entry in `output.audio`. Pair by filename prefix.
  const deadline = Date.now() + 10 * 60 * 1000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 800))
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
      let vocals: AudioFile | undefined
      let instrumental: AudioFile | undefined
      for (const node of Object.values(outputs) as any[]) {
        const list = node?.audio
        if (!Array.isArray(list)) continue
        for (const f of list as AudioFile[]) {
          if (/vocals/i.test(f.filename)) vocals = f
          else if (/instrumental/i.test(f.filename)) instrumental = f
        }
      }
      if (vocals && instrumental) return { vocals, instrumental }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Comfy:')) throw e
    }
  }
  throw new Error('Timed out waiting for the separation to finish.')
}

function extractComfyError(entry: any): string {
  const messages: any[] = entry?.status?.messages ?? []
  const errMsg = messages.find((m) => m[0] === 'execution_error')?.[1]
  if (errMsg?.exception_message) return `Comfy: ${errMsg.exception_message}`
  return 'Comfy: execution failed.'
}

function humanizeError(msg: string): string {
  if (msg.includes('No prompt_id')) return "Couldn't reach the engine. Is ComfyUI running on port 8188?"
  if (msg.includes('demucs')) return 'Vocal separation model failed to load. Try restarting ComfyUI.'
  return msg
}

function reset() {
  song.value = null
  vocalsUrl.value = null
  instrumentalUrl.value = null
  errorMessage.value = null
  status.value = 'idle'
}

function download(url: string, name: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}
</script>

<template>
  <div class="h-full overflow-y-auto bg-[#0a0a0a]">
    <div class="max-w-[920px] mx-auto px-10 py-12">
      <div class="mb-14">
        <div class="text-[11px] uppercase tracking-[0.16em] text-white/35 font-medium mb-3">
          App · Audio
        </div>
        <h1 class="text-[44px] font-medium text-white tracking-tight leading-[1.05] mb-4">
          Karaoke Maker
        </h1>
        <p class="text-[15px] text-white/60 max-w-[560px] leading-relaxed">
          Drop a song and get two separated tracks back — the instrumental for sing-alongs
          and the isolated vocals for remixing. Takes a minute or two on first use.
        </p>
      </div>

      <div class="max-w-[420px] mb-8">
        <AppsAppFileSlot
          v-model="song"
          label="Song"
          step="Step 1"
          accept="audio/*"
          kind="audio"
          hint="Drop your song"
        />
      </div>

      <div class="flex items-center justify-between mb-12">
        <p v-if="status === 'running'" class="text-[12px] text-white/55 flex items-center gap-2">
          <Loader2 class="size-3.5 animate-spin" />
          <span>{{ progressLabel }}</span>
        </p>
        <p v-else-if="errorMessage" class="text-[12px] text-rose-400 max-w-md">
          {{ errorMessage }}
        </p>
        <span v-else class="text-[12px] text-white/35">
          {{ song ? 'Ready to separate.' : 'Add a song above to start.' }}
        </span>
        <button
          class="inline-flex items-center gap-2 h-10 px-5 rounded-full bg-white text-[#0a0a0a] font-medium text-[13px] hover:bg-white/90 transition-colors cursor-pointer disabled:bg-white/15 disabled:text-white/40 disabled:cursor-not-allowed"
          :disabled="!canRun"
          @click="run"
        >
          <span>{{ status === 'running' ? 'Separating…' : 'Separate' }}</span>
          <ArrowRight v-if="status !== 'running'" class="size-4" />
          <Loader2 v-else class="size-4 animate-spin" />
        </button>
      </div>

      <div v-if="vocalsUrl || instrumentalUrl || status === 'running'" class="border-t border-white/[0.06] pt-10">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-[20px] font-medium text-white tracking-tight">Stems</h2>
          <button
            v-if="vocalsUrl && instrumentalUrl"
            class="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-[12px] text-white/80 hover:text-white transition-colors cursor-pointer"
            @click="reset"
          >
            <RefreshCcw class="size-3.5" />
            Start over
          </button>
        </div>

        <div v-if="vocalsUrl && instrumentalUrl" class="grid grid-cols-2 gap-4">
          <div class="rounded-xl bg-gradient-to-br from-violet-900/30 to-violet-500/5 border border-violet-500/20 p-5">
            <div class="flex items-center justify-between mb-3">
              <div class="flex items-center gap-2">
                <div class="size-8 rounded-full bg-violet-500/20 flex items-center justify-center">
                  <Music class="size-4 text-violet-300" :stroke-width="1.75" />
                </div>
                <div>
                  <div class="text-[13px] font-medium text-white">Vocals</div>
                  <div class="text-[11px] text-white/40">A cappella</div>
                </div>
              </div>
              <button
                class="size-8 rounded-full bg-white/[0.08] hover:bg-white/[0.15] flex items-center justify-center text-white/70 hover:text-white transition-colors cursor-pointer"
                @click="download(vocalsUrl!, 'karaoke_vocals.mp3')"
              >
                <Download class="size-3.5" />
              </button>
            </div>
            <audio :src="vocalsUrl" controls preload="metadata" class="w-full" />
          </div>

          <div class="rounded-xl bg-gradient-to-br from-emerald-900/30 to-emerald-500/5 border border-emerald-500/20 p-5">
            <div class="flex items-center justify-between mb-3">
              <div class="flex items-center gap-2">
                <div class="size-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <Music class="size-4 text-emerald-300" :stroke-width="1.75" />
                </div>
                <div>
                  <div class="text-[13px] font-medium text-white">Instrumental</div>
                  <div class="text-[11px] text-white/40">Karaoke backing</div>
                </div>
              </div>
              <button
                class="size-8 rounded-full bg-white/[0.08] hover:bg-white/[0.15] flex items-center justify-center text-white/70 hover:text-white transition-colors cursor-pointer"
                @click="download(instrumentalUrl!, 'karaoke_instrumental.mp3')"
              >
                <Download class="size-3.5" />
              </button>
            </div>
            <audio :src="instrumentalUrl" controls preload="metadata" class="w-full" />
          </div>
        </div>

        <div v-else class="rounded-xl bg-black border border-white/[0.06] min-h-[200px] flex items-center justify-center">
          <div class="flex flex-col items-center gap-3 py-12">
            <Loader2 class="size-6 text-white/30 animate-spin" />
            <div class="text-[12px] text-white/40">{{ progressLabel || 'Working…' }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
