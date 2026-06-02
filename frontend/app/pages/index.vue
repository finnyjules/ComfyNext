<script setup lang="ts">
import {
  Image as ImageIcon,
  Video,
  Box,
  Music,
  Mic,
  Plus,
  ArrowRight,
  ChevronUp,
  ChevronDown,
  ExternalLink,
  Play,
  UserRoundCog,
  MessageSquareQuote,
  Music as MusicIcon,
  Package,
} from 'lucide-vue-next'
import { getNewest } from '~/data/community/workflowService.js'
import { formatNumber } from '~/lib/community/formatters.js'
import { useCommunityNav } from '~/composables/useCommunityNav'

const { openTab } = useTabs()
const { navigateTo: navCommunity } = useCommunityNav()
const { recentProjects, loading: recentLoading, thumbnailUrl, timeAgo, fetchRecentProjects } = useRecentProjects()

onMounted(() => fetchRecentProjects())

function openRecentProject(project: any) {
  const promptId = project.promptIds[0]
  openTab({ type: 'project', label: project.name, workflowId: project.workflowId, promptId, projectUuid: project.workflowId })
  // onProjectIframeLoad in default.vue handles loading the workflow from history
}

const projectTypes = [
  { label: 'Create an image...', icon: ImageIcon, color: '#96b4ff' },
  { label: 'Create a video...', icon: Video, color: '#54f4cf' },
  { label: 'Create a 3D model...', icon: Box, color: '#ffb984' },
  { label: 'Create a song...', icon: Music, color: '#ff99f7' },
  { label: 'Create a voiceover...', icon: Mic, color: '#ff6259' },
]

// Background SVGs for template cards (bg_1.svg to bg_18.svg)
const BG_COUNT = 18

// Fetch newest ComfyUI templates (scraped from comfy.org, creator.id === 'cr_comfyui')
const comfyTemplates = computed(() => {
  const newest = getNewest(30)
  return newest.filter((w: any) => w.creator?.id === 'cr_comfyui').slice(0, 12)
})


// Catalog of apps surfaced on the home page. Order = display order.
// `accent` matches the domain palette from pages/index.vue prompt chips
// (image #96b4ff, audio #ff99f7, video #54f4cf).
const appCards = [
  {
    id: 'face-swap',
    label: 'Face Swap',
    domain: 'Image',
    icon: UserRoundCog,
    accent: '#96b4ff',
    description: 'Put any face into any photo. Drop two photos, click run.',
  },
  {
    id: 'auto-subtitle',
    label: 'Auto Subtitle',
    domain: 'Video',
    icon: MessageSquareQuote,
    accent: '#54f4cf',
    description: 'Drop a talking video, get captions burned in automatically.',
  },
  {
    id: 'karaoke-maker',
    label: 'Karaoke Maker',
    domain: 'Audio',
    icon: MusicIcon,
    accent: '#ff99f7',
    description: 'Split any song into instrumental and a-cappella stems.',
  },
  {
    id: 'product-shot',
    label: 'Product Shot',
    domain: 'Image',
    icon: Package,
    accent: '#ffb55c',
    description: 'Drop a product photo, describe a scene — get a studio-quality shot.',
  },
] as const

// Deterministic but varied background index for a given key (1..BG_COUNT).
function bgIndexFor(key: string): number {
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0
  return (((hash % BG_COUNT) + BG_COUNT) % BG_COUNT) + 1
}

// Assign background indices without consecutive repeats (seeded by slug for stability)
const templateBgIndices = computed(() => {
  const indices: number[] = []
  let lastIdx = -1
  for (const t of comfyTemplates.value) {
    let idx = bgIndexFor(t.slug) - 1
    if (idx === lastIdx) idx = (idx + 1) % BG_COUNT
    indices.push(idx + 1)
    lastIdx = idx
  }
  return indices
})

function openTemplateCommunity(workflow: any) {
  openTab({ type: 'community' })
  nextTick(() => {
    navCommunity({ view: 'workflow', slug: workflow.slug, label: workflow.title })
  })
}

function openTemplateProject(workflow: any) {
  openTab({ type: 'project', label: workflow.title })
}

function isVideo(filename: string): boolean {
  return /\.(mp4|webm|mov|avi)$/i.test(filename)
}
</script>

