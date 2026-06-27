<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { getFeatured, getTrending } from '~/data/community/workflowService.js'
import { gsap, ScrollTrigger } from '~/lib/community/gsap.js'

import { useCommunityNav } from '~/composables/useCommunityNav'

const { navigateTo } = useCommunityNav()

function openWorkflowTab(slug, title, e) {
  if (e) e.preventDefault()
  navigateTo({ view: 'workflow', slug, label: title })
}

// Data -- prefer featured/staff picks, fall back to trending
const allFeatured = getFeatured(5)
const items = allFeatured.length >= 3 ? allFeatured : getTrending(5)

// Carousel state
const currentIndex = ref(0)
const isHovered = ref(false)
const sectionRef = ref(null)
const infoRef = ref(null)
const trackRef = ref(null)
const stageRef = ref(null)
let autoAdvanceTimer = null
let isAnimating = false
let resizeObserver = null
let resizeRafId = null
let lastStageW = 0

const prefersReducedMotion =
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const activeItem = computed(() => items[currentIndex.value] || items[0])

// Measure card dimensions from the actual DOM
function getCardMetrics() {
  if (!trackRef.value || !stageRef.value) return null
  const cards = trackRef.value.querySelectorAll('.featured-carousel__card')
  if (cards.length < 2) return null
  const cardW = cards[0].offsetWidth
  const stride = cards[1].getBoundingClientRect().left - cards[0].getBoundingClientRect().left
  const stageW = stageRef.value.offsetWidth
  return { cardW, stride, stageW }
}

// Calculate translateX to center a given extended-track index in the stage
function getCenteredX(extTrackIndex, metrics) {
  const { cardW, stride, stageW } = metrics
  // Card left edge position in the track (before any translate)
  const cardLeft = extTrackIndex * stride
  // We want the card's center to align with the stage's center
  const cardCenter = cardLeft + cardW / 2
  const stageCenter = stageW / 2
  return stageCenter - cardCenter
}

// Extended items: clone last at start, clone first at end (for infinite loop)
const extendedItems = computed(() => {
  if (items.length === 0) return []
  return [
    { ...items[items.length - 1], _clone: 'last' },
    ...items,
    { ...items[0], _clone: 'first' },
  ]
})

function slideTo(index, animate = true) {
  if (isAnimating) return
  const trackEl = trackRef.value
  if (!trackEl) return

  const metrics = getCardMetrics()
  if (!metrics) return

  // index in extended track = index + 1 (leading clone)
  const targetX = getCenteredX(index + 1, metrics)

  if (!animate || prefersReducedMotion) {
    gsap.set(trackEl, { x: targetX })
    currentIndex.value = index
    return
  }

  isAnimating = true

  gsap.to(trackEl, {
    x: targetX,
    duration: 0.5,
    ease: 'power2.inOut',
    onComplete: () => {
      currentIndex.value = index
      isAnimating = false
    },
  })

  animateInfo()
}

function goNext() {
  if (isAnimating) return
  const trackEl = trackRef.value
  if (!trackEl) return

  const metrics = getCardMetrics()
  if (!metrics) return

  const nextIndex = currentIndex.value + 1
  const extIndex = nextIndex + 1 // +1 for leading clone
  const targetX = getCenteredX(extIndex, metrics)

  isAnimating = true
  currentIndex.value = nextIndex % items.length

  gsap.to(trackEl, {
    x: targetX,
    duration: 0.5,
    ease: 'power2.inOut',
    onComplete: () => {
      // If we slid to the clone of first item, jump back to the real one
      if (nextIndex >= items.length) {
        gsap.set(trackEl, { x: getCenteredX(1, metrics) })
      }
      isAnimating = false
    },
  })

  animateInfo()
  startAutoAdvance()
}

