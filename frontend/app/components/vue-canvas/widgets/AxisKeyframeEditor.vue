<script setup lang="ts">
/**
 * AxisKeyframeEditor — mini-timeline for variable-font axis animation.
 *
 * Shows a horizontal bar per animated axis with diamond keyframe markers.
 * Click the bar to add a keyframe, drag to reposition, click a keyframe
 * to select and edit its axis values. Designed to sit inside the Kinetic
 * Typography widget as an expandable section.
 */
import type { AxisKeyframe } from '~/composables/useKineticRenderer'
import type { FontAxis } from '~/data/variable-fonts'

const props = defineProps<{
  keyframes: AxisKeyframe[]
  axes: FontAxis[]
  /** Current static axis values (used as defaults for new keyframes). */
  currentAxes: Record<string, number>
}>()

const emit = defineEmits<{
  'update:keyframes': [keyframes: AxisKeyframe[]]
}>()

const selectedIdx = ref<number | null>(null)

const selected = computed(() =>
  selectedIdx.value !== null ? props.keyframes[selectedIdx.value] ?? null : null,
)

function addKeyframe(t: number) {
  const kf: AxisKeyframe = {
    t: Math.max(0, Math.min(1, t)),
    axes: { ...props.currentAxes },
  }
  const updated = [...props.keyframes, kf].sort((a, b) => a.t - b.t)
  emit('update:keyframes', updated)
  // Select the newly added keyframe
  selectedIdx.value = updated.findIndex(k => k === kf)
}

function removeKeyframe(idx: number) {
  const updated = props.keyframes.filter((_, i) => i !== idx)
  emit('update:keyframes', updated)
  selectedIdx.value = null
}

function updateKeyframeAxis(idx: number, tag: string, value: number) {
  const updated = props.keyframes.map((kf, i) => {
    if (i !== idx) return kf
    return { ...kf, axes: { ...kf.axes, [tag]: value } }
  })
  emit('update:keyframes', updated)
}

function onTrackClick(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const t = (e.clientX - rect.left) / rect.width
  addKeyframe(t)
}

// Drag state
let dragging: { idx: number; startX: number; startT: number } | null = null

function startDrag(idx: number, e: MouseEvent) {
  e.stopPropagation()
  selectedIdx.value = idx
  const track = (e.currentTarget as HTMLElement).parentElement!
  const rect = track.getBoundingClientRect()
  dragging = { idx, startX: e.clientX, startT: props.keyframes[idx].t }

  const onMove = (me: MouseEvent) => {
    if (!dragging) return
    const dx = me.clientX - dragging.startX
    const dt = dx / rect.width
    const newT = Math.max(0, Math.min(1, dragging.startT + dt))
    const updated = props.keyframes.map((kf, i) => {
      if (i !== dragging!.idx) return kf
      return { ...kf, t: newT }
    })
    emit('update:keyframes', updated)
  }

  const onUp = () => {
    dragging = null
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    // Re-sort after drag
    const sorted = [...props.keyframes].sort((a, b) => a.t - b.t)
    emit('update:keyframes', sorted)
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}
</script>

<template>
  <div class="ake">
    <div class="ake__head">
      <span>Axis Keyframes</span>
      <span class="ake__count">{{ keyframes.length }}</span>
    </div>

    <!-- Timeline track -->
    <div class="ake__track" @click="onTrackClick">
      <div class="ake__track-bg" />
      <div
        v-for="(kf, i) in keyframes"
        :key="i"
        class="ake__marker"
        :class="{ 'ake__marker--selected': selectedIdx === i }"
        :style="{ left: `${kf.t * 100}%` }"
        @mousedown="startDrag(i, $event)"
        @click.stop="selectedIdx = i"
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <rect x="1" y="1" width="8" height="8" rx="1" transform="rotate(45 5 5)" fill="currentColor" />
        </svg>
      </div>
    </div>

    <!-- Selected keyframe editor -->
    <div v-if="selected !== null && selectedIdx !== null" class="ake__editor">
      <div class="ake__editor-head">
        <span>t = {{ (selected.t * 100).toFixed(0) }}%</span>
        <button type="button" class="ake__remove" @click="removeKeyframe(selectedIdx)">Remove</button>
      </div>
      <div v-for="ax in axes" :key="ax.tag" class="ake__axis">
        <div class="ake__axis-head">
          <span>{{ ax.label }}</span>
          <span class="ake__axis-val">{{ Math.round((selected.axes[ax.tag] ?? ax.default) * 100) / 100 }}</span>
        </div>
        <input
          type="range"
          :min="ax.min" :max="ax.max" :step="ax.step ?? 1"
          :value="selected.axes[ax.tag] ?? ax.default"
          class="ake__range"
          @input="updateKeyframeAxis(selectedIdx!, ax.tag, +($event.target as HTMLInputElement).value)"
        />
      </div>
    </div>

    <div v-else class="ake__hint">
      Click the track to add keyframes
    </div>
  </div>
</template>

<style scoped>
.ake { display: flex; flex-direction: column; gap: 5px; }
.ake__head {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.05em;
  color: rgba(255,255,255,0.38);
}
.ake__count {
  font-size: 9px; background: rgba(255,255,255,0.08);
  padding: 1px 5px; border-radius: 4px; color: rgba(255,255,255,0.5);
}

.ake__track {
  position: relative; height: 20px; cursor: crosshair;
  border-radius: 4px; overflow: visible;
}
.ake__track-bg {
  position: absolute; inset: 8px 0;
  background: rgba(255,255,255,0.08);
  border-radius: 2px;
}
.ake__marker {
  position: absolute; top: 50%; transform: translate(-50%, -50%);
  color: rgba(129,140,248,0.7); cursor: grab; z-index: 1;
  transition: color 0.1s;
}
.ake__marker:hover { color: rgba(129,140,248,1); }
.ake__marker--selected { color: #818cf8; filter: drop-shadow(0 0 3px rgba(129,140,248,0.5)); }

.ake__editor {
  display: flex; flex-direction: column; gap: 4px;
  padding: 5px 6px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 6px;
}
.ake__editor-head {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 10px; color: rgba(255,255,255,0.6);
}
.ake__remove {
  font-size: 9px; color: rgba(239,68,68,0.8); background: none;
  border: none; cursor: pointer; padding: 0;
}
.ake__remove:hover { color: #ef4444; }

.ake__axis { display: flex; flex-direction: column; gap: 1px; }
.ake__axis-head {
  display: flex; justify-content: space-between;
  font-size: 10px; color: rgba(255,255,255,0.55);
}
.ake__axis-val { font-variant-numeric: tabular-nums; color: rgba(255,255,255,0.8); }
.ake__range { width: 100%; height: 4px; cursor: pointer; accent-color: #818cf8; }

.ake__hint {
  font-size: 9px; color: rgba(255,255,255,0.25); text-align: center;
  padding: 4px 0;
}
</style>
