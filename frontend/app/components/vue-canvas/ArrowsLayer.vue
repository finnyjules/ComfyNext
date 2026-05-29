<script setup lang="ts">
/**
 * Renders all narrative arrows in a single SVG. Endpoints are *resolved* by
 * the parent (canvas) — this component only knows about coordinates, not
 * about groups or annotations.
 *
 * Selection model: parent passes `selectedId`. When an arrow is selected,
 * we render endpoint handles (drag to reposition as a free point) and a
 * midpoint curve handle (drag perpendicular to bend the arrow). Click on
 * the wide hit-target selects.
 *
 * Visual identity vs data wires:
 *  - dashed stroke (not solid)
 *  - violet default (not type-colored)
 *  - sits above wires in z-order
 */

import { useVueFlow } from '@vue-flow/core'
import type { ArrowAnnotation } from '~/composables/useCanvasAnnotations'

export interface ResolvedArrow {
  id: string
  fromX: number
  fromY: number
  toX: number
  toY: number
  label?: string
  color: string
  curveOffset: number
  thickness: number
  source: ArrowAnnotation
}

const props = defineProps<{
  arrows: ResolvedArrow[]
  selectedId?: string | null
}>()

const emit = defineEmits<{
  'context-menu': [arrowId: string, x: number, y: number]
  'select': [arrowId: string]
  // Drag events report graph-space coords of where the handle is now.
  // The canvas knows how to update the underlying annotation.
  'endpoint-drag':       [arrowId: string, which: 'from' | 'to', x: number, y: number]
  'endpoint-drag-end':   [arrowId: string, which: 'from' | 'to']
  'curve-drag':          [arrowId: string, x: number, y: number]
  'curve-drag-end':      [arrowId: string]
}>()

const { project, viewport } = useVueFlow()

// Path generation — quadratic bezier with a single control point derived from
// the perpendicular offset. Straight when offset == 0.
function controlPoint(a: ResolvedArrow): { x: number; y: number } {
  const dx = a.toX - a.fromX
  const dy = a.toY - a.fromY
  const dist = Math.hypot(dx, dy) || 1
  const mx = (a.fromX + a.toX) / 2
  const my = (a.fromY + a.toY) / 2
  // Perpendicular unit vector. For a quadratic bezier, the curve passes
  // through `mid + perp*offset` when the control point is at `mid + perp*offset*2`.
  const px = -dy / dist
  const py = dx / dist
  return { x: mx + px * a.curveOffset * 2, y: my + py * a.curveOffset * 2 }
}

function pathFor(a: ResolvedArrow): string {
  const dx = a.toX - a.fromX
  const dy = a.toY - a.fromY
  const dist = Math.hypot(dx, dy)
  if (dist < 4) return `M${a.fromX},${a.fromY} L${a.toX},${a.toY}`
  if (Math.abs(a.curveOffset) < 0.5) {
    // Straight: use a line so the arrowhead orients along it correctly.
    return `M${a.fromX},${a.fromY} L${a.toX},${a.toY}`
  }
  const cp = controlPoint(a)
  return `M${a.fromX},${a.fromY} Q${cp.x},${cp.y} ${a.toX},${a.toY}`
}

// Where the curve handle sits — at the actual midpoint of the curve, which
// for a quadratic bezier at t=0.5 is `mid + perp*offset` (not the control
// point itself). Makes the drag feel direct: "the handle IS the bulge."
function curveHandlePos(a: ResolvedArrow): { x: number; y: number } {
  const dx = a.toX - a.fromX
  const dy = a.toY - a.fromY
  const dist = Math.hypot(dx, dy) || 1
  const mx = (a.fromX + a.toX) / 2
  const my = (a.fromY + a.toY) / 2
  const px = -dy / dist
  const py = dx / dist
  return { x: mx + px * a.curveOffset, y: my + py * a.curveOffset }
}

