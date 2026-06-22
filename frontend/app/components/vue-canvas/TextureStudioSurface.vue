<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { Dices } from 'lucide-vue-next'
import { textureFx } from '~/lib/texturefx/renderer'
import { preloadStylize, stylizeTile } from '~/lib/texturefx/stylize'
import { TEXTURE_CONTROLS, textureDefaults } from '~/lib/texturefx/controls'
import { TEXTURE_SECTIONS } from '~/lib/texturefx/sections'
import { cloneParams } from '~/lib/texturefx/types'
import type { Params } from '~/lib/spacetype/effect'
import type { TextureControl } from '~/lib/texturefx/controls'
import StudioModalShell from '~/components/vue-canvas/StudioModalShell.vue'
import StudioSection from '~/components/vue-canvas/StudioSection.vue'
import StudioButton from '~/components/vue-canvas/studio/StudioButton.vue'
import StudioColor from '~/components/vue-canvas/studio/StudioColor.vue'
import StudioSlider from '~/components/vue-canvas/studio/StudioSlider.vue'
import StudioSelect from '~/components/vue-canvas/studio/StudioSelect.vue'

const props = defineProps<{ nodeId: string; nodes: any[] }>()
const emit = defineEmits<{ (e: 'close'): void }>()

// Record generated stills as the current project's assets (Assets panel).
const { recordAsset } = useProjectGenerations()
const { activeTab } = useTabs()

const params = reactive<Params>(textureDefaults())
const repeat = ref(2)
const seams = ref(true)
const baking = ref(false)
const bakeMsg = ref('')
const canvas = ref<HTMLCanvasElement | null>(null)

function currentNode() { return props.nodes.find((n: any) => n.id === props.nodeId) }

function loadParams() {
  const p = currentNode()?.data?.properties?.comfynext_textureStudio
  if (p && typeof p === 'object') Object.assign(params, { ...textureDefaults(), ...cloneParams(p) })
}
function saveParams() {
  const n = currentNode(); if (!n) return
  if (!n.data) n.data = {}
  if (!n.data.properties) n.data.properties = {}
  n.data.properties.comfynext_textureStudio = cloneParams({ ...params })
}
function closeEditor() {
  try { saveParams() } catch (e) { console.error('[texture] save failed', e) }
  emit('close')
}

// Group visible controls by section, in TEXTURE_SECTIONS order. A control with
// a `when` predicate is shown only when it returns true for the current params
// (contextual reveal); sections with no visible controls are omitted.
const sections = computed(() => {
  const byGroup = new Map<string, TextureControl[]>()
  for (const c of TEXTURE_CONTROLS as TextureControl[]) {
    if (c.when && !c.when(params)) continue
    const g = String(c.group)
    if (!(TEXTURE_SECTIONS as readonly string[]).includes(g)) continue
    if (!byGroup.has(g)) byGroup.set(g, [])
    byGroup.get(g)!.push(c)
  }
  return TEXTURE_SECTIONS
    .filter((g) => byGroup.has(g) && byGroup.get(g)!.length > 0)
    .map((g) => ({ title: g, controls: byGroup.get(g)! }))
})

const TILE = 256

function renderPreview() {
  const el = canvas.value; if (!el) return
  const n = repeat.value
  el.width = TILE * n; el.height = TILE * n
  const ctx = el.getContext('2d')!
  // Base tile → stylize (dither/posterize/duotone). TILE=256 is a multiple of 64
  // so the dither pattern stays seamless across the repeat.
  const tile = stylizeTile(textureFx.render(params, TILE, TILE, 0), params, TILE, TILE)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      ctx.drawImage(tile, x * TILE, y * TILE)
    }
  }
  if (seams.value) {
    ctx.strokeStyle = 'rgba(159,232,208,0.7)'; ctx.lineWidth = 1
    for (let i = 1; i < n; i++) {
      ctx.beginPath(); ctx.moveTo(i * TILE, 0); ctx.lineTo(i * TILE, el.height); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, i * TILE); ctx.lineTo(el.width, i * TILE); ctx.stroke()
    }
  }
}

function roll() { params.seed = Math.floor(Math.random() * 1e6); renderPreview() }
function setRepeat(n: number) { repeat.value = n; renderPreview() }
function toggleSeams() { seams.value = !seams.value; renderPreview() }
function onParam() { renderPreview() }

