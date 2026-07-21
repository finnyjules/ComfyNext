import { bezierEase } from '~/lib/spacetype/motion'
import { bounceOut, elasticOut } from '~/lib/motion/easing'
import type { EaseRef } from './types'

/** One resolver for both ease families:
 *  - bezier tuple  → spacetype bezierEase (curve family, CurveEditor)
 *  - named         → procedural fns (bounce/elastic; spring≈elastic) */
export function resolveEaseRef(ease: EaseRef): (t: number) => number {
  if (ease.kind === 'named') {
    if (ease.name === 'bounce') return bounceOut
    return elasticOut // elastic + spring
  }
  const cps = ease.cps
  return (t: number) => bezierEase(t, cps)
}
