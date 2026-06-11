import type { MotionClip } from '~~/shared/timeline/types'

let _seq = 0
function id(prefix: string) { _seq += 1; return `${prefix}-${_seq}-${Math.round(performance.now())}` }

/** A fresh Kinetic Text Motion clip: centered display text, mask-up reveal. */
export function createMotionClip(opts: { startFrame: number; length: number }): MotionClip {
  return {
    id: id('motion'),
    kind: 'motion',
    start_frame: opts.startFrame,
    in_frame: 0,
    length: opts.length,
    layer: {
      id: id('mtl'),
      kind: 'text',
      text: 'KINETIC',
      fontFamily: 'Inter',
      fontWeight: 800,
      fontSize: 0.11,
      color: '#ffffff',
      align: 'center',
      x: 0.5, y: 0.5,
      axes: { wght: 800 },
      animation: { offset: 0, in: { presetId: 'mask-up', duration: 0.6, stagger: 0.04 },
                   out: { presetId: 'fade-out', duration: 0.4, stagger: 0.02 } },
    },
  }
}
