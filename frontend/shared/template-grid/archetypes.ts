/**
 * Built-in Swiss archetypes — curated starting compositions on the master
 * grid. Each is an element-set (plus background + default brand) that adopts
 * the template's existing format set, so picking one immediately produces the
 * full ad-size matrix.
 *
 * Colours use {{ brand.* }} tokens so an archetype re-skins with the brand
 * kit; content uses {{ props.text_layer_* }} / {{ props.image_layer_1 }} so a
 * wired layer flows straight in. The DEFAULT_BRAND below makes archetypes look
 * intentional even before the user sets a brand.
 */
import type { BrandKit, ElementV2, Region, TemplateV2, TextLevel, TextStyleV2 } from './types'

export interface Archetype {
  id: string
  name: string
  blurb: string
  background?: { fill?: string; image?: string }
  brand?: BrandKit
  elements: ElementV2[]
}

/** Sensible defaults so a fresh archetype reads well with no brand set. */
export const DEFAULT_BRAND: BrandKit = {
  primary: '#E2362B',
  secondary: '#1A1A1A',
  accent: '#E2362B',
  foreground: '#FFFFFF',
  background: '#0E0E10',
}

const HEADLINE = '{{ props.text_layer_1 }}'
const SUBHEAD = '{{ props.text_layer_2 }}'
const HERO = '{{ props.image_layer_1 }}'

function text(
  id: string, content: string, level: TextLevel,
  priority: number, region: Region, style: TextStyleV2,
): ElementV2 {
  return { id, type: 'text', content, level, priority, region, style }
}

export const ARCHETYPES: Archetype[] = [
  {
    id: 'hero-band',
    name: 'Hero + headline band',
    blurb: 'Full-bleed image with a brand band carrying headline and CTA.',
    background: { fill: '{{ brand.background }}' },
    brand: DEFAULT_BRAND,
    elements: [
      { id: 'image_layer_1', type: 'image', role: 'IMAGE_LAYER_1', priority: 4,
        region: { col: 1, colSpan: 6, row: 1, rowSpan: 6 }, focal: { x: 0.5, y: 0.4 },
        style: { fit: 'cover' }, content: HERO },
      { id: 'band', type: 'shape', shape: 'rect', priority: 6,
        region: { col: 1, colSpan: 6, row: 5, rowSpan: 2 },
        style: { fill: '{{ brand.primary }}' } },
      text('headline', HEADLINE, 'display', 1,
        { col: 1, colSpan: 5, row: 5, rowSpan: 1 },
        { color: '{{ brand.foreground }}', fontWeight: 700, valign: 'bottom' }),
      text('cta', 'Shop now', 'caption', 2,
        { col: 1, colSpan: 4, row: 6, rowSpan: 1 },
        { color: '{{ brand.foreground }}', fontWeight: 700, valign: 'bottom' }),
    ],
  },
  {
    id: 'split',
    name: 'Split · image / type',
    blurb: 'Hard vertical split: image one side, type block the other.',
    background: { fill: '{{ brand.background }}' },
    brand: DEFAULT_BRAND,
    elements: [
      { id: 'image_layer_1', type: 'image', role: 'IMAGE_LAYER_1', priority: 4,
        region: { col: 1, colSpan: 3, row: 1, rowSpan: 6 }, focal: { x: 0.5, y: 0.5 },
        style: { fit: 'cover' }, content: HERO },
      text('headline', HEADLINE, 'headline', 1,
        { col: 4, colSpan: 3, row: 2, rowSpan: 2 },
        { color: '{{ brand.foreground }}', fontWeight: 700 }),
      text('subhead', SUBHEAD, 'subhead', 5,
        { col: 4, colSpan: 3, row: 4, rowSpan: 1 },
        { color: '{{ brand.foreground }}' }),
      text('cta', 'Shop now', 'caption', 2,
        { col: 4, colSpan: 3, row: 6, rowSpan: 1 },
        { color: '{{ brand.accent }}', fontWeight: 700, valign: 'bottom' }),
    ],
  },
  {
    id: 'type-poster',
    name: 'Type-only poster',
    blurb: 'Oversized headline on a brand field — pure Swiss typography.',
    background: { fill: '{{ brand.primary }}' },
    brand: DEFAULT_BRAND,
    elements: [
      text('logo', 'MONO.', 'body', 3,
        { col: 1, colSpan: 3, row: 1, rowSpan: 1 },
        { color: '{{ brand.foreground }}', fontWeight: 700 }),
      text('headline', HEADLINE, 'display', 1,
        { col: 1, colSpan: 6, row: 3, rowSpan: 3 },
        { color: '{{ brand.foreground }}', fontWeight: 700, transform: 'uppercase' }),
      text('subhead', SUBHEAD, 'subhead', 5,
        { col: 1, colSpan: 4, row: 6, rowSpan: 1 },
        { color: '{{ brand.foreground }}' }),
      text('cta', 'Shop now', 'caption', 2,
        { col: 5, colSpan: 2, row: 6, rowSpan: 1 },
        { color: '{{ brand.foreground }}', fontWeight: 700, align: 'right', valign: 'bottom' }),
    ],
  },
  {
    id: 'editorial',
    name: 'Editorial grid',
    blurb: 'Logo, large headline, image and caption on the modular grid.',
    background: { fill: '{{ brand.background }}' },
    brand: DEFAULT_BRAND,
    elements: [
      text('logo', 'MONO.', 'body', 3,
        { col: 1, colSpan: 3, row: 1, rowSpan: 1 },
        { color: '{{ brand.foreground }}', fontWeight: 700 }),
      text('headline', HEADLINE, 'headline', 1,
        { col: 1, colSpan: 6, row: 2, rowSpan: 2 },
        { color: '{{ brand.foreground }}', fontWeight: 700 }),
      { id: 'image_layer_1', type: 'image', role: 'IMAGE_LAYER_1', priority: 4,
        region: { col: 1, colSpan: 4, row: 4, rowSpan: 3 }, focal: { x: 0.5, y: 0.5 },
        style: { fit: 'cover' }, content: HERO },
      text('subhead', SUBHEAD, 'body', 5,
        { col: 5, colSpan: 2, row: 4, rowSpan: 2 },
        { color: '{{ brand.foreground }}' }),
      text('cta', 'Shop now', 'caption', 2,
        { col: 5, colSpan: 2, row: 6, rowSpan: 1 },
        { color: '{{ brand.accent }}', fontWeight: 700, valign: 'bottom' }),
    ],
  },
]

/** Apply an archetype onto a template, keeping its formats/grid/typeScale/
 * master/id/name. Brand is merged under the archetype's defaults so the user's
 * existing brand wins. Returns a new template (no mutation). */
export function applyArchetype(template: TemplateV2, arch: Archetype): TemplateV2 {
  return {
    ...template,
    background: arch.background ?? template.background,
    brand: { ...arch.brand, ...template.brand },
    elements: JSON.parse(JSON.stringify(arch.elements)) as ElementV2[],
  }
}
