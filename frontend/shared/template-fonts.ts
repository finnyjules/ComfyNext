/**
 * Curated template fonts — single source of truth shared by:
 *  - the server renderer (`render-template.post.ts`) which loads the woff
 *    files for satori + opentype measurement, and
 *  - the editor UI (`useTemplateFonts.ts`) which lists picks for the
 *    PropertyPanel font dropdown.
 *
 * Adding a font:
 *  1. `pnpm add @fontsource/<slug>` (or any other woff source).
 *  2. Append an entry below with the family name and per-weight file path
 *     (relative to `node_modules`).
 *  3. That's it — server registers it automatically, editor offers it in
 *     the picker, and the existing CSS @import covers preview rendering.
 */
export interface TemplateFontWeight {
  weight: 400 | 700
  /** Relative path under `node_modules` — used by the server to read the
   *  woff for satori + opentype, and by Vite when we import it on the client. */
  modulePath: string
}

export interface TemplateFontFamily {
  /** CSS font-family + display name. */
  name: string
  /** Short category for the picker UI. */
  category: 'sans' | 'serif' | 'display' | 'mono'
  weights: TemplateFontWeight[]
}

export const TEMPLATE_FONTS: TemplateFontFamily[] = [
  {
    name: 'Inter',
    category: 'sans',
    weights: [
      { weight: 400, modulePath: '@fontsource/inter/files/inter-latin-400-normal.woff' },
      { weight: 700, modulePath: '@fontsource/inter/files/inter-latin-700-normal.woff' },
    ],
  },
  {
    name: 'Space Grotesk',
    category: 'sans',
    weights: [
      { weight: 400, modulePath: '@fontsource/space-grotesk/files/space-grotesk-latin-400-normal.woff' },
      { weight: 700, modulePath: '@fontsource/space-grotesk/files/space-grotesk-latin-700-normal.woff' },
    ],
  },
  {
    name: 'Playfair Display',
    category: 'serif',
    weights: [
      { weight: 400, modulePath: '@fontsource/playfair-display/files/playfair-display-latin-400-normal.woff' },
      { weight: 700, modulePath: '@fontsource/playfair-display/files/playfair-display-latin-700-normal.woff' },
    ],
  },
  {
    name: 'Bebas Neue',
    category: 'display',
    // Bebas Neue ships a single weight that's already display-bold by design.
    // We register it under both 400 and 700 so the editor's bold toggle still
    // works visually (no separate bold file to fall back to).
    weights: [
      { weight: 400, modulePath: '@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff' },
      { weight: 700, modulePath: '@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff' },
    ],
  },
  {
    name: 'Anton',
    category: 'display',
    weights: [
      { weight: 400, modulePath: '@fontsource/anton/files/anton-latin-400-normal.woff' },
      { weight: 700, modulePath: '@fontsource/anton/files/anton-latin-400-normal.woff' },
    ],
  },
]

/** Names only — what the editor's font dropdown renders. */
export const TEMPLATE_FONT_NAMES = TEMPLATE_FONTS.map((f) => f.name)
