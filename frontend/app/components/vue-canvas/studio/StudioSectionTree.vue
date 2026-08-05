<script setup lang="ts">
/**
 * Renders one already-grouped Section and its children. Recursive, and takes a
 * Section rather than a control list + order so grouping happens exactly once, in
 * StudioControlPanel — a second pass would have to re-derive each child's group from
 * its path, which is how a nested control quietly vanishes.
 */
import type { ControlSpec } from '~/lib/spacetype/effect'
import type { Section } from '~/lib/studio/sections'
import { controlKindToVariableType } from '~/lib/collection/studioBindables'
import StudioSection from '~/components/vue-canvas/StudioSection.vue'
import StudioRow from '~/components/vue-canvas/studio/StudioRow.vue'

defineOptions({ name: 'StudioSectionTree' })

defineProps<{
  section: Section<ControlSpec>
  value: (key: string) => string | number | boolean
  boundFor?: (key: string) => string | null
  goToCollection?: () => void
}>()

const emit = defineEmits<{
  (e: 'set', key: string, value: string | number | boolean): void
  (e: 'promote', control: ControlSpec): void
  (e: 'menu', event: MouseEvent, control: ControlSpec): void
}>()

/**
 * Declared rather than inferred, and the reason is the recursion. The slot names are
 * open-ended (`control-<key>`, `section-<Title>`), and the template forwards them into
 * ANOTHER instance of this same component — so inferring the slot types means inferring
 * them from a use of the thing being inferred. vue-tsc reports that cycle as TS7022
 * ('slotProps' implicitly has type 'any'... referenced directly or indirectly in its
 * own initializer). One explicit signature cuts the cycle.
 */
defineSlots<Record<string, (props: Record<string, unknown>) => unknown>>()
</script>

<template>
  <StudioSection :title="section.title">
    <template v-for="c in section.controls" :key="c.key">
      <!-- Bespoke control, from the surface. It keeps the right-click-to-bind wrapper
           the previous panel gave every control, because a slot's own markup (a harmony
           grid, a FillSwatch) has no `menu` emit of its own. The wrapper is deliberately
           NOT put around the StudioRow branch: the row already emits `menu` on
           contextmenu and does not stop propagation, so a wrapper there would fire the
           bind menu twice for one right-click. It also keeps multi-root slot content
           together as one child of the section's `space-y`, exactly as before. -->
      <div v-if="$slots['control-' + c.key]" @contextmenu.prevent="emit('menu', $event, c)">
        <slot :name="'control-' + c.key" :control="c" />
      </div>
      <StudioRow
        v-else
        :spec="c"
        :model-value="value(c.key)"
        :bound="boundFor?.(c.key) ?? null"
        :bindable="controlKindToVariableType(c.kind) !== null"
        @update:model-value="(v) => emit('set', c.key, v)"
        @promote="emit('promote', c)"
        @menu="(e) => emit('menu', e, c)"
        @go-to-collection="goToCollection?.()"
      />
    </template>
    <StudioSectionTree
      v-for="child in section.sections"
      :key="child.title"
      :section="child"
      :value="value"
      :bound-for="boundFor"
      :go-to-collection="goToCollection"
      @set="(k, v) => emit('set', k, v)"
      @promote="(c) => emit('promote', c)"
      @menu="(e, c) => emit('menu', e, c)"
    >
      <!-- Forwarding every slot through each level of the recursion. Without it a
           bespoke control declared for a NESTED section resolves to no slot here, falls
           through to the plain StudioRow branch, and the surface's custom markup
           disappears with no error at all. -->
      <template v-for="(_, name) in $slots" #[name]="slotProps">
        <slot :name="name" v-bind="slotProps ?? {}" />
      </template>
    </StudioSectionTree>
    <slot :name="'section-' + section.title" />
  </StudioSection>
</template>