function labelPos(a: ResolvedArrow): { x: number; y: number } {
  // Use the curve midpoint so the label tracks the bend instead of floating
  // detached over the chord.
  return curveHandlePos(a)
}

// BBox includes endpoint + curve handles so they aren't clipped by the SVG
// element's size, and we leave generous padding for arrowheads / labels.
const bbox = computed(() => {
  if (!props.arrows.length) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const a of props.arrows) {
    const cp = curveHandlePos(a)
    minX = Math.min(minX, a.fromX, a.toX, cp.x)
    minY = Math.min(minY, a.fromY, a.toY, cp.y)
    maxX = Math.max(maxX, a.fromX, a.toX, cp.x)
    maxY = Math.max(maxY, a.fromY, a.toY, cp.y)
  }
  const pad = 60
  return { x: minX - pad, y: minY - pad, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 }
})

// Selection styling: selected arrows get a brighter stroke + bigger arrowhead +
// a soft glow filter to draw the eye.
function strokeWidth(a: ResolvedArrow): number {
  return props.selectedId === a.id ? a.thickness + 0.75 : a.thickness
}

function onPathContextMenu(e: MouseEvent, id: string) {
  e.preventDefault()
  e.stopPropagation()
  emit('context-menu', id, e.clientX, e.clientY)
}
function onPathClick(e: MouseEvent, id: string) {
  e.stopPropagation()
  emit('select', id)
}

// ---- Handle dragging -------------------------------------------------------
//
// We capture pointer events on the handle <circle>s. To convert pointer
// screen coords to graph coords, we use Vue Flow's `project()` — same as
// the canvas does for spawn positions. Coordinates emitted are graph-space.

type ActiveDrag =
  | { kind: 'endpoint'; arrowId: string; which: 'from' | 'to' }
  | { kind: 'curve';    arrowId: string }
  | null

let active: ActiveDrag = null

function onHandleDown(e: PointerEvent, drag: NonNullable<ActiveDrag>) {
  if (e.button !== 0) return
  e.stopPropagation()
  ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  active = drag
}
function onHandleMove(e: PointerEvent) {
  if (!active) return
  e.stopPropagation()
  const pos = project({ x: e.clientX, y: e.clientY })
  if (active.kind === 'endpoint') {
    emit('endpoint-drag', active.arrowId, active.which, pos.x, pos.y)
  } else {
    emit('curve-drag', active.arrowId, pos.x, pos.y)
  }
}
function onHandleUp(e: PointerEvent) {
  if (!active) return
  e.stopPropagation()
  ;(e.currentTarget as Element).releasePointerCapture?.(e.pointerId)
  if (active.kind === 'endpoint') emit('endpoint-drag-end', active.arrowId, active.which)
  else emit('curve-drag-end', active.arrowId)
  active = null
}

// Handle visual size is inversely scaled by zoom so they stay clickable at
// any zoom level. Without this, handles shrink with the canvas when zoomed
// out and become impossible to grab.
const handleScale = computed(() => 1 / Math.max(0.2, viewport.value.zoom || 1))
</script>