function goPrev() {
  if (isAnimating) return
  const trackEl = trackRef.value
  if (!trackEl) return

  const metrics = getCardMetrics()
  if (!metrics) return

  const prevIndex = currentIndex.value - 1
  // If -1, slide to leading clone (ext index 0)
  const extIndex = prevIndex < 0 ? 0 : prevIndex + 1
  const targetX = getCenteredX(extIndex, metrics)

  isAnimating = true
  currentIndex.value = (prevIndex + items.length) % items.length

  gsap.to(trackEl, {
    x: targetX,
    duration: 0.5,
    ease: 'power2.inOut',
    onComplete: () => {
      // If we slid to the clone of last item, jump back to the real one
      if (prevIndex < 0) {
        gsap.set(trackEl, { x: getCenteredX(items.length, metrics) })
      }
      isAnimating = false
    },
  })

  animateInfo()
  startAutoAdvance()
}

function goTo(index) {
  if (isAnimating || index === currentIndex.value) return
  slideTo(index, true)
  startAutoAdvance()
}

function animateInfo() {
  const info = infoRef.value
  if (!info) return
  info.style.transition = 'none'
  info.style.opacity = '0'
  info.style.transform = 'translateY(8px)'
  info.offsetHeight // force reflow
  info.style.transition = 'opacity 0.35s ease 0.15s, transform 0.35s ease 0.15s'
  info.style.opacity = '1'
  info.style.transform = 'translateY(0)'
}

function startAutoAdvance() {
  stopAutoAdvance()
  autoAdvanceTimer = setInterval(() => {
    if (!isHovered.value) goNext()
  }, 6000)
}

function stopAutoAdvance() {
  if (autoAdvanceTimer) {
    clearInterval(autoAdvanceTimer)
    autoAdvanceTimer = null
  }
}

onMounted(() => {
  // Use double-RAF to ensure DOM is fully laid out before centering
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      slideTo(0, false)
    })
  })

  startAutoAdvance()

  // Re-center active card on window resize only (not animation-triggered layout shifts)
  if (stageRef.value) {
    lastStageW = stageRef.value.offsetWidth
    resizeObserver = new ResizeObserver((entries) => {
      const newW = entries[0].contentRect.width
      // Only react to actual width changes (not height shifts from animations)
      if (Math.abs(newW - lastStageW) < 1) return
      lastStageW = newW
      if (isAnimating) return
      if (resizeRafId) cancelAnimationFrame(resizeRafId)
      resizeRafId = requestAnimationFrame(() => {
        slideTo(currentIndex.value, false)
      })
    })
    resizeObserver.observe(stageRef.value)
  }

  // Also re-center once all card images load (they affect card width)
  if (trackRef.value) {
    const images = trackRef.value.querySelectorAll('.featured-carousel__card-image')
    let loaded = 0
    const total = images.length
    const onLoad = () => {
      loaded++
      if (loaded >= total && !isAnimating) {
        slideTo(currentIndex.value, false)
      }
    }
    images.forEach((img) => {
      if (img.complete) {
        loaded++
      } else {
        img.addEventListener('load', onLoad, { once: true })
      }
    })
  }

  if (prefersReducedMotion || !sectionRef.value) return

  // Entrance animation -- cards fade up (no scale change to avoid layout shift)
  requestAnimationFrame(() => {
    const cards = sectionRef.value?.querySelectorAll('.featured-carousel__card')
    if (cards) {
      cards.forEach((card, i) => {
        gsap.fromTo(card, {
          y: 30,
          opacity: 0,
        }, {
          y: 0,
          opacity: 1,
          duration: 0.7,
          ease: 'power3.out',
          delay: i * 0.06,
        })
      })
    }
  })

  // Ticker fade-in with 2s delay, then parallax on scroll
  const ticker = sectionRef.value.querySelector('.featured-carousel__ticker')
  if (ticker) {
    gsap.fromTo(ticker, { opacity: 0 }, {
      opacity: 1,
      duration: 1,
      delay: 2,
      ease: 'power2.inOut',
    })

    gsap.to(ticker, {
      scrollTrigger: {
        trigger: sectionRef.value,
        start: 'top bottom',
        end: 'bottom top',
        scrub: 0.5,
      },
      x: -120,
      ease: 'none',
    })
  }
})

onUnmounted(() => {
  stopAutoAdvance()
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (resizeRafId) {
    cancelAnimationFrame(resizeRafId)
  }
})
</script>

