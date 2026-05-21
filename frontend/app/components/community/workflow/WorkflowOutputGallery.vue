<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  images: { type: Array, default: () => [] },
})

const lightboxIndex = ref(-1)

function openLightbox(index) {
  lightboxIndex.value = index
}

function closeLightbox() {
  lightboxIndex.value = -1
}

function prevImage() {
  if (lightboxIndex.value > 0) lightboxIndex.value--
}

function nextImage() {
  if (lightboxIndex.value < props.images.length - 1) lightboxIndex.value++
}

function handleKeydown(e) {
  if (lightboxIndex.value < 0) return
  if (e.key === 'Escape') closeLightbox()
  if (e.key === 'ArrowRight') nextImage()
  if (e.key === 'ArrowLeft') prevImage()
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div class="output-gallery">
    <img
      v-for="(img, i) in images"
      :key="i"
      :src="img?.url || img"
      :alt="img?.caption || `Output ${i + 1}`"
      class="output-gallery__image"
      loading="lazy"
      @click="openLightbox(i)"
    />

    <!-- Lightbox overlay -->
    <Teleport to="body">
      <Transition name="lightbox-fade">
        <div
          v-if="lightboxIndex >= 0"
          class="output-gallery__lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Image lightbox"
          @click.self="closeLightbox"
        >
          <button class="output-gallery__lightbox-close" @click="closeLightbox" aria-label="Close lightbox">
            &times;
          </button>
          <img
            :src="images[lightboxIndex]?.url || images[lightboxIndex]"
            alt="Workflow output full size"
            class="output-gallery__lightbox-image"
          />
          <span v-if="images.length > 1" class="output-gallery__lightbox-counter">
            {{ lightboxIndex + 1 }} / {{ images.length }}
          </span>
          <div v-if="images.length > 1" class="output-gallery__lightbox-nav">
            <button
              class="output-gallery__lightbox-btn"
              :disabled="lightboxIndex === 0"
              @click.stop="prevImage"
              aria-label="Previous image"
            >
              &#8249;
            </button>
            <button
              class="output-gallery__lightbox-btn"
              :disabled="lightboxIndex === images.length - 1"
              @click.stop="nextImage"
              aria-label="Next image"
            >
              &#8250;
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style lang="scss" scoped>
.output-gallery {
  display: flex;
  flex-direction: column;
  gap: $space-4;

  &__image {
    width: 100%;
    display: block;
    border-radius: $radius-xl;
    object-fit: cover;
    cursor: zoom-in;
  }

  // Lightbox
  &__lightbox {
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: rgba(0, 0, 0, 0.9);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: zoom-out;
    backdrop-filter: blur(8px);
  }

  &__lightbox-close {
    position: absolute;
    top: $space-4;
    right: $space-4;
    background: none;
    border: none;
    color: $color-text-primary;
    font-size: $text-4xl;
    cursor: pointer;
    line-height: 1;
    padding: $space-2;
    opacity: 0.7;
    transition: opacity $transition-fast;
    z-index: 1;

    &:hover {
      opacity: 1;
    }
  }

  &__lightbox-image {
    max-width: 90vw;
    max-height: 85vh;
    object-fit: contain;
    border-radius: $radius-md;
    cursor: default;
  }

  &__lightbox-counter {
    position: absolute;
    bottom: $space-6;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.65);
    color: $color-text-primary;
    font-size: $text-sm;
    font-weight: $weight-medium;
    padding: $space-1 $space-4;
    border-radius: $radius-full;
    pointer-events: none;
    font-variant-numeric: tabular-nums;
  }

  &__lightbox-nav {
    position: absolute;
    bottom: $space-6;
    right: $space-6;
    display: flex;
    gap: $space-2;
  }

  &__lightbox-btn {
    width: 40px;
    height: 40px;
    border-radius: $radius-full;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: $color-text-primary;
    font-size: $text-2xl;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background $transition-fast;

    &:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.2);
    }

    &:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }
  }
}

// Lightbox transition
.lightbox-fade-enter-active,
.lightbox-fade-leave-active {
  transition: opacity 0.25s ease;
}

.lightbox-fade-enter-from,
.lightbox-fade-leave-to {
  opacity: 0;
}
</style>
