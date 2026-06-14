import * as THREE from 'three'

export interface GradientStop { color: string; on: boolean }
export interface ResolvedStop { color: string; pos: number }

/** Enabled stops, evenly spaced 0..1 in declaration order. */
export function resolveStops(stops: GradientStop[]): ResolvedStop[] {
  const on = stops.filter(s => s.on)
  if (on.length === 0) return []
  if (on.length === 1) return [{ color: on[0].color, pos: 0 }]
  return on.map((s, i) => ({ color: s.color, pos: i / (on.length - 1) }))
}

/** A 256x1 horizontal gradient texture (sampled by U). Browser-only. */
export function makeGradientTexture(stops: GradientStop[], fallback: string): THREE.CanvasTexture {
  const resolved = resolveStops(stops)
  const canvas = document.createElement('canvas')
  canvas.width = 256; canvas.height = 1
  const ctx = canvas.getContext('2d')!
  if (resolved.length <= 1) {
    ctx.fillStyle = resolved[0]?.color ?? fallback
    ctx.fillRect(0, 0, 256, 1)
  } else {
    const g = ctx.createLinearGradient(0, 0, 256, 0)
    for (const s of resolved) g.addColorStop(s.pos, s.color)
    ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 1)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping; tex.needsUpdate = true
  return tex
}
