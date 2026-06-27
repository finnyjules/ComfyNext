/** Starter v2 template + built-in format presets. Mirrors the Python node's
 * _STARTER_LAYOUT / _FORMAT_PRESETS (comfy_extras/nodes_smart_layout.py) so
 * the editor and execution agree on defaults — keep both in sync. */

import type { FormatSpec, TemplateV2, TemplateV3 } from './types'

export const FORMAT_PRESETS: Record<string, FormatSpec> = {
  '1x1':     { w: 1080, h: 1080, label: 'Square' },
  '4x5':     { w: 1080, h: 1350, label: 'Feed portrait' },
  '9x16':    { w: 1080, h: 1920, label: 'Story', safeArea: { top: 270, bottom: 380 } },
  '16x9':    { w: 1920, h: 1080, label: 'Wide' },
  '300x250': { w: 300,  h: 250,  label: 'MPU' },
  '300x600': { w: 300,  h: 600,  label: 'Half page' },
  '728x90':  { w: 728,  h: 90,   label: 'Leaderboard' },
  '970x250': { w: 970,  h: 250,  label: 'Billboard' },
  '320x50':  { w: 320,  h: 50,   label: 'Mobile banner' },
  '160x600': { w: 160,  h: 600,  label: 'Skyscraper' },
}

export function makeStarterTemplate(id: string): TemplateV2 {
  return {
    version: 2,
    id,
    name: 'New Layout',
    master: '1x1',
    formats: structuredClone(FORMAT_PRESETS),
    grid: { gutter: 24, margin: 72, baseline: 12 },
    typeScale: { base: 28, ratio: 1.414 },
    background: { fill: '#0a0a0a' },
    elements: [],
  }
}

/** A v3 demo: a "headline lockup" section (headline + subhead) on the fine
 * grid plus an ungrouped badge. Used to verify sectioned cross-format render.
 * Regions are in master fine-grid units (1x1 master → ~78×78). */
export function v3Demo(): TemplateV3 {
  return {
    version: 3,
    id: 'v3-demo',
    name: 'Sectioned Demo',
    master: '1x1',
    formats: {
      '1x1':  { w: 1080, h: 1080, label: 'Square' },
      '9x16': { w: 1080, h: 1920, label: 'Story' },
      '16x9': { w: 1920, h: 1080, label: 'Wide' },
    },
    grid: { gutter: 24, margin: 72, baseline: 12 },
    typeScale: { base: 28, ratio: 1.414 },
    background: { fill: '#0E1116' },
    elements: [
      // Ungrouped badge, top-right.
      { id: 'demo-badge', type: 'shape', shape: 'circle', priority: 2,
        region: { col: 62, colSpan: 12, row: 4, rowSpan: 12 },
        style: { fill: '#34D399' } },
    ],
    sections: [
      {
        id: 'demo-lockup', name: 'headline lockup',
        region: { col: 4, colSpan: 70, row: 40, rowSpan: 32 },
        children: [
          { id: 'demo-headline', type: 'text', content: '{{ props.headline }}',
            level: 'display', priority: 1, overflow: 'shrink',
            region: { col: 4, colSpan: 70, row: 40, rowSpan: 16 },
            style: { color: '#F4F4F5', fontFamily: 'Anton', transform: 'uppercase', valign: 'bottom' } },
          { id: 'demo-subhead', type: 'text', content: '{{ props.subhead }}',
            level: 'subhead', priority: 2,
            region: { col: 4, colSpan: 70, row: 58, rowSpan: 10 },
            style: { color: '#34D399', fontFamily: 'Inter' } },
        ],
      },
    ],
  }
}
