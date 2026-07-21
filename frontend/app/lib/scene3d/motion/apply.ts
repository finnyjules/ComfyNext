import type { SceneDoc, Vec3 } from '~/lib/scene3d/config'
import { serializeDoc, parseDoc } from '~/lib/scene3d/config'
import { evaluateObjectMotion, evaluateCameraMotion } from './evaluate'

export function sceneLoopCycles(doc: SceneDoc): number[] {
  const rates: number[] = []
  for (const o of doc.objects) if (o.motion?.loop && o.motion.loop.kind !== 'none') {
    rates.push(Math.max(1, Math.round(Math.abs(o.motion.loop.speed))))
  }
  if (doc.camera.motion && doc.camera.motion.preset !== 'none') {
    rates.push(Math.max(1, Math.round(doc.camera.motion.speed)))
  }
  return rates.length ? rates : [1]
}

export function applyMotionToDoc(
  doc: SceneDoc, t01: number,
): { doc: SceneDoc; opacities: Record<string, number> } {
  const out = parseDoc(serializeDoc(doc)) // deep clone via tolerant round-trip
  const duration = out.motion.duration
  const tSec = t01 * duration
  const opacities: Record<string, number> = {}

  for (const obj of out.objects) {
    const s = evaluateObjectMotion(obj.motion, tSec, duration)
    obj.position = [obj.position[0] + s.dPosition[0], obj.position[1] + s.dPosition[1], obj.position[2] + s.dPosition[2]]
    obj.rotation = [obj.rotation[0] + s.dRotation[0], obj.rotation[1] + s.dRotation[1], obj.rotation[2] + s.dRotation[2]]
    obj.scale = [obj.scale[0] * s.scaleMul[0], obj.scale[1] * s.scaleMul[1], obj.scale[2] * s.scaleMul[2]]
    if (s.opacity < 1) opacities[obj.id] = s.opacity
  }

  const cam = evaluateCameraMotion(out.camera.motion, t01)
  if (cam.dTargetYaw !== 0 || cam.dPosition[0] || cam.dPosition[1] || cam.dPosition[2]) {
    out.camera.position = orbitAround(out.camera.position, out.camera.target, cam.dTargetYaw, cam.dPosition)
  }
  return { doc: out, opacities }
}

/** rotate `pos` around `target` about world-Y by `yaw`, then add a local push delta. */
function orbitAround(pos: Vec3, target: Vec3, yaw: number, push: Vec3): Vec3 {
  const dx = pos[0] - target[0], dz = pos[2] - target[2]
  const c = Math.cos(yaw), s = Math.sin(yaw)
  const rx = dx * c - dz * s, rz = dx * s + dz * c
  return [target[0] + rx + push[0], pos[1] + push[1], target[2] + rz + push[2]]
}
