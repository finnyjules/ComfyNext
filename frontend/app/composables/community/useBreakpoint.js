import { ref, onMounted, onUnmounted } from 'vue'

const breakpoints = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
}

export function useBreakpoint() {
  const width = ref(typeof window !== 'undefined' ? window.innerWidth : 1280)
  const isMobile = ref(false)
  const isTablet = ref(false)
  const isDesktop = ref(true)

  function update() {
    width.value = window.innerWidth
    isMobile.value = width.value < breakpoints.md
    isTablet.value = width.value >= breakpoints.md && width.value < breakpoints.lg
    isDesktop.value = width.value >= breakpoints.lg
  }

  onMounted(() => {
    update()
    window.addEventListener('resize', update)
  })

  onUnmounted(() => {
    window.removeEventListener('resize', update)
  })

  return { width, isMobile, isTablet, isDesktop }
}
