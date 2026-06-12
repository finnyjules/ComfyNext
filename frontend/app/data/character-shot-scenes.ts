/**
 * Scene / pose / lighting prompts that drive VARIATION for a character training
 * set, used with ideogram-character. The reference image preserves the identity,
 * so these deliberately describe ONLY framing, pose, lighting, setting and
 * wardrobe — never the face. Spreading the dataset across contexts is exactly
 * what teaches a character LoRA to bind the identity to the trigger word rather
 * than to one look/lighting.
 *
 * An optional subject hint (e.g. "a young woman with red hair") is prepended at
 * call time to help Ideogram lock the look; the scene strings themselves stay
 * subject-agnostic so they're reusable for any character.
 *
 * Scenes are tagged with framing tiers — 'closeup', 'medium', 'full' — so the
 * picker can guarantee body coverage. Close-ups teach face quality; full-body
 * shots teach body type and proportions; medium shots fill the middle ground.
 * Use `pickScenes(count)` to get a quota-balanced selection.
 */
export type Framing = 'closeup' | 'medium' | 'full'

export interface CharacterShotScene {
  prompt: string
  framing: Framing
}

export const CHARACTER_SHOT_SCENES: CharacterShotScene[] = [
  // --- close-ups (face large in frame → teaches the FACE) ---
  { prompt: 'close-up portrait, front view, soft window light, plain neutral background', framing: 'closeup' },
  { prompt: 'three-quarter view headshot, natural daylight, shallow depth of field', framing: 'closeup' },
  { prompt: 'profile view, side lighting, dark studio background', framing: 'closeup' },
  { prompt: 'headshot tilted slightly down, even softbox lighting, seamless backdrop', framing: 'closeup' },
  { prompt: 'close-up, soft diffused light, slight smile, beige background', framing: 'closeup' },
  { prompt: 'neutral expression, overhead soft light, white seamless backdrop', framing: 'closeup' },
  { prompt: 'looking up, dramatic rim lighting, dark background', framing: 'closeup' },
  { prompt: 'serious expression, high-contrast black and white, studio', framing: 'closeup' },
  { prompt: 'relaxed portrait, warm window backlight, indoor neutral wall', framing: 'closeup' },
  { prompt: 'close portrait in shade, cool soft light, greenery background', framing: 'closeup' },
  // --- medium / waist-up (some body, still readable face) ---
  { prompt: 'waist-up shot, warm indoor lamp light, cozy interior', framing: 'medium' },
  { prompt: 'medium shot, soft golden indoor light, bookshelf background', framing: 'medium' },
  { prompt: 'smiling, casual snapshot, bright midday sun, park background', framing: 'medium' },
  { prompt: 'laughing candidly, backlit by afternoon sun, outdoors', framing: 'medium' },
  { prompt: 'sitting at a cafe table, window light, blurred interior behind', framing: 'medium' },
  { prompt: 'wearing a casual t-shirt, flat studio lighting, grey backdrop', framing: 'medium' },
  { prompt: 'looking over the shoulder, twilight ambient light, street', framing: 'medium' },
  // --- full / three-quarter body (teaches BODY TYPE / proportions) ---
  { prompt: 'full-body shot standing, golden hour sunlight, urban street background', framing: 'full' },
  { prompt: 'full body walking, cloudy day, wide shot, city sidewalk', framing: 'full' },
  { prompt: 'full-body seated on steps, bright daylight, architectural background', framing: 'full' },
  { prompt: 'dynamic pose mid-stride, motion candid, sunny outdoor plaza', framing: 'full' },
  { prompt: 'three-quarter body turning toward camera, evening light, plain wall', framing: 'full' },
  { prompt: 'full-body standing relaxed, flat studio lighting, grey seamless backdrop', framing: 'full' },
  { prompt: 'full-body leaning against a wall, soft daylight, urban exterior', framing: 'full' },
  { prompt: 'full body standing front-on, even daylight, neutral outdoor background', framing: 'full' },
  { prompt: 'three-quarter body seated on a chair, warm indoor light, simple room', framing: 'full' },
]

/** Aspect ratios cycled across shots so the set isn't all one crop. */
export const CHARACTER_SHOT_ASPECTS: string[] = ['1:1', '3:4', '4:3']

/** Pick up to `k` items spread evenly across `pool` (wraps if k > pool.length). */
function spread<T>(pool: T[], k: number): T[] {
  if (k <= 0 || pool.length === 0) return []
  const out: T[] = []
  if (k >= pool.length) {
    for (let i = 0; i < k; i++) out.push(pool[i % pool.length]!)
    return out
  }
  const stride = pool.length / k
  for (let i = 0; i < k; i++) out.push(pool[Math.floor(i * stride)]!)
  return out
}

/**
 * Choose `count` scenes with guaranteed body coverage. Close-ups stay
 * co-plurality (face quality), full-body is always present (body type),
 * medium fills the middle. Selection is spread within each tier so repeated
 * runs vary instead of always taking the first scenes.
 */
export function pickScenes(count: number): CharacterShotScene[] {
  if (count <= 0) return []
  const closeups = CHARACTER_SHOT_SCENES.filter((s) => s.framing === 'closeup')
  const mediums = CHARACTER_SHOT_SCENES.filter((s) => s.framing === 'medium')
  const fulls = CHARACTER_SHOT_SCENES.filter((s) => s.framing === 'full')

  let nClose = Math.round(count * 0.4)
  let nFull = Math.round(count * 0.35)
  let nMedium = count - nClose - nFull
  if (nMedium < 0) { nClose += nMedium; nMedium = 0 } // pathological clamp
  if (nFull < 1 && count >= 1) { nFull = 1; if (nClose > 0) nClose -= 1; else nMedium -= 1 }

  return [
    ...spread(fulls, nFull),
    ...spread(closeups, nClose),
    ...spread(mediums, nMedium),
  ]
}
