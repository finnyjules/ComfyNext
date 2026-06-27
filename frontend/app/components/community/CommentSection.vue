<script setup>
import { ref, computed, watch } from 'vue'
import { getComments, getCommentCount, getQuestionCount, getShowcaseCount } from '~/data/community/commentService.js'
import { timeAgo } from '~/lib/community/formatters.js'

const props = defineProps({
  workflowId: { type: String, required: true },
})

// -- Tabs --
const activeTab = ref('all')
const tabs = computed(() => [
  { key: 'all', label: 'All', count: count.value },
  { key: 'question', label: 'Questions', count: questionCount.value },
  { key: 'showcase', label: 'Showcase', count: showcaseCount.value },
])

// -- Sort --
const activeSort = ref('newest')
const sortOptions = [
  { key: 'newest', label: 'Newest' },
  { key: 'helpful', label: 'Most Helpful' },
  { key: 'creator', label: 'Creator First' },
]

// -- Counts --
const count = ref(getCommentCount(props.workflowId))
const questionCount = ref(getQuestionCount(props.workflowId))
const showcaseCount = ref(getShowcaseCount(props.workflowId))

// -- Comments --
const comments = ref(getComments(props.workflowId, { type: 'all', sort: 'newest' }))

watch([activeTab, activeSort], ([tab, sort]) => {
  comments.value = getComments(props.workflowId, { type: tab, sort })
})

// -- Upvote (local state only) --
const upvoted = ref(new Set())

function toggleUpvote(commentId) {
  if (upvoted.value.has(commentId)) {
    upvoted.value.delete(commentId)
  } else {
    upvoted.value.add(commentId)
  }
  // Trigger reactivity
  upvoted.value = new Set(upvoted.value)
}

function getUpvoteCount(comment) {
  const base = comment.upvotes || 0
  return upvoted.value.has(comment.id) ? base + 1 : base
}

// -- Comment input (UI only) --
const newCommentText = ref('')
</script>

<template>
  <section>
    <h2 class="text-xl font-bold text-foreground mb-5">Comments ({{ count }})</h2>

    <!-- Comment input form -->
    <div class="mb-6 pb-6 border-b border-border">
      <textarea
        v-model="newCommentText"
        class="w-full bg-muted border border-border rounded-md text-foreground text-sm p-3 resize-y min-h-[72px] transition-all duration-150 font-[inherit] placeholder:text-muted-foreground/70 focus:outline-none focus:border-palette-yellow"
        placeholder="Share your thoughts, ask a question, or showcase your results..."
        rows="3"
      />
      <div class="flex justify-end mt-2">
        <UiButton
          size="sm"
          :disabled="!newCommentText.trim()"
          class="bg-palette-yellow text-white hover:bg-palette-yellow/80 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Post Comment
        </UiButton>
      </div>
    </div>

    <!-- Tabs & Sort bar -->
    <div class="flex items-center justify-between mb-5 gap-3 flex-wrap">
      <div class="flex gap-1" role="tablist" aria-label="Comment filters">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          role="tab"
          :aria-selected="activeTab === tab.key"
          class="flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-md border-none cursor-pointer transition-all duration-150"
          :class="activeTab === tab.key
            ? 'bg-accent text-foreground'
            : 'bg-transparent text-muted-foreground/70 hover:bg-accent hover:text-muted-foreground'"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
          <span class="text-xs text-muted-foreground/70 bg-muted px-2 py-px rounded-full min-w-[20px] text-center">{{ tab.count }}</span>
        </button>
      </div>
      <div>
        <select
          v-model="activeSort"
          class="bg-muted border border-border rounded-md text-muted-foreground text-sm px-3 py-1 cursor-pointer focus:outline-none focus:border-palette-yellow"
          aria-label="Sort comments"
        >
          <option v-for="opt in sortOptions" :key="opt.key" :value="opt.key">
            {{ opt.label }}
          </option>
        </select>
      </div>
    </div>

    <!-- Comment list -->
    <div class="flex flex-col gap-5">
      <div
        v-for="comment in comments.slice(0, 10)"
        :key="comment.id"
        class="flex gap-3 pb-5 border-b border-border"
        :class="{ 'border-l-[3px] border-l-palette-yellow pl-3 rounded-sm': comment.isCreatorReply }"
      >
        <img :src="comment.author.avatarUrl" :alt="comment.author.displayName" class="w-9 h-9 rounded-full object-cover shrink-0" />
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-sm font-medium text-foreground flex items-center gap-2">
              {{ comment.author.displayName }}
              <span
                v-if="comment.isCreatorReply"
                class="text-xs font-semibold text-palette-yellow bg-palette-yellow/15 px-2 py-px rounded-full tracking-wide"
              >Creator</span>
            </span>
            <span class="text-xs text-muted-foreground/70">{{ timeAgo(comment.createdAt) }}</span>
          </div>
          <p class="text-sm text-muted-foreground leading-normal mb-2">{{ comment.content }}</p>
          <div class="flex gap-3">
            <button
              class="flex items-center gap-1 text-xs px-2 py-1 rounded-sm border-none cursor-pointer transition-all duration-150"
              :class="upvoted.has(comment.id)
                ? 'text-palette-yellow bg-transparent hover:text-palette-yellow/80'
                : 'text-muted-foreground/70 bg-transparent hover:bg-accent hover:text-muted-foreground'"
              @click="toggleUpvote(comment.id)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
              <span>{{ getUpvoteCount(comment) }}</span>
            </button>
          </div>

          <!-- Threaded replies -->
          <div v-if="comment.replies?.length" class="mt-4 pl-4 border-l-2 border-border flex flex-col gap-4">
            <div
              v-for="reply in comment.replies"
              :key="reply.id"
              class="flex gap-3"
              :class="{ 'border-l-2 border-l-palette-yellow pl-3 rounded-[1px]': reply.isCreatorReply }"
            >
              <img :src="reply.author.avatarUrl" :alt="reply.author.displayName" class="w-7 h-7 rounded-full object-cover shrink-0" />
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <span class="text-sm font-medium text-foreground flex items-center gap-2">
                    {{ reply.author.displayName }}
                    <span
                      v-if="reply.isCreatorReply"
                      class="text-xs font-semibold text-palette-yellow bg-palette-yellow/15 px-2 py-px rounded-full tracking-wide"
                    >Creator</span>
                  </span>
                  <span class="text-xs text-muted-foreground/70">{{ timeAgo(reply.createdAt) }}</span>
                </div>
                <p class="text-sm text-muted-foreground leading-normal mb-2">{{ reply.content }}</p>
                <div class="flex gap-3">
                  <button
                    class="flex items-center gap-1 text-xs px-2 py-1 rounded-sm border-none cursor-pointer transition-all duration-150"
                    :class="upvoted.has(reply.id)
                      ? 'text-palette-yellow bg-transparent hover:text-palette-yellow/80'
                      : 'text-muted-foreground/70 bg-transparent hover:bg-accent hover:text-muted-foreground'"
                    @click="toggleUpvote(reply.id)"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M12 19V5M5 12l7-7 7 7" />
                    </svg>
                    <span>{{ getUpvoteCount(reply) }}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
