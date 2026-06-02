/**
 * Text-effect catalog — drives the "Text effect" node's gallery. Each effect
 * is a typographic treatment: the user types a word, picks an effect, and the
 * backend asks a text-strong image model (Ideogram v3) to render the word in
 * that style.
 *
 * Mirrors comfy_api_nodes/text_effects.py — keep `id` identical (dispatch key).
 *
 * `cssPreview` selects a client-side recipe used to live-preview the user's
 * actual word inside each gallery card. Flat/graphic effects approximate well
 * in CSS; volumetric ones fall back to a tasteful 'styled' treatment (the real
 * look comes from the AI render regardless).
 */

export type TextEffectCategory = 'hype' | 'museum'

// Which CSS recipe the gallery card uses to render the live word preview.
export type CssPreviewRecipe =
  | 'chrome' | 'holo' | 'glitch' | 'gradient' | 'riso'
  | 'concrete' | 'neon-trail' | 'molten' | 'glass' | 'outline'
  | 'styled'   // generic accent fallback for volumetric effects

export interface TextEffect {
  id: string
  label: string
  pitch: string
  category: TextEffectCategory
  // Prompt template — `{TEXT}` is replaced with the user's word. Written to
  // coax Ideogram into rendering the literal word in the given style.
  promptTemplate: string
  accent: string                 // hex accent used for the card swatch / styled fallback
  cssPreview: CssPreviewRecipe
  tags: string[]
  // Dispersion effects want the letters to break apart. When `dispersion` is
  // true, picking the effect seeds the node's "freedom" widget with
  // `defaultFreedom` so the restyle disperses out of the box (material effects
  // leave freedom at 0). Mirrors `medium`/`default_freedom` in text_effects.py.
  dispersion?: boolean
  defaultFreedom?: number
}

// The literal word is wrapped in quotes in every template so Ideogram treats
// it as text-to-render rather than scene description. Kept consistent so the
// model behaves predictably across effects.
const W = '{TEXT}'

