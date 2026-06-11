// frontend/app/data/slate-templates.ts
/**
 * The six LIV-style slate primitives — data-only `SlateTemplate` definitions.
 * Colors/fonts are brand tokens (`{{ brand.* }}`), user copy is slot tokens
 * (`{{ props.* }}`). instantiate.ts resolves them into editable Frame layers.
 * Geometry: x/y = normalized center (0..1); sizes normalized to canvas WIDTH.
 */
import type { SlateTemplate } from '~/lib/slates/types'

const ACC = '{{ brand.accent }}'
const ACC2 = '{{ brand.accent2 }}'
const FG = '{{ brand.foreground }}'
const BG = '{{ brand.primary }}'
const FONT = '{{ brand.fontDisplay }}'
const FONT_BODY = '{{ brand.fontBody }}'
const GRAD = { type: 'linear' as const, angle: 0, stops: [{ offset: 0, color: ACC }, { offset: 1, color: ACC2 }] }

// ── 1. event-slate — the broadcast intro card (tokenized Phase 1 fixture) ────
const eventSlate: SlateTemplate = {
  id: 'event-slate',
  label: 'Event Slate',
  pitch: 'City, date, venue — the broadcast intro card.',
  motion: { fps: 30, duration: 4 },
  textSlots: [
    { key: 'title', label: 'City / Title', default: 'ADELAIDE' },
    { key: 'date', label: 'Date', default: '14–16 FEB' },
    { key: 'venue', label: 'Venue', default: 'THE GRANGE GOLF CLUB' },
    { key: 'micro', label: 'Microcopy', default: 'WATCH LIVE — 2025' },
  ],
  mediaSlots: [],
  layers: [
    {
      kind: 'rect', ref: 'bar', x: 0.5, y: 0.532, w: 0.46, h: 0.085, fill: GRAD,
      animation: { offset: 0.25, in: { presetId: 'slide-right', duration: 0.5, stagger: 0 }, out: { presetId: 'fade-out', duration: 0.4, stagger: 0 } },
    },
    {
      kind: 'text', ref: 'city', text: '{{ props.title }}', x: 0.5, y: 0.42, fontSize: 0.11, fontWeight: 900, fontFamily: FONT, color: FG,
      animation: { offset: 0, in: { presetId: 'mask-up', duration: 0.7, stagger: 0.035 }, out: { presetId: 'slide-out-up', duration: 0.45, stagger: 0.02 } },
    },
    {
      kind: 'text', ref: 'date', text: '{{ props.date }}', x: 0.5, y: 0.535, fontSize: 0.055, fontWeight: 800, fontFamily: FONT, color: BG,
      animation: { offset: 0.45, in: { presetId: 'slide-up', duration: 0.5, stagger: 0.03 }, out: { presetId: 'fade-out', duration: 0.35, stagger: 0.02 } },
    },
    {
      kind: 'text', ref: 'venue', text: '{{ props.venue }}', x: 0.5, y: 0.63, fontSize: 0.034, fontWeight: 700, fontFamily: FONT_BODY, color: ACC,
      animation: { offset: 0.65, in: { presetId: 'fade-in', duration: 0.5, stagger: 0.015 }, out: { presetId: 'fade-out', duration: 0.35, stagger: 0 } },
    },
    {
      kind: 'text', ref: 'micro', text: '{{ props.micro }}', x: 0.5, y: 0.92, fontSize: 0.018, fontWeight: 600, fontFamily: FONT_BODY, color: ACC,
      animation: { offset: 0.9, in: { presetId: 'typewriter', duration: 0.6, stagger: 0.02 }, loop: { presetId: 'glitch-loop', duration: 1.2, stagger: 0.01 } },
    },
  ],
  thumb: [BG, ACC, ACC2],
}

