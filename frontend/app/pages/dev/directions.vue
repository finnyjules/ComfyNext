<script setup lang="ts">
/**
 * Dev eval for the Direction Loop's direction proposer (Slice 2). Drop/paste an
 * image, type the brief it was generated for, hit Propose — it runs the REAL
 * prompt (DIRECTIONS_SYSTEM + buildDirectionsPrompt) through /api/agent-review and
 * shows the directions it came back with, so you can eyeball SHARP (grounded in
 * THIS image) vs GENERIC (could apply to anything). No CLI, no briefs.json —
 * uses your Anthropic key from Settings → AI. Needs `npm run dev`.
 */
import { ref, computed } from 'vue'
import { DIRECTIONS_SYSTEM, DIRECTIONS_SCHEMA, buildDirectionsPrompt, parseDirectionsResponse, type Direction } from '~/lib/agent/protocol'

const { getLocalSetting } = useLocalSettings()

const image = ref<string | null>(null)   // data URL
const brief = ref('')
const mode = ref<'explore' | 'refine'>('explore')
const n = ref(4)
const busy = ref(false)
const error = ref('')
const directions = ref<Direction[]>([])
const ran = ref(false)

const GENERIC = /\b(more detail|higher quality|different angle|cooler tones?|warmer tones?|more vibrant|enhance|improve|better|sharper|crisper|refined)\b/i
const isGeneric = (d: Direction) => GENERIC.test(`${d.label} ${d.why}`)
const axisCollision = computed(() => {
  const axes = new Set(directions.value.map(d => d.axis))
  return directions.value.length > 0 && axes.size < directions.value.length
})
const cleanPct = computed(() => {
  if (!directions.value.length) return 0
  return Math.round(100 * directions.value.filter(d => !isGeneric(d)).length / directions.value.length)
})

function fileToDataUrl(file: File) {
  const r = new FileReader()
  r.onload = () => { image.value = String(r.result) }
  r.readAsDataURL(file)
}
function onFile(e: Event) { const f = (e.target as HTMLInputElement).files?.[0]; if (f) fileToDataUrl(f) }
function onDrop(e: DragEvent) { const f = e.dataTransfer?.files?.[0]; if (f?.type.startsWith('image/')) fileToDataUrl(f) }
function onPaste(e: ClipboardEvent) {
  for (const item of e.clipboardData?.items ?? []) {
    if (item.type.startsWith('image/')) { const f = item.getAsFile(); if (f) fileToDataUrl(f) }
  }
}

async function propose() {
  if (!image.value || !brief.value.trim() || busy.value) return
  const apiKey = getLocalSetting('ComfyNext.AI.AnthropicApiKey')
  if (!apiKey) { error.value = 'Add your Anthropic key in Settings → AI.'; return }
  busy.value = true; error.value = ''; directions.value = []; ran.value = false
  try {
    const res = await $fetch<{ text: string }>('/api/agent-review', {
      method: 'POST',
      body: { apiKey, tier: 'plan', system: DIRECTIONS_SYSTEM, prompt: buildDirectionsPrompt(brief.value, mode.value, n.value), schema: DIRECTIONS_SCHEMA, image: image.value },
    })
    const parsed = parseDirectionsResponse(res.text)
    if (parsed.parseFailed) throw new Error('Could not read the model reply.')
    directions.value = parsed.directions
    ran.value = true
  } catch (e: any) {
    error.value = e?.data?.message || e?.message || 'Request failed.'
  } finally {
    busy.value = false
  }
}

const AXIS_COLOR: Record<string, string> = {
  lighting: '#e7b64b', composition: '#7dd3fc', palette: '#fb923c',
  content: '#34d399', mood: '#a3e635', interpretation: '#67e8f9',
}
</script>

