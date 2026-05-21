<script setup>
import { computed, ref } from 'vue'
import { useStore } from '@nanostores/vue'
import { $favoriteIds, toggleFavorite } from '~/composables/community/auth.js'
import { formatNumber } from '~/lib/community/formatters.js'
import { getWorkflowBySlug } from '~/data/community/workflowService.js'
import WorkflowBadges from '~/components/community/workflow/WorkflowBadges.vue'
import WorkflowDescription from '~/components/community/workflow/WorkflowDescription.vue'
import WorkflowModels from '~/components/community/workflow/WorkflowModels.vue'
import WorkflowOutputGallery from '~/components/community/workflow/WorkflowOutputGallery.vue'
import BeforeAfterSlider from '~/components/community/ui/BeforeAfterSlider.vue'
import RelatedWorkflows from '~/components/community/RelatedWorkflows.vue'
import { useCommunityNav } from '~/composables/useCommunityNav'

const props = defineProps({
  slug: { type: String, required: true },
})

const { navigateTo, goBack: navBack } = useCommunityNav()
const { openTab } = useTabs()

const workflow = computed(() => getWorkflowBySlug(props.slug))

const bannerImage = computed(() =>
  workflow.value?.outputImages?.[0]?.url || workflow.value?.thumbnailUrl
)

const hasBeforeAfter = computed(() => workflow.value?.hasBeforeAfter === true)

const createdAgo = computed(() => {
  if (!workflow.value?.createdAt) return ''
  const diff = Date.now() - new Date(workflow.value.createdAt).getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  if (days < 1) return 'today'
  if (days === 1) return '1d ago'
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return months === 1 ? '1mo ago' : `${months}mo ago`
})

const favoriteIds = useStore($favoriteIds)
const isFavorited = computed(() =>
  workflow.value ? favoriteIds.value.has(workflow.value.id) : false
)

function goBack() {
  navBack()
}

const isLoadingWorkflow = ref(false)

async function openWorkflow() {
  if (!workflow.value) return
  const wf = workflow.value

  isLoadingWorkflow.value = true

  try {
    // Fetch the real workflow JSON from comfy.org
    const res = await fetch(`https://comfy.org/workflows/${wf.slug}.json`)
    if (!res.ok) throw new Error(`Failed to fetch workflow: ${res.status}`)
    const workflowJson = await res.json()

    // Open a new project tab with the workflow title
    const tab = openTab({ type: 'project', label: wf.title })

    // Dispatch event so the layout can store the workflow for this tab
    window.dispatchEvent(new CustomEvent('comfynext:loadTabWorkflow', {
      detail: { tabId: tab.id, workflow: workflowJson },
    }))
  } catch (err) {
    console.error('Failed to load workflow:', err)
  } finally {
    isLoadingWorkflow.value = false
  }
}

function handleFavorite() {
  if (workflow.value) toggleFavorite(workflow.value.id)
}
</script>

