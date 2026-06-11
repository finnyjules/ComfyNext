<script setup lang="ts">
/**
 * App-wide "Brand fonts" manager — upload/list/delete licensed fonts that the
 * render loader registers for satori and the FontPicker offers under "Brand
 * fonts". Lives in the brand LibraryPopover; fonts are shared across all kits
 * and projects (like the kit library itself).
 */
import { Trash2, Upload } from 'lucide-vue-next'
import { ref } from 'vue'

import { useUploadedFonts } from '~/composables/useUploadedFonts'

const { fonts, upload, remove } = useUploadedFonts()

const family = ref('')
const weight = ref<'400' | '700'>('400')
const fileInput = ref<HTMLInputElement>()
const busy = ref(false)
const error = ref('')

async function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const fam = family.value.trim()
  if (!fam) { error.value = 'Name the font family first.'; input.value = ''; return }
  busy.value = true
  error.value = ''
  try {
    await upload(file, fam, weight.value)
    family.value = ''
    weight.value = '400'
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Upload failed'
  } finally {
    busy.value = false
    input.value = ''
  }
}

/** Human label for a family's available weights (mirror = single Regular). */
function weightsLabel(weights: Partial<Record<'400' | '700', string>>): string {
  const r = weights['400']
  const b = weights['700']
  if (r && b && r === b) return 'Regular'      // single upload mirrored to both
  const parts: string[] = []
  if (r) parts.push('Regular')
  if (b) parts.push('Bold')
  return parts.join(' + ') || '—'
}
</script>

<template>
  <div class="space-y-2 text-xs">
    <span class="font-medium text-white/80">Brand fonts</span>

    <div v-if="!fonts.length" class="text-white/40">No uploaded fonts yet.</div>
    <div v-for="f in fonts" :key="f.slug" class="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-white/[0.04]">
      <span class="min-w-0">
        <span class="block truncate text-white/85" :style="{ fontFamily: f.family }">{{ f.family }}</span>
        <span class="block text-[10px] text-white/35">{{ weightsLabel(f.weights) }}</span>
      </span>
      <button
        class="shrink-0 p-1 rounded text-white/40 hover:text-rose-300 hover:bg-rose-500/10 transition-colors cursor-pointer"
        title="Delete font"
        @click="remove(f.slug)"
      >
        <Trash2 class="size-3.5" />
      </button>
    </div>

    <!-- Upload row -->
    <div class="pt-2 border-t border-white/10 space-y-1.5">
      <input
        v-model="family"
        type="text" placeholder="Family name (e.g. Acme Grotesk)"
        class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-1.5 py-1 text-white/90 outline-none focus:border-[#96b4ff]/40"
      >
      <div class="flex items-center gap-1.5">
        <select
          v-model="weight"
          class="bg-[#1a1a1a] border border-[#2a2a2a] rounded px-1.5 py-1 text-white/90 outline-none"
        >
          <option value="400">Regular</option>
          <option value="700">Bold</option>
        </select>
        <label
          class="flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors"
          :class="busy ? 'bg-white/[0.04] text-white/40' : 'bg-white/[0.06] hover:bg-white/[0.1] text-white/70'"
        >
          <Upload class="size-3" />
          {{ busy ? 'Uploading…' : 'Upload font' }}
          <input
            ref="fileInput" type="file" accept=".ttf,.otf,.woff" class="hidden"
            :disabled="busy" @change="onPick"
          >
        </label>
      </div>
      <p v-if="error" class="text-rose-300">{{ error }}</p>
      <p class="text-[10px] text-white/30">.ttf, .otf or .woff (not .woff2), up to 2&nbsp;MB. One file covers both weights until you add a Bold.</p>
    </div>
  </div>
</template>
