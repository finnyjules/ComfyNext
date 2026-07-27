import type { ControlSpec } from '~/lib/spacetype/effect'
import { ASPECTS, BLEND_MODES, LAYOUTS, type GradientConfig } from './types'
import { GRADIENT_PRESET_NAMES } from './presets'

/**
 * The single declarative description of Gradient Studio's parameters.
 *
 * This list is the SOURCE. `gradientAgentControls` derives the agent vocabulary
 * from it and `motion.ts` derives animatable targets from it. The inspector UI
 * will derive from it in a follow-on change; today it is still hand-written.
 *
 * It is a SUPERSET, but each consumer is opt-OUT, not opt-in: a new slider is
 * agent-visible and motion-animatable by default. `agent: false` withholds a
 * control from the agent (used for the Shape block, which the agent has never
 * seen); `animatable: false` withholds a slider from motion. So adding a
 * control here silently grants it to BOTH capabilities unless you opt it out
 * of one. The agent side is guarded against surprise grants by frozen
 * characterization snapshots (gradientfx-controls.unit.spec.ts.snap); the
 * motion side is pinned the same way by gradientfx-motion-path.unit.spec.ts's
 * animatable-target-set snapshot.
 *
 * Keys are FROZEN: persisted Collection bindings are `params.<key>`, and
 * GRADIENT_GUIDANCE names keys in prose.
 */
export type GradientControl = ControlSpec & {
  when?: (cfg: GradientConfig) => boolean
}

/** Emission order. The legacy builder emitted strictly in this group order. */
export const GRADIENT_SECTIONS = [
  'Preset', 'Canvas', 'Colours', 'Flow', 'Liquid', 'Mesh', 'Shape', 'Relief', 'Layer', 'Focus',
] as const

const isRadial = (c: GradientConfig) => c.canvas.layout === 'radial' || c.canvas.layout === 'orbit'
const isLiquid = (c: GradientConfig) => c.canvas.layout === 'liquid'
const isMesh = (c: GradientConfig) => c.canvas.layout === 'mesh'
const isBanded = (c: GradientConfig) => !isLiquid(c) && !isMesh(c)

/** Mirrors agentControls.ts's helper exactly, including the inert `default: 0`. */
function slider(
  key: string, label: string, min: number, max: number, step: number, group: string,
  hint?: string, extra: Partial<GradientControl> = {},
): GradientControl {
  return { key, label, kind: 'slider', min, max, step, default: 0, group, ...(hint ? { hint } : {}), ...extra } as GradientControl
}