<template>
  <div class="overflow-y-auto px-12 py-8 space-y-16">
    <!-- Section 1: Hero Feature Banner -->
    <div
      class="relative w-full h-[242px] rounded-[16px] bg-[#52367b] overflow-hidden"
    >
      <!-- Decorative background shapes -->
      <div
        class="absolute inset-0 opacity-20"
      >
        <div class="absolute top-8 left-8 w-40 h-28 rounded-[12px] border border-white/30 rotate-[-8deg]" />
        <div class="absolute top-16 left-32 w-48 h-32 rounded-[12px] border border-white/20 rotate-[4deg]" />
        <div class="absolute bottom-4 left-16 w-36 h-24 rounded-[12px] border border-white/25 rotate-[-3deg]" />
        <div class="absolute top-4 left-52 w-24 h-16 rounded-[8px] bg-white/10 rotate-[6deg]" />
        <div class="absolute bottom-8 left-48 w-32 h-20 rounded-[8px] bg-white/10 rotate-[-5deg]" />
      </div>

      <!-- Right side content -->
      <div class="absolute right-16 top-1/2 -translate-y-1/2 flex flex-col items-start gap-3 max-w-[45%]">
        <span
          class="inline-block rounded-full bg-[rgba(16,16,16,0.4)] backdrop-blur px-[10px] py-[4px] text-xs font-medium text-white"
        >
          New feature
        </span>
        <h1 class="text-[48px] font-extrabold tracking-tight text-white leading-none">
          GATES
        </h1>
        <div class="space-y-0.5">
          <p class="text-xs font-medium text-white">
            With Gates, you can now divide your workflow into steps.
          </p>
          <p class="text-xs font-medium text-white">
            Control generations every step of the way.
          </p>
        </div>
        <button
          class="flex items-center gap-2 rounded-[4px] bg-white text-[#18181b] h-[36px] px-4 text-sm font-medium hover:bg-white/90 transition-colors cursor-pointer"
        >
          Open workflow example
          <ArrowRight class="size-4" />
        </button>
      </div>

      <!-- Carousel indicator -->
      <div class="absolute right-4 top-1/2 -translate-y-1/2 flex flex-col items-center gap-2">
        <button class="text-white/60 hover:text-white transition-colors cursor-pointer">
          <ChevronUp class="size-4" />
        </button>
        <div class="flex flex-col gap-1.5">
          <div class="w-1.5 h-1.5 rounded-full bg-white" />
          <div class="w-1.5 h-1.5 rounded-full bg-white/40" />
          <div class="w-1.5 h-1.5 rounded-full bg-white/40" />
        </div>
        <button class="text-white/60 hover:text-white transition-colors cursor-pointer">
          <ChevronDown class="size-4" />
        </button>
      </div>
    </div>

    <!-- Section 2: Start a Project -->
    <div>
      <h2 class="text-[20px] font-medium text-white tracking-[0.2px] mb-4">
        Start a project
      </h2>
      <div class="flex gap-3 overflow-x-auto">
        <button
          v-for="pt in projectTypes"
          :key="pt.label"
          class="flex items-center gap-3 h-[69px] flex-1 min-w-0 rounded-[4px] px-8 shadow-[0px_1px_3px_0px_rgba(0,0,0,0.1),0px_1px_2px_0px_rgba(0,0,0,0.06)] cursor-pointer transition-opacity hover:opacity-90"
          :style="{
            background: `linear-gradient(90deg, ${pt.color}33, ${pt.color}33), linear-gradient(90deg, #fafafa, #fafafa)`,
          }"
        >
          <div
            class="flex items-center justify-center rounded-[8px] p-1 border-[0.5px] border-white"
            :style="{ backgroundColor: pt.color }"
          >
            <component :is="pt.icon" class="size-6 text-white" />
          </div>
          <span class="text-sm font-medium text-[#18181b] whitespace-nowrap">
            {{ pt.label }}
          </span>
        </button>

        <!-- Blank project button -->
        <button
          class="flex items-center gap-2 h-[69px] flex-1 min-w-0 rounded-[4px] px-8 bg-[#fafafa] shadow-[0px_1px_3px_0px_rgba(0,0,0,0.1),0px_1px_2px_0px_rgba(0,0,0,0.06)] cursor-pointer transition-opacity hover:opacity-90"
          @click="openTab({ type: 'project' })"
        >
          <Plus class="size-4 text-[#18181b]" />
          <span class="text-sm font-medium text-[#18181b] whitespace-nowrap">
            Start a blank project
          </span>
        </button>
      </div>
    </div>

    <!-- Section 2b: Apps — polished, single-purpose surfaces built on the node engine.
         Distinct from "Starter workflows" below: apps you RUN, workflows you EDIT. -->
    <div>
      <div class="flex justify-between items-center mb-1">
        <h2 class="text-[20px] font-medium text-white tracking-[0.2px]">
          Apps
        </h2>
      </div>
      <p class="text-[13px] text-white/45 mb-4">
        One-click tools for specific jobs. No canvas, no nodes — drop inputs, hit run.
      </p>
      <div class="grid grid-cols-3 gap-4">
        <button
          v-for="app in appCards"
          :key="app.id"
          class="group relative flex flex-col items-stretch h-[180px] rounded-[12px] overflow-hidden border border-white/[0.06] hover:border-white/15 transition-colors cursor-pointer text-left"
          @click="openTab({ type: 'app', label: app.label, appId: app.id })"
        >
          <img
            :src="`/grid_bg/bg_${bgIndexFor(app.id)}.svg`"
            alt=""
            class="absolute inset-0 w-full h-full object-cover"
          />
          <div class="absolute inset-0 bg-gradient-to-t from-black/75 via-black/35 to-black/15 pointer-events-none" />
          <div class="absolute top-0 left-0 right-0 h-[3px]" :style="{ backgroundColor: app.accent }" />

          <div class="relative flex-1 flex items-center justify-center">
            <div class="size-14 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center ring-1 ring-white/10">
              <component :is="app.icon" class="size-7" :style="{ color: app.accent }" :stroke-width="1.5" />
            </div>
          </div>

          <div class="relative p-4 pt-0">
            <div class="flex items-center justify-between mb-1">
              <div class="text-[14px] font-medium text-white drop-shadow-sm">{{ app.label }}</div>
              <span class="text-[10px] uppercase tracking-[0.12em] text-white/55 font-medium">{{ app.domain }}</span>
            </div>
            <p class="text-[12px] text-white/60 leading-snug line-clamp-2 drop-shadow-sm">
              {{ app.description }}
            </p>
          </div>
        </button>
      </div>
    </div>

    <!-- Section 3: Recent Projects -->
    <div>
      <div class="flex justify-between items-center mb-4">
        <div class="flex items-center gap-4">
          <h2 class="text-[20px] font-medium text-white tracking-[0.2px]">
            Recent projects
          </h2>
          <span class="text-[20px] font-medium text-white/40 tracking-[0.2px] cursor-pointer hover:text-white/60 transition-colors">
            Pinned projects
          </span>
        </div>
        <button class="flex items-center gap-1 text-sm text-white hover:text-white/80 transition-colors cursor-pointer">
          See all projects
          <ArrowRight class="size-3.5" />
        </button>
      </div>

      <!-- Loading state -->
      <div v-if="recentLoading" class="flex gap-[32px]">
        <div v-for="i in 5" :key="i" class="flex-shrink-0 w-[270px]">
          <div class="h-[180px] rounded-[16px] bg-[#1e1e1e] animate-pulse" />
          <div class="mt-3 space-y-2">
            <div class="h-4 w-32 bg-[#1e1e1e] rounded animate-pulse" />
            <div class="h-3 w-20 bg-[#1e1e1e] rounded animate-pulse" />
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div
        v-else-if="recentProjects.length === 0"
        class="flex items-center justify-center h-[180px] rounded-[16px] border border-[#2a2a2a] border-dashed"
      >
        <p class="text-sm text-white/30">No recent generations yet. Run a workflow to see results here.</p>
      </div>

      <!-- Real projects -->
      <div v-else class="flex gap-[32px] overflow-x-auto pb-2">
        <div
          v-for="project in recentProjects"
          :key="project.workflowId"
          class="flex-shrink-0 w-[270px] cursor-pointer group"
          @click="openRecentProject(project)"
        >
          <!-- Thumbnail mosaic: 1 large left + 2 small right from last 3 images -->
          <div class="h-[180px] rounded-[16px] bg-[#1e1e1e] overflow-hidden flex gap-px">
            <!-- Large asset (most recent) -->
            <template v-if="project.images[0]">
              <video
                v-if="isVideo(project.images[0].filename)"
                :src="thumbnailUrl(project.images[0])"
                class="w-[180px] h-full object-cover"
                muted loop autoplay playsinline
              />
              <img
                v-else
                :src="thumbnailUrl(project.images[0])"
                alt=""
                class="w-[180px] h-full object-cover"
                loading="lazy"
              />
            </template>
            <!-- Two smaller assets on the right -->
            <div v-if="project.images.length > 1" class="flex flex-col flex-1 gap-px">
              <template v-if="project.images[1]">
                <video
                  v-if="isVideo(project.images[1].filename)"
                  :src="thumbnailUrl(project.images[1])"
                  class="h-[90px] w-full object-cover"
                  muted loop autoplay playsinline
                />
                <img
                  v-else
                  :src="thumbnailUrl(project.images[1])"
                  alt=""
                  class="h-[90px] w-full object-cover"
                  loading="lazy"
                />
              </template>
              <template v-if="project.images[2]">
                <video
                  v-if="isVideo(project.images[2].filename)"
                  :src="thumbnailUrl(project.images[2])"
                  class="h-[90px] w-full object-cover"
                  muted loop autoplay playsinline
                />
                <img
                  v-else
                  :src="thumbnailUrl(project.images[2])"
                  alt=""
                  class="h-[90px] w-full object-cover"
                  loading="lazy"
                />
              </template>
              <div
                v-if="!project.images[2]"
                class="h-[90px] w-full bg-[#252525]"
              />
            </div>
          </div>
          <!-- Info -->
          <div class="mt-3 space-y-1">
            <p class="text-[16px] font-medium text-white group-hover:text-white/80 transition-colors truncate">
              {{ project.name }}
            </p>
            <p class="text-sm text-white/60">
              Last opened {{ timeAgo(project.lastTimestamp) }}
              <span v-if="project.runCount > 1" class="text-white/30">
                &middot; {{ project.runCount }} runs
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- Section 4: Starter workflows — pre-built graphs that open in the canvas
         for power users to inspect and customize. Sibling to Apps above. -->
    <div>
      <div class="flex justify-between items-center mb-1">
        <h2 class="text-[20px] font-medium text-white tracking-[0.2px]">
          Starter workflows
        </h2>
        <button
          class="flex items-center gap-1 text-sm text-white hover:text-white/80 transition-colors cursor-pointer"
          @click="openTab({ type: 'community' })"
        >
          Browse all
          <ArrowRight class="size-3.5" />
        </button>
      </div>
      <p class="text-[13px] text-white/45 mb-4">
        Pre-built node graphs to open in the canvas and customize. Good if you want to peek under the hood.
      </p>

      <div class="flex gap-6 overflow-x-auto pb-2">
        <div
          v-for="(template, index) in comfyTemplates"
          :key="template.id"
          class="template-card flex-shrink-0 w-[240px] rounded-[16px] overflow-hidden relative group"
        >
          <!-- Background SVG -->
          <img
            :src="`/grid_bg/bg_${templateBgIndices[index]}.svg`"
            alt=""
            class="absolute inset-0 w-full h-full object-cover"
          />

          <!-- Gradient overlay for text readability -->
          <div class="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent pointer-events-none" />

          <!-- Card content overlay -->
          <div class="relative flex flex-col h-full p-4">
            <!-- Thumbnail -->
            <div class="w-full aspect-square rounded-lg overflow-hidden shadow-lg mb-3">
              <img
                :src="template.thumbnailUrl"
                :alt="template.title"
                class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                loading="lazy"
              />
            </div>

            <!-- Info -->
            <div class="flex flex-col gap-1.5 flex-1">
              <h3 class="text-sm font-semibold text-white line-clamp-2 leading-tight drop-shadow-sm">
                {{ template.title }}
              </h3>
              <div class="flex items-center gap-1.5 mt-auto">
                <UiAvatar class="size-5">
                  <UiAvatarImage :src="template.creator.avatarUrl" :alt="template.creator.displayName" />
                  <UiAvatarFallback class="text-[9px]">C</UiAvatarFallback>
                </UiAvatar>
                <span class="text-[11px] text-white/70">{{ template.creator.displayName }}</span>
              </div>
              <div class="flex items-center gap-3 text-[11px] text-white/50">
                <span class="flex items-center gap-1">
                  <Play class="size-3" fill="currentColor" />
                  {{ formatNumber(template.stats.runs) }}
                </span>
                <span>{{ template.categoryLabel }}</span>
              </div>
            </div>

            <!-- Hover actions -->
            <div class="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity rounded-[16px]">
              <button
                class="flex items-center gap-2 h-9 px-5 bg-white text-[#18181b] text-sm font-medium rounded-md hover:bg-white/90 transition-colors cursor-pointer"
                @click.stop="openTemplateProject(template)"
              >
                <Play class="size-3.5" fill="currentColor" />
                Open template
              </button>
              <button
                class="flex items-center gap-2 h-9 px-5 bg-white/15 text-white text-sm font-medium rounded-md hover:bg-white/25 transition-colors cursor-pointer backdrop-blur-sm"
                @click.stop="openTemplateCommunity(template)"
              >
                <ExternalLink class="size-3.5" />
                View details
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
