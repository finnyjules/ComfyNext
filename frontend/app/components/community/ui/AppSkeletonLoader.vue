<script setup>
defineProps({
  variant: {
    type: String,
    default: 'card',
    validator: (v) => ['card', 'list', 'profile', 'detail', 'text'].includes(v),
  },
  count: {
    type: Number,
    default: 1,
  },
})
</script>

<template>
  <div class="w-full">
    <!-- Card variant -->
    <template v-if="variant === 'card'">
      <div
        v-for="n in count"
        :key="`card-${n}`"
        class="bg-card rounded-lg overflow-hidden"
        :class="{ 'mt-4': n > 1 }"
      >
        <div class="skeleton w-full h-[200px]" />
        <div class="p-4 flex flex-col gap-3">
          <div class="skeleton h-4 w-3/4" />
          <div class="skeleton h-3.5 w-1/2" />
          <div class="flex gap-2 mt-1">
            <span class="skeleton inline-block h-[22px] w-14 rounded-full" />
            <span class="skeleton inline-block h-[22px] w-14 rounded-full" />
            <span class="skeleton inline-block h-[22px] w-14 rounded-full" />
          </div>
        </div>
      </div>
    </template>

    <!-- List variant -->
    <template v-if="variant === 'list'">
      <div
        v-for="n in count"
        :key="`list-${n}`"
        class="flex items-center gap-4 bg-card rounded-lg p-4"
        :class="{ 'mt-4': n > 1 }"
      >
        <div class="skeleton w-[60px] h-[60px] shrink-0 rounded-md" />
        <div class="flex-1 flex flex-col gap-2">
          <div class="skeleton h-4 w-3/5" />
          <div class="skeleton h-3.5 w-2/5" />
        </div>
      </div>
    </template>

    <!-- Profile variant -->
    <template v-if="variant === 'profile'">
      <div
        v-for="n in count"
        :key="`profile-${n}`"
        class="flex flex-col items-center gap-4 py-8 px-4"
        :class="{ 'mt-4': n > 1 }"
      >
        <div class="skeleton w-24 h-24 rounded-full" />
        <div class="w-full max-w-xs flex flex-col items-center gap-3">
          <div class="skeleton h-5 w-[45%]" />
          <div class="skeleton h-3.5 w-4/5" />
          <div class="skeleton h-3.5 w-[55%]" />
        </div>
      </div>
    </template>

    <!-- Detail variant -->
    <template v-if="variant === 'detail'">
      <div
        v-for="n in count"
        :key="`detail-${n}`"
        class="flex flex-col gap-6"
        :class="{ 'mt-4': n > 1 }"
      >
        <div class="skeleton w-full h-[400px] rounded-lg" />
        <div class="flex flex-col gap-3">
          <div class="skeleton h-4 w-full" />
          <div class="skeleton h-4 w-[70%]" />
          <div class="skeleton h-4 w-1/2" />
          <div class="skeleton h-4 w-[90%]" />
        </div>
      </div>
    </template>

    <!-- Text variant -->
    <template v-if="variant === 'text'">
      <div
        v-for="n in count"
        :key="`text-${n}`"
        class="flex flex-col gap-3"
        :class="{ 'mt-4': n > 1 }"
      >
        <div class="skeleton h-3.5 w-full" />
        <div class="skeleton h-3.5 w-4/5" />
        <div class="skeleton h-3.5 w-3/5" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.skeleton {
  background: linear-gradient(
    90deg,
    var(--muted) 25%,
    var(--accent) 50%,
    var(--muted) 75%
  );
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s ease-in-out infinite;
  border-radius: 0.25rem;
}

@keyframes skeleton-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>
