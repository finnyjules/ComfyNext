<script setup>
import { ref, onMounted } from 'vue'
import { getFeaturedCreators } from '~/data/community/creatorService.js'
import { useScrollAnimation } from '~/composables/community/useScrollAnimation.js'
import CreatorCard from '~/components/community/creator/CreatorCard.vue'

const gridRef = ref(null)
const headingRef = ref(null)
const creators = ref([])

const { alternateSlideIn, revealWords, scaleBounce } = useScrollAnimation()

creators.value = getFeaturedCreators(6)

onMounted(() => {
  // Heading per-word reveal
  if (headingRef.value) {
    revealWords(headingRef.value)
  }

  // Cards alternate slide-in from left/right
  if (gridRef.value) {
    alternateSlideIn(gridRef.value, '.creator-card')

    // Avatar bounce after cards enter
    const avatars = gridRef.value.querySelectorAll('.creator-card__avatar img, .creator-card__avatar')
    avatars.forEach((avatar, i) => {
      scaleBounce(avatar, {
        trigger: gridRef.value,
        fromScale: 0.5,
        delay: 0.3 + i * 0.1,
        ease: 'elastic.out(1, 0.5)',
        duration: 0.8,
      })
    })
  }
})
</script>

<template>
  <section class="featured-creators">
    <div class="featured-creators__container">
      <div class="featured-creators__header">
        <h2 class="featured-creators__title">
          <svg
            class="featured-creators__icon"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"
              fill="currentColor"
            />
          </svg>
          <span ref="headingRef">Featured Creators</span>
        </h2>
        <a href="/search" class="featured-creators__view-all">View all</a>
      </div>

      <div ref="gridRef" class="featured-creators__grid">
        <CreatorCard
          v-for="creator in creators"
          :key="creator.id"
          :creator="creator"
        />
      </div>
    </div>
  </section>
</template>

<style lang="scss" scoped>
.featured-creators {
  @include section-spacing;

  &__container {
    @include container;
  }

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: $space-6;
  }

  &__title {
    display: flex;
    align-items: center;
    gap: $space-2;
    font-size: $text-2xl;
    font-weight: $weight-bold;
    color: $color-text-primary;
    margin: 0;
  }

  &__icon {
    color: $color-primary-light;
    flex-shrink: 0;
  }

  &__view-all {
    font-size: $text-sm;
    color: $color-primary-light;
    text-decoration: none;
    transition: text-decoration 0.2s ease;

    &:hover {
      text-decoration: underline;
    }
  }

  &__grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: $space-6;

    @include respond-below('lg') {
      grid-template-columns: repeat(2, 1fr);
    }

    @include respond-below('md') {
      grid-template-columns: 1fr;
    }
  }
}
</style>
