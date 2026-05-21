<script setup>
import { getRelated } from '~/data/community/workflowService.js'
import { getCreatorById } from '~/data/community/creatorService.js'
import WorkflowCard from '~/components/community/workflow/WorkflowCard.vue'

const props = defineProps({
  workflowId: { type: String, required: true },
  category: { type: String, required: true },
  creatorId: { type: String, required: true },
})

const { similar, byCreator } = getRelated(props.workflowId, props.category, props.creatorId, 4)
const creator = getCreatorById(props.creatorId)
</script>

<template>
  <div class="flex flex-col gap-16">
    <!-- More from @creator -->
    <section v-if="byCreator.length" class="flex flex-col gap-6">
      <div class="flex items-center gap-3">
        <img
          v-if="creator"
          :src="creator.avatarUrl"
          :alt="creator.displayName"
          class="w-6 h-6 rounded-full object-cover shrink-0"
        />
        <h2 class="font-semibold text-foreground" style="font-size: 20px">
          More from {{ creator ? `@${creator.handle.replace('@', '')}` : 'this creator' }}
        </h2>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-8">
        <WorkflowCard
          v-for="w in byCreator"
          :key="w.id"
          :workflow="w"
          variant="compact"
        />
      </div>
    </section>

    <!-- Similar workflows -->
    <section v-if="similar.length" class="flex flex-col gap-6">
      <h2 class="font-semibold text-foreground" style="font-size: 20px">Similar templates</h2>
      <div class="grid grid-cols-1 sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-8">
        <WorkflowCard
          v-for="w in similar"
          :key="w.id"
          :workflow="w"
          variant="compact"
        />
      </div>
    </section>
  </div>
</template>
