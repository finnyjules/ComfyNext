<script setup>
import { ref, onMounted } from 'vue'
import { collections } from '~/data/community/collections.js'
import { getCollectionWorkflows } from '~/data/community/workflowService.js'
import WorkflowCard from '~/components/community/workflow/WorkflowCard.vue'
import { useScrollAnimation } from '~/composables/community/useScrollAnimation.js'

// Load 5 workflows per collection for homepage preview
const collectionsData = collections.map((c) => ({
  ...c,
  workflows: getCollectionWorkflows(c.id, 5),
}))

const sectionRef = ref(null)
const { staggerChildren } = useScrollAnimation()

onMounted(() => {
  // Stagger each collection row in
  if (sectionRef.value) {
    const rows = sectionRef.value.querySelectorAll('.collection-row')
    rows.forEach((row) => {
      staggerChildren(row, '.workflow-card', {
        y: 30,
        stagger: 0.08,
      })
    })
  }
})
</script>

<template>
  <section ref="sectionRef" class="py-16 md:py-20">
    <div class="mx-auto max-w-7xl px-4">
      <!-- One row per collection -->
      <div
        v-for="(col, index) in collectionsData"
        :key="col.id"
        class="collection-row"
        :class="{ 'mt-20': index > 0 }"
      >
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-xl font-semibold text-foreground">{{ col.title }} templates</h3>
          <a :href="`/collection/${col.id}`" class="inline-flex items-center gap-1 text-sm font-medium text-comfy-yellow/80 no-underline transition-colors duration-150 hover:text-comfy-yellow">
            View collection
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </a>
        </div>

        <div class="grid grid-cols-5 gap-5 max-xl:grid-cols-4 max-lg:grid-cols-3 max-md:grid-cols-2 max-sm:grid-cols-1">
          <WorkflowCard
            v-for="workflow in col.workflows"
            :key="workflow.id"
            :workflow="workflow"
            variant="compact"
          />
        </div>
      </div>
    </div>
  </section>
</template>
