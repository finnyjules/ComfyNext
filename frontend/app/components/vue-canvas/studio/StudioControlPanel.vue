<script setup lang="ts">
/**
 * Renders a studio's inspector from its ControlSpec[].
 *
 * Handles the three kinds every studio shares — slider, select, color — and hands
 * everything else to a named slot (`#control-<key>`). Bespoke blocks (repeaters,
 * palette pickers, motion editors, export panels) belong in `#section-<Title>`,
 * not in the schema; Space Type's `<template v-if="section.name === 'Camera'">`
 * is the precedent this follows.
 *
 * `StudioSlider` owns its own label row, value readout, and `VariableGlyph` — it's
 * passed straight through. `select` and `color` do NOT own that chrome: this
 * component reproduces the label row + glyph + "bound" pink read-only row for
 * both, matching what Texture/Space Type hand-wrote today.
 */
import { computed } from 'vue'
import type { ControlSpec } from '~/lib/spacetype/effect'
import { groupIntoSections } from '~/lib/studio/sections'
import { controlKindToVariableType } from '~/lib/collection/studioBindables'
import StudioSection from '~/components/vue-canvas/StudioSection.vue'
import StudioSlider from '~/components/vue-canvas/studio/StudioSlider.vue'
import StudioSelect from '~/components/vue-canvas/studio/StudioSelect.vue'
import StudioSegmented from '~/components/vue-canvas/studio/StudioSegmented.vue'
import StudioColor from '~/components/vue-canvas/studio/StudioColor.vue'
import VariableGlyph from '~/components/vue-canvas/studio/VariableGlyph.vue'

const props = withDefaults(defineProps<{
  controls: ControlSpec[]
  order: readonly string[]
  /** Current value for a control key. A reader function, not a params object —
   *  Texture's params is a flat record while Gradient/Shape use a dotted proxy. */
  value: (key: string) => string | number
  visible?: (c: ControlSpec) => boolean
  /** Bound collection column label for a key, or null if unbound. */
  boundFor?: (key: string) => string | null
  /** Selects with at most this many options render as segmented pills. 0 disables
   *  (Texture's current all-dropdown appearance); Space Type's rule is 3. */
  segmentedMax?: number
  /** Parameterless — dispatches the "open the wired collection" event. Only needed
   *  to reproduce the bound row's "Edit in table" button. */
  goToCollection?: () => void
}>(), { segmentedMax: 3 })

const emit = defineEmits<{
  (e: 'set', key: string, value: string | number): void
  (e: 'promote', control: ControlSpec): void
  (e: 'menu', event: MouseEvent, control: ControlSpec): void
}>()

const sections = computed(() => groupIntoSections(props.controls, props.order, props.visible))

function bound(key: string): string | null {
  return props.boundFor?.(key) ?? null
}
function isSegmented(c: ControlSpec): boolean {
  const options = (c as { options?: string[] }).options
  return props.segmentedMax! > 0 && (options?.length ?? 0) <= props.segmentedMax!
}
</script>

<template>
  <StudioSection v-for="s in sections" :key="s.title" :title="s.title">
    <div
      v-for="c in s.controls"
      :key="c.key"
      @contextmenu.prevent="emit('menu', $event, c)"
    >
      <slot :name="'control-' + c.key" :control="c">
        <template v-if="c.kind === 'slider'">
          <!-- StudioSlider uses defineModel<number> — bind with v-model semantics -->
          <StudioSlider
            :label="c.label"
            :min="Number(c.min)"
            :max="Number(c.max)"
            :step="Number(c.step)"
            :default="Number(c.default)"
            :model-value="Number(value(c.key))"
            :bindable="controlKindToVariableType(c.kind) !== null"
            :bound="bound(c.key)"
            @update:model-value="(v: number) => emit('set', c.key, v)"
            @promote="emit('promote', c)"
            @menu="(e: MouseEvent) => emit('menu', e, c)"
          />
        </template>
        <template v-else-if="c.kind === 'select'">
          <label class="mb-1 flex items-center gap-1.5 text-[11px] text-white/55 group">
            <span>{{ c.label }}</span>
            <VariableGlyph
              v-if="controlKindToVariableType(c.kind) !== null"
              :bound="bound(c.key)"
              @promote="emit('promote', c)"
              @menu="(e: MouseEvent) => emit('menu', e, c)"
            />
          </label>
          <!-- Bound: pink read-only row — the variable name, never the resolved
               literal value. Editing happens in the collection table. -->
          <div v-if="bound(c.key)" class="flex items-center justify-between gap-2 rounded bg-white/[0.04] px-2 py-1.5">
            <span class="truncate text-[12px]" style="color: var(--var-accent-text)">{{ bound(c.key) }}</span>
            <button type="button" @click="goToCollection?.()"
                    class="shrink-0 rounded px-2 py-1 text-[11px] text-white/60 hover:bg-white/10 hover:text-white">Edit in table</button>
          </div>
          <StudioSegmented
            v-else-if="isSegmented(c)"
            :options="c.options as string[]"
            :model-value="String(value(c.key))"
            @update:model-value="(v: string) => emit('set', c.key, v)"
          />
          <!-- StudioSelect uses defineModel<string> — bind with v-model semantics -->
          <StudioSelect
            v-else
            :options="c.options as string[]"
            :model-value="String(value(c.key))"
            @update:model-value="(v: string) => emit('set', c.key, v)"
          />
        </template>
        <template v-else-if="c.kind === 'color'">
          <div class="flex items-center gap-2">
            <label class="flex items-center gap-1.5 text-[11px] text-white/55 group">
              <span>{{ c.label }}</span>
              <VariableGlyph
                v-if="controlKindToVariableType(c.kind) !== null"
                :bound="bound(c.key)"
                @promote="emit('promote', c)"
                @menu="(e: MouseEvent) => emit('menu', e, c)"
              />
            </label>
            <!-- Bound: pink read-only row instead of the swatch/picker. -->
            <div v-if="bound(c.key)" class="flex flex-1 items-center justify-between gap-2 rounded bg-white/[0.04] px-2 py-1.5">
              <span class="truncate text-[12px]" style="color: var(--var-accent-text)">{{ bound(c.key) }}</span>
              <button type="button" @click="goToCollection?.()"
                      class="shrink-0 rounded px-2 py-1 text-[11px] text-white/60 hover:bg-white/10 hover:text-white">Edit in table</button>
            </div>
            <!-- StudioColor uses defineModel<string> — bind with v-model semantics -->
            <StudioColor
              v-else
              :model-value="String(value(c.key))"
              @update:model-value="(v: string) => emit('set', c.key, v)"
            />
          </div>
        </template>
      </slot>
    </div>
    <slot :name="'section-' + s.title" />
  </StudioSection>
</template>