// ── 2. photo-mask-punch — a giant word punched out of a photo ────────────────
const photoMaskPunch: SlateTemplate = {
  id: 'photo-mask-punch',
  label: 'Photo Mask Punch',
  pitch: 'A giant word punched out of your photo.',
  motion: { fps: 30, duration: 4 },
  textSlots: [{ key: 'word', label: 'Word', default: '25' }],
  mediaSlots: [{ key: 'photo', label: 'Photo / video still' }],
  layers: [
    {
      kind: 'text', ref: 'maskWord', text: '{{ props.word }}', x: 0.5, y: 0.5, fontSize: 0.42, fontWeight: 900, fontFamily: FONT, color: FG,
    },
    {
      kind: 'media', ref: 'photo', slot: 'photo', x: 0.5, y: 0.5, w: 0.9, h: 0.9, maskedByRef: 'maskWord', fallbackFill: GRAD,
      animation: { offset: 0, in: { presetId: 'grow-in', duration: 0.7, stagger: 0 }, loop: { presetId: 'breathe', duration: 3, stagger: 0 }, out: { presetId: 'fade-out', duration: 0.5, stagger: 0 } },
    },
    {
      kind: 'text', ref: 'caption', text: '{{ props.word }}', x: 0.5, y: 0.9, fontSize: 0.03, fontWeight: 700, fontFamily: FONT_BODY, color: ACC,
      animation: { offset: 0.5, in: { presetId: 'fade-in', duration: 0.4, stagger: 0.02 }, out: { presetId: 'fade-out', duration: 0.3, stagger: 0 } },
    },
  ],
  thumb: [ACC2, FG, ACC],
}

// ── 3. marquee-band — three scrolling wordmark bands ─────────────────────────
const PHRASE_TILE = '{{ props.phrase }}   {{ props.phrase }}   {{ props.phrase }}'
const marqueeBand: SlateTemplate = {
  id: 'marquee-band',
  label: 'Marquee Band',
  pitch: 'Three scrolling wordmark bands.',
  motion: { fps: 30, duration: 6 },
  textSlots: [{ key: 'phrase', label: 'Phrase', default: 'LIV GOLF' }],
  mediaSlots: [],
  layers: [
    { kind: 'rect', ref: 'band1', x: 0.5, y: 0.25, w: 1.6, h: 0.18, fill: ACC },
    {
      kind: 'text', ref: 'word1', text: PHRASE_TILE, x: 0.5, y: 0.25, fontSize: 0.09, fontWeight: 900, fontFamily: FONT, color: BG,
      animation: { offset: 0, loop: { presetId: 'marquee', duration: 3, stagger: 0 } },
    },
    { kind: 'rect', ref: 'band2', x: 0.5, y: 0.5, w: 1.6, h: 0.18, fill: BG },
    {
      kind: 'text', ref: 'word2', text: PHRASE_TILE, x: 0.5, y: 0.5, fontSize: 0.09, fontWeight: 900, fontFamily: FONT, color: FG,
      animation: { offset: 0, loop: { presetId: 'marquee', duration: 3, stagger: 0 } },
    },
    { kind: 'rect', ref: 'band3', x: 0.5, y: 0.75, w: 1.6, h: 0.18, fill: ACC2 },
    {
      kind: 'text', ref: 'word3', text: PHRASE_TILE, x: 0.5, y: 0.75, fontSize: 0.09, fontWeight: 900, fontFamily: FONT, color: BG,
      animation: { offset: 0, loop: { presetId: 'marquee', duration: 3, stagger: 0 } },
    },
  ],
  thumb: [ACC, BG, ACC2],
}

// ── 4. lower-third — name + role broadcast strap ─────────────────────────────
const lowerThird: SlateTemplate = {
  id: 'lower-third',
  label: 'Lower Third',
  pitch: 'Name + role broadcast strap.',
  motion: { fps: 30, duration: 4 },
  textSlots: [
    { key: 'name', label: 'Name', default: 'JON RAHM' },
    { key: 'role', label: 'Role', default: 'LEGION XIII — CAPTAIN' },
  ],
  mediaSlots: [],
  layers: [
    {
      kind: 'rect', ref: 'bar', x: 0.26, y: 0.82, w: 0.42, h: 0.075, fill: GRAD,
      animation: { offset: 0, in: { presetId: 'slide-right', duration: 0.45, stagger: 0 }, out: { presetId: 'slide-out-left', duration: 0.4, stagger: 0 } },
    },
    {
      kind: 'text', ref: 'name', text: '{{ props.name }}', x: 0.26, y: 0.815, fontSize: 0.034, fontWeight: 900, fontFamily: FONT, color: BG, align: 'left',
      animation: { offset: 0.2, in: { presetId: 'mask-up', duration: 0.4, stagger: 0.02 }, out: { presetId: 'fade-out', duration: 0.3, stagger: 0.01 } },
    },
    {
      kind: 'text', ref: 'role', text: '{{ props.role }}', x: 0.26, y: 0.875, fontSize: 0.02, fontWeight: 600, fontFamily: FONT_BODY, color: FG, align: 'left',
      animation: { offset: 0.4, in: { presetId: 'slide-up', duration: 0.4, stagger: 0.015 }, out: { presetId: 'fade-out', duration: 0.3, stagger: 0 } },
    },
  ],
  thumb: [ACC, ACC2, FG],
}

