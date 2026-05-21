<script setup>
import { computed } from 'vue'
import { ArrowLeft } from 'lucide-vue-next'
import { useCommunityNav } from '~/composables/useCommunityNav'
import { collections } from '~/data/community/collections.js'
import { getCollectionWorkflows, getCollectionCreators } from '~/data/community/workflowService.js'
import { getCreatorById } from '~/data/community/creatorService.js'
import WorkflowCard from '~/components/community/workflow/WorkflowCard.vue'

const props = defineProps({
  collectionId: { type: String, required: true },
})

const { navigateTo, goBack: navBack } = useCommunityNav()

const collection = computed(() => collections.find((c) => c.id === props.collectionId))

const workflows = computed(() => getCollectionWorkflows(props.collectionId, 9999))

const creatorSections = computed(() => {
  const creatorIds = getCollectionCreators(props.collectionId, 5)
  return creatorIds
    .map((id) => {
      const creator = getCreatorById(id)
      if (!creator) return null
      const creatorWorkflows = workflows.value
        .filter((w) => w.creator.id === id)
        .slice(0, 3)
      if (!creatorWorkflows.length) return null
      return { creator, workflows: creatorWorkflows }
    })
    .filter(Boolean)
})

function goBack() {
  navBack()
}

function viewCreator(creator) {
  navigateTo({ view: 'creator', handle: creator.handle, label: creator.displayName })
}
</script>

<template>
  <div v-if="collection" class="bg-background min-h-full">
    <!-- Header -->
    <section class="mx-auto max-w-7xl px-4 pt-10 pb-8">
      <button
        class="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6 cursor-pointer bg-transparent border-0 p-0"
        @click="goBack"
      >
        <ArrowLeft class="size-4" />
        Back
      </button>

      <h1 class="text-foreground font-semibold leading-tight m-0" style="font-size: 32px">
        ComfyUI for {{ collection.title }}
      </h1>
      <p class="text-muted-foreground mt-3 mb-2 max-w-2xl leading-relaxed" style="font-size: 16px">
        {{ collection.description }}
      </p>
      <span class="text-sm text-muted-foreground">{{ workflows.length }} workflows</span>
    </section>

    <!-- Workflow grid -->
    <section class="mx-auto max-w-7xl px-4 pb-16">
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        <WorkflowCard
          v-for="w in workflows"
          :key="w.id"
          :workflow="w"
          variant="compact"
        />
      </div>
    </section>

    <!-- Creators section -->
    <section v-if="creatorSections.length" class="mx-auto max-w-7xl px-4 pb-20">
      <h2 class="text-foreground text-center font-normal mb-12" style="font-size: 24px">
        {{ collection.title }} Creators using ComfyUI
      </h2>

      <div class="flex flex-col gap-16">
        <div
          v-for="{ creator, workflows: creatorWorkflows } in creatorSections"
          :key="creator.id"
          class="grid grid-cols-[280px_1fr] max-lg:grid-cols-1 gap-8 items-start"
        >
          <!-- Creator info -->
          <div class="flex flex-col gap-3">
            <img
              :src="creator.avatarUrl"
              :alt="creator.displayName"
              class="w-14 h-14 rounded-full object-cover"
            />
            <div>
              <h3 class="text-foreground font-semibold m-0" style="font-size: 18px">
                {{ creator.displayName }}
              </h3>
              <p class="text-muted-foreground text-sm m-0">
                {{ creator.handle }}
              </p>
            </div>
            <p class="text-muted-foreground text-sm leading-relaxed m-0 line-clamp-3">
              {{ creator.bio }}
            </p>
            <button
              class="text-sm font-medium text-[#F0FF41] hover:text-[#f5ff7a] transition-colors bg-transparent border-0 p-0 cursor-pointer text-left"
              @click="viewCreator(creator)"
            >
              View profile &rarr;
            </button>
          </div>

          <!-- Creator's workflows -->
          <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
            <WorkflowCard
              v-for="w in creatorWorkflows"
              :key="w.id"
              :workflow="w"
              variant="compact"
            />
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
