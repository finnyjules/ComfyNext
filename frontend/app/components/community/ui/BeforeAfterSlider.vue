<script setup>
import { ref, computed } from 'vue'

defineProps({
  beforeImage: { type: String, required: true },
  afterImage: { type: String, required: true },
  beforeLabel: { type: String, default: 'Before' },
  afterLabel: { type: String, default: 'After' },
})

const containerRef = ref(null)
const position = ref(50) // percentage 0-100

const clipStyle = computed(() => ({
  clipPath: `inset(0 ${100 - position.value}% 0 0)`,
}))

const dividerStyle = computed(() => ({
  left: `${position.value}%`,
}))

function updatePosition(clientX) {
  if (!containerRef.value) return
  const rect = containerRef.value.getBoundingClientRect()
  const x = clientX - rect.left
  const pct = Math.max(0, Math.min(100, (x / rect.width) * 100))
  position.value = pct
}

function handleMouseMove(e) {
  updatePosition(e.clientX)
}

function handleMouseLeave() {
  position.value = 50
}

function handleTouchMove(e) {
  e.preventDefault()
  updatePosition(e.touches[0].clientX)
}
</script>

<template>
  <div
    ref="containerRef"
    class="relative rounded-xl overflow-hidden cursor-default select-none aspect-square"
    @mousemove="handleMouseMove"
    @mouseleave="handleMouseLeave"
    @touchmove="handleTouchMove"
  >
    <!-- After image (bottom layer, always fully visible) -->
    <img :src="afterImage" alt="After" class="block w-full h-full object-cover absolute top-0 left-0" draggable="false" />

    <!-- Before image (top layer, clipped) -->
    <img
      :src="beforeImage"
      alt="Before"
      class="block w-full h-full object-cover absolute top-0 left-0 z-[1]"
      :style="clipStyle"
      draggable="false"
    />

    <!-- Divider line -->
    <div class="ba-divider" :style="dividerStyle">
      <div class="ba-handle">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>
    </div>

    <!-- Labels -->
    <span class="absolute top-3 left-3 z-[3] bg-black/55 text-white text-xs font-medium px-2 py-1 rounded-sm pointer-events-none backdrop-blur-sm tracking-wide uppercase">{{ beforeLabel }}</span>
    <span class="absolute top-3 right-3 z-[3] bg-black/55 text-white text-xs font-medium px-2 py-1 rounded-sm pointer-events-none backdrop-blur-sm tracking-wide uppercase">{{ afterLabel }}</span>
  </div>
</template>

<style scoped>
.ba-divider {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #ffffff;
  z-index: 2;
  transform: translateX(-50%);
  pointer-events: none;
  box-shadow: 0 0 8px rgba(0, 0, 0, 0.5);
}

.ba-handle {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 44px;
  height: 44px;
  border-radius: 9999px;
  background: rgba(0, 0, 0, 0.6);
  border: 2px solid #ffffff;
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  pointer-events: none;
  gap: -4px;
}

.ba-handle svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
</style>