<template>
  <section
    ref="sectionRef"
    class="featured-carousel relative overflow-hidden bg-background py-8 md:py-6"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
  >
    <!-- Ticker background layer (behind everything) -->
    <div class="featured-carousel__ticker absolute top-1/2 left-0 right-0 -translate-y-1/2 overflow-hidden z-0 pointer-events-none opacity-0" aria-hidden="true">
      <div class="featured-carousel__ticker-track flex w-max">
        <div class="flex items-center shrink-0" v-for="dup in 2" :key="dup">
          <span class="flex items-center gap-6 px-10" v-for="n in 5" :key="n">
            <svg class="featured-carousel__ticker-diamond shrink-0 w-[clamp(50px,5vw,70px)] h-auto opacity-40" width="60" height="52" viewBox="0 0 130 112" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M65 2L128 56L65 110L2 56L65 2Z" stroke="#ECFF00" stroke-width="3" fill="none"/>
            </svg>
            <span class="featured-carousel__ticker-text">Featured</span>
          </span>
        </div>
      </div>
    </div>

    <!-- Glow orbs -->
    <div class="featured-carousel__glow featured-carousel__glow--left"></div>
    <div class="featured-carousel__glow featured-carousel__glow--right"></div>

    <div class="relative z-[1] w-full">
      <!-- Cards + side arrows wrapper -->
      <div ref="stageRef" class="relative overflow-hidden">
        <!-- Sliding track with all cards + clones for infinite loop -->
        <div ref="trackRef" class="flex items-stretch gap-6 will-change-transform">
          <div
            v-for="(item, i) in extendedItems"
            :key="(item._clone || '') + item.id"
            class="featured-carousel__card rounded-xl overflow-hidden min-w-0 relative shadow-[0_4px_64px_rgba(0,0,0,0.25)] transition-opacity duration-400"
            :class="
              (!item._clone && items.indexOf(items.find(it => it.id === item.id)) === currentIndex)
              || (item._clone === 'first' && currentIndex === 0)
              || (item._clone === 'last' && currentIndex === items.length - 1)
                ? 'z-[2] opacity-100'
                : 'opacity-60'
            "
          >
            <a href="#" class="block w-full h-full" @click="openWorkflowTab(item.slug, item.title, $event)">
              <img
                :src="item.thumbnailUrl"
                :alt="item.title"
                class="featured-carousel__card-image w-full h-full object-cover block"
                loading="lazy"
              />
            </a>
            <a
              v-if="
                (!item._clone && items.indexOf(items.find(it => it.id === item.id)) === currentIndex)
                || (item._clone === 'first' && currentIndex === 0)
                || (item._clone === 'last' && currentIndex === items.length - 1)
              "
              href="#"
              class="featured-carousel__run-btn"
              @click="openWorkflowTab(item.slug, item.title, $event)"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="black"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              Run on Comfy Cloud
            </a>
          </div>
        </div>

        <!-- Side navigation arrows -->
        <UiButton
          variant="ghost"
          size="icon"
          @click="goPrev"
          class="featured-carousel__arrow featured-carousel__arrow--left"
          aria-label="Previous workflow"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </UiButton>
        <UiButton
          variant="ghost"
          size="icon"
          @click="goNext"
          class="featured-carousel__arrow featured-carousel__arrow--right"
          aria-label="Next workflow"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </UiButton>
      </div>

      <!-- Info below carousel -->
      <div ref="infoRef" class="mt-6 text-center">
        <h2 class="text-xl font-semibold text-foreground m-0">
          <a
            href="#"
            class="text-inherit transition-all duration-150 hover:text-palette-yellow/80"
            @click="openWorkflowTab(activeItem.slug, activeItem.title, $event)"
          >
            {{ activeItem.title }}
          </a>
        </h2>
        <p class="mt-1 text-sm text-muted-foreground/70">
          by <a
            href="#"
            class="text-palette-yellow/80 transition-all duration-150 hover:text-palette-yellow"
            @click.prevent="navigateTo({ view: 'creator', handle: activeItem.creator.handle.replace('@', ''), label: activeItem.creator.displayName })"
          >{{ activeItem.creator.displayName }}</a>
        </p>
        <span
          v-if="activeItem.categoryLabel"
          class="mt-2 inline-block rounded-full border border-border bg-accent px-3 py-1 text-xs text-muted-foreground"
        >
          {{ activeItem.categoryLabel }}
        </span>
      </div>

      <!-- Dot indicators -->
      <div class="mt-4 flex justify-center gap-2">
        <button
          v-for="(w, i) in items"
          :key="w.id"
          class="featured-carousel__dot h-2 rounded-full border cursor-pointer transition-all duration-300"
          :class="
            i === currentIndex
              ? 'w-6 bg-palette-yellow border-palette-yellow rounded-[4px]'
              : 'w-2 bg-accent border-border hover:bg-muted-foreground/70 hover:scale-[1.2]'
          "
          @click="goTo(i)"
          :aria-label="`Go to slide ${i + 1}`"
        />
      </div>
    </div>
  </section>
