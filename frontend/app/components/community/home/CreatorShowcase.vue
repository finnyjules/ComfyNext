<script setup>
import { ref, onMounted } from 'vue'
import { getCreator, getCreatorWorkflows } from '~/data/community/creatorService.js'
import { useScrollAnimation } from '~/composables/community/useScrollAnimation.js'
import { useCommunityNav } from '~/composables/useCommunityNav'
import WorkflowCard from '~/components/community/workflow/WorkflowCard.vue'

const { navigateTo } = useCommunityNav()

function openCreator(creator) {
  navigateTo({
    view: 'creator',
    handle: creator.handle.replace('@', ''),
    label: creator.displayName,
  })
}

const FEATURED_HANDLES = ['hellorob', 'PurzBeats', '8bit_e']

const rows = ref([])

onMounted(() => {
  rows.value = FEATURED_HANDLES.map((handle) => {
    const creator = getCreator(handle)
    if (!creator) return null
    const { data } = getCreatorWorkflows(creator.id, { page: 1, limit: 3, sort: 'popular' })
    return { creator, workflows: data }
  }).filter(Boolean)

  // Stagger rows in on scroll
  if (sectionRef.value) {
    staggerChildren(sectionRef.value, '.creator-showcase__row', { y: 30 })
  }
})

const sectionRef = ref(null)
const { staggerChildren } = useScrollAnimation()
</script>

<template>
  <section ref="sectionRef" class="py-16 pb-20 max-md:py-10 max-md:pb-12 bg-background">
    <div class="mx-auto max-w-7xl px-4">
      <h2 class="text-[clamp(1.5rem,4vw,2.25rem)] font-normal text-foreground leading-tight mb-12 max-md:mb-8 text-center">Discover the world's best creators</h2>

      <div
        v-for="row in rows"
        :key="row.creator.id"
        class="creator-showcase__row grid grid-cols-[280px_1fr] gap-8 items-start py-8 max-lg:grid-cols-1 max-lg:gap-6"
      >
        <!-- Creator info -->
        <div class="flex flex-col items-start gap-3 max-lg:flex-row max-lg:gap-4">
          <a
            href="#"
            class="shrink-0 rounded-full focus-visible:ring-2 focus-visible:ring-ring"
            @click.prevent="openCreator(row.creator)"
          >
            <UiAvatar class="size-14">
              <UiAvatarImage :src="row.creator.avatarUrl" :alt="row.creator.displayName" />
              <UiAvatarFallback>{{ row.creator.displayName?.charAt(0) ?? '?' }}</UiAvatarFallback>
            </UiAvatar>
          </a>

          <div class="flex flex-col gap-1">
            <a
              href="#"
              class="text-lg font-semibold text-foreground no-underline transition-colors duration-150 tracking-tight hover:text-palette-yellow/80"
              @click.prevent="openCreator(row.creator)"
            >
              {{ row.creator.displayName }}
            </a>
            <span class="text-sm text-muted-foreground/70">{{ row.creator.handle }}</span>
            <p class="text-sm text-muted-foreground leading-normal mt-1 line-clamp-3 max-lg:line-clamp-2">{{ row.creator.bio }}</p>

            <a
              href="#"
              class="inline-flex items-center gap-1 mt-2 text-sm font-medium text-palette-yellow/80 no-underline transition-all duration-150 hover:text-palette-yellow hover:gap-2"
              @click.prevent="openCreator(row.creator)"
            >
              View profile
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
              </svg>
            </a>
          </div>
        </div>

        <!-- Creator's workflows (3 cards) -->
        <div class="grid grid-cols-3 gap-4 max-md:grid-cols-2 max-sm:grid-cols-1">
          <WorkflowCard
            v-for="wf in row.workflows"
            :key="wf.id"
            :workflow="wf"
            variant="compact"
          />
        </div>
      </div>
    </div>
  </section>
</template>
