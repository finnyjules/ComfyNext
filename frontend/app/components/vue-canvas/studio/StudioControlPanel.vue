<script setup lang="ts">
/**
 * Renders a studio's inspector from its ControlSpec[].
 *
 * Every kind goes through StudioRow — this file has no per-kind branch. Bespoke
 * blocks (repeaters, palette pickers, motion editors, export panels) belong in
 * `#section-<Title>` or `#control-<key>`, not in the schema.
 *
 * Grouping happens here and only here; StudioSectionTree walks the result.
 *
 * Gone with the per-kind branches: `segmentedMax`. A select with three options used
 * to render as a pill row; now it is an inline dropdown like every other select,
 * because the point of the row model is that every control is the same 28px object.
 */
import { computed } from 'vue'
import type { ControlSpec } from '~/lib/spacetype/effect'
import { groupIntoSections } from '~/lib/studio/sections'
import StudioSectionTree from '~/components/vue-canvas/studio/StudioSectionTree.vue'

const props = defineProps<{
  controls: ControlSpec[]
  order: readonly string[]
  /** Current value for a control key. A reader function, not a params object —
   *  Texture's params is a flat record while Gradient/Shape use a dotted proxy. */
  value: (key: string) => string | number | boolean
  visible?: (c: ControlSpec) => boolean
  /** Bound collection column label for a key, or null if unbound. */
  boundFor?: (key: string) => string | null
  /** Parameterless — dispatches the "open the wired collection" event. */
  goToCollection?: () => void
  /** Per-section chrome overrides, keyed by section title. Forwarded through to
   *  StudioSectionTree — see its own doc-comment for the exact contract. */
  sections?: Record<string, { badge?: string; open?: boolean }>
}>()

const emit = defineEmits<{
  (e: 'set', key: string, value: string | number | boolean): void
  (e: 'promote', control: ControlSpec): void
  (e: 'menu', event: MouseEvent, control: ControlSpec): void
}>()

const sections = computed(() => groupIntoSections(props.controls, props.order, props.visible))
</script>

<template>
  <StudioSectionTree
    v-for="s in sections"
    :key="s.title"
    :section="s"
    :value="value"
    :bound-for="boundFor"
    :go-to-collection="goToCollection"
    :sections="props.sections"
    @set="(k, v) => emit('set', k, v)"
    @promote="(c) => emit('promote', c)"
    @menu="(e, c) => emit('menu', e, c)"
  >
    <template v-for="(_, name) in $slots" #[name]="slotProps">
      <slot :name="name" v-bind="slotProps ?? {}" />
    </template>
  </StudioSectionTree>
</template>
