import type { ControlSpec } from '~/lib/spacetype/effect'
import { ASPECTS, BLEND_MODES, LAYOUTS, type GradientConfig } from './types'

/**
 * The Gradient studio's tune vocabulary for the in-product agent. The studio
 * stores everything on a single nested `config` ref, so these ControlSpec keys
 * are DOTTED paths resolved by makeConfigParams (a leading `layer.` targets the
 * active layer). gradientAgentControls() returns only the controls that apply to
 * the current layout — mirroring the surface's own v-if gating so the agent is
 * never offered a knob the user can't see.
 */
function slider(key: string, label: string, min: number, max: number, step: number, group: string, hint?: string): ControlSpec {
  return { key, label, kind: 'slider', min, max, step, default: 0, group, ...(hint ? { hint } : {}) }
}

export function gradientAgentControls(cfg: GradientConfig): ControlSpec[] {
  const layout = cfg.canvas.layout
  const isRadial = layout === 'radial' || layout === 'orbit'
  const isLiquid = layout === 'liquid'
  const isMesh = layout === 'mesh'
  const out: ControlSpec[] = []

  // Canvas
  out.push({ key: 'canvas.aspect', label: 'Aspect ratio', kind: 'select', options: [...ASPECTS], default: '16:9', group: 'Canvas', hint: 'Output proportions' })
  out.push({ key: 'canvas.layout', label: 'Layout', kind: 'select', options: [...LAYOUTS], default: 'linear', group: 'Canvas', hint: 'Overall composition: linear/radial/orbit/stack/liquid/mesh' })
  out.push(slider('canvas.margin', 'Margin', 0, 0.45, 0.01, 'Canvas'))
  out.push({ key: 'canvas.background', label: 'Background', kind: 'color', default: '#000000', group: 'Canvas' })
  if (isRadial) {
    out.push(slider('canvas.innerRadius', 'Inner radius', 0, 0.9, 0.01, 'Canvas'))
    out.push(slider('canvas.center.x', 'Center X', -0.5, 0.5, 0.01, 'Canvas'))
    out.push(slider('canvas.center.y', 'Center Y', -0.5, 0.5, 0.01, 'Canvas'))
  }

  // Flow (domain warp — applies to every layout; 0 intensity = undistorted)
  out.push(slider('flow.angle', 'Flow angle', 0, 360, 1, 'Flow'))
  out.push(slider('flow.noiseScale', 'Noise scale', 0.5, 8, 0.1, 'Flow'))
  out.push(slider('flow.intensity', 'Noise intensity', 0, 100, 1, 'Flow', 'Strength of the liquid warp; 0 = flat gradient'))
  out.push(slider('flow.distortion', 'Curve distortion', 0, 100, 1, 'Flow'))
  out.push(slider('flow.detail', 'Detail', 1, 6, 1, 'Flow'))
  out.push(slider('flow.swirl', 'Swirl', 0, 100, 1, 'Flow'))
  out.push(slider('flow.speed', 'Flow speed', 0, 100, 1, 'Flow', 'Living drift speed (visible in video export)'))

  // Liquid-only fold shading + light
  if (isLiquid) {
    out.push(slider('flow.depth', 'Depth', 0, 100, 1, 'Liquid'))
    out.push(slider('flow.highlights', 'Highlights', 0, 100, 1, 'Liquid'))
    out.push(slider('flow.shadows', 'Shadows', 0, 100, 1, 'Liquid'))
    out.push(slider('flow.foldScale', 'Fold scale', 0, 100, 1, 'Liquid'))
    out.push(slider('flow.gloss', 'Gloss', 0, 100, 1, 'Liquid'))
    out.push(slider('flow.veins', 'Veins', 0, 100, 1, 'Liquid'))
    out.push(slider('flow.veinScale', 'Vein scale', 0, 100, 1, 'Liquid'))
    out.push(slider('flow.ripple', 'Ripple', 0, 100, 1, 'Liquid'))
    out.push(slider('flow.refract', 'Refraction', 0, 100, 1, 'Liquid'))
    out.push(slider('flow.viscosity', 'Viscosity', 0, 100, 1, 'Liquid'))
    out.push(slider('relief.light.azimuth', 'Light angle', 0, 360, 1, 'Liquid'))
    out.push(slider('relief.light.elevation', 'Light height', 0, 90, 1, 'Liquid'))
  }

  // Mesh-only (layer 0 soft blend)
  if (isMesh) {
    out.push(slider('layer.mesh.softness', 'Softness', 10, 100, 1, 'Mesh'))
    out.push(slider('layer.mesh.contrast', 'Contrast', 0, 100, 1, 'Mesh'))
    out.push(slider('layer.mesh.blur', 'Blur', 0, 100, 1, 'Mesh'))
    out.push(slider('layer.mesh.drift', 'Drift', 0, 100, 1, 'Mesh'))
  }

  // Relief & grain (texture, every layout)
  out.push(slider('relief.grain', 'Grain', 0, 1, 0.01, 'Relief'))
  out.push(slider('relief.relief', 'Relief', 0, 1, 0.01, 'Relief'))

  // Active layer colour + compositing
  out.push({ key: 'layer.blend', label: 'Blend', kind: 'select', options: [...BLEND_MODES], default: 'normal', group: 'Layer' })
  out.push(slider('layer.opacity', 'Opacity', 0, 1, 0.01, 'Layer'))
  out.push(slider('layer.color.steps', 'Posterize steps', 0, 24, 1, 'Layer', '0 = smooth; higher = banded'))
  out.push(slider('layer.color.hueDrift', 'Hue drift', -180, 180, 1, 'Layer'))
  out.push(slider('layer.color.hueRotate', 'Hue rotate', 0, 360, 1, 'Layer'))

  return out
}
