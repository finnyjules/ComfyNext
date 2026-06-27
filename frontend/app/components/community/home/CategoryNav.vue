<script setup>
import { computed, ref, onMounted } from 'vue'
import { categories } from '~/data/community/mock/generators/categories.js'
import { workflows } from '~/data/community/mock/index.js'
import { useScrollAnimation } from '~/composables/community/useScrollAnimation.js'

const gridRef = ref(null)
const { staggerChildren } = useScrollAnimation()

onMounted(() => {
  if (gridRef.value) {
    staggerChildren(gridRef.value, '.category-nav__tile')
  }
})

const workflowCounts = computed(() => {
  const counts = {}
  workflows.forEach((w) => {
    counts[w.category] = (counts[w.category] || 0) + 1
  })
  return counts
})

const iconPaths = {
  image: {
    paths: ['M21 15V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10'],
    extras: '<polyline points="3 15 8 10 13 15"/><polyline points="14 13 17 10 21 14"/><circle cx="17" cy="7" r="2"/>',
  },
  video: {
    paths: ['M23 7l-7 5 7 5V7z', 'M14 5H3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z'],
    extras: '',
  },
  music: {
    paths: ['M9 18V5l12-2v13'],
    extras: '<circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  },
  cube: {
    paths: ['M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z'],
    extras: '<polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
  },
  maximize: {
    paths: ['M15 3h6v6', 'M9 21H3v-6', 'M21 3l-7 7', 'M3 21l7-7'],
    extras: '',
  },
  edit: {
    paths: ['M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7'],
    extras: '<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  },
  cpu: {
    paths: ['M18 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z'],
    extras: '<rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>',
  },
  layers: {
    paths: ['M12 2L2 7l10 5 10-5-10-5z'],
    extras: '<polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  },
  tool: {
    paths: ['M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z'],
    extras: '',
  },
}

function getIconMarkup(iconName) {
  const icon = iconPaths[iconName]
  if (!icon) return ''

  const pathsMarkup = icon.paths
    .map((d) => `<path d="${d}"/>`)
    .join('')

  return pathsMarkup + icon.extras
}
</script>

<template>
  <section class="py-16 md:py-20">
    <div class="mx-auto max-w-7xl px-4">
      <div class="flex items-center justify-between mb-8">
        <h2 class="text-xl font-semibold text-foreground">Browse by Category</h2>
        <a href="/workflows" class="inline-flex items-center gap-1 text-sm font-medium text-palette-yellow/80 transition-colors duration-150 hover:text-palette-yellow">
          View all
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12h14" /><path d="M12 5l7 7-7 7" />
          </svg>
        </a>
      </div>

      <div ref="gridRef" class="grid grid-cols-3 gap-4 md:max-lg:grid-cols-3 max-md:flex max-md:overflow-x-auto max-md:scroll-snap-x max-md:mandatory max-md:gap-3 max-md:pb-3">
        <a
          v-for="cat in categories"
          :key="cat.id"
          :href="`/workflows/${cat.id}`"
          class="category-nav__tile bg-card rounded-xl border border-border transition-all focus-visible:ring-2 focus-visible:ring-ring flex flex-col items-center justify-center gap-2 py-6 px-4 text-center cursor-pointer duration-250 hover:border-border/80 hover:bg-muted max-md:min-w-[160px] max-md:shrink-0 max-md:snap-start"
        >
          <div class="category-nav__icon flex items-center justify-center size-12 rounded-lg bg-palette-yellow/10 text-palette-yellow/80 mb-1 transition-all duration-250">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              v-html="getIconMarkup(cat.icon)"
            />
          </div>
          <span class="text-sm font-semibold text-foreground leading-tight">{{ cat.label }}</span>
          <span class="text-xs text-muted-foreground/70">{{ workflowCounts[cat.id] || 0 }} templates</span>
        </a>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* Tile icon hover color shift */
.category-nav__tile:hover .category-nav__icon {
  background: rgb(240 255 65 / 0.2);
  color: rgb(var(--color-palette-yellow);
}

/* Horizontal scroll on small screens */
@media (max-width: 767px) {
  .max-md\:scroll-snap-x {
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
  }
}
</style>
