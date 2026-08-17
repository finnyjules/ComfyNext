<script setup lang="ts">
/**
 * Odometer-style number: each digit is a vertical drum of 0-9 that rolls to
 * its current value. Feed it a value that changes per frame (the wallet
 * tween) and the low digits spin like a cash register while the high digits
 * click over once. Separators (thousands commas) stay static.
 *
 * Digit columns are KEYED BY POSITION FROM THE RIGHT so the ones column
 * keeps its element identity when the number gains or loses a digit
 * (10,001 → 9,998) — otherwise every drum would remount and snap.
 */
import { computed } from 'vue'

const props = defineProps<{ value: number }>()

const label = computed(() => Math.max(0, Math.round(props.value)).toLocaleString('en-US'))

const chars = computed(() => {
  const s = label.value
  const n = s.length
  return Array.from(s, (ch, i) => {
    const fromRight = n - 1 - i
    const digit = ch >= '0' && ch <= '9' ? Number(ch) : null
    return { key: digit === null ? `sep-${fromRight}` : `d-${fromRight}`, ch, digit }
  })
})
</script>

<template>
  <span class="rolling-number" role="text" :aria-label="label">
    <template v-for="c in chars" :key="c.key">
      <span v-if="c.digit === null" class="rn-sep" aria-hidden="true">{{ c.ch }}</span>
      <span v-else class="rn-col" aria-hidden="true">
        <span class="rn-strip" :style="{ transform: `translateY(-${c.digit}em)` }">
          <span v-for="d in 10" :key="d - 1" class="rn-digit">{{ d - 1 }}</span>
        </span>
      </span>
    </template>
  </span>
</template>

<style scoped>
.rolling-number {
  display: inline-flex;
  align-items: flex-start;
  height: 1em;
  overflow: hidden;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  /* Sits inline with surrounding text; 1em height tracks the host font size. */
  vertical-align: -0.13em;
}
.rn-col {
  display: inline-block;
  height: 1em;
  overflow: hidden;
}
.rn-strip {
  display: flex;
  flex-direction: column;
  /* Short transition + per-frame retargeting from the driving tween = a
     continuous roll; on a single-step change it's one clean click-over. */
  transition: transform 140ms cubic-bezier(0.2, 0.6, 0.3, 1);
  will-change: transform;
}
.rn-digit {
  height: 1em;
  line-height: 1;
  text-align: center;
}
.rn-sep {
  display: inline-block;
  line-height: 1;
}
@media (prefers-reduced-motion: reduce) {
  .rn-strip { transition: none; }
}
</style>
