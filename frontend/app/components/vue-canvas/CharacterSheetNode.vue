<script setup lang="ts">
// Character Sheet Builder — canvas card. Expands one photo (or a trained
// character LoRA) into a canonical 4-shot reference sheet, then saves it as a
// castable Character (Task 5 registry). Mirrors CharacterNode's saved-state
// idiom and the dataset-builder generate/re-roll pattern from
// LoraTrainerSurface.vue, scaled down to a fixed 4-shot set.
import { computed, inject, ref, watch } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { Images, Loader2, RefreshCcw, Upload } from 'lucide-vue-next'
import { useCharacters } from '~/composables/useCharacters'
import { useSheetGeneration, type SheetSource } from '~/composables/useSheetGeneration'
import { uploadRefFile } from '~/lib/shotdirector/refUpload'
import { CHARACTER_SHEET_CANONICAL } from '~/data/character-shot-scenes'
import { toast } from 'vue-sonner'

const props = defineProps<{
  id: string
  data: {
    nodeType: string
    title?: string
    properties?: Record<string, any>
  }
}>()

const { characters, coverUrl } = useCharacters()

// ── Saved state ──────────────────────────────────────────────────────────
const slug = computed<string | null>(() => props.data?.properties?.comfynext_characterSlug ?? null)
const savedCharacter = computed(() => characters.value.find(c => c.slug === slug.value) ?? null)
// This node only ever populates the character's default variant (see save()
// below), so the reference count for the saved-state summary comes from
// that variant specifically — mirrors useCharacters' own default-variant fallback.
const savedRefCount = computed(() => {
  const c = savedCharacter.value
  if (!c) return 0
  const variant = c.variants.find(v => v.id === 'default') ?? c.variants[0]
  return variant?.refImages.length ?? 0
})

// ── Wired upstream source (optional IMAGE input) ────────────────────────
const nodesInj = inject<any>('vueFlowNodes', null)
const edgesInj = inject<any>('vueFlowEdges', null)
const upstream = computed(() => {
  const e = (edgesInj?.value ?? []).find((e: any) => String(e.target) === props.id && e.targetHandle === 'input-0')
  const n = e && (nodesInj?.value ?? []).find((n: any) => String(n.id) === String(e.source))
  return n?.data?.images?.[0] ?? null
})

// ── Source mode: Photo | Trained LoRA ───────────────────────────────────
const sourceMode = ref<'photo' | 'lora'>('photo')

// Photo mode: wired-image (converted to data URL) or a local upload.
const uploadedDataUrl = ref<string | null>(null)
const sourceDataUrl = computed<string | null>(() => uploadedDataUrl.value)
const uploading = ref(false)

