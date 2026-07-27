/**
 * Variable-font catalog. Each entry is a Google Font with variable axes. The
 * CSS consumers (Text on Path, Text Mask, the Compositor's text layers, the
 * template renderer) load `cssUrl` — a Google Fonts CSS2 link requesting the
 * FULL axis ranges so the variable file is served — then vary it live via
 * `font-variation-settings`. Vector Type Studio instead loads the `ttfPath`
 * outlines (see below); it is this list's font menu.
 *
 * Axis tags follow the OpenType spec: wght (weight), wdth (width), slnt
 * (slant), opsz (optical size), plus font-specific ones (SOFT, WONK, CASL,
 * MONO, GRAD). Each axis declares its slider range + default.
 *
 * Every consumer is a LOCAL render — no AI, no cost.
 *
 * `ttfPath` points at the same family's VARIABLE TTF inside the google/fonts
 * repo, for Vector Type Studio (which needs real outlines, not CSS). It is a
 * SEPARATE source from `cssUrl`: fonts.googleapis.com/css2 never serves the
 * variable file — a curl UA gets static per-weight TTF cuts, a browser UA gets
 * woff2 that is still one static instance split by unicode-range. See
 * docs/superpowers/specs/2026-07-27-vector-type-studio-design.md.
 *
 * The axis list is baked into the repo FILENAME (`RobotoFlex[GRAD,XOPQ,…].ttf`)
 * and cannot be derived by convention — every path below is curated and was
 * verified against the repo listing + parsed with fontkit (2026-07-27).
 * `server/api/fonts/variable.get.ts` resolves an id to this path; it never
 * accepts a URL from the caller.
 */

export interface FontAxis {
  tag: string          // OpenType axis tag, e.g. 'wght'
  label: string        // human label, e.g. 'Weight'
  min: number
  max: number
  default: number
  step?: number
}

export interface VariableFont {
  id: string
  label: string
  family: string       // CSS font-family name as Google serves it
  cssUrl: string       // Google Fonts CSS2 link with full axis ranges
  /** Repo-relative path to the VARIABLE ttf in google/fonts, e.g.
   *  `ofl/inter/Inter[opsz,wght].ttf`. Curated — never derived. */
  ttfPath: string
  axes: FontAxis[]
  defaultSize: number  // px at the reference canvas width
  category: 'sans' | 'serif' | 'display' | 'mono'
}

const W = (min: number, max: number, def = 400): FontAxis =>
  ({ tag: 'wght', label: 'Weight', min, max, default: def, step: 1 })

