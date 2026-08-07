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
 * `opts.threeD` is FORWARD WORK, not a live capability: no shipping host passes
 * it. Scene3D still hand-writes its own 21 post sliders (scene3d/controls.ts),
 * so the `threeD` branch here, `PostEffectDef.threeDOnly`, and the "3D hosts
 * keep `uniform: null` params" rule below are exercised only by tests. They
 * encode the withholding rules a Scene3D migration onto this manifest would
 * need, so that migration doesn't have to rediscover them — read them as a
 * design note, not as something running in the product.
 *
 * Must stay free of `three` imports — reachable from the Collection control
 * resolver's dynamic import graph (same constraint as scene3d/controls.ts).
 */
/**
 * One "Effects" section holding a nested section per effect: its switch sits in the
 * header (`sectionToggle`), its params are the body, and the card opens and closes
 * with the switch.
 *
 * Two earlier shapes were wrong in opposite directions. A section per effect at top
 * level gave twelve one-row cards — a "Bloom" card whose only content was a "Bloom"
 * switch. One flat section fixed that but ran 32 rows together, so a slider had no
 * visible owner. Nesting keeps each effect's params visibly its own while an
 * inactive effect costs one collapsed row.
 *
 * Params deliberately do NOT carry `showIf`. Collapsing is the reveal, and it is the
 * better one: the chevron opens a disabled effect so it can be dialled in before it
 * is switched on, which a hidden row cannot do.
 *
 * Labels stay qualified in the manifest ("Bloom strength", not "Strength") even though
 * the section now supplies context, because the agent's vocabulary and motion's target
 * list are flat — there, "Strength" alone would collide across four effects.
 */
export const POST_SECTION = 'Effects'

/** The nested section path for one effect — 'Effects/Bloom'. */
const sectionFor = (label: string) => `${POST_SECTION}/${label}`

export type PostHost = 'gl2d' | 'three' | 'three-depth'

export function postControls(opts: { host: PostHost }): ControlSpec[] {
  const includeDepthOnly = opts.host === 'three-depth' // gtao needs a depth buffer
  const keepNullUniformParams = opts.host !== 'gl2d'   // three.js hosts render these via EffectComposer
  const out: ControlSpec[] = []
  for (const e of POST_EFFECTS) {
    if (e.threeDOnly && !includeDepthOnly) continue
    const group = sectionFor(e.label)
    out.push({
      key: `post.${e.enableKey}`,
      label: e.label,
      kind: 'switch',
      default: DEFAULT_POST[e.enableKey] as boolean,
      group,
      sectionToggle: true,
    })
    for (const p of e.params) {
      // uniform: null means this param has nothing to bind to in a 2D shader pass
      // (gtao's three are withheld wholesale via threeDOnly above; halftoneScatter
      // is the one that isn't — a flat host would otherwise show a slider, and
      // offer the agent a knob, that provably cannot affect a pixel). 3D hosts
      // keep them: gtao renders via EffectComposer, not this params list's frag.
      // (The 3D side of this rule is forward work — see the doc comment above.)
      if (p.uniform === null && !keepNullUniformParams) continue
      if (p.kind === 'color') {
        out.push({
          key: `post.${p.settingsKey}`, label: p.label, kind: 'color',
          default: DEFAULT_POST[p.settingsKey] as string,
          group, hint: p.hint,
        })
      } else {
        out.push({
          key: `post.${p.settingsKey}`, label: p.label, kind: 'slider',
          min: p.min, max: p.max, step: p.step,
          default: DEFAULT_POST[p.settingsKey] as number,
          group, hint: p.hint,
        })
      }
    }
  }
  return out
}

/**
 * For a host's section order array: the parent plus every effect's nested path, in
 * declaration order — the order array is what decides sibling order at each depth.
 *
 * Ambient occlusion's path is listed unconditionally even though only a 3D host emits
 * its controls; `groupIntoSections` prunes a section that ends up with nothing in it.
 */
export const POST_SECTIONS = [POST_SECTION, ...POST_EFFECTS.map(e => sectionFor(e.label))]