export const GRADIENT_CONTROLS: GradientControl[] = [
  // --- Preset (agent-only macro; the surface has its own button row) --------
  { key: 'preset', label: 'Style preset', kind: 'select', options: [...GRADIENT_PRESET_NAMES], default: 'linear', group: 'Preset',
    hint: 'The overall look. marble/oil/ink/lava/satin = liquid surfaces; ripple/stack = concentric; mesh = soft blobs; linear = simple ramp. Set this to establish a style, then override colours/blur/grain. Leave it alone when only ADJUSTING an existing gradient.',
    summary: 1 },

  // --- Canvas --------------------------------------------------------------
  { key: 'canvas.aspect', label: 'Aspect ratio', kind: 'select', options: [...ASPECTS], default: '16:9', group: 'Canvas', hint: 'Output proportions' },
  { key: 'canvas.layout', label: 'Layout', kind: 'select', options: [...LAYOUTS], default: 'linear', group: 'Canvas', hint: 'Overall composition: linear/radial/orbit/stack/liquid/mesh' },
  slider('canvas.margin', 'Margin', 0, 0.45, 0.01, 'Canvas', undefined, { when: isBanded }),
  { key: 'canvas.background', label: 'Background', kind: 'color', default: '#000000', group: 'Canvas' },
  slider('canvas.innerRadius', 'Inner radius', 0, 0.9, 0.01, 'Canvas', undefined, { when: isRadial }),
  slider('canvas.center.x', 'Center X', -0.5, 0.5, 0.01, 'Canvas', undefined, { when: isRadial }),
  slider('canvas.center.y', 'Center Y', -0.5, 0.5, 0.01, 'Canvas', undefined, { when: isRadial }),

  // --- Colours: runtime cardinality, synthesized in visibleGradientControls --

  // --- Flow (every layout) --------------------------------------------------
  slider('flow.angle', 'Flow angle', 0, 360, 1, 'Flow'),
  slider('flow.noiseScale', 'Noise scale', 0.5, 8, 0.1, 'Flow'),
  slider('flow.intensity', 'Noise intensity', 0, 100, 1, 'Flow', 'Strength of the liquid warp; 0 = flat gradient'),
  slider('flow.distortion', 'Curve distortion', 0, 100, 1, 'Flow'),
  slider('flow.detail', 'Detail', 1, 6, 1, 'Flow'),
  slider('flow.swirl', 'Swirl', 0, 100, 1, 'Flow'),
  slider('flow.speed', 'Flow speed', 0, 100, 1, 'Flow', 'Living drift speed (visible in video export)'),

  // --- Liquid only ----------------------------------------------------------
  slider('flow.depth', 'Depth', 0, 100, 1, 'Liquid', undefined, { when: isLiquid }),
  slider('flow.highlights', 'Highlights', 0, 100, 1, 'Liquid', undefined, { when: isLiquid }),
  slider('flow.shadows', 'Shadows', 0, 100, 1, 'Liquid', undefined, { when: isLiquid }),
  slider('flow.foldScale', 'Fold scale', 0, 100, 1, 'Liquid', undefined, { when: isLiquid }),
  slider('flow.gloss', 'Gloss', 0, 100, 1, 'Liquid', undefined, { when: isLiquid }),
  slider('flow.veins', 'Veins', 0, 100, 1, 'Liquid', undefined, { when: isLiquid }),
  slider('flow.veinScale', 'Vein scale', 0, 100, 1, 'Liquid', undefined, { when: isLiquid }),
  slider('flow.ripple', 'Ripple', 0, 100, 1, 'Liquid', undefined, { when: isLiquid }),
  slider('flow.refract', 'Refraction', 0, 100, 1, 'Liquid', undefined, { when: isLiquid }),
  slider('flow.viscosity', 'Viscosity', 0, 100, 1, 'Liquid', undefined, { when: isLiquid }),

  // --- Mesh only ------------------------------------------------------------
  slider('layer.mesh.softness', 'Softness', 10, 100, 1, 'Mesh', undefined, { when: isMesh }),
  slider('layer.mesh.contrast', 'Contrast', 0, 100, 1, 'Mesh', undefined, { when: isMesh }),
  slider('layer.mesh.blur', 'Blur', 0, 100, 1, 'Mesh', undefined, { when: isMesh }),
  slider('layer.mesh.drift', 'Drift', 0, 100, 1, 'Mesh', undefined, { when: isMesh }),

  // --- Shape: previously ORPHANED. Present in the surface, but never in the
  //     agent vocabulary. Declared here with `agent: false` so motion can
  //     derive from them without changing the agent's snapshot. Exposing them
  //     to the agent is a deliberate later step.
  //     Ranges mirror the surface's Shape sliders, except `sweep`, whose
  //     animation range intentionally exceeds the UI slider bound (see the
  //     `animatable` override below), and `count`, which the surface caps
  //     lower for the stack layout (40) than the range declared here (64).
  slider('layer.shape.phase', 'Wave phase', 0, 1, 0.01, 'Shape', undefined, { agent: false, when: isBanded }),
  slider('layer.shape.scrub', 'Scrub / rotate', 0, 1, 0.01, 'Shape', undefined, { agent: false, when: isBanded }),
  slider('layer.shape.peaks', 'Peaks', 1, 12, 1, 'Shape', undefined, { agent: false, when: isBanded }),
  slider('layer.shape.count', 'Count', 2, 64, 1, 'Shape', undefined, { agent: false, when: isBanded }),
  slider('layer.shape.minDepth', 'Min depth', 0, 1, 0.01, 'Shape', undefined, { agent: false, when: isBanded }),
  slider('layer.shape.curveExp', 'Curve exponent', 0.2, 3, 0.05, 'Shape', undefined, { agent: false, when: isBanded }),
  slider('layer.shape.jitter', 'Jitter', 0, 1, 0.01, 'Shape', undefined, { agent: false, when: isBanded }),
  // Slider bound is 20 but animation is allowed the full 0..360 — the one known
  // UI-vs-track divergence, declared once here instead of in two lists.
  slider('layer.shape.sweep', 'Sweep', 20, 360, 1, 'Shape', undefined, { agent: false, when: isBanded, animatable: { min: 0, max: 360 } }),
  slider('layer.shape.gap', 'Gap', 0, 0.8, 0.01, 'Shape', undefined, { agent: false, when: isBanded, animatable: { min: 0, max: 1 } }),
  slider('layer.shape.rounding', 'Rounding', 0, 1, 0.01, 'Shape', undefined, { agent: false, when: isBanded }),
  slider('layer.shape.valley', 'Valley position', 0, 1, 0.01, 'Shape', undefined, { agent: false, when: isBanded }),

  // --- Relief ---------------------------------------------------------------
  slider('relief.grain', 'Grain', 0, 1, 0.01, 'Relief', undefined, { summary: 2 }),
  // The relief light shades the band/ring height field only: shaders.ts gates u_light
  // on `u_layout < 3.5`, and the liquid branch is explicit that it uses "its own light,
  // not u_light". The legacy agent builder had these under isLiquid — exactly inverted —
  // so the agent was offered them where they do nothing and denied them where they work.
  slider('relief.light.azimuth', 'Light angle', 0, 360, 1, 'Relief', undefined, { when: isBanded }),
  slider('relief.light.elevation', 'Light height', 0, 90, 1, 'Relief', undefined, { when: isBanded }),
  slider('relief.relief', 'Relief', 0, 1, 0.01, 'Relief', undefined, { when: isBanded }),

  // --- Layer ----------------------------------------------------------------
  { key: 'layer.blend', label: 'Blend', kind: 'select', options: [...BLEND_MODES], default: 'normal', group: 'Layer' },
  slider('layer.opacity', 'Opacity', 0, 1, 0.01, 'Layer'),
  slider('layer.color.steps', 'Posterize steps', 0, 24, 1, 'Layer', '0 = smooth; higher = banded'),
  slider('layer.color.hueDrift', 'Hue drift', -180, 180, 1, 'Layer'),
  slider('layer.color.hueRotate', 'Hue rotate', 0, 360, 1, 'Layer'),

  // --- Focus ----------------------------------------------------------------
  slider('focus.blur', 'Blur', 0, 100, 1, 'Focus', 'Soft-focus / defocus amount; 0 = perfectly sharp'),
  { key: 'focus.shape', label: 'Focus region', kind: 'select', options: ['off', 'radial', 'linear'], default: 'off', group: 'Focus',
    hint: 'off = blur the whole thing evenly; radial = keep a round spot sharp; linear = keep an angled band sharp (tilt-shift)' },
  slider('focus.radius', 'Focus size', 0, 1, 0.01, 'Focus', 'Size of the in-focus region (needs a radial/linear shape)'),
  slider('focus.softness', 'Focus falloff', 0, 100, 1, 'Focus', 'How gradually blur ramps in past the focus region'),
  slider('focus.x', 'Focus X', -0.5, 0.5, 0.01, 'Focus', 'Focus centre, left↔right'),
  slider('focus.y', 'Focus Y', -0.5, 0.5, 0.01, 'Focus', 'Focus centre, up↔down'),
  slider('focus.angle', 'Band angle', 0, 360, 1, 'Focus', undefined, { when: (c) => c.focus?.shape === 'linear' }),
]

