<script setup lang="ts">
// Dev harness — cast-model bake-off. Run the SAME cast shot through each candidate
// video model (in their playground or via our app), drop the result clips here, and
// score them on the two axes that actually decide it: did it clear the likeness
// guard, and did it hold the character's identity. No paid calls here — this is the
// scoring/layout surface; generation happens elsewhere. State persists to localStorage.
import { reactive, computed, watch, onMounted } from 'vue'

type Guard = 'untested' | 'passed' | 'blocked'
interface Contender {
  name: string
  platform: string
  note: string       // capability note
  videoUrl: string
  guard: Guard
  identity: number   // 0 = unscored, 1–5
  notes: string
}

interface Bakeoff {
  prompt: string
  referenceUrl: string
  contenders: Contender[]
}

const KEY = 'comfynext:model-bakeoff'

const seed = (): Bakeoff => ({
  prompt: 'Characters: Vera. A woman in a red coat walks slowly toward camera, in a rainy neon street. Medium shot, smooth orbit counterclockwise around the subject. Neon; cinematic, 35mm film grain.',
  referenceUrl: '',
  contenders: [
    { name: 'Veo 3.1 (Replicate)', platform: 'replicate', note: '≤3 refs · native audio', videoUrl: '', guard: 'untested', identity: 0, notes: '' },
    { name: 'Veo 3.1 (fal)', platform: 'fal', note: '≤3 refs · native audio · same guard as Seedance?', videoUrl: '', guard: 'untested', identity: 0, notes: '' },
    { name: 'Kling 3.0 Elements', platform: 'fal/replicate?', note: '≤4 refs · identity-lock through motion', videoUrl: '', guard: 'untested', identity: 0, notes: '' },
    { name: 'Runway Gen-4 References', platform: 'fal/runway', note: '3 refs · lock identity ~85%', videoUrl: '', guard: 'untested', identity: 0, notes: '' },
    { name: 'Vidu Q2 (multi-ref)', platform: 'fal', note: 'up to 7 subjects · cheap', videoUrl: '', guard: 'untested', identity: 0, notes: '' },
    { name: 'MiniMax S2V-01', platform: 'replicate', note: '1 subject · no audio', videoUrl: '', guard: 'untested', identity: 0, notes: '' },
    { name: 'Seedance 2.0 (fal) — baseline', platform: 'fal', note: 'current route — BLOCKED our face', videoUrl: '', guard: 'blocked', identity: 0, notes: 'HTTP 422 likeness guard on image_urls' },
  ],
})

const state = reactive<Bakeoff>(seed())

onMounted(() => {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) Object.assign(state, JSON.parse(raw))
  } catch { /* ignore */ }
})
watch(state, () => { try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* ignore */ } }, { deep: true })

const GUARDS: Guard[] = ['untested', 'passed', 'blocked']
const guardClass = (g: Guard) => g === 'passed' ? 'text-emerald-400' : g === 'blocked' ? 'text-red-400' : 'text-white/40'

// Recommendation: among guard-passers, highest identity wins.
const ranked = computed(() =>
  state.contenders
    .filter(c => c.guard === 'passed' && c.identity > 0)
    .slice()
    .sort((a, b) => b.identity - a.identity))

function reset() { Object.assign(state, seed()) }
</script>

<template>
  <div class="min-h-screen bg-[#0e0e10] p-6 text-white">
    <div class="mx-auto max-w-[1100px] space-y-4">
      <div class="flex items-center justify-between">
        <h1 class="text-[15px] font-semibold">Cast-model bake-off</h1>
        <button class="rounded border border-white/15 px-2 py-1 text-[11px] text-white/60 hover:bg-white/10" @click="reset">Reset</button>
      </div>
      <p class="text-[11px] leading-relaxed text-white/40">
        Run the same shot + reference through each model, paste the result clip, then score: did it clear the likeness guard, and did it hold the identity? The winner is the highest-identity model that passed.
      </p>

      <!-- Shot context -->
      <div class="grid grid-cols-[1fr_200px] gap-4 rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
        <div>
          <label class="mb-1 block text-[11px] text-white/45">Shot prompt (same for every model)</label>
          <textarea v-model="state.prompt" rows="4" class="w-full resize-none rounded border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[12px] text-white/90 outline-none focus:border-white/25" />
        </div>
        <div>
          <label class="mb-1 block text-[11px] text-white/45">Reference (cover) URL</label>
          <input v-model="state.referenceUrl" placeholder="/view?filename=… or https://…" class="w-full rounded border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[11px] text-white/80 outline-none focus:border-white/25" />
          <div class="mt-2 aspect-square overflow-hidden rounded border border-white/10 bg-black/40">
            <img v-if="state.referenceUrl" :src="state.referenceUrl" class="h-full w-full object-cover" alt="" />
            <div v-else class="flex h-full items-center justify-center text-[10px] text-white/25">reference</div>
          </div>
        </div>
      </div>

      <!-- Recommendation -->
      <div class="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3">
        <div class="mb-1 text-[11px] uppercase tracking-wide text-white/45">Recommendation</div>
        <p v-if="!ranked.length" class="text-[12px] text-white/40">Score a guard-passing model to see a pick.</p>
        <ol v-else class="space-y-0.5">
          <li v-for="(c, i) in ranked" :key="c.name" class="text-[12px]" :class="i === 0 ? 'text-emerald-300' : 'text-white/60'">
            {{ i + 1 }}. {{ c.name }} — identity {{ c.identity }}/5 <span class="text-white/35">({{ c.note }})</span>
          </li>
        </ol>
      </div>

      <!-- Contenders -->
      <div class="grid grid-cols-2 gap-3">
        <div v-for="c in state.contenders" :key="c.name" class="space-y-2 rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
          <div class="flex items-baseline justify-between">
            <span class="text-[12px] font-medium text-white/85">{{ c.name }}</span>
            <span class="text-[10px] text-white/35">{{ c.platform }}</span>
          </div>
          <div class="text-[10px] text-white/35">{{ c.note }}</div>

          <div class="aspect-video overflow-hidden rounded border border-white/10 bg-black/50">
            <video v-if="c.videoUrl" :src="c.videoUrl" controls class="h-full w-full object-contain" />
            <div v-else class="flex h-full items-center justify-center text-[10px] text-white/25">paste result URL below</div>
          </div>
          <input v-model="c.videoUrl" placeholder="result video URL" class="w-full rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-white/80 outline-none focus:border-white/25" />

          <div class="flex items-center gap-3">
            <!-- Guard -->
            <div class="flex items-center gap-1.5">
              <span class="text-[10px] text-white/40">Guard</span>
              <button
                v-for="g in GUARDS" :key="g"
                class="rounded px-1.5 py-0.5 text-[10px] capitalize transition-colors"
                :class="c.guard === g ? 'bg-white/15 ' + guardClass(g) : 'text-white/30 hover:bg-white/10'"
                @click="c.guard = g"
              >{{ g }}</button>
            </div>
            <!-- Identity -->
            <div class="flex items-center gap-1">
              <span class="text-[10px] text-white/40">Identity</span>
              <button
                v-for="n in 5" :key="n"
                class="text-[13px] leading-none transition-colors"
                :class="n <= c.identity ? 'text-amber-300' : 'text-white/20 hover:text-white/40'"
                @click="c.identity = c.identity === n ? 0 : n"
              >★</button>
            </div>
          </div>
          <input v-model="c.notes" placeholder="notes (likeness, wardrobe drift, motion…)" class="w-full rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-white/70 outline-none focus:border-white/25" />
        </div>
      </div>
    </div>
  </div>
</template>
