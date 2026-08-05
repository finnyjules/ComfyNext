<script setup lang="ts">
// Prop-driven entry point for a boolean row. `label` is optional: the switch is
// still used bare as a StudioSection #badge and inside surfaces' own label rows,
// where there is no row to draw — so with no label this renders RowSwitch, the same
// component the schema-driven row uses for its value side. The markup used to be
// duplicated byte for byte between the two files; now there is one copy.
//
// The delegation only goes this way. RowSwitch must never render StudioSwitch: the
// labelled branch below renders StudioRow, which resolves `switch` to RowSwitch, and
// that cycle would not terminate.
import { computed } from 'vue'
import type { ControlSpec } from '~/lib/spacetype/effect'
import StudioRow from './StudioRow.vue'
import RowSwitch from './rows/RowSwitch.vue'

const model = defineModel<boolean>({ required: true })
const props = defineProps<{ label?: string; bound?: string | null }>()

const spec = computed(() => ({
  key: 'inline', label: props.label ?? '', kind: 'switch', default: false, group: '',
} as ControlSpec))
</script>

<template>
  <RowSwitch
    v-if="!label"
    :value="model" :spec="spec" :step="1" :editing="false"
    @update:value="(v: boolean) => (model = v)"
  />
  <StudioRow
    v-else
    :spec="spec" :model-value="model" :bound="bound ?? null"
    @update:model-value="(v) => (model = Boolean(v))"
  />
</template>