async function fetchAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetch ${res.status}`)
  const blob = await res.blob()
  return await blobToDataUrl(blob)
}
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

// Keep uploadedDataUrl in sync with the wired source when present (and no
// manual upload has overridden it).
const usingWiredSource = ref(false)
watch(upstream, async (url) => {
  if (!url) { if (usingWiredSource.value) { uploadedDataUrl.value = null; usingWiredSource.value = false } return }
  try {
    uploadedDataUrl.value = await fetchAsDataUrl(url)
    usingWiredSource.value = true
  } catch (e) {
    console.warn('[CharacterSheet] wired source fetch failed', e)
    toast.error('Couldn\'t load the wired source image', { description: 'Upload a photo instead, or re-run the upstream node' })
  }
}, { immediate: true })

function onFilePicked(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  uploading.value = true
  const reader = new FileReader()
  reader.onload = () => {
    uploadedDataUrl.value = reader.result as string
    usingWiredSource.value = false
    uploading.value = false
  }
  reader.onerror = () => { uploading.value = false }
  reader.readAsDataURL(file)
  ;(e.target as HTMLInputElement).value = ''
}

// LoRA mode: pick a trained character LoRA.
interface LoraItem { filename: string, name: string, trigger: string | null, coverUrl: string | null }
const loraItems = ref<LoraItem[]>([])
const lorasLoading = ref(false)
const selectedLoraFilename = ref<string | null>(null)
const selectedLora = computed(() => loraItems.value.find(l => l.filename === selectedLoraFilename.value) ?? null)

async function loadLoras() {
  lorasLoading.value = true
  try {
    const res = await fetch('/api/loras-local')
    if (res.ok) {
      const data = await res.json() as { loras?: any[] }
      loraItems.value = (data.loras || [])
        .filter((l) => l.kind === 'character')
        .map((l) => ({ filename: l.filename, name: l.name, trigger: l.trigger ?? null, coverUrl: l.coverUrl ?? null }))
    }
  } catch { /* offline */ } finally {
    lorasLoading.value = false
  }
}

function setSourceMode(mode: 'photo' | 'lora') {
  sourceMode.value = mode
  if (mode === 'lora' && loraItems.value.length === 0 && !lorasLoading.value) void loadLoras()
}

const hasSource = computed(() => sourceMode.value === 'photo' ? !!sourceDataUrl.value : !!selectedLora.value)

// ── Name ─────────────────────────────────────────────────────────────────
const charName = ref('')

// ── Shots ────────────────────────────────────────────────────────────────
const { shots, reset: resetShots, runShot: runShotOn, expandAll } = useSheetGeneration(CHARACTER_SHEET_CANONICAL)
const expanding = ref(false)

const hasAnyShot = computed(() => shots.value.some(s => s.dataUrl))
const canExpand = computed(() => hasSource.value && charName.value.trim().length > 0 && !expanding.value)

function currentSource(): SheetSource | null {
  if (sourceMode.value === 'lora') {
    const lora = selectedLora.value
    if (!lora) return null
    return { mode: 'lora', loraFilename: lora.filename, trigger: lora.trigger }
  }
  if (!sourceDataUrl.value) return null
  return { mode: 'photo', referenceImageDataUrl: sourceDataUrl.value }
}

async function runShot(idx: number) {
  const source = currentSource()
  if (!source) return
  await runShotOn(idx, source)
}

async function expandSheet() {
  if (!canExpand.value) return
  const source = currentSource()
  if (!source) return
  expanding.value = true
  try {
    await expandAll(source)
  } finally {
    expanding.value = false
  }
}

function reroll(idx: number) {
  void runShot(idx)
}

const expandCostLabel = computed(() => sourceMode.value === 'lora' ? '~$0.12' : '~$0.32')

// ── Save ─────────────────────────────────────────────────────────────────
const saving = ref(false)
const saveError = ref<string | null>(null)

function dataUrlToFile(dataUrl: string, name: string): File {
  const comma = dataUrl.indexOf(',')
  const head = dataUrl.slice(0, comma)
  const b64 = dataUrl.slice(comma + 1)
  const mime = head.match(/data:(.*?);base64/)?.[1] || 'image/png'
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new File([arr], name, { type: mime })
}

async function urlToFile(url: string, name: string): Promise<File> {
  if (url.startsWith('data:')) return dataUrlToFile(url, name)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetch ${res.status}`)
  const blob = await res.blob()
  return new File([blob], name, { type: blob.type || 'image/png' })
}

async function save() {
  if (saving.value) return
  const name = charName.value.trim()
  if (!name || !hasSource.value) return

  saving.value = true
  saveError.value = null
  let createdSlug: string | null = null
  try {
    // Upload source + every generated shot (source first, so it's the cover).
    const uploads: string[] = []
    if (sourceMode.value === 'photo' && sourceDataUrl.value) {
      const sourceFile = dataUrlToFile(sourceDataUrl.value, 'source.png')
      const sourceUrl = await uploadRefFile(sourceFile)
      uploads.push(new URLSearchParams(sourceUrl.split('?')[1]).get('filename')!)
    }
    let shotIdx = 0
    for (const shot of shots.value) {
      if (!shot.dataUrl) continue
      const file = await urlToFile(shot.dataUrl, `sheet_${shotIdx++}.png`)
      const refUrl = await uploadRefFile(file)
      uploads.push(new URLSearchParams(refUrl.split('?')[1]).get('filename')!)
    }
    if (uploads.length === 0) throw new Error('nothing to save — add a source photo or generate a sheet first')

    // LoRA mode attaches to the character that already owns this LoRA
    // (post-unification, absorb guarantees one exists) — POSTing would 409.
    // The registry record's identity wins over whatever name was typed.
    let targetSlug: string | null = null
    let targetName = name
    if (sourceMode.value === 'lora' && selectedLora.value) {
      try {
        const res = await fetch('/api/characters-local')
        if (res.ok) {
          const data = await res.json() as { characters?: { slug: string, name: string, loraName: string | null }[] }
          const existing = (data.characters ?? []).find(c => c.loraName === selectedLora.value!.filename)
          if (existing) { targetSlug = existing.slug; targetName = existing.name }
        }
      } catch { /* registry unreachable — fall through to create */ }
    }

    if (!targetSlug) {
      const created = await fetch('/api/characters-local', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      })
      if (!created.ok) throw new Error(`create ${created.status}`)
      const { slug: newSlug } = await created.json() as { slug: string }
      createdSlug = newSlug
      targetSlug = newSlug
    }

    // Legacy refImages alias writes through to the Default variant — a full
    // replace, same semantics as the panel's "Regenerate sheet".
    const patchBody: Record<string, any> = { slug: targetSlug, refImages: uploads }
    if (sourceMode.value === 'lora' && selectedLora.value) {
      patchBody.loraName = selectedLora.value.filename
      patchBody.trigger = selectedLora.value.trigger
    }
    const patched = await fetch('/api/characters-local', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patchBody),
    })
    if (!patched.ok) {
      // Don't leave an orphan zero-ref character behind — but ONLY clean up a
      // record this save created; never delete a pre-existing character.
      if (createdSlug) {
        await fetch('/api/characters-local', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: createdSlug, remove: true }),
        }).catch(() => {})
      }
      throw new Error(`attach refs ${patched.status}`)
    }

    if (!props.data.properties) (props.data as any).properties = {}
    const properties = props.data.properties as Record<string, any>
    properties.comfynext_characterSlug = targetSlug
    properties.comfynext_characterName = targetName
    window.dispatchEvent(new CustomEvent('comfynext:charactersChanged'))
    window.dispatchEvent(new CustomEvent('comfynext:castEdgesChanged'))
    toast.success(
      createdSlug ? `Saved ${targetName} to characters` : `Updated ${targetName}'s reference sheet`,
      { description: 'Castable in the Shot Director' },
    )
  } catch (e: any) {
    console.warn('[CharacterSheet] save failed', e)
    saveError.value = e?.message || 'Save failed'
  } finally {
    saving.value = false
  }
}

