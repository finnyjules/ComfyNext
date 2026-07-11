<script setup lang="ts">
import {
  House,
  Globe,
  LayoutGrid,
  Image,
  CircleHelp,
  Settings,
  Wand,
  Palette,
} from 'lucide-vue-next'

const route = useRoute()

const navItems = [
  { icon: House, label: 'Home', to: '/' },
  { icon: LayoutGrid, label: 'Projects', action: 'openAllProjects' },
  { icon: Image, label: 'Assets', action: 'openAssets' },
  { icon: Palette, label: 'Brand', action: 'openBrand' },
  { icon: Wand, label: 'Create a Style', action: 'openTrain' },
  { icon: Globe, label: 'Community', action: 'openCommunity' },
]

const bottomItems = [
  { icon: CircleHelp, label: 'Help', to: '/help' },
]

function isActive(to: string) {
  return route.path === to
}

const { setActiveTab, openTab, activeTab } = useTabs()
const { openSettings } = useSettingsModal()

const userProfile = inject<Ref<any>>('userProfile', ref(null))
const toggleUserPopup = inject<() => void>('toggleUserPopup', () => {})

function handleAction(action: string) {
  if (action === 'openAssets') openTab({ type: 'assets' })
  else if (action === 'openCommunity') openTab({ type: 'community' })
  else if (action === 'openTrain') openTab({ type: 'train' })
  else if (action === 'openAllProjects') openTab({ type: 'all-projects', label: 'All projects' })
  else if (action === 'openBrand') openTab({ type: 'brand' })
}

function getActionActive(action: string): boolean {
  if (action === 'openAssets') return activeTab.value.type === 'assets'
  if (action === 'openCommunity') return activeTab.value.type === 'community'
  if (action === 'openTrain') return activeTab.value.type === 'train'
  if (action === 'openAllProjects') return activeTab.value.type === 'all-projects'
  if (action === 'openBrand') return activeTab.value.type === 'brand'
  return false
}

const userInitials = computed(() => {
  const user = userProfile.value
  if (user?.displayName) {
    return user.displayName.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()
  }
  if (user?.email) return user.email[0].toUpperCase()
  return '?'
})

// Google/Firebase profile images sometimes 403 on mobile (referrer policy /
// hot-link protection). Track per-URL load failures and fall back to initials.
const avatarFailed = ref(false)
watch(() => userProfile.value?.photoURL, () => { avatarFailed.value = false })
</script>

<template>
  <nav class="w-[68px] h-screen bg-sidebar flex flex-col items-center shrink-0">
    <!-- Logo -->
    <div class="pt-7 pb-8">
      <SailorMark class="w-[34px] h-[34px] select-none" />
    </div>

    <!-- Main nav -->
    <div class="flex flex-col items-center gap-10 flex-1">
      <UiTooltipProvider :delay-duration="300">
        <template v-for="item in navItems" :key="item.label">
          <!-- Action items (e.g. Assets tab) — plain button, no tooltip wrapper -->
          <button
            v-if="item.action"
            class="text-white transition-opacity cursor-pointer"
            :class="getActionActive(item.action) ? 'opacity-100' : 'opacity-60 hover:opacity-100'"
            :title="item.label"
            @click="handleAction(item.action)"
          >
            <component :is="item.icon" class="size-5" />
          </button>
          <!-- Route items -->
          <UiTooltip v-else>
            <UiTooltipTrigger as-child>
              <NuxtLink
                :to="item.to!"
                class="text-white transition-opacity"
                :class="(item.to === '/' ? activeTab.type === 'home' : isActive(item.to!)) ? 'opacity-100' : 'opacity-60 hover:opacity-100'"
                @click="item.to === '/' && setActiveTab('home')"
              >
                <component :is="item.icon" class="size-5" />
              </NuxtLink>
            </UiTooltipTrigger>
            <UiTooltipContent side="right">
              {{ item.label }}
            </UiTooltipContent>
          </UiTooltip>
        </template>
      </UiTooltipProvider>

      <!-- Separator -->
      <div class="w-4 border-t border-sidebar-border" />

      <!-- Pinned project thumbnails -->
      <div class="size-5 rounded bg-muted" />
      <div class="size-5 rounded bg-muted" />
    </div>

    <!-- Bottom section -->
    <div class="flex flex-col items-center gap-10 pb-6">
      <UiTooltipProvider :delay-duration="300">
        <UiTooltip v-for="item in bottomItems" :key="item.to">
          <UiTooltipTrigger as-child>
            <NuxtLink
              :to="item.to"
              class="text-white opacity-60 hover:opacity-100 transition-opacity"
            >
              <component :is="item.icon" class="size-5" />
            </NuxtLink>
          </UiTooltipTrigger>
          <UiTooltipContent side="right">
            {{ item.label }}
          </UiTooltipContent>
        </UiTooltip>

        <!-- Settings button (opens ComfyUI settings dialog) -->
        <UiTooltip>
          <UiTooltipTrigger as-child>
            <button
              class="text-white opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
              @click="openSettings"
            >
              <Settings class="size-5" />
            </button>
          </UiTooltipTrigger>
          <UiTooltipContent side="right">
            Settings
          </UiTooltipContent>
        </UiTooltip>
      </UiTooltipProvider>

      <!-- User avatar -->
      <button
        class="cursor-pointer transition-opacity hover:opacity-80"
        @click="toggleUserPopup"
      >
        <img
          v-if="userProfile?.photoURL && !avatarFailed"
          :src="userProfile.photoURL"
          alt="User avatar"
          referrerpolicy="no-referrer"
          class="size-7 rounded-full object-cover ring-2 ring-transparent hover:ring-white/20 transition-all"
          @error="avatarFailed = true"
        />
        <div
          v-else
          class="size-7 rounded-full bg-[#2a2a2a] flex items-center justify-center text-[10px] font-medium text-white/60 ring-2 ring-transparent hover:ring-white/20 transition-all"
        >
          {{ userInitials }}
        </div>
      </button>
    </div>
  </nav>
</template>
