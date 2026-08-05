import type { ControlSpec } from '~/lib/spacetype/effect'
import { DEFAULT_POST } from './settings'
import { POST_EFFECTS } from './manifest'

/**
 * The post panel's controls, DERIVED from the manifest rather than hand-written.
 *
 * This list is the SOURCE for three consumers at once: the inspector (via
 * groupIntoSections), the agent vocabulary (via describeControls), and motion's
 * animatable targets. Adding an effect to the manifest therefore grants all three
 * unless explicitly opted out — which is why the derived set is snapshot-frozen in
 * tests/unit/studio-post-controls.unit.spec.ts.
 *
 * Keys are FROZEN: persisted Collection bindings are `params.post.<key>`.
 *
 * Must stay free of `three` imports — reachable from the Collection control
 * resolver's dynamic import graph (same constraint as scene3d/controls.ts).
 */
export function postControls(opts: { threeD?: boolean } = {}): ControlSpec[] {
  const out: ControlSpec[] = []
  for (const e of POST_EFFECTS) {
    if (e.threeDOnly && !opts.threeD) continue
    out.push({
      key: `post.${e.enableKey}`,
      label: e.label,
      kind: 'switch',
      default: DEFAULT_POST[e.enableKey] as boolean,
      group: e.label,
    })
    for (const p of e.params) {
      // uniform: null means this param has nothing to bind to in a 2D shader pass
      // (gtao's three are withheld wholesale via threeDOnly above; halftoneScatter
      // is the one that isn't — a flat host would otherwise show a slider, and
      // offer the agent a knob, that provably cannot affect a pixel). 3D hosts
      // keep them: gtao renders via EffectComposer, not this params list's frag.
      if (p.uniform === null && !opts.threeD) continue
      const showIf = { key: `post.${e.enableKey}`, equals: true } as const
      if (p.kind === 'color') {
        out.push({
          key: `post.${p.settingsKey}`, label: p.label, kind: 'color',
          default: DEFAULT_POST[p.settingsKey] as string,
          group: e.label, hint: p.hint, showIf,
        })
      } else {
        out.push({
          key: `post.${p.settingsKey}`, label: p.label, kind: 'slider',
          min: p.min, max: p.max, step: p.step,
          default: DEFAULT_POST[p.settingsKey] as number,
          group: e.label, hint: p.hint, showIf,
        })
      }
    }
  }
  return out
}

/** Section order for groupIntoSections — one section per effect, chain order. */
export const POST_SECTIONS = POST_EFFECTS.map(e => e.label)
