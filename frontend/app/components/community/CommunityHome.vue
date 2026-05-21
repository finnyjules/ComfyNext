<script setup>
import { ref, watch, nextTick } from 'vue'
import { useCommunityNav } from '~/composables/useCommunityNav'
import CollectionGrid from '~/components/community/home/CollectionGrid.vue'
import GallerySection from '~/components/community/home/GallerySection.vue'
import CreatorShowcase from '~/components/community/home/CreatorShowcase.vue'
import CuratedCollections from '~/components/community/home/CuratedCollections.vue'
import WorkflowDetail from '~/components/community/workflow/WorkflowDetail.vue'
import CreatorDetail from '~/components/community/creator/CreatorDetail.vue'
import CollectionDetail from '~/components/community/collection/CollectionDetail.vue'

const { currentRoute } = useCommunityNav()

const containerRef = ref(null)

// Scroll to top when navigating between views
watch(currentRoute, () => {
  nextTick(() => {
    containerRef.value?.parentElement?.scrollTo(0, 0)
  })
})
</script>

<template>
  <div ref="containerRef" class="bg-background min-h-full">
    <!-- Workflow detail -->
    <WorkflowDetail
      v-if="currentRoute.view === 'workflow'"
      :key="currentRoute.slug"
      :slug="currentRoute.slug"
    />

    <!-- Creator detail -->
    <CreatorDetail
      v-else-if="currentRoute.view === 'creator'"
      :key="currentRoute.handle"
      :handle="currentRoute.handle"
    />

    <!-- Collection detail -->
    <CollectionDetail
      v-else-if="currentRoute.view === 'collection'"
      :key="currentRoute.collectionId"
      :collection-id="currentRoute.collectionId"
    />

    <!-- Home (default) -->
    <template v-else>
      <!-- Hero headline -->
      <section class="py-12 pb-8 bg-background text-center">
        <div class="mx-auto max-w-[1075px] px-4">
          <h1 class="text-[clamp(1.5rem,4vw,2.25rem)] font-normal text-foreground leading-tight m-0">
            Discover hundreds of templates from the world's best creators.<br />
            Run them for <strong class="font-semibold">free</strong> on Comfy Cloud
          </h1>
        </div>
      </section>

      <CollectionGrid />
      <GallerySection />
      <CreatorShowcase />
      <CuratedCollections />
    </template>
  </div>
</template>
