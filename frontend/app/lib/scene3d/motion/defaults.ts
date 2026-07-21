import type { SceneDoc } from '~/lib/scene3d/config'
import type { ObjectMotion } from './types'

const EASE_OUT = { kind: 'bezier' as const, cps: [0, 0, 0.58, 1] as [number, number, number, number] }

function animatable(doc: SceneDoc) { return doc.objects.filter(o => o.kind !== 'light') }

export const SCENE_TEMPLATES: Record<'showcase' | 'reveal' | 'loop', (doc: SceneDoc) => void> = {
  showcase(doc) {
    doc.motion = { duration: 4, fps: 30, loop: true, template: 'showcase' }
    animatable(doc).forEach((o, i) => {
      o.motion = {
        loop: { kind: 'bob', speed: 1, amount: 0.5, phase: i * 0.15 },
        in: { preset: 'rise', duration: 0.6, direction: 'bottom', ease: EASE_OUT },
        offset: i * 0.12,
      } satisfies ObjectMotion
    })
    doc.camera.motion = { preset: 'orbit', speed: 1, amount: 1 }
  },
  reveal(doc) {
    doc.motion = { duration: 4, fps: 30, loop: true, template: 'reveal' }
    animatable(doc).forEach((o, i) => {
      o.motion = {
        loop: { kind: 'none', speed: 1, amount: 1, phase: i * 0.15 },
        in: { preset: 'fade', duration: 0.7, ease: EASE_OUT },
        offset: i * 0.15,
      } satisfies ObjectMotion
    })
    doc.camera.motion = { preset: 'push', speed: 1, amount: 1 }
  },
  loop(doc) {
    doc.motion = { duration: 4, fps: 30, loop: true, template: 'loop' }
    animatable(doc).forEach((o, i) => {
      o.motion = { loop: { kind: 'spin', speed: 1, amount: 1, phase: i * 0.2 } } satisfies ObjectMotion
    })
    doc.camera.motion = { preset: 'none', speed: 1, amount: 1 }
  },
}

export function animateSceneDefaults(doc: SceneDoc): void { SCENE_TEMPLATES.showcase(doc) }
