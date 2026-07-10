<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { HOUSE_STYLES, USE_CASE_TAGS, type UseCaseTag } from '~/data/house-styles'
import { BENCHMARK_SHOTS } from '~/data/house-style-benchmarks'

interface LocalLora {
  filename: string
  name: string
  trigger: string | null
  aesthetic: string | null
  kind: 'character' | 'style' | null
  model: string | null
  url: string | null
  coverUrl: string | null
}

interface Draft {
  useCases: UseCaseTag[]
  examplePrompt: string
  thumbs: string[]        // baked full-res data URLs (png), in BENCHMARK_SHOTS order
  busy: string | null     // 'profile' | 'bake' | 'publish' | null
  error: string | null
  publishedOk: boolean
}

const loras = ref<LocalLora[]>([])
const drafts = ref<Record<string, Draft>>({})
const openFilename = ref<string | null>(null)

const styles = computed(() => loras.value.filter(l => l.kind !== 'character'))

const publishedModels = computed(() => new Set(HOUSE_STYLES.map(s => s.replicateModel)))
function modelBase(l: LocalLora): string { return (l.model || '').split(':')[0] ?? '' }
function isPublished(l: LocalLora): boolean { return publishedModels.value.has(modelBase(l)) }
function kebab(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}
function draftFor(l: LocalLora): Draft {
  if (!drafts.value[l.filename]) {
    const existing = HOUSE_STYLES.find(s => s.replicateModel === modelBase(l))
    drafts.value[l.filename] = {
      useCases: (existing?.useCases as UseCaseTag[]) ?? [],
      examplePrompt: existing?.examplePrompts[0] ?? '',
      thumbs: [],
      busy: null,
      error: null,
      publishedOk: false,
    }
  }
  return drafts.value[l.filename]!
}
function genName(l: LocalLora): string { return l.filename.replace(/\.safetensors$/, '') }
function toggleTag(l: LocalLora, tag: UseCaseTag) {
  const d = draftFor(l)
  d.useCases = d.useCases.includes(tag) ? d.useCases.filter(t => t !== tag) : [...d.useCases, tag]
}

async function fetchLoras() {
  const res = await fetch('/api/loras-local')
  const data = await res.json()
  loras.value = data.loras ?? []
}
onMounted(fetchLoras)

/** One cheap sample gen → Qwen aesthetic → PATCH sidecar. */
async function generateProfile(l: LocalLora) {
  const d = draftFor(l)
  d.busy = 'profile'; d.error = null
  try {
    const gen = await fetch('/api/inpaint/lora-gen', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: genName(l), prompt: 'a varied collage of subjects', aspectRatio: '1:1' }),
    })
    if (!gen.ok) throw new Error(`sample gen failed: ${await gen.text()}`)
    const { images } = await gen.json()
    const aes = await fetch('/api/cloud-train/aesthetic', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ imageDataUrl: images[0] }),
    })
    if (!aes.ok) throw new Error(`aesthetic failed: ${await aes.text()}`)
    const { aesthetic } = await aes.json()
    const patch = await fetch('/api/loras-local', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: l.filename, aesthetic }),
    })
    if (!patch.ok) throw new Error(`sidecar patch failed: ${await patch.text()}`)
    l.aesthetic = aesthetic
  } catch (e: any) { d.error = String(e?.message || e) } finally { d.busy = null }
}

/** Bake the 4 frozen benchmark shots through the style's own model. */
async function bakeThumbs(l: LocalLora) {
  const d = draftFor(l)
  d.busy = 'bake'; d.error = null; d.thumbs = []
  try {
    for (const shot of BENCHMARK_SHOTS) {
      const res = await fetch('/api/inpaint/lora-gen', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: genName(l), prompt: shot.prompt, aspectRatio: shot.aspectRatio, seed: shot.seed }),
      })
      if (!res.ok) throw new Error(`${shot.id} failed: ${await res.text()}`) // break-on-first-failure money guard
      const { images } = await res.json()
      d.thumbs.push(images[0])
    }
  } catch (e: any) { d.error = String(e?.message || e) } finally { d.busy = null }
}

/** Downscale a data URL to ≤640px webp (client-side; no server encoder exists). */
async function toWebp(dataUrl: string, max = 640): Promise<string> {
  const img = new Image()
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl })
  const scale = Math.min(1, max / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/webp', 0.85))
  if (!blob) throw new Error('webp encode failed')
  return await new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(blob)
  })
}

function canPublish(l: LocalLora): boolean {
  const d = draftFor(l)
  return Boolean(
    (l.aesthetic?.trim().length ?? 0) >= 40 && l.trigger?.trim() && modelBase(l) && l.url
    && d.useCases.length > 0 && d.examplePrompt.trim() && d.thumbs.length === 4 && !d.busy,
  )
}