<template>
  <div v-if="workflow" class="comfyhub">
    <div class="relative bg-background">
      <!-- Blurred background image — covers top 50vh with progressive fade -->
      <div class="absolute top-0 left-0 right-0 h-[50vh] overflow-hidden z-0 pointer-events-none" style="mask-image: linear-gradient(to bottom, black 40%, transparent); -webkit-mask-image: linear-gradient(to bottom, black 40%, transparent);">
        <img
          :src="bannerImage"
          alt=""
          class="w-full h-full object-cover blur-[80px] opacity-30 scale-125"
          aria-hidden="true"
        />
      </div>

      <!-- Back button -->
      <div class="relative z-[1] mx-auto max-w-7xl px-6 pt-4 pb-2">
        <UiButton
          variant="ghost"
          size="sm"
          class="gap-1 text-muted-foreground hover:text-foreground"
          @click="goBack"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </UiButton>
      </div>

      <!-- Main two-column layout -->
      <section class="relative z-[1] pb-10 md:pb-6">
        <div class="mx-auto max-w-7xl px-6">
          <div class="grid grid-cols-[2fr_1fr] gap-10 items-start">
            <!-- Left column: hero image + output gallery -->
            <div class="flex flex-col gap-4">
              <BeforeAfterSlider
                v-if="hasBeforeAfter && workflow.outputImages?.length >= 2"
                :beforeImage="workflow.outputImages[1].url"
                :afterImage="workflow.outputImages[0].url"
              />
              <img
                v-else
                :src="bannerImage"
                :alt="workflow.title"
                class="w-full object-cover rounded-xl"
              />

              <WorkflowOutputGallery
                v-if="!hasBeforeAfter && workflow.outputImages?.length > 1"
                :images="workflow.outputImages.slice(1)"
              />
            </div>

            <!-- Right column: sticky meta + sidebar -->
            <div class="sticky top-0 self-start h-screen overflow-y-auto flex flex-col justify-center gap-6 scrollbar-none">
              <WorkflowBadges
                :isStaffPick="workflow.isStaffPick"
                :isFeatured="workflow.isFeatured"
                :categoryLabel="workflow.categoryLabel"
              />

              <h1 class="text-xl font-semibold text-foreground leading-tight tracking-tight">
                {{ workflow.title }}
              </h1>

              <div class="flex items-center gap-2">
                <img
                  :src="workflow.creator.avatarUrl"
                  :alt="workflow.creator.displayName"
                  class="size-4 rounded-full object-cover"
                />
                <a
                  href="#"
                  class="text-xs text-foreground hover:text-comfy-yellow transition-colors no-underline"
                  @click.prevent="navigateTo({ view: 'creator', handle: workflow.creator.handle?.replace('@', '') || workflow.creator.id, label: workflow.creator.displayName })"
                >
                  {{ workflow.creator.displayName }}
                </a>
                <span class="text-xs text-foreground ml-auto">{{ createdAgo }}</span>
              </div>

              <WorkflowDescription
                :shortDescription="workflow.shortDescription"
                :description="workflow.description"
              />

              <!-- Action buttons -->
              <div class="flex items-center gap-3 flex-wrap">
                <UiButton
                  :disabled="isLoadingWorkflow"
                  class="bg-[#0b8ce9] text-white hover:bg-[#0a7dd1] gap-2"
                  @click="openWorkflow"
                >
                  <svg v-if="!isLoadingWorkflow" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
                    <polygon points="6,3 20,12 6,21" />
                  </svg>
                  {{ isLoadingWorkflow ? 'Loading...' : 'Open Template' }}
                </UiButton>

                <UiButton
                  variant="secondary"
                  class="bg-[#262729] text-white hover:bg-[#333537] gap-2"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                    <line x1="14.5" y1="4" x2="9.5" y2="20" />
                  </svg>
                  Download .json
                </UiButton>

                <UiButton
                  variant="ghost"
                  class="bg-[#262729] gap-2 text-muted-foreground/70 hover:text-destructive"
                  :class="{ 'text-destructive': isFavorited }"
                  @click="handleFavorite"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" :fill="isFavorited ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                  </svg>
                  <span class="text-xs font-normal opacity-80 px-2 py-1 rounded-full">
                    {{ formatNumber(workflow.stats?.favorites ?? 0) }}
                  </span>
                </UiButton>
              </div>

              <div class="flex flex-col gap-1">
                <div class="flex items-baseline gap-2">
                  <span class="text-sm font-bold text-foreground">{{ formatNumber(workflow.stats?.views ?? workflow.stats?.runs ?? 0) }}</span>
                  <span class="text-sm text-muted-foreground/70">views</span>
                </div>
                <div class="flex items-baseline gap-2">
                  <span class="text-sm font-bold text-foreground">{{ formatNumber(workflow.stats?.runs ?? 0) }}</span>
                  <span class="text-sm text-muted-foreground/70">runs</span>
                </div>
              </div>

              <WorkflowModels
                :baseModel="workflow.baseModel"
                :dependencies="workflow.dependencies"
              />

              <!-- Tag pills -->
              <div v-if="workflow.tags?.length" class="flex gap-3 flex-wrap">
                <span
                  v-for="tag in workflow.tags"
                  :key="tag"
                  class="inline-flex items-center justify-center px-2 py-1 rounded-full text-xs text-foreground bg-[#262729]"
                >
                  #{{ tag }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Related workflows (full-width) -->
      <section class="relative z-[1] py-10 md:py-6">
        <div class="mx-auto max-w-7xl px-4">
          <RelatedWorkflows
            :workflowId="workflow.id"
            :category="workflow.category"
            :creatorId="workflow.creator.id"
          />
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* Hide scrollbar on sticky sidebar */
.scrollbar-none {
  scrollbar-width: none;
}
.scrollbar-none::-webkit-scrollbar {
  display: none;
}
</style>
