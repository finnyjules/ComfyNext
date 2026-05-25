<script setup lang="ts">
/**
 * Renders text inside a fixed-size box, shrinking fontSize so the wrapped
 * content fits both width and height. Treats the incoming `fontSize` as the
 * max; never goes below `minSize`. The actual rendered size is computed by
 * binary-searching candidate sizes against the element's offsetWidth/
 * scrollHeight, so it stays in lockstep with whatever the box ends up being
 * after layout.
 *
 * Mirrors the server-side opentype measurement in render-template.post.ts so
 * the editor preview matches the final PNG output.
 */
const props = defineProps<{
  text: string
  maxFontSize: number
  minFontSize: number
  // Pass through any extra style the parent wants applied to the text node.
  // We add the resolved fontSize on top.
  style: Record<string, string | number>
}>()

const rootRef = ref<HTMLDivElement | null>(null)
const fitted = ref(props.maxFontSize)

function fits(size: number): boolean {
  const el = rootRef.value
  if (!el) return true
  el.style.fontSize = `${size}px`
  return el.scrollWidth <= el.clientWidth + 0.5
      && el.scrollHeight <= el.clientHeight + 0.5
}

function measure() {
  if (!rootRef.value) return
  let lo = props.minFontSize
  let hi = props.maxFontSize
  let best = props.minFontSize
  // Binary search the largest integer size that still fits.
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (fits(mid)) { best = mid; lo = mid + 1 }
    else           { hi = mid - 1 }
  }
  fitted.value = best
  // Apply the chosen size so the next paint is correct (we leave the element's
  // inline style at the last `fits()` test value otherwise).
  if (rootRef.value) rootRef.value.style.fontSize = `${best}px`
}

onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined' && rootRef.value) {
    const ro = new ResizeObserver(() => measure())
    ro.observe(rootRef.value)
    onUnmounted(() => ro.disconnect())
  }
})

// Re-measure when text, size bounds, or any other style prop changes — covers
// variant cycling (text changes) and live drag-resize (clientWidth changes).
watch(() => [props.text, props.maxFontSize, props.minFontSize, props.style], () => {
  nextTick(measure)
}, { deep: true })

const composedStyle = computed(() => ({
  ...props.style,
  fontSize: `${fitted.value}px`,
}))
</script>

<template>
  <div ref="rootRef" :style="composedStyle">{{ text }}</div>
</template>