<template>
  <div class="min-h-screen bg-[#0a0a0b] text-white/90 p-8" @paste="onPaste">
    <div class="mx-auto max-w-3xl">
      <h1 class="text-lg font-semibold mb-1">Direction proposer — sharpness check</h1>
      <p class="text-[13px] text-white/45 mb-6">Drop or paste a generated image, type the brief it came from, and see the directions the AI proposes. Sharp = names a specific thing in <em>this</em> image; generic = could apply to anything.</p>

      <div class="grid grid-cols-[280px_1fr] gap-5">
        <!-- image drop -->
        <label
          class="relative flex flex-col items-center justify-center h-[280px] rounded-xl border border-dashed border-white/15 bg-[#161719] cursor-pointer overflow-hidden hover:border-white/30"
          @dragover.prevent @drop.prevent="onDrop"
        >
          <img v-if="image" :src="image" class="absolute inset-0 w-full h-full object-contain bg-black/40" >
          <div v-else class="text-center text-white/35 text-[12.5px] px-6">
            <div class="text-2xl mb-2">⬇</div>
            drop / paste / click<br>a generated image
          </div>
          <input type="file" accept="image/*" class="hidden" @change="onFile" >
        </label>

        <!-- controls -->
        <div class="flex flex-col gap-3">
          <textarea
            v-model="brief" rows="4" placeholder="The brief it was generated for, e.g. “grand_theft_auto a blonde woman at a bar drinking a martini, GTA style, neon lighting”"
            class="w-full rounded-lg bg-[#161719] border border-white/10 p-3 text-[13px] outline-none focus:border-white/25 resize-none placeholder:text-white/25"
          />
          <div class="flex items-center gap-3 text-[12.5px]">
            <div class="flex rounded-lg border border-white/10 overflow-hidden">
              <button
                v-for="m in (['explore','refine'] as const)" :key="m"
                class="px-3 py-1.5" :class="mode === m ? 'bg-white/10 text-white' : 'text-white/45 hover:text-white/70'"
                @click="mode = m"
              >{{ m }}</button>
            </div>
            <label class="text-white/45">count
              <input v-model.number="n" type="number" min="1" max="6" class="ml-1 w-12 rounded bg-[#161719] border border-white/10 px-2 py-1 text-white/85">
            </label>
            <button
              class="ml-auto rounded-lg px-4 py-2 font-semibold text-[13px] text-[#053225] bg-gradient-to-b from-[#5fe3b0] to-[#34d399] disabled:opacity-40"
              :disabled="!image || !brief.trim() || busy" @click="propose"
            >{{ busy ? 'Proposing…' : '✦ Propose directions' }}</button>
          </div>
          <p v-if="error" class="text-[12.5px] text-rose-400">{{ error }}</p>
        </div>
      </div>

      <!-- results -->
      <div v-if="ran" class="mt-7">
        <div class="flex items-center gap-3 mb-3 text-[12.5px] text-white/45">
          <span>{{ directions.length }} direction{{ directions.length === 1 ? '' : 's' }}</span>
          <span>·</span>
          <span :class="cleanPct >= 75 ? 'text-emerald-400' : 'text-amber-400'">{{ cleanPct }}% clean (crude filter)</span>
          <span v-if="axisCollision" class="text-amber-400">· ⚠ axis collision</span>
          <span v-if="!directions.length" class="text-white/40">— model returned none (image may already be strong)</span>
        </div>

        <div class="flex flex-col gap-2.5">
          <div
            v-for="(d, i) in directions" :key="i"
            class="rounded-xl border border-white/8 bg-[#161719] p-3.5"
            :class="isGeneric(d) ? 'ring-1 ring-amber-500/40' : ''"
          >
            <div class="flex items-center gap-2.5">
              <span class="text-[14px] font-semibold">{{ d.label }}</span>
              <span class="text-[10px] px-1.5 py-0.5 rounded" :style="{ color: AXIS_COLOR[d.axis] ?? '#aaa', border: `1px solid ${AXIS_COLOR[d.axis] ?? '#555'}44` }">{{ d.axis }}</span>
              <span v-if="isGeneric(d)" class="ml-auto text-[10.5px] text-amber-400">⚠ maybe generic</span>
            </div>
            <p class="mt-1.5 text-[12.5px] text-white/55 leading-relaxed">{{ d.why }}</p>
            <div class="mt-2 text-[11px] font-mono text-white/35 bg-[#0f1012] border border-white/8 rounded-lg px-2.5 py-1.5">
              <span v-if="d.patch.promptAdd">prompt += <span class="text-emerald-300/80">“{{ d.patch.promptAdd }}”</span></span>
              <span v-else-if="d.patch.promptReplace">“{{ d.patch.promptReplace[0] }}” → <span class="text-emerald-300/80">“{{ d.patch.promptReplace[1] }}”</span></span>
              <span v-else>no prompt change</span>
              <span class="text-white/25"> · seed: {{ d.patch.seed }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
