import type { ControlSpec } from '~/lib/spacetype/effect'
import type { GradientConfig } from './types'
import { visibleGradientControls } from './controls'

/**
 * The Gradient studio's tune vocabulary for the in-product agent, derived from
 * the declarative GRADIENT_CONTROLS schema. Keys are DOTTED paths resolved by
 * makeConfigParams (a leading `layer.` targets the active layer). Only controls
 * applicable to the current layout are returned — mirroring the surface's own
 * v-if gating so the agent is never offered a knob the user can't see.
 *
 * `opts.includePreset` adds the `preset` macro (the canvas tuner handles it by
 * swapping the whole base config; the in-studio copilot omits it).
 */
export function gradientAgentControls(
  cfg: GradientConfig,
  opts: { includePreset?: boolean } = {},
): ControlSpec[] {
  return visibleGradientControls(cfg, opts)
    .filter((c) => (c as any).agent !== false)
    .map(({ when, agent, animatable, ...spec }) => spec as ControlSpec)
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