/** Per-stop / per-mesh-point colour controls — runtime cardinality. */
function colourControls(cfg: GradientConfig): GradientControl[] {
  const colour = (key: string, i: number, hint?: string): GradientControl =>
    ({ key, label: `Colour ${i + 1}`, kind: 'color', default: '#ffffff', group: 'Colours', ...(hint ? { hint } : {}) } as GradientControl)
  const layer0 = cfg.layers[0]
  if (cfg.canvas.layout === 'mesh') {
    const pts = layer0?.mesh?.points ?? []
    return pts.map((_, i) => colour(`layer.mesh.points.${i}.color`, i,
      i === 0 ? 'The gradient colours, in order. Set these to recolour the whole gradient.' : undefined))
  }
  const stops = layer0?.color?.stops ?? []
  return stops.map((_, i) => colour(`layer.color.stops.${i}.color`, i,
    i === 0 ? 'The gradient colours, in ramp order (1 = start). Set these to recolour the whole gradient.' : undefined))
}

/**
 * Controls applicable to this config, in GRADIENT_SECTIONS order, with the
 * runtime colour block spliced into the Colours section. `preset` is omitted
 * unless explicitly requested (the in-studio copilot can't express a whole-
 * config swap; only the canvas tuner can).
 */
export function visibleGradientControls(
  cfg: GradientConfig,
  opts: { includePreset?: boolean } = {},
): GradientControl[] {
  const out: GradientControl[] = []
  for (const section of GRADIENT_SECTIONS) {
    if (section === 'Preset') {
      if (opts.includePreset) out.push(...GRADIENT_CONTROLS.filter((c) => c.group === 'Preset'))
      continue
    }
    if (section === 'Colours') { out.push(...colourControls(cfg)); continue }
    for (const c of GRADIENT_CONTROLS) {
      if (c.group !== section) continue
      if (c.when && !c.when(cfg)) continue
      out.push(c)
    }
  }
  return out
}
