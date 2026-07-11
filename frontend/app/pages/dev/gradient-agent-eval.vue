<script setup lang="ts">
/**
 * Dev eval harness for the gradient agent. For each target prompt it runs the REAL
 * agent path — gradientAgentControls (with the preset macro) → /api/vibe (with the
 * gradient recipe guidance) → validated patch → apply (preset first, then overrides,
 * mirroring the canvas tuner) → render — and shows the result + the patch it chose.
 *
 * Needs `npm run dev` + your Anthropic key in Settings → AI. No ComfyUI backend
 * (/api/vibe calls Anthropic directly). Each pass is ~½¢ × N prompts.
 */
import { ref } from 'vue'
import { gradientFx } from '~/lib/gradientfx/renderer'
import { GRADIENT_GUIDANCE, gradientAgentControls } from '~/lib/gradientfx/agentControls'
import { buildGradientPreset } from '~/lib/gradientfx/presets'
import { defaultConfig } from '~/lib/gradientfx/randomize'
import { aspectRatio, cloneConfig, ensureConfigDefaults, type GradientConfig } from '~/lib/gradientfx/types'
import { makeConfigParams } from '~/lib/agent/configParams'
import { describeControls, validatePatch } from '~/lib/spacetype/controlDescriptor'
import type { ParamValue } from '~/lib/spacetype/effect'

const { getLocalSetting } = useLocalSettings()

const DEFAULT_TARGETS = [
  'blue, pink and orange liquid marble, grainy',
  'soft dreamy aurora colour wash',
  'tight embossed oil with tilt-shift focus',
  'icy frosted glass gradient',
  'animated flowing lava',
  'radial sunset, subtle grain',
  'high-contrast ink marble, sharp',
  'pastel mesh blobs, out of focus',
].join('\n')

const prompts = ref(DEFAULT_TARGETS)
const startFrom = ref<'linear' | 'marble'>('linear')
const running = ref(false)
interface Row { phrase: string; img: string; patch: Record<string, ParamValue> | null; rationale: string; error?: string }
const results = ref<Row[]>([])

function startConfig(): GradientConfig {
  const c = startFrom.value === 'marble' ? buildGradientPreset('marble') : null
  return c ?? ensureConfigDefaults(defaultConfig('#eval00'))
}

/** Apply a validated patch exactly like the canvas tuner: preset swaps the base
 *  config, then the remaining keys are written through the flat proxy. */
function applyPatch(base: GradientConfig, patch: Record<string, ParamValue>): GradientConfig {
  let cfg = base
  if (typeof patch.preset === 'string') { const s = buildGradientPreset(patch.preset); if (s) cfg = s }
  const params = makeConfigParams(() => cfg, () => 0)
  for (const [k, v] of Object.entries(patch)) { if (k !== 'preset') params[k] = v }
  return cfg
}

async function run() {
  const apiKey = getLocalSetting('Sailor.AI.AnthropicApiKey')
  if (!apiKey) { window.alert('Set your Anthropic key in Settings → AI first.'); return }
  running.value = true
  results.value = []
  const list = prompts.value.split('\n').map(s => s.trim()).filter(Boolean)
  for (const phrase of list) {
    try {
      const config = cloneConfig(startConfig())
      const controls = gradientAgentControls(config, { includePreset: true })
      const described = describeControls(controls, makeConfigParams(() => config, () => 0))
      const res = await $fetch<{ changes: { key: string; value: ParamValue }[]; rationale: string }>('/api/vibe', {
        method: 'POST',
        body: { apiKey, controls: described, phrase, effectLabel: 'Gradient studio', guidance: GRADIENT_GUIDANCE },
      })
      const raw: Record<string, ParamValue> = {}
      for (const c of res.changes ?? []) raw[c.key] = c.value
      const patch = validatePatch(raw, described)
      const cfg = applyPatch(config, patch)
      const w = 360, h = Math.round(360 / aspectRatio(cfg.canvas.aspect))
      const img = gradientFx.render(cfg, w, h, 0).toDataURL('image/jpeg', 0.85)
      results.value = [...results.value, { phrase, img, patch, rationale: res.rationale ?? '' }]
    } catch (e: any) {
      results.value = [...results.value, { phrase, img: '', patch: null, rationale: '', error: e?.message ?? String(e) }]
    }
  }
  running.value = false
}
</script>

<template>
  <div style="min-height:100vh;background:#0b0b0f;color:#ddd;font-family:sans-serif;padding:20px">
    <h1 style="font-size:16px;margin:0 0 12px">Gradient agent eval</h1>
    <p style="font-size:12px;color:#888;margin:0 0 12px">
      Runs each prompt through the real agent path (preset macro + recipe guidance) and renders the result. Needs your Anthropic key in Settings → AI.
    </p>
    <div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:14px">
      <textarea v-model="prompts" rows="8" spellcheck="false"
        style="flex:1;max-width:520px;background:#15151c;color:#ddd;border:1px solid #2a2a35;border-radius:8px;padding:10px;font:12px monospace" />
      <div style="display:flex;flex-direction:column;gap:8px">
        <label style="font-size:12px;color:#aaa">Start from
          <select v-model="startFrom" style="margin-left:6px;background:#15151c;color:#ddd;border:1px solid #2a2a35;border-radius:6px;padding:4px">
            <option value="linear">linear default (creation)</option>
            <option value="marble">marble base (refinement)</option>
          </select>
        </label>
        <button :disabled="running" @click="run"
          style="background:#e6e6ea;color:#111;border:none;border-radius:8px;padding:8px 16px;font-weight:600;cursor:pointer">
          {{ running ? 'Running…' : 'Run eval' }}
        </button>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px">
      <div v-for="(r, i) in results" :key="i" style="background:#14141b;border:1px solid #23232e;border-radius:10px;overflow:hidden">
        <img v-if="r.img" :src="r.img" style="width:100%;display:block;background:#000" />
        <div v-else style="padding:20px;color:#e66;font-size:12px">{{ r.error }}</div>
        <div style="padding:8px 10px">
          <div style="font-size:12px;font-weight:600;margin-bottom:4px">{{ r.phrase }}</div>
          <div style="font-size:11px;color:#8a8;margin-bottom:6px">{{ r.rationale }}</div>
          <pre style="font:10px/1.4 monospace;color:#9aa;white-space:pre-wrap;margin:0">{{ r.patch ? JSON.stringify(r.patch, null, 1) : '' }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>
