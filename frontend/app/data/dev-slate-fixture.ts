// frontend/app/data/dev-slate-fixture.ts
/**
 * Dev fixture: a minimal LIV-style event slate used to acceptance-test the
 * motion engine end-to-end. Phase 2's template system will supersede this —
 * keep the choreography (offsets/presets) as the reference rhythm.
 */
import { createTextLayer, createRectLayer, type LocalLayer } from '~/composables/useCompositorLayers'
import type { FrameMotion } from '~/lib/motion/types'

export const SLATE_FIXTURE_MOTION: FrameMotion = { fps: 30, duration: 4 }

export function createSlateFixtureLayers(): LocalLayer[] {
  const bar = createRectLayer({
    x: 0.5, y: 0.532, w: 0.46, h: 0.085, radius: 0,
    fill: { type: 'linear', angle: 0, stops: [
      { offset: 0, color: '#2dd4bf' }, { offset: 1, color: '#a3e635' },
    ] },
    animation: { offset: 0.25, in: { presetId: 'slide-right', duration: 0.5, stagger: 0 }, out: { presetId: 'fade-out', duration: 0.4, stagger: 0 } },
  })
  const city = createTextLayer({
    text: 'ADELAIDE', x: 0.5, y: 0.42, fontSize: 0.11, fontWeight: 900,
    fontFamily: 'Archivo Black', color: '#ffffff', align: 'center',
    animation: { offset: 0, in: { presetId: 'mask-up', duration: 0.7, stagger: 0.035 }, out: { presetId: 'slide-out-up', duration: 0.45, stagger: 0.02 } },
  })
  const date = createTextLayer({
    text: '14–16 FEB', x: 0.5, y: 0.535, fontSize: 0.055, fontWeight: 800,
    fontFamily: 'Archivo Black', color: '#0a0a0a', align: 'center',
    animation: { offset: 0.45, in: { presetId: 'slide-up', duration: 0.5, stagger: 0.03 }, out: { presetId: 'fade-out', duration: 0.35, stagger: 0.02 } },
  })
  const venue = createTextLayer({
    text: 'THE GRANGE GOLF CLUB', x: 0.5, y: 0.63, fontSize: 0.034, fontWeight: 700,
    fontFamily: 'Inter', color: '#d9f99d', align: 'center',
    animation: { offset: 0.65, in: { presetId: 'fade-in', duration: 0.5, stagger: 0.015 }, out: { presetId: 'fade-out', duration: 0.35, stagger: 0 } },
  })
  const micro = createTextLayer({
    text: 'WATCH LIVE — 2025', x: 0.5, y: 0.92, fontSize: 0.018, fontWeight: 600,
    fontFamily: 'Inter', color: '#65a30d', align: 'center',
    animation: { offset: 0.9, in: { presetId: 'typewriter', duration: 0.6, stagger: 0.02 }, loop: { presetId: 'glitch-loop', duration: 1.2, stagger: 0.01 } },
  })
  // "In-type" mask: a gradient panel clipped to a giant numeral's silhouette
  // (the LIV photo-in-type look, with a gradient standing in for the photo —
  // swap the rect for an ImageLayer to mask real media). The text layer is the
  // mask (maskedById) so it never paints itself; the panel animates inside it.
  const year = createTextLayer({
    text: '25', x: 0.84, y: 0.78, fontSize: 0.28, fontWeight: 900,
    fontFamily: 'Archivo Black', color: '#ffffff', align: 'center',
  })
  const inType = createRectLayer({
    x: 0.84, y: 0.78, w: 0.4, h: 0.4, radius: 0,
    fill: { type: 'linear', angle: 45, stops: [
      { offset: 0, color: '#22d3ee' }, { offset: 1, color: '#a3e635' },
    ] },
    maskedById: year.id,
    animation: { offset: 0.5, in: { presetId: 'grow-in', duration: 0.6, stagger: 0 }, out: { presetId: 'fade-out', duration: 0.4, stagger: 0 } },
  })
  return [bar, city, date, venue, micro, year, inType]
}
