<script setup lang="ts">
/**
 * Live thumbnails of every format on a v2 (Swiss grid) template, rendered by
 * the real /api/render-template pipeline — what you see here is exactly what
 * the node will output. Interim authoring surface until the visual grid
 * editor lands; re-renders whenever the template prop changes.
 */
import { onBeforeUnmount, ref, watchEffect } from 'vue'

import type { TemplateV2 } from '~~/shared/template-grid/types'

const props = defineProps<{
  template: TemplateV2
  renderProps?: Record<string, unknown>
  brand?: Record<string, unknown>
}>()

interface Thumb { key: string; label: string; w: number; h: number; url: string | null; error: boolean }
const thumbs = ref<Thumb[]>([])
let urls: string[] = []

watchEffect(async () => {
  const template = props.template
  urls.forEach(u => URL.revokeObjectURL(u))
  urls = []
  const entries = Object.entries(template.formats ?? {})
  thumbs.value = entries.map(([key, f]) => ({ key, label: f.label ?? key, w: f.w, h: f.h, url: null, error: false }))
  await Promise.all(entries.map(async ([key], i) => {
    try {
      const res = await fetch('/api/render-template', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          template,
          aspect: key,
          props: props.renderProps ?? {},
          brand: props.brand ?? {},
        }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const url = URL.createObjectURL(await res.blob())
      urls.push(url)
      if (thumbs.value[i]?.key === key) thumbs.value[i] = { ...thumbs.value[i], url }
    } catch {
      if (thumbs.value[i]?.key === key) thumbs.value[i] = { ...thumbs.value[i], error: true }
    }
  }))
})

onBeforeUnmount(() => urls.forEach(u => URL.revokeObjectURL(u)))
</script>

<template>
  <div class="grid grid-cols-3 gap-4 overflow-y-auto p-4 content-start">
    <figure v-for="t in thumbs" :key="t.key" class="flex flex-col gap-1.5 m-0">
      <div class="flex min-h-28 items-center justify-center rounded-lg bg-black/40 border border-white/[0.06] p-2">
        <img v-if="t.url" :src="t.url" class="max-h-44 w-auto max-w-full rounded-[3px]" :alt="t.label">
        <span v-else-if="t.error" class="text-[11px] text-red-400">render failed</span>
        <span v-else class="text-[11px] text-white/35">rendering…</span>
      </div>
      <figcaption class="text-[11px] text-white/45">
        {{ t.label }} · {{ t.w }}×{{ t.h }}
      </figcaption>
    </figure>
  </div>
</template>
