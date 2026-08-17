<script setup lang="ts">
/**
 * Dev harness for the wallet pill's odometer. Drives RollingNumber through
 * the same tween the layout uses (lib/countTween) so the cash-register feel
 * can be verified without a hosted session. Dev-only page (stripped in prod
 * by the nuxt.config dev-pages module).
 */
import { ref, onUnmounted } from 'vue'
import RollingNumber from '~/components/RollingNumber.vue'
import { tweenValue, shouldAnimateWalletChange } from '~/lib/countTween'

const balance = ref(9000)
const displayed = ref(9000)
let raf = 0
const TWEEN_MS = 900

function setBalance(next: number) {
  const prev = balance.value
  balance.value = next
  cancelAnimationFrame(raf)
  if (!shouldAnimateWalletChange(prev, next)) { displayed.value = next; return }
  const from = displayed.value
  const start = performance.now()
  const step = (now: number) => {
    const t = (now - start) / TWEEN_MS
    displayed.value = tweenValue(from, next, t)
    if (t < 1) raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
}
onUnmounted(() => cancelAnimationFrame(raf))
</script>

<template>
  <div class="min-h-screen bg-[#111] text-white p-10 flex flex-col items-start gap-8">
    <h1 class="text-sm uppercase tracking-widest text-white/40">RollingNumber harness</h1>

    <!-- The pill, verbatim styling from the layout -->
    <button class="flex items-center gap-1.5 bg-[#1a1a1a] rounded-full px-3 py-1.5 border border-[#2a2a2a]">
      <span class="text-xs font-medium text-white/70">
        <RollingNumber :value="displayed" /> credits
      </span>
    </button>

    <!-- Big version so the roll is easy to inspect -->
    <div class="text-6xl font-semibold tabular-nums">
      <RollingNumber :value="displayed" />
    </div>

    <div class="flex flex-wrap gap-3">
      <button class="px-3 py-1.5 rounded bg-[#2a2a2a] hover:bg-[#333] text-sm" data-test="debit-2" @click="setBalance(balance - 2)">debit 2</button>
      <button class="px-3 py-1.5 rounded bg-[#2a2a2a] hover:bg-[#333] text-sm" data-test="debit-481" @click="setBalance(balance - 481)">debit 481</button>
      <button class="px-3 py-1.5 rounded bg-[#2a2a2a] hover:bg-[#333] text-sm" data-test="topup" @click="setBalance(balance + 7200)">top up 7,200</button>
      <button class="px-3 py-1.5 rounded bg-[#2a2a2a] hover:bg-[#333] text-sm" data-test="cross-length" @click="setBalance(balance >= 10000 ? 9998 : 10001)">cross 10k boundary</button>
    </div>

    <p class="text-white/40 text-xs max-w-md">Low digits should spin like drums while high digits click over once; commas stay put; crossing the 10k boundary must not remount the surviving columns.</p>
  </div>
</template>