// ── 5. keyline-trace — outline draws on, then the fill snaps in ──────────────
const keylineTrace: SlateTemplate = {
  id: 'keyline-trace',
  label: 'Keyline Trace',
  pitch: 'Outline letters draw on, then fill snaps in.',
  motion: { fps: 30, duration: 4 },
  textSlots: [{ key: 'word', label: 'Word', default: 'LEGION' }],
  mediaSlots: [],
  layers: [
    {
      kind: 'text', ref: 'outline', text: '{{ props.word }}', x: 0.5, y: 0.5, fontSize: 0.18, fontWeight: 900, fontFamily: FONT, color: 'transparent', strokeColor: ACC, strokeWidth: 0.003,
      animation: { offset: 0, in: { presetId: 'mask-up', duration: 1.0, stagger: 0.05 }, loop: { presetId: 'float', duration: 3, stagger: 0.02 } },
    },
    {
      kind: 'text', ref: 'fill', text: '{{ props.word }}', x: 0.5, y: 0.5, fontSize: 0.18, fontWeight: 900, fontFamily: FONT, color: FG,
      animation: { offset: 1.1, in: { presetId: 'appear', duration: 0.3, stagger: 0.02 }, out: { presetId: 'fade-out', duration: 0.4, stagger: 0.02 } },
    },
  ],
  thumb: [BG, ACC, FG],
}

// ── 6. metadata-grid — ambient microtype grid for overlays ───────────────────
const GRID_TEXTS = ['{{ props.line1 }}', '{{ props.line2 }}', '{{ props.line3 }}', '{{ props.line1 }}', '{{ props.line2 }}', '{{ props.line3 }}']
const GRID_POS = [
  { x: 0.15, y: 0.15 }, { x: 0.85, y: 0.15 },
  { x: 0.15, y: 0.5 }, { x: 0.85, y: 0.5 },
  { x: 0.15, y: 0.85 }, { x: 0.85, y: 0.85 },
]
const metadataGrid: SlateTemplate = {
  id: 'metadata-grid',
  label: 'Metadata Grid',
  pitch: 'Ambient microtype grid for overlays.',
  motion: { fps: 30, duration: 6 },
  textSlots: [
    { key: 'line1', label: 'Line 1', default: 'ADELAIDE — FEB 14-16' },
    { key: 'line2', label: 'Line 2', default: 'THE GRANGE GOLF CLUB' },
    { key: 'line3', label: 'Line 3', default: '13 TEAMS — 2025' },
  ],
  mediaSlots: [],
  layers: [
    ...GRID_POS.map((p, i) => ({
      kind: 'text' as const, ref: `micro${i + 1}`, text: GRID_TEXTS[i]!, x: p.x, y: p.y, fontSize: 0.016, fontWeight: 600, fontFamily: FONT_BODY, color: ACC, align: 'left' as const,
      animation: { offset: i * 0.15, in: { presetId: 'typewriter', duration: 0.5, stagger: 0.02 }, loop: { presetId: 'glitch-loop', duration: 1.5, stagger: 0.01 } },
    })),
    {
      kind: 'text', ref: 'center', text: '{{ props.line1 }}', x: 0.5, y: 0.5, fontSize: 0.04, fontWeight: 800, fontFamily: FONT, color: FG,
      animation: { offset: 0.3, in: { presetId: 'mask-up', duration: 0.6, stagger: 0.03 }, loop: { presetId: 'float', duration: 4, stagger: 0.03 } },
    },
  ],
  thumb: [BG, ACC, ACC2],
}

export const SLATE_TEMPLATES: SlateTemplate[] = [eventSlate, photoMaskPunch, marqueeBand, lowerThird, keylineTrace, metadataGrid]
export const SLATE_TEMPLATES_BY_ID: Record<string, SlateTemplate> = Object.fromEntries(SLATE_TEMPLATES.map(t => [t.id, t]))
