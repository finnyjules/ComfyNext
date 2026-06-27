<script setup lang="ts">
/** Dev harness for the rehauled Smart Layout opening flow: a fresh (empty)
 * layout, so the FormatPicker shows first — pick formats → blank canvas →
 * add sections. Mirrors a freshly-dropped node. Reachable only at
 * /dev/v3editor; not linked in the product. */
import GridEditorShell from '~/components/templates/GridEditorShell.vue'
import { makeStarterTemplate } from '~~/shared/template-grid/starter'

const initial = makeStarterTemplate('dev-fresh')
</script>

<template>
  <div class="fixed inset-0 bg-[#0b0d12]">
    <GridEditorShell :initial="initial" />
  </div>
</template>
