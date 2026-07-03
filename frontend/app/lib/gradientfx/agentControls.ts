import type { ControlSpec } from '~/lib/spacetype/effect'
import { ASPECTS, BLEND_MODES, LAYOUTS, type GradientConfig } from './types'
import { GRADIENT_PRESET_NAMES } from './presets'

/**
 * The Gradient studio's tune vocabulary for the in-product agent. The studio
 * stores everything on a single nested `config` ref, so these ControlSpec keys
 * are DOTTED paths resolved by makeConfigParams (a leading `layer.` targets the
 * active layer). gradientAgentControls() returns only the controls that apply to
 * the current layout — mirroring the surface's own v-if gating so the agent is
 * never offered a knob the user can't see.
 *
 * `opts.includePreset` adds the `preset` macro (the canvas tuner handles it by
 * swapping the whole base config; the in-studio copilot omits it — it has buttons
 * + a per-key proposal model that can't express a whole-config swap).
 */
function slider(key: string, label: string, min: number, max: number, step: number, group: string, hint?: string): ControlSpec {
  return { key, label, kind: 'slider', min, max, step, default: 0, group, ...(hint ? { hint } : {}) }
}

export function gradientAgentControls(cfg: GradientConfig, opts: { includePreset?: boolean } = {}): ControlSpec[] {
  const layout = cfg.canvas.layout
  const isRadial = layout === 'radial' || layout === 'orbit'
  const isLiquid = layout === 'liquid'
  const isMesh = layout === 'mesh'
  const out: ControlSpec[] = []

  // Style preset — the primary lever: pick the closest overall look (a good base
  // config), THEN fine-tune the knobs below. Only for a NEW overall style.
  if (opts.includePreset) {
    out.push({ key: 'preset', label: 'Style preset', kind: 'select', options: [...GRADIENT_PRESET_NAMES], default: 'linear', group: 'Preset',
      hint: 'The overall look. marble/oil/ink/lava/satin = liquid surfaces; ripple/stack = concentric; mesh = soft blobs; linear = simple ramp. Set this to establish a style, then override colours/blur/grain. Leave it alone when only ADJUSTING an existing gradient.' })
  }

  // Canvas
  out.push({ key: 'canvas.aspect', label: 'Aspect ratio', kind: 'select', options: [...ASPECTS], default: '16:9', group: 'Canvas', hint: 'Output proportions' })
  out.push({ key: 'canvas.layout', label: 'Layout', kind: 'select', options: [...LAYOUTS], default: 'linear', group: 'Canvas', hint: 'Overall composition: linear/radial/orbit/stack/liquid/mesh' })
  // Margin only insets band/ring layouts; liquid & mesh fill the frame (no-op there).
  if (!isLiquid && !isMesh) out.push(slider('canvas.margin', 'Margin', 0, 0.45, 0.01, 'Canvas'))
  out.push({ key: 'canvas.background', label: 'Background', kind: 'color', default: '#000000', group: 'Canvas' })
  if (isRadial) {
    out.push(slider('canvas.innerRadius', 'Inner radius', 0, 0.9, 0.01, 'Canvas'))
    out.push(slider('canvas.center.x', 'Center X', -0.5, 0.5, 0.01, 'Canvas'))
    out.push(slider('canvas.center.y', 'Center Y', -0.5, 0.5, 0.01, 'Canvas'))
  }

  // Palette — the actual gradient COLOURS. The vibe patch is scalar-only, so it
  // can't set the whole stops[] array at once; instead expose each colour of the
  // active layer (layer 0) as its own `color` control so the agent can recolour
  // the gradient (e.g. "blue, pink and orange"). Mesh layouts colour via points,
  // every other layout via ramp stops. Ordered low→high position, so "Colour 1"
  // is the start of the ramp.
  const colour = (key: string, i: number, hint?: string): ControlSpec =>
    ({ key, label: `Colour ${i + 1}`, kind: 'color', default: '#ffffff', group: 'Colours', ...(hint ? { hint } : {}) })
  const layer0 = cfg.layers[0]
  if (isMesh) {
    const pts = layer0?.mesh?.points ?? []
    pts.forEach((_, i) => out.push(colour(`layer.mesh.points.${i}.color`, i, i === 0 ? 'The gradient colours, in order. Set these to recolour the whole gradient.' : undefined)))
  } else {
    const stops = layer0?.color?.stops ?? []
    stops.forEach((_, i) => out.push(colour(`layer.color.stops.${i}.color`, i, i === 0 ? 'The gradient colours, in ramp order (1 = start). Set these to recolour the whole gradient.' : undefined)))
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

  // Grain applies to every layout; Relief only shades the band/ring height field
  // (linear/radial/orbit/stack) — liquid uses flow.depth, mesh has none.
  out.push(slider('relief.grain', 'Grain', 0, 1, 0.01, 'Relief'))
  if (!isLiquid && !isMesh) out.push(slider('relief.relief', 'Relief', 0, 1, 0.01, 'Relief'))

  // Active layer colour + compositing
  out.push({ key: 'layer.blend', label: 'Blend', kind: 'select', options: [...BLEND_MODES], default: 'normal', group: 'Layer' })
  out.push(slider('layer.opacity', 'Opacity', 0, 1, 0.01, 'Layer'))
  out.push(slider('layer.color.steps', 'Posterize steps', 0, 24, 1, 'Layer', '0 = smooth; higher = banded'))
  out.push(slider('layer.color.hueDrift', 'Hue drift', -180, 180, 1, 'Layer'))
  out.push(slider('layer.color.hueRotate', 'Hue rotate', 0, 360, 1, 'Layer'))

  // Focus — optical soft-focus / depth-of-field (post stage). `blur` drives it;
  // `shape` chooses uniform blur vs a sharp radial spot / linear tilt-shift band.
  // Position/size/falloff are offered too so a single ask can set the whole thing;
  // band angle only when linear.
  out.push(slider('focus.blur', 'Blur', 0, 100, 1, 'Focus', 'Soft-focus / defocus amount; 0 = perfectly sharp'))
  out.push({ key: 'focus.shape', label: 'Focus region', kind: 'select', options: ['off', 'radial', 'linear'], default: 'off', group: 'Focus', hint: 'off = blur the whole thing evenly; radial = keep a round spot sharp; linear = keep an angled band sharp (tilt-shift)' })
  out.push(slider('focus.radius', 'Focus size', 0, 1, 0.01, 'Focus', 'Size of the in-focus region (needs a radial/linear shape)'))
  out.push(slider('focus.softness', 'Focus falloff', 0, 100, 1, 'Focus', 'How gradually blur ramps in past the focus region'))
  out.push(slider('focus.x', 'Focus X', -0.5, 0.5, 0.01, 'Focus', 'Focus centre, left↔right'))
  out.push(slider('focus.y', 'Focus Y', -0.5, 0.5, 0.01, 'Focus', 'Focus centre, up↔down'))
  if (cfg.focus?.shape === 'linear') out.push(slider('focus.angle', 'Band angle', 0, 360, 1, 'Focus'))

  return out
}

/**
 * Domain guidance injected into the /api/vibe prompt for the gradient (both the
 * canvas tuner and the in-studio copilot pass it). Teaches the model how the
 * knobs COMBINE into looks — otherwise it sets a couple of literal-sounding knobs
 * and leaves the rest at defaults. Kept declarative; the model still returns a
 * validated param patch.
 */
export const GRADIENT_GUIDANCE = `This is a PROCEDURAL GRADIENT / colour-field generator (not text — ignore any typography wording). Compose the WHOLE look: usually a preset + a few overrides, not one knob.

PICK A STYLE FIRST (when a "preset" control is offered and the user wants a NEW overall look). Match the request to the CLOSEST preset — it sets the whole base look; then only override colours/blur/grain/etc:
- marble — cool veined liquid stone. Triggers: "marble", "marbled", "veined", "carrara", "stone", "liquid".
- oil — iridescent petrol slick. Triggers: "oil", "oil slick", "iridescent", "petrol", "gasoline", "holographic", "opal", "fuel".
- ink — monochrome ink-in-water tendrils. Triggers: "ink", "ink in water", "monochrome", "black and white", "smoke", "tendrils".
- lava — glowing molten flow. Triggers: "lava", "molten", "magma", "fire", "hot", "ember", "volcanic".
- satin — soft silky pastel sheen. Triggers: "satin", "silk", "silky", "sheen", "soft liquid".
- aurora — flowing blue/magenta/mint ribbons. Triggers: "aurora", "northern lights", "nebula", "cosmic", "galaxy", "space".
- frosted — etched / icy frosted glass. Triggers: "frosted", "frosted glass", "etched", "icy", "ice", "glass", "crystalline".
- sunset — warm purple→gold sky wash. Triggers: "sunset", "sunrise", "dusk", "dawn", "golden hour", "twilight", "warm sky".
- ripple / stack — concentric rings ("rings", "ripples", "concentric", "target"). mesh — soft blurry blobs ("colour wash", "soft blobs", "cloudy", "gradient mesh"). linear — simple straight ramp ("simple", "plain", "two-tone", "duotone").
Then OVERRIDE only what the request ADDS. When merely ADJUSTING an existing gradient ("more veins", "darker", "warmer", "less blur"), do NOT set preset — tune the specific knobs.

COLOURS: after picking a preset, RECOLOUR it whenever the user names colours — set "Colour 1..N" (layer.color.stops.N.color) IN RAMP ORDER (1 = start). Map the named colours across the stops and keep them coherent.

LOOK → KNOBS (recognise synonyms, not just these exact words):
- blur/soft-focus — "blurry", "soft focus", "dreamy", "out of focus", "defocused", "hazy", "misty", "bokeh", "soft" → focus.blur (30–70). "tilt-shift"/"miniature" → focus.shape "linear". "sharp centre"/"vignette blur" → focus.shape "radial". "sharp"/"crisp"/"in focus" → focus.blur 0.
- grain — "grainy", "gritty", "filmic", "film", "noisy", "textured", "analog", "rough", "sandy" → relief.grain (0.15–0.5).
- depth/3D — "3D", "embossed", "raised", "relief", "folds", "liquid depth", "glossy", "wet", "shiny" → flow.depth (40–80, also refracts the colours over the folds) + flow.gloss; flow.foldScale = fold size (higher = finer/tighter).
- veins — "marbled", "veiny", "streaky", "tendrils", "wispy" → flow.veins (40–80). swirl — "swirly", "turbulent", "chaotic", "wavy" → flow.swirl / flow.distortion.
- motion — "animated", "flowing", "living", "moving", "drifting", "looping" → flow.speed (30–70; churns for video export).
- intensity — "high contrast", "punchy", "bold", "vivid", "saturated" → stronger colours + flow.depth. "muted", "pastel", "soft", "calm", "subtle", "washed out" → softer stop colours + lower flow.depth/intensity.

EXAMPLES — the exact changes to return (preset first, then minimal overrides):
- "blue, pink and orange liquid marble, grainy" → {"preset":"marble","layer.color.stops.0.color":"#3b6bff","layer.color.stops.1.color":"#ff6ec7","layer.color.stops.2.color":"#ff9a4d","relief.grain":0.32}
- "tight embossed oil with tilt-shift focus" → {"preset":"oil","focus.shape":"linear","focus.blur":42}
- "soft dreamy pastel aurora, out of focus" → {"preset":"aurora","focus.blur":52,"layer.color.stops.0.color":"#bfe3ff","layer.color.stops.1.color":"#e5c9ff","layer.color.stops.2.color":"#c9f6e4"}
- "warm radial sunset, subtle grain" → {"preset":"sunset","relief.grain":0.22}
- "high-contrast ink, sharp" → {"preset":"ink"}
- "make it more molten and glossy" (adjusting → no preset) → {"flow.depth":72,"flow.highlights":80,"flow.gloss":55}`
