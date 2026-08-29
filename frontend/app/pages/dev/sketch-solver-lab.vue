<!-- app/pages/dev/sketch-solver-lab.vue -->
<script setup lang="ts">
// Dev harness — not linked in the app. Proving ground for the sketch constraint solver.
definePageMeta({ layout: false })
import { ref, computed, onMounted } from 'vue'
import type { SketchDoc, EntityId } from '~/lib/sketch/model'
import { getPoint } from '~/lib/sketch/model'
import { solve, type DragTarget, type SolveResult } from '~/lib/sketch/solve'
import { sketchPathData } from '~/lib/sketch/sketchPath'

const doc = ref<SketchDoc>({ entities: [], constraints: [] })
const status = ref('empty')
const ready = ref(false)

// world→screen: 40px per unit, origin near lower-left of a 640x420 board
const S = 34, OX = 60, OY = 360
const sx = (x: number) => OX + x * S
const sy = (y: number) => OY - y * S
const wx = (px: number) => (px - OX) / S
const wy = (py: number) => (OY - py) / S

const pathScreen = computed(() => {
  // re-emit in screen space by remapping: build a transformed shadow doc
  const d = doc.value
  const shadow: SketchDoc = {
    entities: d.entities.map(e => e.kind === 'point'
      ? { ...e, x: sx(e.x), y: sy(e.y) }
      : e.kind === 'circle' ? { ...e, r: e.r * S } : { ...e }),
    constraints: [],
  }
  return sketchPathData(shadow)
})
const points = computed(() => doc.value.entities.filter(e => e.kind === 'point') as any[])

function loadTangentDemo() {
  doc.value = {
    entities: [
      { id: 'a', kind: 'point', x: 1, y: 2, fixed: true },
      { id: 'b', kind: 'point', x: 12, y: 2 },
      { id: 'cc', kind: 'point', x: 6, y: 9 },
      { id: 'L', kind: 'line', p1: 'a', p2: 'b' },
      { id: 'C', kind: 'circle', center: 'cc', r: 3 },
    ],
    constraints: [
      { id: 'k', kind: 'tangentLineCircle', refs: ['L', 'C'] },
      { id: 'rr', kind: 'radius', refs: ['C'], value: 3 },
    ],
  }
  runSolve()
}

function runSolve(drag?: DragTarget): SolveResult {
  const res = solve(doc.value, { maxIter: 120, drag })
  status.value = res.converged ? `solved (${res.iterations} it)` : `NOT converged (${res.residualNorm.toFixed(2)})`
  return res
}

// pointer drag
let dragId: EntityId | null = null
function onDown(id: EntityId) { dragId = id }
function onMove(ev: PointerEvent) {
  if (!dragId) return
  const svg = (ev.currentTarget as SVGSVGElement).getBoundingClientRect()
  runSolve({ point: dragId, x: wx(ev.clientX - svg.left), y: wy(ev.clientY - svg.top) })
}
function onUp() { dragId = null }

onMounted(() => {
  ;(window as any).__sketchLab = {
    get doc() { return doc.value },
    solve: (drag?: DragTarget) => runSolve(drag),
    loadTangentDemo,
    setPoint: (id: EntityId, x: number, y: number) => runSolve({ point: id, x, y }),
    pathData: () => sketchPathData(doc.value),
  }
  ready.value = true
})
</script>

<template>
  <div :data-ready="ready ? '' : undefined" style="font-family: ui-sans-serif, system-ui; padding: 12px; color: #e5e5e5; background: #111; min-height: 100vh">
    <h1 style="font-size: 14px; margin: 0 0 8px">Sketch Solver Lab</h1>
    <div style="display: flex; gap: 8px; margin-bottom: 8px">
      <button data-act="demo" @click="loadTangentDemo" style="padding: 4px 10px">Tangent demo</button>
      <span data-status style="align-self: center; font-size: 12px; color: #9ca3af">{{ status }}</span>
    </div>
    <svg width="640" height="420" style="background: #fafafa; border-radius: 8px; touch-action: none"
         @pointermove="onMove" @pointerup="onUp" @pointerleave="onUp">
      <path :d="pathScreen" fill="none" stroke="#3730a3" stroke-width="1.5" />
      <circle v-for="p in points" :key="p.id" :cx="sx(p.x)" :cy="sy(p.y)"
              :r="p.fixed ? 5 : 6" :fill="p.fixed ? '#9ca3af' : '#2563eb'"
              style="cursor: grab" @pointerdown="onDown(p.id)" :data-point="p.id" />
    </svg>
  </div>
</template>