export const TEXT_EFFECTS: TextEffect[] = [
  // ===== Hype / streetwear =================================================
  {
    id: 'liquid-chrome',
    label: 'Liquid Chrome',
    pitch: 'Flowing mercury Y2K metal',
    category: 'hype',
    promptTemplate: `the word "${W}" sculpted from flowing liquid chrome, glossy mercury metal with sharp studio reflections, Y2K aesthetic, dark seamless background, octane render, high contrast`,
    accent: '#c7d2e0',
    cssPreview: 'chrome',
    tags: ['metal', 'glossy', 'y2k'],
  },
  {
    id: 'inflated-gloss',
    label: 'Inflated Gloss',
    pitch: 'Puffy vacuum-sealed 3D type',
    category: 'hype',
    promptTemplate: `the word "${W}" as glossy inflated 3D letters, puffy vacuum-sealed balloon typography, soft studio lighting, subtle subsurface sheen, pastel seamless background, blender octane render`,
    accent: '#ff8fb1',
    cssPreview: 'styled',
    tags: ['3d', 'glossy', 'puffy'],
  },
  {
    id: 'iridescent-holo',
    label: 'Iridescent Holo',
    pitch: 'Oil-slick holographic foil',
    category: 'hype',
    promptTemplate: `the word "${W}" in iridescent holographic foil, oil-slick rainbow sheen shifting across the letters, reflective chrome edges, dark background, hyper-glossy product render`,
    accent: '#a78bfa',
    cssPreview: 'holo',
    tags: ['holographic', 'iridescent', 'foil'],
  },
  {
    id: 'chromatic-glitch',
    label: 'Chromatic Glitch',
    pitch: 'RGB-split datamosh',
    category: 'hype',
    promptTemplate: `the word "${W}" with heavy chromatic aberration and RGB channel split, glitch art, datamosh scanlines, VHS distortion, dark background, new-media aesthetic`,
    accent: '#22d3ee',
    cssPreview: 'glitch',
    tags: ['glitch', 'rgb', 'digital'],
  },
  {
    id: 'acid-graphics',
    label: 'Acid Graphics',
    pitch: 'Rave-flyer warp',
    category: 'hype',
    promptTemplate: `the word "${W}" as acid graphics, hyper-saturated warped chrome lettering, rave flyer aesthetic, melting distorted forms, bold gradients, dark background`,
    accent: '#a3e635',
    cssPreview: 'gradient',
    tags: ['acid', 'rave', 'saturated'],
  },
  {
    id: 'distressed-screenprint',
    label: 'Distressed Screenprint',
    pitch: 'Cracked xerox tee print',
    category: 'hype',
    promptTemplate: `the word "${W}" as a distressed screenprint, cracked and faded ink texture, halftone grain, vintage graphic-tee print, off-white paper background, high contrast`,
    accent: '#e5e7eb',
    cssPreview: 'riso',
    tags: ['print', 'distressed', 'streetwear'],
  },
  {
    id: 'gradient-mesh',
    label: 'Gradient Mesh',
    pitch: 'Smooth blob gradients',
    category: 'hype',
    promptTemplate: `the word "${W}" formed from smooth bold gradient mesh blobs, soft vibrant color transitions, rounded modern type, minimal seamless background, contemporary poster design`,
    accent: '#fb7185',
    cssPreview: 'gradient',
    tags: ['gradient', 'modern', 'poster'],
  },

  // ===== Contemporary art / museum ========================================
  {
    id: 'brutalist-concrete',
    label: 'Brutalist Concrete',
    pitch: 'Raw cast concrete',
    category: 'museum',
    promptTemplate: `the word "${W}" cast in raw brutalist concrete, monolithic heavy letterforms, harsh directional shadows, rough aggregate texture, neutral gray studio background, architectural photography`,
    accent: '#9ca3af',
    cssPreview: 'concrete',
    tags: ['concrete', 'brutalist', 'architectural'],
  },
  {
    id: 'ink-in-water',
    label: 'Ink in Water',
    pitch: 'Billowing ink dispersion',
    category: 'museum',
    promptTemplate: `the word "${W}" dissolving into billowing black ink dispersing through clear water, elegant fluid tendrils, high-speed photography, white background, fine art`,
    accent: '#64748b',
    cssPreview: 'styled',
    tags: ['fluid', 'ink', 'elegant'],
    dispersion: true,
    defaultFreedom: 0.65,
  },
  {
    id: 'smoke-vapor',
    label: 'Smoke / Vapor',
    pitch: 'Drifting monochrome smoke',
    category: 'museum',
    promptTemplate: `the word "${W}" forming from drifting wisps of monochrome smoke and vapor, soft volumetric haze, dark background, moody fine-art photography`,
    accent: '#94a3b8',
    cssPreview: 'styled',
    tags: ['smoke', 'volumetric', 'moody'],
    dispersion: true,
    defaultFreedom: 0.65,
  },
  {
    id: 'frosted-glass',
    label: 'Frosted Glass',
    pitch: 'Translucent acrylic',
    category: 'museum',
    promptTemplate: `the word "${W}" as translucent frosted glass letters, soft refraction and caustics, shallow depth of field, minimal pastel background, product render`,
    accent: '#bae6fd',
    cssPreview: 'glass',
    tags: ['glass', 'translucent', 'soft'],
  },
  {
    id: 'wireframe-mesh',
    label: 'Wireframe Mesh',
    pitch: '3D topology blueprint',
    category: 'museum',
    promptTemplate: `the word "${W}" as a technical 3D wireframe mesh, glowing topology lines, blueprint aesthetic, dark background, generative-art render`,
    accent: '#38bdf8',
    cssPreview: 'outline',
    tags: ['wireframe', '3d', 'technical'],
  },
  {
    id: 'risograph',
    label: 'Risograph',
    pitch: 'Duotone riso grain',
    category: 'museum',
    promptTemplate: `the word "${W}" as a risograph print, two-color duotone with misregistration, visible grain and ink texture, indie art-book aesthetic, paper background`,
    accent: '#f472b6',
    cssPreview: 'riso',
    tags: ['riso', 'duotone', 'print'],
  },
  {
    id: 'crystalline',
    label: 'Crystalline',
    pitch: 'Cut-crystal facets',
    category: 'museum',
    promptTemplate: `the word "${W}" carved from cut crystal and gemstone facets, prismatic light refraction, sharp polished edges, dark background, luxury product render`,
    accent: '#c4b5fd',
    cssPreview: 'styled',
    tags: ['crystal', 'prismatic', 'luxury'],
  },
  {
    id: 'light-trails',
    label: 'Light Trails',
    pitch: 'Long-exposure neon streaks',
    category: 'museum',
    promptTemplate: `the word "${W}" drawn in glowing long-exposure light trails, neon light-painting streaks against a dark night scene, motion blur, photographic`,
    accent: '#f59e0b',
    cssPreview: 'neon-trail',
    tags: ['light', 'long-exposure', 'neon'],
    dispersion: true,
    defaultFreedom: 0.6,
  },
  {
    id: 'molten-metal',
    label: 'Molten Metal',
    pitch: 'Glowing poured metal',
    category: 'museum',
    promptTemplate: `the word "${W}" as glowing molten metal, poured liquid steel with incandescent orange heat, dramatic industrial lighting, dark background, cinematic render`,
    accent: '#f97316',
    cssPreview: 'molten',
    tags: ['metal', 'molten', 'industrial'],
  },
]

export const TEXT_EFFECTS_BY_ID: Record<string, TextEffect> = Object.fromEntries(
  TEXT_EFFECTS.map(e => [e.id, e]),
)

export const DEFAULT_TEXT_EFFECT_ID = 'liquid-chrome'

export const TEXT_EFFECT_CATEGORY_LABELS: Record<TextEffectCategory, string> = {
  hype: 'Hype',
  museum: 'Museum',
}
