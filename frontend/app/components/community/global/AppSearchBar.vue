<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import SearchAutocomplete from '~/components/community/search/SearchAutocomplete.vue'

const props = defineProps({
  placeholder: {
    type: String,
    default: 'Search templates...',
  },
})

const query = ref('')
const isFocused = ref(false)
const showAutocomplete = ref(false)
const inputRef = ref(null)
const wrapperRef = ref(null)

function handleSubmit() {
  if (query.value.trim()) {
    showAutocomplete.value = false
    window.location.href = `/search?q=${encodeURIComponent(query.value.trim())}`
  }
}

function handleFocus() {
  isFocused.value = true
  if (query.value.length >= 2) {
    showAutocomplete.value = true
  }
}

function handleBlur() {
  // Delay to allow click on autocomplete items
  setTimeout(() => {
    isFocused.value = false
    showAutocomplete.value = false
  }, 200)
}

function handleInput() {
  showAutocomplete.value = query.value.length >= 2
}

function handleAutocompleteSelect() {
  showAutocomplete.value = false
}

function handleAutocompleteClose() {
  showAutocomplete.value = false
}

function handleKeydown(e) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault()
    inputRef.value?.focus()
  }
}

function handleClickOutside(e) {
  if (wrapperRef.value && !wrapperRef.value.contains(e.target)) {
    showAutocomplete.value = false
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('click', handleClickOutside)
})
</script>

<template>
  <div ref="wrapperRef" class="relative w-full">
    <form
      class="relative flex items-center w-full bg-accent border border-border rounded-xl transition-all duration-150"
      :class="{ 'border-comfy-yellow shadow-[0_0_0_1px_rgba(240,255,65,0.15)]': isFocused }"
      role="search"
      @submit.prevent="handleSubmit"
    >
      <svg class="absolute left-4 text-muted-foreground/70 pointer-events-none shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
      </svg>
      <input
        ref="inputRef"
        v-model="query"
        type="text"
        class="w-full py-3 pr-5 pl-12 bg-transparent border-none outline-none text-base text-foreground placeholder:text-muted-foreground/70"
        :placeholder="placeholder"
        aria-label="Search templates"
        aria-autocomplete="list"
        :aria-expanded="showAutocomplete"
        @focus="handleFocus"
        @blur="handleBlur"
        @input="handleInput"
      />
      <kbd v-if="!isFocused && !query" class="absolute right-4 px-2 py-px text-xs font-sans text-muted-foreground/70 bg-muted border border-border rounded-sm pointer-events-none">
        <span>&#8984;K</span>
      </kbd>
      <button
        v-if="query"
        type="button"
        class="absolute right-3 flex p-1 text-muted-foreground/70 rounded-sm transition-all duration-150 hover:text-foreground"
        aria-label="Clear search"
        @click="query = ''; showAutocomplete = false"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </form>

    <SearchAutocomplete
      :query="query"
      :visible="showAutocomplete"
      @select="handleAutocompleteSelect"
      @close="handleAutocompleteClose"
    />
  </div>
</template>
