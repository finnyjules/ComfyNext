<script setup lang="ts">
import { BRAND_COLOR_KEYS, type BrandKit } from '~~/shared/brand/types'

defineProps<{ kit: BrandKit }>()
const emit = defineEmits<{ update: [patch: Partial<BrandKit>] }>()

const COLOR_LABELS: Record<string, string> = {
  primary: 'Primary', secondary: 'Secondary', accent: 'Accent',
  accent2: 'Accent 2', foreground: 'Foreground', background: 'Background',
}

function setColor(key: string, v: string) { emit('update', { [key]: v }) }

async function onLogoFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const fd = new FormData()
  fd.append('image', file)
  fd.append('overwrite', 'true')
  const res = await fetch('/upload/image', { method: 'POST', body: fd })
  if (res.ok) {
    const data = await res.json() as { name?: string; subfolder?: string }
    const name = data.subfolder ? `${data.subfolder}/${data.name}` : (data.name ?? '')
    if (name) emit('update', { logo: `/view?filename=${encodeURIComponent(name)}&type=input` })
  }
}
</script>

<template>
  <div class="space-y-2 text-xs">
    <div v-for="key in BRAND_COLOR_KEYS" :key="key" class="flex items-center justify-between gap-2">
      <span class="text-white/60">{{ COLOR_LABELS[key] }}</span>
      <span class="flex items-center gap-1">
        <input
          type="color" :value="kit[key] || '#000000'"
          class="size-6 rounded border border-white/10 bg-transparent p-0"
          @change="setColor(key, ($event.target as HTMLInputElement).value)"
        ><!-- @change, not @input: every update PUTs the whole kit; a picker drag would spam the API -->
        <input
          type="text" :value="kit[key] ?? ''" placeholder="unset"
          class="w-20 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-1 py-0.5 text-white/90 outline-none"
          @change="setColor(key, ($event.target as HTMLInputElement).value.trim())"
        >
      </span>
    </div>
    <div class="flex items-center justify-between gap-2">
      <span class="text-white/60">Display font</span>
      <TemplatesFontPicker :model-value="kit.fontDisplay ?? ''" @update:model-value="(v: string) => emit('update', { fontDisplay: v })" />
    </div>
    <div class="flex items-center justify-between gap-2">
      <span class="text-white/60">Body font</span>
      <TemplatesFontPicker :model-value="kit.fontBody ?? ''" @update:model-value="(v: string) => emit('update', { fontBody: v })" />
    </div>
    <div class="space-y-1">
      <span class="text-white/60">Logo</span>
      <input
        type="text" :value="kit.logo ?? ''" placeholder="https://… or upload"
        class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-1 py-0.5 text-white/90 outline-none"
        @change="emit('update', { logo: ($event.target as HTMLInputElement).value.trim() })"
      >
      <label class="inline-block px-2 py-0.5 rounded bg-white/[0.06] hover:bg-white/[0.1] cursor-pointer text-white/70">
        Upload<input type="file" accept="image/*" class="hidden" @change="onLogoFile">
      </label>
    </div>
  </div>
</template>
