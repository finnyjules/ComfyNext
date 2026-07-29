import type { SceneDoc, SceneObject } from '~/lib/scene3d/config'
import { rootObjects } from '~/lib/scene3d/hierarchy'
import type { ObjectMotion } from './types'

const EASE_OUT = { kind: 'bezier' as const, cps: [0, 0, 0.58, 1] as [number, number, number, number] }

/** The objects a motion TEMPLATE auto-populates: top-level, non-light.
 *
 *  ROOTS ONLY, because a group's motion already composes into its children
 *  through the scene graph. Stamping the same preset onto a group AND each of
 *  its children makes every child travel its `in` distance twice — once from
 *  its own preset, once carried by the group's — and sets the two `bob` loops
 *  beating against each other at different phases. The template would look
 *  broken on precisely the scenes grouping exists to build.
 *
 *  Only TEMPLATES are roots-only. Two neighbours deliberately are NOT, and both
 *  were checked when this rule landed:
 *  - `Scene3DMotionTimeline`'s row list stays every non-light object. Animating
 *    a group BY HAND is the whole point of groups, and so is nudging one child
 *    inside an animated group — both need rows.
 *  - `sceneHasMotion` (motion/render.ts) stays every non-light object. It asks
 *    "does anything in this scene move", and a hand-authored child motion moves
 *    the scene whether or not its group has motion of its own. */
export function templateTargets(doc: SceneDoc): SceneObject[] {
  return rootObjects(doc.objects).filter(o => o.kind !== 'light')
}

/** Stamp `make(i)` onto every template target, and CLEAR object motion on every
 *  non-light object that is not one.
 *
 *  The clear is what keeps a template idempotent across a grouping. A child that
 *  was top-level the last time a template ran still carries that run's preset;
 *  group it and re-run, and the group's preset composes on top of the child's
 *  leftover one — the exact double-travel the roots-only rule above exists to
 *  prevent, just arrived at through history instead of through one pass.
 *  Applying a template is a "set the scene's motion" action, so owning what it
 *  leaves behind is part of its job. */
function stampTemplate(doc: SceneDoc, make: (i: number) => ObjectMotion): void {
  const targets = templateTargets(doc)
  const targetIds = new Set(targets.map((o) => o.id))
  for (const o of doc.objects) {
    if (o.kind === 'light' || targetIds.has(o.id)) continue
    delete o.motion
  }
  targets.forEach((o, i) => { o.motion = make(i) })
}

export const SCENE_TEMPLATES: Record<'showcase' | 'reveal' | 'loop', (doc: SceneDoc) => void> = {
  showcase(doc) {
    doc.motion = { duration: 4, fps: 30, loop: true, template: 'showcase' }
    stampTemplate(doc, (i) => ({
      loop: { kind: 'bob', speed: 1, amount: 0.5, phase: i * 0.15 },
      in: { preset: 'rise', duration: 0.6, direction: 'bottom', ease: EASE_OUT },
      offset: i * 0.12,
    } satisfies ObjectMotion))
    doc.camera.motion = { preset: 'orbit', speed: 1, amount: 1 }
  },
  reveal(doc) {
    doc.motion = { duration: 4, fps: 30, loop: true, template: 'reveal' }
    stampTemplate(doc, (i) => ({
      loop: { kind: 'none', speed: 1, amount: 1, phase: i * 0.15 },
      in: { preset: 'fade', duration: 0.7, ease: EASE_OUT },
      offset: i * 0.15,
    } satisfies ObjectMotion))
    doc.camera.motion = { preset: 'push', speed: 1, amount: 1 }
  },
  loop(doc) {
    doc.motion = { duration: 4, fps: 30, loop: true, template: 'loop' }
    stampTemplate(doc, (i) => ({
      loop: { kind: 'spin', speed: 1, amount: 1, phase: i * 0.2 },
    } satisfies ObjectMotion))
    doc.camera.motion = { preset: 'none', speed: 1, amount: 1 }
  },
}

export function animateSceneDefaults(doc: SceneDoc): void { SCENE_TEMPLATES.showcase(doc) }