</template>

<style lang="scss" scoped>
/* Card sizing -- needs calc with vh units */
.featured-carousel__card {
  flex: 0 0 calc(60vh * 16 / 9);
  height: 60vh;
}

/* Run button -- absolute positioned with custom font, needs style block */
.featured-carousel__run-btn {
  position: absolute;
  z-index: 5;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.25rem;
  background: #F0FF41;
  color: #000;
  font-family: var(--font-brand);
  font-style: italic;
  font-weight: 900;
  font-size: 1.125rem;
  border-radius: 8px;
  white-space: nowrap;
  transition: transform 150ms;
  box-shadow: 0 4px 24px rgba(240, 255, 65, 0.3);

  &:hover {
    transform: translate(-50%, -50%) scale(1.05);
  }

  @media (max-width: 768px) {
    font-size: 0.875rem;
    padding: 0.5rem 1rem;
  }
}

/* Ticker text -- custom font reference */
.featured-carousel__ticker-text {
  font-family: var(--font-brand);
  font-size: clamp(5rem, 10vw, 9rem);
  font-weight: 900;
  font-style: italic;
  color: transparent;
  -webkit-text-stroke: 2px rgba(236, 255, 0, 0.4);
  line-height: 1;
  white-space: nowrap;
  text-transform: uppercase;
  user-select: none;
}

/* Ticker scroll animation */
.featured-carousel__ticker-track {
  animation: ticker-scroll 30s linear infinite;
}

/* Glow orbs -- complex radial gradients */
.featured-carousel__glow {
  position: absolute;
  width: 944px;
  height: 944px;
  border-radius: 50%;
  pointer-events: none;
  z-index: 0;
  opacity: 0.15;

  &--left {
    left: -466px;
    top: 50%;
    transform: translateY(-50%);
    background: radial-gradient(circle, rgba(59, 130, 246, 0.4) 0%, transparent 70%);
  }

  &--right {
    right: -466px;
    top: 50%;
    transform: translateY(-50%);
    background: radial-gradient(circle, rgba(96, 165, 250, 0.4) 0%, transparent 70%);
  }
}

/* Navigation arrows -- show on hover/focus, complex positioning */
.featured-carousel__arrow {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 10;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(var(--accent), 0.85);
  backdrop-filter: blur(8px);
  border: 1px solid var(--border);
  color: var(--foreground);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 150ms, border-color 150ms, opacity 150ms, transform 150ms;
  opacity: 0;

  .featured-carousel:hover &,
  .featured-carousel:focus-within & {
    opacity: 1;
  }

  &:hover {
    background: var(--muted);
    border-color: var(--border);
    transform: translateY(-50%) scale(1.1);
  }

  &--left {
    left: 1rem;
  }

  &--right {
    right: 1rem;
  }

  @media (max-width: 768px) {
    width: 36px;
    height: 36px;
    opacity: 1; /* Always visible on mobile (no hover) */

    &--left {
      left: 0.5rem;
    }

    &--right {
      right: 0.5rem;
    }
  }
}

@keyframes ticker-scroll {
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
</style>
