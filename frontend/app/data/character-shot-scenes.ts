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
 * Ordered loosely close-up → full-body and light → varied, so taking the first
 * N still yields a balanced spread of angles and framings.
 */
export const CHARACTER_SHOT_SCENES: string[] = [
  'close-up portrait, front view, soft window light, plain neutral background',
  'three-quarter view headshot, natural daylight, shallow depth of field',
  'profile view, side lighting, dark studio background',
  'headshot tilted slightly down, even softbox lighting, seamless backdrop',
  'close-up, soft diffused light, slight smile, beige background',
  'neutral expression, overhead soft light, white seamless backdrop',
  'looking up, dramatic rim lighting, dark background',
  'serious expression, high-contrast black and white, studio',
  'waist-up shot, warm indoor lamp light, cozy interior',
  'medium shot, soft golden indoor light, bookshelf background',
  'smiling, casual snapshot, bright midday sun, park background',
  'laughing candidly, backlit by afternoon sun, outdoors',
  'looking over the shoulder, twilight ambient light, street',
  'three-quarter back view turning toward camera, evening light',
  'candid photo outdoors, overcast daylight, looking away from camera',
  'sitting at a cafe table, window light, blurred interior behind',
  'wearing a coat, cold blue daylight, outdoor winter setting',
  'wearing a casual t-shirt, flat studio lighting, grey backdrop',
  'full-body shot standing, golden hour sunlight, urban street background',
  'full body walking, cloudy day, wide shot, city sidewalk',
  'full-body seated on steps, bright daylight, architectural background',
  'dynamic pose mid-stride, motion candid, sunny outdoor plaza',
  'relaxed portrait, warm window backlight, indoor neutral wall',
  'close portrait in shade, cool soft light, greenery background',
]

/** Aspect ratios cycled across shots so the set isn't all one crop. */
export const CHARACTER_SHOT_ASPECTS: string[] = ['1:1', '3:4', '4:3']
