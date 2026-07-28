<script setup lang="ts">
import { Sparkles } from 'lucide-vue-next'
import NodeCapsule from '~/components/vue-canvas/NodeCapsule.vue'

const icon = { kind: 'component' as const, value: Sparkles }
const states = [
  { state: 'ready' as const, title: 'Flux Dev', readout: '28 steps · guidance 3.5' },
  { state: 'running' as const, title: 'Flux Dev', readout: 'rendering · 12.5s' },
  { state: 'done' as const, title: 'Flux Dev', readout: '28 steps · seed 84021' },
  { state: 'failed' as const, title: 'Export', readout: 'No credits remaining' },
]
</script>

<template>
  <div class="capsule-lab">
    <h1>Capsule lab</h1>
    <div class="capsule-lab__rows">
      <div v-for="s in states" :key="s.state" class="capsule-lab__row">
        <NodeCapsule
          :title="s.title"
          :readout="s.readout"
          :icon="icon"
          :state="s.state"
          border-left="#facc15"
          border-right="#60a5fa"
        />
        <span class="capsule-lab__label">{{ s.state }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Self-contained, like the component it exercises. A harness that depends on
   utilities being generated can quietly render half-styled and make you trust
   a reading it didn't earn — which is exactly what happened the first time. */
.capsule-lab { min-height: 100vh; background: #0b0a09; padding: 64px; }
.capsule-lab h1 {
  margin: 0 0 40px;
  font-size: 14px;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: rgba(255, 255, 255, 0.3);
}
.capsule-lab__rows { display: flex; flex-direction: column; gap: 40px; }
.capsule-lab__row { display: flex; align-items: center; gap: 32px; }
.capsule-lab__label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: rgba(255, 255, 255, 0.3);
}
</style>
