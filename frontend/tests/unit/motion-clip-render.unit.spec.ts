import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderMotionClip } from '../../app/lib/engine/motionClipRenderer'
import type { MotionClip } from '../../shared/timeline/types'

// Recording 2D context stub (mirror tests/unit/motion-text-layout.unit.spec.ts).
function recCtx() {
  const calls: any[] = []
  let variation = ''
  const ctx: any = {
    canvas: { width: 100, height: 100 }, font: '', textAlign: 'left', textBaseline: 'alphabetic',
    fillStyle: '', strokeStyle: '', lineWidth: 1, lineJoin: 'miter', lineCap: 'butt',
    globalAlpha: 1, globalCompositeOperation: 'source-over', filter: 'none',
    get fontVariationSettings() { return variation },
    set fontVariationSettings(v: string) { variation = v; calls.push(['var', v]) },
    save(){}, restore(){}, translate(){}, rotate(){}, scale(){}, setTransform(){},
    beginPath(){}, rect(){}, roundRect(){}, ellipse(){}, moveTo(){}, lineTo(){}, clip(){}, clearRect(){},
    measureText: (s: string) => ({ width: s.length * 10 }),
    createLinearGradient: () => ({ addColorStop(){} }), createRadialGradient: () => ({ addColorStop(){} }),
    fillText: (s: string) => calls.push(['fillText', s, variation, ctx.font]),
    strokeText(){}, drawImage(){}, fill(){}, stroke(){}, fillRect(){},
  }
  return { ctx: ctx as CanvasRenderingContext2D, calls }
}

const CLIP: MotionClip = {
  id: 'm', kind: 'motion', start_frame: 0, in_frame: 0, length: 120,
  layer: {
    id: 'l', kind: 'text', text: 'AB', fontFamily: 'Inter', fontWeight: 400, fontSize: 0.1,
    color: '#fff', align: 'center', axes: { wght: 100 },
    axisKeyframes: [{ t: 0, axes: { wght: 100 } }, { t: 1, axes: { wght: 900 } }],
    animation: { offset: 0, in: { presetId: 'fade-in', duration: 1, stagger: 0 } },
  },
}

describe('renderMotionClip', () => {
  it('sets an interpolated axis weight (between 100 and 900) at mid-clip', () => {
    const { ctx, calls } = recCtx()
    // localFrame 60 of 120 @ 30fps → t=2s, duration=4s, normalized 0.5 → wght~500
    renderMotionClip(ctx, CLIP, 60, 100, 100, 30)
    const v = calls.find(c => c[0] === 'var')
    expect(v).toBeTruthy()
    const wght = Number(/"wght"\s*([\d.]+)/.exec(v![1])![1])
    expect(wght).toBeGreaterThan(100)
    expect(wght).toBeLessThan(900)
  })
  it('drives the interpolated weight into ctx.font (works even where canvas fontVariationSettings is unsupported)', () => {
    const { ctx, calls } = recCtx()
    // mid-clip → wght ~500; the rendered font weight must reflect the axis, not the static layer.fontWeight (400)
    renderMotionClip(ctx, CLIP, 60, 100, 100, 30)
    const draw = calls.find(c => c[0] === 'fillText')
    expect(draw).toBeTruthy()
    const w = Number(/^\s*(\d+(?:\.\d+)?)\s/.exec(draw![3])![1])
    expect(w).toBeGreaterThan(400)
    expect(w).toBeLessThan(600)
  })
  it('does not throw and sets a variation string at t=0', () => {
    const { ctx, calls } = recCtx()
    renderMotionClip(ctx, CLIP, 0, 100, 100, 30)
    expect(calls.some(c => c[0] === 'var')).toBe(true)
  })
})