async function publish(l: LocalLora) {
  const d = draftFor(l)
  d.busy = 'publish'; d.error = null
  try {
    const thumbnails = await Promise.all(d.thumbs.map(t => toWebp(t)))
    const res = await fetch('/api/house-styles/publish', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entry: {
          id: kebab(l.name),
          label: l.name.replace(/_/g, ' '),
          useCases: d.useCases,
          trigger: l.trigger,
          tasteProfile: l.aesthetic,
          replicateModel: modelBase(l),
          weightsUrl: l.url,
          examplePrompts: [d.examplePrompt.trim()],
        },
        thumbnails,
      }),
    })
    if (!res.ok) throw new Error(await res.text())
    d.publishedOk = true
  } catch (e: any) { d.error = String(e?.message || e) } finally { d.busy = null }
}
</script>

<template>
  <div class="min-h-screen bg-neutral-950 text-white/90 p-8">
    <div class="max-w-4xl mx-auto space-y-6">
      <header class="flex items-start justify-between gap-4">
        <div>
          <h1 class="text-xl font-semibold">Style Publisher</h1>
          <p class="text-sm text-white/50">
            Backfill profile → bake 4 benchmark thumbs → publish into house-styles.json. Review the git diff, then commit.
          </p>
        </div>
        <NuxtLink
          to="/?train=1"
          class="shrink-0 px-3 py-1.5 rounded-md text-sm border border-white/15 text-white/80 hover:bg-white/10"
          title="Open the trainer — a finished style LoRA lands in this list automatically"
        >
          + Train a new style
        </NuxtLink>
      </header>

      <div v-for="l in styles" :key="l.filename" class="rounded-lg border border-white/10 bg-white/[0.03]">
        <button class="w-full flex items-center gap-3 px-4 py-3 text-left"
          @click="openFilename = openFilename === l.filename ? null : l.filename">
          <img v-if="l.coverUrl" :src="l.coverUrl" class="size-10 rounded object-cover" />
          <div v-else class="size-10 rounded bg-white/10" />
          <div class="flex-1">
            <div class="text-sm font-medium">{{ l.name }}</div>
            <div class="text-xs text-white/40">{{ modelBase(l) || 'no model' }}</div>
          </div>
          <span v-if="isPublished(l) || draftFor(l).publishedOk"
            class="text-xs px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300">published</span>
          <span v-else-if="!l.aesthetic" class="text-xs px-2 py-0.5 rounded bg-amber-500/15 text-amber-300">needs profile</span>
        </button>

        <div v-if="openFilename === l.filename" class="px-4 pb-4 space-y-4 border-t border-white/10 pt-4">
          <!-- Taste profile -->
          <section>
            <div class="flex items-center justify-between">
              <h3 class="text-xs uppercase tracking-wide text-white/40">Taste profile</h3>
              <button class="text-xs px-3 py-1.5 rounded-md pastel-ai" :disabled="draftFor(l).busy !== null"
                @click="generateProfile(l)">
                {{ draftFor(l).busy === 'profile' ? 'Generating…' : (l.aesthetic ? 'Regenerate · ~$0.05' : 'Generate · ~$0.05') }}
              </button>
            </div>
            <p class="mt-1 text-xs text-white/60 whitespace-pre-wrap">{{ l.aesthetic || '— none (required to publish)' }}</p>
          </section>

          <!-- Tags + example prompt -->
          <section class="space-y-2">
            <h3 class="text-xs uppercase tracking-wide text-white/40">Use cases</h3>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="tag in USE_CASE_TAGS" :key="tag"
                class="text-xs px-2 py-1 rounded-full border"
                :class="draftFor(l).useCases.includes(tag)
                  ? 'border-white/60 bg-white/15' : 'border-white/15 text-white/50 hover:bg-white/5'"
                @click="toggleTag(l, tag)">{{ tag }}</button>
            </div>
            <input v-model="draftFor(l).examplePrompt" placeholder="Example prompt (required)"
              class="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm" />
          </section>

          <!-- Thumbnails -->
          <section>
            <div class="flex items-center justify-between">
              <h3 class="text-xs uppercase tracking-wide text-white/40">Benchmark thumbnails</h3>
              <button class="text-xs px-3 py-1.5 rounded-md pastel-ai" :disabled="draftFor(l).busy !== null"
                @click="bakeThumbs(l)">
                {{ draftFor(l).busy === 'bake' ? 'Baking…' : 'Bake 4 thumbs · ~$0.20' }}
              </button>
            </div>
            <div v-if="draftFor(l).thumbs.length" class="mt-2 grid grid-cols-4 gap-2">
              <img v-for="(t, i) in draftFor(l).thumbs" :key="i" :src="t" class="rounded aspect-square object-cover" />
            </div>
          </section>

          <p v-if="draftFor(l).error" class="text-xs text-red-400">{{ draftFor(l).error }}</p>

          <button class="w-full py-2 rounded-md text-sm font-medium bg-emerald-500/90 text-black disabled:opacity-30"
            :disabled="!canPublish(l)" @click="publish(l)">
            {{ draftFor(l).busy === 'publish' ? 'Publishing…' : (isPublished(l) ? 'Republish (updates entry)' : 'Publish to library') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pastel-ai {
  background: linear-gradient(120deg, rgba(167, 243, 208, 0.25), rgba(186, 230, 253, 0.25), rgba(254, 205, 211, 0.25));
  border: 1px solid rgba(255, 255, 255, 0.15);
}
.pastel-ai:disabled { opacity: 0.4; }
</style>
