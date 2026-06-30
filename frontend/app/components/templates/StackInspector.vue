<script setup lang="ts">
/**
 * Inspector panel for a selected auto-layout Stack section.
 * Injected from GridEditorShell via 'gridEditor'. Renders only when a stack
 * is selected (ctx.selectedStack != null). Controls call Task-5 functions:
 * updateStackLayout, updateChildSizing.
 */
import { Layers2 } from 'lucide-vue-next'

import StudioSection from '~/components/vue-canvas/StudioSection.vue'
import type { GridEditorContext } from '~/composables/useGridEditor'

const ctx = inject<GridEditorContext>('gridEditor')!
const { selectedStack, updateStackLayout, updateChildSizing } = ctx

const stack = selectedStack

const labelCls = 'panel-label'
const btnRowCls = 'flex-1 h-7 rounded text-[11px] transition-colors cursor-pointer'

function activeBtnCls(active: boolean) {
  return active
    ? 'bg-white/15 text-white'
    : 'bg-white/[0.04] text-white/50 hover:bg-white/[0.08]'
}

const paddingVal = computed(() => {
  const p = stack.value?.layout?.padding
  if (!p) return 0
  // Show uniform value (top) if all sides equal, else top as representative.
  return p.top
})

function onGap(e: Event) {
  if (!stack.value) return
  const v = Math.max(0, Math.min(12, Number((e.target as HTMLInputElement).value)))
  updateStackLayout(stack.value.id, { gap: v })
}

function onPadding(e: Event) {
  if (!stack.value) return
  const v = Math.max(0, Math.min(12, Number((e.target as HTMLInputElement).value)))
  updateStackLayout(stack.value.id, { padding: { top: v, right: v, bottom: v, left: v } })
}
</script>

<template>
  <div v-if="stack" class="h-full overflow-y-auto p-3 flex flex-col gap-2.5">
    <!-- Header -->
    <div class="flex items-center gap-2">
      <Layers2 class="size-3.5 text-white/45 shrink-0" />
      <span class="text-[12px] text-white font-medium truncate">{{ stack.name }}</span>
      <span class="text-[10px] text-white/30 shrink-0">Stack</span>
    </div>

    <!-- Direction + alignment -->
    <StudioSection title="Layout">
      <!-- Direction -->
      <div>
        <p :class="labelCls" class="mb-1.5">Direction</p>
        <div class="flex gap-1">
          <button
            :class="[btnRowCls, activeBtnCls(stack.layout?.direction === 'vertical')]"
            @click="updateStackLayout(stack.id, { direction: 'vertical' })"
          >Vertical</button>
          <button
            :class="[btnRowCls, activeBtnCls(stack.layout?.direction === 'horizontal')]"
            @click="updateStackLayout(stack.id, { direction: 'horizontal' })"
          >Horizontal</button>
        </div>
      </div>

      <!-- Gap -->
      <div>
        <p :class="labelCls" class="mb-1">Gap</p>
        <div class="flex items-center gap-2">
          <input
            type="range" min="0" max="12" step="1" :value="stack.layout?.gap ?? 0"
            class="flex-1"
            @input="onGap"
          >
          <span class="text-[11px] text-white/50 tabular-nums w-4">{{ stack.layout?.gap ?? 0 }}</span>
        </div>
      </div>

      <!-- Padding -->
      <div>
        <p :class="labelCls" class="mb-1">Padding</p>
        <div class="flex items-center gap-2">
          <input
            type="range" min="0" max="12" step="1" :value="paddingVal"
            class="flex-1"
            @input="onPadding"
          >
          <span class="text-[11px] text-white/50 tabular-nums w-4">{{ paddingVal }}</span>
        </div>
      </div>

      <!-- Main align -->
      <div>
        <p :class="labelCls" class="mb-1.5">Main align</p>
        <div class="flex gap-1">
          <button
            v-for="a in (['start', 'center', 'end', 'space-between'] as const)" :key="a"
            :class="[btnRowCls, activeBtnCls(stack.layout?.mainAlign === a)]"
            @click="updateStackLayout(stack.id, { mainAlign: a })"
          >{{ a === 'space-between' ? '⇔' : a }}</button>
        </div>
      </div>

      <!-- Cross align -->
      <div>
        <p :class="labelCls" class="mb-1.5">Cross align</p>
        <div class="flex gap-1">
          <button
            v-for="a in (['start', 'center', 'end', 'stretch'] as const)" :key="a"
            :class="[btnRowCls, activeBtnCls(stack.layout?.crossAlign === a)]"
            @click="updateStackLayout(stack.id, { crossAlign: a })"
          >{{ a }}</button>
        </div>
      </div>
    </StudioSection>

    <!-- Per-child sizing -->
    <StudioSection title="Children">
      <div
        v-for="child in stack.children"
        :key="child.id"
        class="flex items-center gap-2"
      >
        <span class="text-[11px] text-white/50 truncate flex-1 min-w-0">{{ child.id }}</span>
        <div class="flex gap-0.5 shrink-0">
          <button
            v-for="mode in (['hug', 'fill', 'fixed'] as const)" :key="mode"
            class="px-1.5 h-6 rounded text-[10px] transition-colors cursor-pointer"
            :class="(child.layoutSizing?.main ?? 'hug') === mode
              ? 'bg-emerald-500/20 text-emerald-300'
              : 'bg-white/[0.04] text-white/40 hover:bg-white/[0.08]'"
            :title="`Main size: ${mode}`"
            @click="updateChildSizing(stack.id, child.id, { main: mode, cross: child.layoutSizing?.cross ?? 'fill' })"
          >{{ mode }}</button>
        </div>
      </div>
      <p v-if="!stack.children.length" class="text-[11px] text-white/30">No children yet.</p>
    </StudioSection>
  </div>
</template>
