/**
 * Maps base model name patterns to partner node SVG icon filenames.
 * Icons live in /public/icons/partners/ and are served at /icons/partners/.
 * Order matters — first match wins (e.g. "sd 1.5" before generic "sd").
 */
const modelIconMap = {
  'flux': 'BFL.svg',
  'chroma': 'BFL.svg',
  'sd 1.5': 'Stability.svg',
  'sd3': 'Stability.svg',
  'sdxl': 'Stability.svg',
  'stable cascade': 'Stability.svg',
  'hunyuan': 'Tencent.svg',
  'wan': 'Wan.svg',
  'qwen': 'Wan.svg',
  'kling': 'Kling.svg',
  'ltx': 'LTXV.svg',
  'gemini': 'Gemini.svg',
  'grok': 'Grok.svg',
  'cogvideo': 'ByteDance.svg',
  'pixart': 'Pixverse.svg',
}

/**
 * Returns the URL path to the partner icon for a given model name,
 * or null if no match is found.
 */
export function getPartnerIcon(modelName) {
  if (!modelName) return null
  const lower = modelName.toLowerCase()
  for (const [key, icon] of Object.entries(modelIconMap)) {
    if (lower.includes(key)) return `/icons/partners/${icon}`
  }
  return null
}