// Render the full-res tile and apply stylize, then encode. 1024 is a multiple of
// 64 so dither stays seamless.
async function exportBlob(): Promise<Blob> {
  const styled = stylizeTile(textureFx.render(params, 1024, 1024, 0), params, 1024, 1024)
  return await new Promise<Blob>((res, rej) =>
    styled.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'))
}

async function sendToCanvas() {
  baking.value = true; bakeMsg.value = 'Rendering…'
  try {
    const blob = await exportBlob()
    const { uploadFrameBatch } = await import('~/composables/useKineticRenderer')
    const [filename] = await uploadFrameBatch([blob], 'texture_img')
    if (filename) {
      saveParams()
      await recordAsset(activeTab.value?.projectUuid, 'image', filename)
      window.dispatchEvent(new CustomEvent('comfynext:textureStudioOutput', {
        detail: { sourceNodeId: props.nodeId, nodeType: 'Image', widgetOverrides: { image: filename } },
      }))
      closeEditor()
    } else { bakeMsg.value = 'Upload failed — see console.' }
  } catch (e) { console.error('[texture] send failed', e); bakeMsg.value = 'Failed — see console.' }
  finally { baking.value = false }
}

async function downloadPng() {
  try {
    const blob = await exportBlob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = `texture_${params.seed}.png`; a.click()
    URL.revokeObjectURL(a.href)
  } catch (e) { console.error('[texture] PNG download failed', e) }
}

// Keyboard shortcut: Escape closes the editor.
function onKey(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
  if (e.key === 'Escape') closeEditor()
}

onMounted(() => {
  bakeMsg.value = ''
  loadParams()
  renderPreview()
  // Stylize effects load async; re-render once ready so the preview reflects them.
  preloadStylize().then(renderPreview).catch(() => {})
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  try { saveParams() } catch { /* swallow */ }
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <StudioModalShell title="Texture Studio" @close="closeEditor">
    <template #preview>
      <div class="flex h-full flex-col items-center justify-center gap-3 p-4">
        <canvas ref="canvas" class="max-h-[60vh] max-w-full rounded-lg border border-white/10" />
        <div class="flex items-center gap-2 text-xs">
          <button v-for="n in [1, 2, 3]" :key="n"
                  type="button"
                  class="rounded border px-2 py-1 transition-colors"
                  :class="repeat === n ? 'border-white bg-white/10 text-white' : 'border-white/15 text-white/55 hover:bg-white/10'"
                  @click="setRepeat(n)">{{ n }}×</button>
          <button type="button"
                  class="rounded border px-2 py-1 transition-colors"
                  :class="seams ? 'border-white bg-white/10 text-white' : 'border-white/15 text-white/55 hover:bg-white/10'"
                  @click="toggleSeams">Highlight seams</button>
        </div>
      </div>
    </template>

    <template #actions>
      <StudioButton variant="secondary" @click="roll"><Dices :size="14" /> Roll · seed {{ params.seed }}</StudioButton>
      <StudioButton variant="secondary" @click="downloadPng">Download PNG</StudioButton>
      <StudioButton variant="primary" :disabled="baking" @click="sendToCanvas">{{ baking ? bakeMsg : 'Send to canvas' }}</StudioButton>
    </template>

    <template #controls>
      <StudioSection v-for="s in sections" :key="s.title" :title="s.title">
        <div v-for="c in s.controls" :key="c.key">
          <template v-if="c.kind === 'slider'">
            <!-- StudioSlider uses defineModel<number> — bind with v-model -->
            <StudioSlider
              :label="c.label"
              :min="Number(c.min)"
              :max="Number(c.max)"
              :step="Number(c.step)"
              :default="Number(c.default)"
              :model-value="Number(params[c.key])"
              @update:model-value="(v: number) => { params[c.key] = v; onParam() }"
            />
          </template>
          <template v-else-if="c.kind === 'select'">
            <label class="mb-1 block text-[11px] text-white/55">{{ c.label }}</label>
            <!-- StudioSelect uses defineModel<string> — bind with v-model -->
            <StudioSelect
              :options="c.options as string[]"
              :model-value="String(params[c.key])"
              @update:model-value="(v: string) => { params[c.key] = v; onParam() }"
            />
          </template>
          <template v-else-if="c.kind === 'color'">
            <div class="flex items-center gap-2">
              <label class="text-[11px] text-white/55">{{ c.label }}</label>
              <!-- StudioColor uses defineModel<string> — bind with v-model -->
              <StudioColor
                :model-value="String(params[c.key])"
                @update:model-value="(v: string) => { params[c.key] = v; onParam() }"
              />
            </div>
          </template>
        </div>
      </StudioSection>
    </template>
  </StudioModalShell>
</template>
