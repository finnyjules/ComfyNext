<script setup>
import { ref, onMounted } from 'vue'
import { collections } from '~/data/community/collections.js'
import { getCollectionWorkflows } from '~/data/community/workflowService.js'
import { useScrollAnimation } from '~/composables/community/useScrollAnimation.js'
import { useCommunityNav } from '~/composables/useCommunityNav'

const { navigateTo } = useCommunityNav()

// Order: VFX, Marketing, Gaming, Architecture, Animation, 3D, Fashion (4x2 grid)
const displayOrder = ['vfx', 'marketing', 'gaming', 'architecture', 'animation', '3d', 'fashion']

// Override cover images for specific collections
const coverOverrides = {
  vfx: 'https://www.comfy.org/workflows/thumbnails/api_grok_video-1.webp',
  marketing: 'https://www.comfy.org/workflows/thumbnails/templates-photo_to_product_vid-1.webp',
  gaming: 'https://www.comfy.org/workflows/thumbnails/api_rodin_image_to_model-1.webp',
  architecture: 'https://www.comfy.org/workflows/thumbnails/image_qwen_image_edit_2509-1.webp',
  animation: 'https://www.comfy.org/workflows/thumbnails/03_video_wan2_2_14B_i2v_subgraphed-1.webp',
  fashion: 'https://www.comfy.org/workflows/thumbnails/templates-fashion_shoot_vton-1.webp',
}

const collectionBlocks = displayOrder
  .map((id) => {
    const col = collections.find((c) => c.id === id)
    if (!col) return null
    const workflows = getCollectionWorkflows(id, 9999)
    return {
      ...col,
      count: workflows.length,
      image: coverOverrides[id] || workflows[0]?.thumbnailUrl || `https://picsum.photos/seed/${id}/600/400`,
    }
  })
  .filter(Boolean)

const gridRef = ref(null)
const { staggerChildren } = useScrollAnimation()

onMounted(() => {
  if (gridRef.value) {
    staggerChildren(gridRef.value, '.collection-grid__block', {
      y: 30,
      stagger: 0.06,
      duration: 0.5,
    })
  }
})
</script>

<template>
  <section class="pb-8 bg-background">
    <div class="mx-auto max-w-7xl px-4">
      <div ref="gridRef" class="grid grid-cols-4 gap-4 max-lg:grid-cols-2 max-sm:grid-cols-1">
        <button
          v-for="col in collectionBlocks"
          :key="col.id"
          class="collection-grid__block relative aspect-[3/1] rounded-xl overflow-hidden block no-underline group cursor-pointer border-0 p-0 text-left"
          @click="navigateTo({ view: 'collection', collectionId: col.id, label: col.title })"
        >
          <img
            :src="col.image"
            :alt="col.title"
            class="absolute inset-0 w-full h-full object-cover transition-transform duration-[400ms] ease-out group-hover:scale-105"
            loading="lazy"
          />
          <div class="collection-grid__overlay absolute inset-0 z-[1]" />
          <div class="absolute bottom-0 left-0 right-0 px-5 py-4 z-[2] flex items-baseline justify-between gap-2">
            <span class="text-lg font-semibold text-white tracking-tight">{{ col.title }}</span>
            <span class="text-xs text-white/70 whitespace-nowrap">{{ col.count }} templates</span>
          </div>
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* Gradient overlay for readability */
.collection-grid__overlay {
  background: linear-gradient(
    to top,
    rgba(0, 0, 0, 0.75) 0%,
    rgba(0, 0, 0, 0.15) 50%,
    rgba(0, 0, 0, 0.05) 100%
  );
}
</style>
