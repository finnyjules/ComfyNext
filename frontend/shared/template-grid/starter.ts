/** Starter v2 template + built-in format presets. Mirrors the Python node's
 * _STARTER_LAYOUT / _FORMAT_PRESETS (comfy_extras/nodes_smart_layout.py) so
 * the editor and execution agree on defaults — keep both in sync. */

import type { FormatSpec, TemplateV2 } from './types'

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
