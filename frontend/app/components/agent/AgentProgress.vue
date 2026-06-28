<script setup lang="ts">
// A single rotating progress line shown while the agent works — generic phases
// fade through one at a time with a Claude-style shimmer (we can't stream real
// reasoning reliably, so this is honest "something is happening" feedback).
import { onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{ active: boolean }>()

const PHASES = [
  'Analyzing the request…',
  'Planning the changes…',
  'Composing the layout…',
  'Applying changes…',
]
const i = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

function stop() { if (timer) { clearInterval(timer); timer = null } }
function start() {
  stop()
  i.value = 0
  timer = setInterval(() => { i.value = (i.value + 1) % PHASES.length }, 1900)
}

watch(() => props.active, (a) => { a ? start() : stop() }, { immediate: true })
onBeforeUnmount(stop)
</script>

<template>
  <div class="flex items-center gap-1.5 text-[11.5px]">
    <span class="text-white/60">✦</span>
    <Transition name="agent-phase" mode="out-in">
      <span :key="PHASES[i]" class="agent-shimmer">{{ PHASES[i] }}</span>
    </Transition>
  </div>
</template>

<style scoped>
.agent-phase-enter-active,
.agent-phase-leave-active { transition: opacity 0.28s ease, transform 0.28s ease; }
.agent-phase-enter-from { opacity: 0; transform: translateY(3px); }
.agent-phase-leave-to { opacity: 0; transform: translateY(-3px); }

/* Claude-style shimmer: a soft light sweep across the muted text. */
.agent-shimmer {
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.32) 0%, rgba(255, 255, 255, 0.85) 50%, rgba(255, 255, 255, 0.32) 100%);
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: agent-shimmer 1.9s linear infinite;
}
@keyframes agent-shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}
</style>
