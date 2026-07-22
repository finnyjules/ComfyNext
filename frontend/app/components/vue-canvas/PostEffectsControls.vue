<!-- frontend/app/components/vue-canvas/PostEffectsControls.vue -->
<script setup lang="ts">
// Post-processing effect sections (adjust/bloom/grain/vignette/duotone).
// Emits the FULL replacement chain array — the owner decides where it lives
// (layer.effects for a layer, sailor_localFx for the document).
import { defaultPostEffect, type PostEffect } from '~/lib/compositor/postEffects'

const props = defineProps<{ effects: PostEffect[] }>()
const emit = defineEmits<{ (e: 'update', effects: PostEffect[]): void }>()

interface ParamSpec { key: string; label: string; min: number; max: number; step: number }
interface SectionSpec { type: PostEffect['type']; label: string; params: ParamSpec[]; colors?: [string, string][] }
const SECTIONS: SectionSpec[] = [
  { type: 'adjust', label: 'Adjust', params: [
    { key: 'brightness', label: 'Brightness', min: 0, max: 2, step: 0.01 },
    { key: 'contrast', label: 'Contrast', min: 0, max: 2, step: 0.01 },
    { key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.01 },
    { key: 'hue', label: 'Hue', min: -180, max: 180, step: 1 },
  ] },
  { type: 'bloom', label: 'Bloom', params: [
    { key: 'threshold', label: 'Threshold', min: 0, max: 1, step: 0.01 },
    { key: 'radius', label: 'Radius', min: 0, max: 0.2, step: 0.002 },
    { key: 'intensity', label: 'Intensity', min: 0, max: 2, step: 0.01 },
  ] },
  { type: 'grain', label: 'Grain', params: [
    { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01 },
    { key: 'size', label: 'Size', min: 1, max: 8, step: 0.5 },
  ] },
  { type: 'vignette', label: 'Vignette', params: [
    { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01 },
    { key: 'size', label: 'Size', min: 0, max: 1, step: 0.01 },
    { key: 'softness', label: 'Softness', min: 0, max: 1, step: 0.01 },
  ] },
  { type: 'duotone', label: 'Duotone', colors: [['shadows', 'Shadows'], ['highlights', 'Highlights']], params: [
    { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01 },
  ] },
]

function fx(type: string): Record<string, any> | undefined {
  return props.effects.find(e => e.type === type) as Record<string, any> | undefined
}
function toggle(type: PostEffect['type']) {
  if (fx(type)) emit('update', props.effects.filter(e => e.type !== type))
  else emit('update', [...props.effects, defaultPostEffect(type)])
}
function patch(type: PostEffect['type'], key: string, value: number | string) {
  const cur = (fx(type) ?? defaultPostEffect(type)) as Record<string, any>
  emit('update', [
    ...props.effects.filter(e => e.type !== type),
    { ...cur, [key]: value } as PostEffect,
  ])
}
function fmt(v: unknown, step: number): string {
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(step >= 1 ? 0 : 2) : '—'
}
</script>

<template>
  <div>
    <div v-for="s in SECTIONS" :key="s.type" class="mt-3 first:mt-0">
      <div class="flex items-center justify-between mb-1.5">
        <div class="panel-label">{{ s.label }}</div>
        <button class="text-[10px] px-1.5 py-0.5 rounded border border-[#2a2a2a] text-white/60 hover:text-white/90"
          :data-testid="`postfx-add-${s.type}`"
          @click="toggle(s.type)">{{ fx(s.type) ? 'Remove' : 'Add' }}</button>
      </div>
      <div v-if="fx(s.type)" class="space-y-1.5">
        <div v-if="s.colors" class="flex items-center gap-1.5">
          <div v-for="[key, label] in s.colors" :key="key" class="flex-1 flex items-center gap-1.5 min-w-0">
            <input type="color" :value="fx(s.type)![key]" :title="label"
              class="w-8 h-8 rounded bg-transparent border border-[#2a2a2a] cursor-pointer shrink-0"
              @input="patch(s.type, key, ($event.target as HTMLInputElement).value)" />
            <div class="panel-sublabel truncate">{{ label }}</div>
          </div>
        </div>
        <div v-for="p in s.params" :key="p.key" class="flex items-center gap-2">
          <div class="panel-sublabel w-16 shrink-0">{{ p.label }}</div>
          <input type="range" :min="p.min" :max="p.max" :step="p.step" :value="fx(s.type)![p.key]"
            class="flex-1 min-w-0 accent-white/80 cursor-pointer"
            :data-testid="`postfx-${s.type}-${p.key}`"
            @input="patch(s.type, p.key, parseFloat(($event.target as HTMLInputElement).value))" />
          <div class="w-9 shrink-0 text-right text-[10px] text-white/50 tabular-nums">{{ fmt(fx(s.type)![p.key], p.step) }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
