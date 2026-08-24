<script setup lang="ts">
/**
 * Renders one already-grouped Section and its children. Recursive, and takes a
 * Section rather than a control list + order so grouping happens exactly once, in
 * StudioControlPanel — a second pass would have to re-derive each child's group from
 * its path, which is how a nested control quietly vanishes.
 */
import { computed } from 'vue'
import type { ControlSpec } from '~/lib/spacetype/effect'
import type { Section } from '~/lib/studio/sections'
import { controlKindToVariableType } from '~/lib/collection/studioBindables'
import StudioSection from '~/components/vue-canvas/StudioSection.vue'
import StudioRow from '~/components/vue-canvas/studio/StudioRow.vue'
import StudioSwitch from '~/components/vue-canvas/studio/StudioSwitch.vue'

defineOptions({ name: 'StudioSectionTree' })

const props = defineProps<{
  section: Section<ControlSpec>
  value: (key: string) => string | number | boolean
  boundFor?: (key: string) => string | null
  goToCollection?: () => void
  /** Per-section chrome overrides, keyed by section title (the `group` path's last
   *  segment as rendered). Applied to the matching StudioSection's badge/open props;
   *  `sectionToggle` keeps priority over a chrome `open` — a toggle-driven section's
   *  open state is always the toggle's value. */
  sections?: Record<string, { badge?: string; open?: boolean }>
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

/**
 * A control marked `sectionToggle` moves into the section's header instead of being a
 * body row, and the section then opens and closes with it — a section you switch on.
 * The chevron still works independently, so a disabled section can be opened and set
 * up before it is enabled.
 *
 * Sections without one are unaffected and stay open, exactly as before.
 */
const toggle = computed(() => props.section.controls.find(c => c.sectionToggle) ?? null)
const bodyControls = computed(() => props.section.controls.filter(c => !c.sectionToggle))
</script>

<template>
  <StudioSection
    :title="section.title"
    :open="toggle ? value(toggle.key) === true : (sections?.[section.title]?.open ?? true)"
    :badge="sections?.[section.title]?.badge"
  >
    <template v-if="toggle" #badge>
      <!-- .stop lives in StudioSwitch's own click handler, so flipping the switch does
           not also toggle the <details> it sits in the summary of. -->
      <StudioSwitch
        :model-value="value(toggle.key) === true"
        @update:model-value="(v: boolean) => emit('set', toggle!.key, v)"
      />
    </template>
    <template v-for="c in bodyControls" :key="c.key">
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
        :bindable="c.bindable !== false && controlKindToVariableType(c.kind) !== null"
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
      :sections="sections"
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