<template>
  <svg
    v-if="arrows.length"
    class="arrows-layer-svg absolute"
    :style="{
      left: `${bbox.x}px`,
      top: `${bbox.y}px`,
      width: `${bbox.w}px`,
      height: `${bbox.h}px`,
      pointerEvents: 'none',
    }"
    :viewBox="`${bbox.x} ${bbox.y} ${bbox.w} ${bbox.h}`"
  >
    <defs>
      <marker
        v-for="a in arrows"
        :key="`m-${a.id}`"
        :id="`arrowhead-${a.id}`"
        :markerWidth="selectedId === a.id ? 12 : 10"
        :markerHeight="selectedId === a.id ? 12 : 10"
        :refX="selectedId === a.id ? 10 : 8"
        refY="5"
        orient="auto-start-reverse"
        markerUnits="userSpaceOnUse"
      >
        <path d="M0,0 L10,5 L0,10 L2,5 Z" :fill="a.color" />
      </marker>
    </defs>

    <g v-for="a in arrows" :key="a.id" class="arrows-layer__arrow">
      <!-- Wide invisible hit target. Receives clicks (select) and right-clicks
           (context menu) without obscuring the visible path. -->
      <path
        :d="pathFor(a)"
        fill="none"
        stroke="transparent"
        stroke-width="18"
        style="pointer-events: stroke; cursor: pointer;"
        @contextmenu="(e) => onPathContextMenu(e, a.id)"
        @click="(e) => onPathClick(e, a.id)"
      />
      <!-- Visible path. Slightly thicker + brighter when selected. -->
      <path
        :d="pathFor(a)"
        fill="none"
        :stroke="a.color"
        :stroke-width="strokeWidth(a)"
        stroke-dasharray="8 5"
        stroke-linecap="round"
        :marker-end="`url(#arrowhead-${a.id})`"
        :opacity="selectedId && selectedId !== a.id ? 0.55 : 1"
        style="pointer-events: none;"
      />

      <!-- Label pill -->
      <g v-if="a.label" :transform="`translate(${labelPos(a).x}, ${labelPos(a).y})`">
        <rect
          :x="-((a.label.length * 4) + 8)"
          y="-10"
          :width="a.label.length * 8 + 16"
          height="20"
          rx="10"
          ry="10"
          fill="rgba(20, 23, 28, 0.92)"
          :stroke="a.color"
          stroke-width="1"
          style="pointer-events: none;"
        />
        <text
          x="0"
          y="0"
          text-anchor="middle"
          dominant-baseline="central"
          fill="rgba(255, 255, 255, 0.92)"
          font-size="11"
          font-family="ui-sans-serif, system-ui, sans-serif"
          style="pointer-events: none; user-select: none;"
        >{{ a.label }}</text>
      </g>

      <!-- Handles: rendered only for the selected arrow. -->
      <g v-if="selectedId === a.id" class="arrows-layer__handles">
        <!-- From handle -->
        <circle
          :cx="a.fromX" :cy="a.fromY"
          :r="6 * handleScale"
          fill="#fff" :stroke="a.color" :stroke-width="2 * handleScale"
          style="pointer-events: all; cursor: grab;"
          @pointerdown="(e) => onHandleDown(e, { kind: 'endpoint', arrowId: a.id, which: 'from' })"
          @pointermove="onHandleMove"
          @pointerup="onHandleUp"
          @pointercancel="onHandleUp"
        />
        <!-- To handle (smaller dot inside arrowhead area, but still grabbable) -->
        <circle
          :cx="a.toX" :cy="a.toY"
          :r="6 * handleScale"
          fill="#fff" :stroke="a.color" :stroke-width="2 * handleScale"
          style="pointer-events: all; cursor: grab;"
          @pointerdown="(e) => onHandleDown(e, { kind: 'endpoint', arrowId: a.id, which: 'to' })"
          @pointermove="onHandleMove"
          @pointerup="onHandleUp"
          @pointercancel="onHandleUp"
        />
        <!-- Curve handle: small diamond at the curve's midpoint. Differs
             from the endpoints visually so users can tell what it does. -->
        <rect
          :x="curveHandlePos(a).x - 4 * handleScale"
          :y="curveHandlePos(a).y - 4 * handleScale"
          :width="8 * handleScale"
          :height="8 * handleScale"
          :transform="`rotate(45 ${curveHandlePos(a).x} ${curveHandlePos(a).y})`"
          fill="#fff" :stroke="a.color" :stroke-width="2 * handleScale"
          style="pointer-events: all; cursor: move;"
          @pointerdown="(e) => onHandleDown(e, { kind: 'curve', arrowId: a.id })"
          @pointermove="onHandleMove"
          @pointerup="onHandleUp"
          @pointercancel="onHandleUp"
        />
      </g>
    </g>
  </svg>
</template>

<style scoped>
.arrows-layer-svg {
  overflow: visible;
}
</style>
