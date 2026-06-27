<script setup lang="ts">
/** Dev harness for the v3 (sectioned) Smart Layout flow. Starts from a v2
 * template with content — exactly like the real node — so the "select →
 * Group → converts to v3 + section" path can be exercised. Reachable only at
 * /dev/v3editor; not linked in the product. */
import GridEditorShell from '~/components/templates/GridEditorShell.vue'
import type { TemplateV2 } from '~~/shared/template-grid/types'

const initial: TemplateV2 = {
  version: 2, id: 'dev-v2', name: 'Dev v2', master: '1x1',
  formats: {
    '1x1': { w: 1080, h: 1080, label: 'Square' },
    '9x16': { w: 1080, h: 1920, label: 'Story' },
    '16x9': { w: 1920, h: 1080, label: 'Wide' },
  },
  grid: { gutter: 24, margin: 72, baseline: 12 },
  typeScale: { base: 28, ratio: 1.414 },
  background: { fill: '#0E1116' },
  elements: [
    { id: 'headline', type: 'text', content: '{{ props.headline }}', level: 'display', priority: 1,
      region: { col: 1, colSpan: 5, row: 4, rowSpan: 1 },
      style: { color: '#F4F4F5', fontFamily: 'Anton', transform: 'uppercase' } },
    { id: 'subhead', type: 'text', content: '{{ props.subhead }}', level: 'subhead', priority: 2,
      region: { col: 1, colSpan: 5, row: 5, rowSpan: 1 },
      style: { color: '#34D399', fontFamily: 'Inter' } },
  ],
}
const initialProps = { headline: 'Brazil', subhead: 'Group G · Match Day 1' }
</script>

<template>
  <div class="fixed inset-0 bg-[#0b0d12]">
    <GridEditorShell
      :initial="initial"
      :initial-props="initialProps"
      aspects="1x1,9x16,16x9"
    />
  </div>
</template>
