<script setup lang="ts">
/** Dev harness: the Smart Layout grid editor mounted on a v3 (sectioned)
 * template, to verify section frames render and move/resize across formats.
 * Not linked anywhere in the product — reachable only at /dev/v3editor. */
import GridEditorShell from '~/components/templates/GridEditorShell.vue'
import { v3Demo } from '~~/shared/template-grid/starter'

const initial = v3Demo()
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