function resetToNewSheet() {
  if (!props.data.properties) return
  delete props.data.properties.comfynext_characterSlug
  delete props.data.properties.comfynext_characterName
  charName.value = ''
  uploadedDataUrl.value = null
  usingWiredSource.value = false
  resetShots()
  saveError.value = null
  window.dispatchEvent(new CustomEvent('comfynext:castEdgesChanged'))
}
</script>

<template>
  <div class="relative w-[240px] overflow-hidden rounded-xl border border-white/10 bg-neutral-900 text-white shadow-lg">
    <!-- Target handle (optional wired source image) -->
    <Handle
      id="input-0" type="target" :position="Position.Left"
      class="!h-3 !w-3 !rounded-full !border-2 !border-white/30 !bg-[#1a1a1a]"
      :style="{ top: '38px' }"
      title="Source image (optional)"
    />
    <!-- Output handle (CHARACTER, once saved) -->
    <Handle
      id="output-0" type="source" :position="Position.Right"
      class="!h-3 !w-3 !rounded-full !border-2 !border-white/30 !bg-[#1a1a1a]"
      :style="{ top: '38px' }"
    />

    <!-- Header -->
    <div class="flex items-center gap-2 border-b border-white/10 px-3 py-2">
      <Images class="h-3.5 w-3.5 text-white/70" />
      <span class="text-xs font-medium text-white/80">Character Sheet</span>
    </div>

    <!-- SAVED STATE -->
    <div v-if="slug" class="px-3 py-2.5">
      <template v-if="savedCharacter">
        <div class="flex items-center gap-2">
          <img
            v-if="coverUrl(savedCharacter)" :src="coverUrl(savedCharacter)!" :alt="savedCharacter.name"
            class="h-10 w-10 shrink-0 rounded object-cover"
          >
          <div v-else class="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-white/[0.06]">
            <Images class="h-4 w-4 text-white/30" />
          </div>
          <div class="min-w-0">
            <p class="truncate text-[12px] text-white/90" :title="savedCharacter.name">{{ savedCharacter.name }}</p>
            <p class="text-[10px] text-white/40">{{ savedRefCount }} reference{{ savedRefCount === 1 ? '' : 's' }}</p>
          </div>
        </div>
      </template>
      <p v-else class="text-[11px] leading-tight text-red-400/80">
        Character "{{ data?.properties?.comfynext_characterName || slug }}" was deleted.
      </p>
      <button
        class="mt-2 w-full rounded bg-white/10 px-2.5 py-1.5 text-[11px] text-white/80 transition hover:bg-white/20"
        @click.stop="resetToNewSheet"
      >
        New sheet
      </button>
    </div>

    <!-- BUILD STATE -->
    <div v-else class="space-y-2.5 px-3 py-2.5">
      <!-- Source mode toggle -->
      <div class="flex overflow-hidden rounded border border-white/10 text-[10.5px]">
        <button
          class="flex-1 px-2 py-1 transition"
          :class="sourceMode === 'photo' ? 'bg-white/15 text-white/90' : 'text-white/45 hover:bg-white/5'"
          @click.stop="setSourceMode('photo')"
        >
          Photo
        </button>
        <button
          class="flex-1 px-2 py-1 transition"
          :class="sourceMode === 'lora' ? 'bg-white/15 text-white/90' : 'text-white/45 hover:bg-white/5'"
          @click.stop="setSourceMode('lora')"
        >
          Trained LoRA
        </button>
      </div>

      <!-- Photo source row -->
      <div v-if="sourceMode === 'photo'" class="flex items-center gap-2">
        <div class="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-white/[0.06]">
          <img v-if="sourceDataUrl" :src="sourceDataUrl" class="h-full w-full object-cover" alt="Source">
          <Images v-else class="h-4 w-4 text-white/25" />
        </div>
        <div class="min-w-0 flex-1">
          <p v-if="usingWiredSource" class="truncate text-[11px] text-white/60">Wired source</p>
          <label
            v-else
            class="nodrag nopan flex cursor-pointer items-center gap-1 text-[11px] text-white/60 hover:text-white/85"
          >
            <Upload class="h-3 w-3" />
            <span>{{ uploading ? 'Uploading…' : sourceDataUrl ? 'Replace photo' : 'Upload a photo' }}</span>
            <input type="file" accept="image/*" class="hidden" :disabled="uploading" @change="onFilePicked">
          </label>
        </div>
      </div>

      <!-- LoRA source row -->
      <div v-else class="space-y-1">
        <p v-if="lorasLoading" class="text-[11px] text-white/40">Loading character LoRAs…</p>
        <p v-else-if="!loraItems.length" class="text-[11px] leading-tight text-white/40">
          No trained character LoRAs yet — train one first.
        </p>
        <select
          v-else v-model="selectedLoraFilename"
          class="nodrag nopan w-full rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-white/85 outline-none"
        >
          <option :value="null" disabled>Pick a character LoRA…</option>
          <option v-for="l in loraItems" :key="l.filename" :value="l.filename">{{ l.name }}</option>
        </select>
      </div>

      <!-- Name field -->
      <input
        v-model="charName"
        placeholder="Character name"
        class="nodrag nopan w-full rounded border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[12px] text-white/90 placeholder:text-white/30 outline-none focus:border-white/25"
      >

      <!-- Shot grid -->
      <div v-if="hasAnyShot || expanding" class="grid grid-cols-4 gap-1">
        <div
          v-for="(shot, i) in shots" :key="i"
          class="group relative aspect-square overflow-hidden rounded bg-white/[0.05]"
        >
          <img v-if="shot.dataUrl" :src="shot.dataUrl" class="h-full w-full object-cover" :alt="`Shot ${i + 1}`">
          <div v-if="shot.loading" class="absolute inset-0 flex items-center justify-center bg-black/40">
            <Loader2 class="h-3.5 w-3.5 animate-spin text-white/70" />
          </div>
          <button
            v-if="shot.error && !shot.loading"
            class="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-red-500/10 text-red-300 hover:bg-red-500/20"
            title="Retry this shot"
            @click.stop="reroll(i)"
          >
            <RefreshCcw class="h-3 w-3" />
            <span class="text-[8px]">Retry</span>
          </button>
          <button
            v-else-if="shot.dataUrl && !shot.loading"
            class="absolute inset-0 hidden items-center justify-center bg-black/50 group-hover:flex"
            title="Re-roll this shot"
            @click.stop="reroll(i)"
          >
            <RefreshCcw class="h-3.5 w-3.5 text-white/85" />
          </button>
        </div>
      </div>

      <!-- Expand button -->
      <button
        class="w-full rounded bg-white/10 px-2.5 py-1.5 text-[11px] text-white/80 transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="!canExpand"
        @click.stop="expandSheet"
      >
        <span v-if="expanding" class="inline-flex items-center gap-1.5">
          <Loader2 class="h-3 w-3 animate-spin" /> Expanding…
        </span>
        <span v-else>Expand sheet · {{ expandCostLabel }}</span>
      </button>

      <!-- Save button -->
      <button
        class="w-full rounded bg-emerald-500/15 px-2.5 py-1.5 text-[11px] font-medium text-emerald-300 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="saving || !charName.trim() || !hasSource"
        @click.stop="save"
      >
        <span v-if="saving" class="inline-flex items-center gap-1.5">
          <Loader2 class="h-3 w-3 animate-spin" /> Saving…
        </span>
        <span v-else>Save character</span>
      </button>

      <p v-if="saveError" class="text-[10px] leading-tight text-red-400/90">{{ saveError }}</p>
    </div>
  </div>
</template>
