// Curated, hand-tuned palettes grouped by color-theory harmony. These are the
// gallery starting points; the seed-color mode (harmonize) regenerates live.
// Ordered dark → light within each palette so they drop straight into a duotone
// (first/last) or a gradient map (all stops).

import type { CuratedPalette, HarmonyType } from './harmony'

export type { CuratedPalette } from './harmony'

export const CURATED_PALETTES: CuratedPalette[] = [
  // ── Monochromatic — one hue, tonal ramp ──────────────────────────────────
  { name: 'Ink Blue', type: 'monochromatic', colors: ['#0a1428', '#2a4a7a', '#8fb4e8'] },
  { name: 'Sepia', type: 'monochromatic', colors: ['#2b1a08', '#8a6a3a', '#f0e2c8'] },
  { name: 'Slate', type: 'monochromatic', colors: ['#12161c', '#4a5464', '#c8d2e0'] },

  // ── Complementary — opposite hues, high contrast ─────────────────────────
  { name: 'Teal / Ember', type: 'complementary', colors: ['#0b3d4a', '#f2a25c'] },
  { name: 'Cobalt / Amber', type: 'complementary', colors: ['#12306e', '#f0b429'] },
  { name: 'Plum / Lime', type: 'complementary', colors: ['#2d0a2e', '#c8e86a'] },

  // ── Split-complementary ──────────────────────────────────────────────────
  { name: 'Lagoon Pop', type: 'split-complementary', colors: ['#1f6f78', '#f25c54', '#f2b134'] },
  { name: 'Indigo Spark', type: 'split-complementary', colors: ['#2d2a6e', '#e85d75', '#e8a13a'] },

  // ── Analogous — neighbouring hues, calm ──────────────────────────────────
  { name: 'Ocean', type: 'analogous', colors: ['#06283d', '#256d85', '#47b5ff'] },
  { name: 'Forest', type: 'analogous', colors: ['#0c2a1f', '#2f6b4f', '#7fc8a9'] },
  { name: 'Fire', type: 'analogous', colors: ['#7a1f0a', '#e8622a', '#f2b134'] },

  // ── Accented analogous — analogous run + a complementary pop ─────────────
  { name: 'Harbor Pop', type: 'accented-analogous', colors: ['#1a3a5a', '#2f6b85', '#5fb0c9', '#f2884b'] },
  { name: 'Orchid Gold', type: 'accented-analogous', colors: ['#3a2a5a', '#6a4a8a', '#a988c9', '#e8d24a'] },

  // ── Triadic — three hues 120° apart ──────────────────────────────────────
  { name: 'Primary Play', type: 'triadic', colors: ['#e23b3b', '#3be27a', '#3b7ae2'] },
  { name: 'Candy', type: 'triadic', colors: ['#d94f8a', '#8ad94f', '#4f8ad9'] },

  // ── Tetradic — four hues 90° apart ───────────────────────────────────────
  { name: 'Carousel', type: 'tetradic', colors: ['#e2683b', '#8ae23b', '#3b8ae2', '#e23bb0'] },
  { name: 'Jewel Box', type: 'tetradic', colors: ['#c94f4f', '#4fc98a', '#4f6ac9', '#c9a84f'] },

  // ── Compound — two complementary pairs, unequal spacing ──────────────────
  { name: 'Dusk Ember', type: 'compound', colors: ['#1f4f6e', '#2f7f9a', '#e8894a', '#e8b04a'] },
  { name: 'Rosewood', type: 'compound', colors: ['#5a2a4a', '#8a4a6a', '#5aa87a', '#8ac89a'] },
]

/** Curated palettes for one harmony type (for a gallery row). */
export function palettesByType(type: HarmonyType): CuratedPalette[] {
  return CURATED_PALETTES.filter(p => p.type === type)
}
