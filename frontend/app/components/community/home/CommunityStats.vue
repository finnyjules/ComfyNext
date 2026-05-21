<script setup>
import { ref, onMounted } from 'vue'
import { getCommunityStats } from '~/data/community/workflowService.js'
import { useGsap } from '~/composables/community/useGsap.js'
import { useScrollAnimation } from '~/composables/community/useScrollAnimation.js'

const { scaleBounce } = useScrollAnimation()

const sectionRef = ref(null)
const glowRef = ref(null)
const { gsap, ScrollTrigger, animate, prefersReducedMotion } = useGsap()

const stats = getCommunityStats()

const workflowCount = ref(0)
const runCount = ref(0)
const creatorCount = ref(0)
const favoriteCount = ref(0)

function formatNumber(value) {
  return Math.floor(value).toLocaleString('en-US')
}

const statItems = [
  { ref: workflowCount, target: stats.totalWorkflows, label: 'Workflows', icon: 'grid' },
  { ref: runCount, target: stats.totalRuns, label: 'Total Runs', icon: 'play' },
  { ref: creatorCount, target: stats.totalCreators, label: 'Creators', icon: 'users' },
  { ref: favoriteCount, target: stats.totalFavorites, label: 'Favorites', icon: 'heart' },
]

onMounted(() => {
  if (prefersReducedMotion) {
    workflowCount.value = stats.totalWorkflows
    runCount.value = stats.totalRuns
    creatorCount.value = stats.totalCreators
    favoriteCount.value = stats.totalFavorites
    return
  }

  animate(() => {
    statItems.forEach((item) => {
      const proxy = { value: 0 }

      gsap.to(proxy, {
        value: item.target,
        duration: 2,
        ease: 'power2.out',
        snap: { value: 1 },
        scrollTrigger: {
          trigger: sectionRef.value,
          start: 'top 80%',
          once: true,
        },
        onUpdate() {
          item.ref.value = proxy.value
        },
      })
    })
  })

  // Icon scale-bounce entrance
  const icons = sectionRef.value?.querySelectorAll('.community-stats__icon')
  if (icons) {
    icons.forEach((icon, i) => {
      scaleBounce(icon, {
        trigger: sectionRef.value,
        start: 'top 80%',
        fromScale: 0,
        delay: i * 0.15,
        ease: 'back.out(3)',
        duration: 0.5,
      })
    })
  }

  // Glow expansion
  if (glowRef.value) {
    animate(() => {
      gsap.fromTo(
        glowRef.value,
        { opacity: 0, scale: 0.3 },
        {
          opacity: 0.15,
          scale: 1,
          scrollTrigger: {
            trigger: sectionRef.value,
            start: 'top 80%',
            end: 'bottom 20%',
            scrub: true,
          },
          ease: 'none',
        }
      )
    })
  }
})
</script>

<template>
  <section ref="sectionRef" class="community-stats relative overflow-hidden py-20 md:max-lg:py-20 max-md:py-12 border-y border-border">
    <div ref="glowRef" class="community-stats__glow absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 size-[600px] rounded-full pointer-events-none opacity-0 z-0"></div>
    <div class="relative z-[1] mx-auto max-w-7xl px-4">
      <div class="flex justify-evenly items-start max-md:grid max-md:grid-cols-2 max-md:gap-10">
        <!-- Workflows -->
        <div class="flex flex-col items-center gap-2 text-center">
          <svg
            class="community-stats__icon text-comfy-yellow mb-1 shrink-0"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="7" height="7" rx="1.5" fill="currentColor" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" fill="currentColor" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" fill="currentColor" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" fill="currentColor" />
          </svg>
          <span class="text-4xl max-md:text-3xl font-bold text-foreground leading-tight tabular-nums">{{ formatNumber(workflowCount) }}+</span>
          <span class="text-sm text-muted-foreground/70">Workflows</span>
        </div>

        <!-- Total Runs -->
        <div class="flex flex-col items-center gap-2 text-center">
          <svg
            class="community-stats__icon text-comfy-yellow mb-1 shrink-0"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M8 5.14v14.72a1 1 0 0 0 1.5.86l11-7.36a1 1 0 0 0 0-1.72l-11-7.36A1 1 0 0 0 8 5.14z"
              fill="currentColor"
            />
          </svg>
          <span class="text-4xl max-md:text-3xl font-bold text-foreground leading-tight tabular-nums">{{ formatNumber(runCount) }}+</span>
          <span class="text-sm text-muted-foreground/70">Total Runs</span>
        </div>

        <!-- Creators -->
        <div class="flex flex-col items-center gap-2 text-center">
          <svg
            class="community-stats__icon text-comfy-yellow mb-1 shrink-0"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <circle cx="9" cy="7" r="4" fill="currentColor" />
            <path
              d="M2 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              fill="none"
            />
            <circle cx="18" cy="9" r="3" fill="currentColor" />
            <path
              d="M18 14a4 4 0 0 1 4 4v2"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              fill="none"
            />
          </svg>
          <span class="text-4xl max-md:text-3xl font-bold text-foreground leading-tight tabular-nums">{{ formatNumber(creatorCount) }}+</span>
          <span class="text-sm text-muted-foreground/70">Creators</span>
        </div>

        <!-- Favorites -->
        <div class="flex flex-col items-center gap-2 text-center">
          <svg
            class="community-stats__icon text-comfy-yellow mb-1 shrink-0"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
              fill="currentColor"
            />
          </svg>
          <span class="text-4xl max-md:text-3xl font-bold text-foreground leading-tight tabular-nums">{{ formatNumber(favoriteCount) }}+</span>
          <span class="text-sm text-muted-foreground/70">Favorites</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* Background gradient */
.community-stats {
  background: linear-gradient(180deg, var(--muted) 0%, var(--background) 100%);
}

/* Glow element for GSAP animation */
.community-stats__glow {
  background: radial-gradient(circle, rgb(var(--color-comfy-yellow) 0%, transparent 70%);
}

/* tabular-nums utility */
.tabular-nums {
  font-variant-numeric: tabular-nums;
}
</style>
