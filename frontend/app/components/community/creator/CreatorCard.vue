<script setup>
import { computed } from 'vue'
import { useStore } from '@nanostores/vue'
import { $followingIds, toggleFollow } from '~/composables/community/auth.js'
import { formatNumber } from '~/lib/community/formatters.js'
import { useCommunityNav } from '~/composables/useCommunityNav'

const props = defineProps({
  creator: { type: Object, required: true },
})

const { navigateTo } = useCommunityNav()
const followingIds = useStore($followingIds)
const isFollowing = computed(() => followingIds.value.has(props.creator.id))

function openCreator(e) {
  e.preventDefault()
  navigateTo({
    view: 'creator',
    handle: props.creator.handle.replace('@', ''),
    label: props.creator.displayName,
  })
}

function handleFollow(e) {
  e.preventDefault()
  e.stopPropagation()
  toggleFollow(props.creator.id)
}
</script>

<template>
  <article class="bg-card rounded-xl border border-border transition-all flex flex-col hover:border-ring">
    <a href="#" class="flex flex-col gap-3 p-5 h-full no-underline" @click="openCreator">
      <!-- Top section: avatar + identity -->
      <div class="flex items-center gap-3">
        <UiAvatar class="h-12 w-12 shrink-0">
          <UiAvatarImage :src="creator.avatarUrl" :alt="creator.displayName" />
          <UiAvatarFallback>{{ creator.displayName?.charAt(0) }}</UiAvatarFallback>
        </UiAvatar>
        <div class="flex flex-col min-w-0">
          <h3 class="text-base font-semibold text-foreground m-0 truncate">{{ creator.displayName }}</h3>
          <span class="text-sm text-muted-foreground/70 truncate">{{ creator.handle }}</span>
        </div>
      </div>

      <!-- Badges -->
      <div v-if="creator.badges?.length" class="flex flex-wrap gap-1">
        <UiBadge
          v-for="badge in creator.badges"
          :key="badge.id"
          variant="secondary"
          class="text-xs bg-accent text-comfy-yellow font-medium"
        >
          {{ badge.label }}
        </UiBadge>
      </div>

      <!-- Bio -->
      <p v-if="creator.bio" class="text-sm text-muted-foreground m-0 line-clamp-2">{{ creator.bio }}</p>

      <!-- Stats -->
      <div class="flex items-center gap-2 mt-auto pt-3">
        <span class="text-xs text-muted-foreground/70">
          {{ formatNumber(creator.stats.workflowCount) }} templates
        </span>
        <span class="text-xs text-muted-foreground/70" aria-hidden="true">&middot;</span>
        <span class="text-xs text-muted-foreground/70">
          {{ formatNumber(creator.stats.totalRuns) }} runs
        </span>
      </div>

      <!-- Follow button -->
      <UiButton
        :variant="isFollowing ? 'default' : 'outline'"
        size="sm"
        class="w-full"
        :class="isFollowing
          ? 'bg-comfy-yellow text-white border-comfy-yellow hover:bg-comfy-yellow/80 hover:border-comfy-yellow/80'
          : 'hover:border-comfy-yellow hover:text-comfy-yellow'"
        :aria-label="isFollowing ? `Unfollow ${creator.displayName}` : `Follow ${creator.displayName}`"
        @click="handleFollow"
      >
        {{ isFollowing ? 'Following' : 'Follow' }}
      </UiButton>
    </a>
  </article>
</template>