export const VARIABLE_FONTS: VariableFont[] = [
  {
    id: 'inter',
    label: 'Inter',
    family: 'Inter',
    // Inter has no `slnt` axis (italics are a separate file). The old css2 URL
    // asked for one and 400'd; the repo TTF carries opsz + wght only.
    cssUrl: 'https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,100..900&display=swap',
    ttfPath: 'ofl/inter/Inter[opsz,wght].ttf',
    axes: [W(100, 900, 700), { tag: 'opsz', label: 'Optical size', min: 14, max: 32, default: 14, step: 1 }],
    defaultSize: 120,
    category: 'sans',
  },
  {
    id: 'roboto-flex',
    label: 'Roboto Flex',
    family: 'Roboto Flex',
    cssUrl: 'https://fonts.googleapis.com/css2?family=Roboto+Flex:opsz,slnt,wdth,wght@8..144,-10..0,25..151,100..1000&display=swap',
    // 13 axes in the file; the CSS consumers curate the four legible ones. Vector
    // Type reads the full set off the parsed font, not from here.
    ttfPath: 'ofl/robotoflex/RobotoFlex[GRAD,XOPQ,XTRA,YOPQ,YTAS,YTDE,YTFI,YTLC,YTUC,opsz,slnt,wdth,wght].ttf',
    axes: [
      W(100, 1000, 700),
      { tag: 'wdth', label: 'Width', min: 25, max: 151, default: 100, step: 1 },
      { tag: 'opsz', label: 'Optical size', min: 8, max: 144, default: 60, step: 1 },
      { tag: 'slnt', label: 'Slant', min: -10, max: 0, default: 0, step: 1 },
    ],
    defaultSize: 120,
    category: 'sans',
  },
  {
    id: 'archivo',
    label: 'Archivo',
    family: 'Archivo',
    cssUrl: 'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&display=swap',
    ttfPath: 'ofl/archivo/Archivo[wdth,wght].ttf',
    axes: [W(100, 900, 800), { tag: 'wdth', label: 'Width', min: 62, max: 125, default: 100, step: 1 }],
    defaultSize: 120,
    category: 'sans',
  },
  {
    id: 'fraunces',
    label: 'Fraunces',
    family: 'Fraunces',
    cssUrl: 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,100..900,0..100,0..1&display=swap',
    ttfPath: 'ofl/fraunces/Fraunces[SOFT,WONK,opsz,wght].ttf',
    axes: [
      W(100, 900, 600),
      { tag: 'opsz', label: 'Optical size', min: 9, max: 144, default: 80, step: 1 },
      { tag: 'SOFT', label: 'Softness', min: 0, max: 100, default: 0, step: 1 },
      { tag: 'WONK', label: 'Wonk', min: 0, max: 1, default: 0, step: 1 },
    ],
    defaultSize: 120,
    category: 'serif',
  },
  {
    id: 'recursive',
    label: 'Recursive',
    family: 'Recursive',
    cssUrl: 'https://fonts.googleapis.com/css2?family=Recursive:CASL,CRSV,MONO,slnt,wght@0..1,0..1,0..1,-15..0,300..1000&display=swap',
    ttfPath: 'ofl/recursive/Recursive[CASL,CRSV,MONO,slnt,wght].ttf',
    axes: [
      W(300, 1000, 700),
      { tag: 'CASL', label: 'Casual', min: 0, max: 1, default: 0, step: 0.01 },
      { tag: 'MONO', label: 'Mono', min: 0, max: 1, default: 0, step: 0.01 },
      { tag: 'slnt', label: 'Slant', min: -15, max: 0, default: 0, step: 1 },
    ],
    defaultSize: 120,
    category: 'sans',
  },
  {
    id: 'bricolage',
    label: 'Bricolage Grotesque',
    family: 'Bricolage Grotesque',
    // The file's opsz range is 12–96, not 10–48; the old css2 URL asked for the
    // wrong range and 400'd.
    cssUrl: 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,200..800&display=swap',
    ttfPath: 'ofl/bricolagegrotesque/BricolageGrotesque[opsz,wdth,wght].ttf',
    axes: [
      W(200, 800, 700),
      { tag: 'opsz', label: 'Optical size', min: 12, max: 96, default: 36, step: 1 },
    ],
    defaultSize: 120,
    category: 'display',
  },
  {
    id: 'big-shoulders',
    label: 'Big Shoulders Display',
    family: 'Big Shoulders Display',
    cssUrl: 'https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@100..900&display=swap',
    ttfPath: 'ofl/bigshouldersdisplay/BigShouldersDisplay[wght].ttf',
    axes: [W(100, 900, 800)],
    defaultSize: 150,
    category: 'display',
  },
  {
    id: 'space-grotesk',
    label: 'Space Grotesk',
    family: 'Space Grotesk',
    cssUrl: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300..700&display=swap',
    ttfPath: 'ofl/spacegrotesk/SpaceGrotesk[wght].ttf',
    axes: [W(300, 700, 600)],
    defaultSize: 120,
    category: 'sans',
  },
  {
    id: 'unbounded',
    label: 'Unbounded',
    family: 'Unbounded',
    cssUrl: 'https://fonts.googleapis.com/css2?family=Unbounded:wght@200..900&display=swap',
    ttfPath: 'ofl/unbounded/Unbounded[wght].ttf',
    axes: [W(200, 900, 700)],
    defaultSize: 110,
    category: 'display',
  },
  {
    id: 'source-serif',
    label: 'Source Serif 4',
    family: 'Source Serif 4',
    cssUrl: 'https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,200..900&display=swap',
    ttfPath: 'ofl/sourceserif4/SourceSerif4[opsz,wght].ttf',
    axes: [
      W(200, 900, 600),
      { tag: 'opsz', label: 'Optical size', min: 8, max: 60, default: 40, step: 1 },
    ],
    defaultSize: 120,
    category: 'serif',
  },
]

export const VARIABLE_FONTS_BY_ID: Record<string, VariableFont> = Object.fromEntries(
  VARIABLE_FONTS.map(f => [f.id, f]),
)

export const DEFAULT_FONT_ID = 'inter'
