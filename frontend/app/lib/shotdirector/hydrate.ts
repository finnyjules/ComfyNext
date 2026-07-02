// frontend/app/lib/shotdirector/hydrate.ts
// Defensive hydration of a persisted ShotSheet (node.data.properties.comfynext_shotDirector)
// and pure reference-list helpers. Mirrors the shaderstudio hydrateConfig pattern.

import { createDefaultShotSheet, type CastMember, type Ref, type RefKind, type ShotSheet } from './types'

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}
function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}
function str(v: unknown, d: string): string {
  return typeof v === 'string' ? v : d
}

export function hydrateShotSheet(raw: unknown): ShotSheet {
  const d = createDefaultShotSheet()
  const r = obj(raw)
  const cam = obj(r.camera), aud = obj(r.audio), fmt = obj(r.format)
  return {
    intent: str(r.intent, d.intent),
    mode: r.mode === 'firstLastFrame' ? 'firstLastFrame' : 'reference',
    subject: str(r.subject, d.subject),
    action: str(r.action, d.action),
    environment: str(r.environment, d.environment),
    lighting: str(r.lighting, d.lighting),
    style: str(r.style, d.style),
    camera: {
      shotType: str(cam.shotType, d.camera.shotType) as ShotSheet['camera']['shotType'],
      move: str(cam.move, d.camera.move) as ShotSheet['camera']['move'],
      pacing: str(cam.pacing, d.camera.pacing) as ShotSheet['camera']['pacing'],
    },
    constraints: arr<string>(r.constraints),
    cast: arr<CastMember>(r.cast).filter(c =>
      c && typeof c.slug === 'string' && typeof c.name === 'string'
      && (c.via === 'wire' || c.via === 'picker')),
    references: arr<Ref>(r.references),
    firstFrame: typeof r.firstFrame === 'string' ? r.firstFrame : undefined,
    lastFrame: typeof r.lastFrame === 'string' ? r.lastFrame : undefined,
    beats: arr(r.beats),
    audio: {
      generate: typeof aud.generate === 'boolean' ? aud.generate : d.audio.generate,
      dialogue: Array.isArray(aud.dialogue) ? aud.dialogue as ShotSheet['audio']['dialogue'] : undefined,
      sfxNote: typeof aud.sfxNote === 'string' ? aud.sfxNote : undefined,
    },
    format: {
      aspectRatio: str(fmt.aspectRatio, d.format.aspectRatio),
      durationS: typeof fmt.durationS === 'number' ? fmt.durationS : d.format.durationS,
      resolution: str(fmt.resolution, d.format.resolution),
      seed: typeof fmt.seed === 'number' ? fmt.seed : undefined,
    },
  }
}

export function nextSlot(refs: Ref[], kind: RefKind): number {
  const used = new Set(refs.filter(r => r.kind === kind).map(r => r.slot))
  let s = 1
  while (used.has(s)) s++
  return s
}

export function addRef(sheet: ShotSheet, kind: RefKind, src: string, role: Ref['role']): ShotSheet {
  const slot = nextSlot(sheet.references, kind)
  return { ...sheet, references: [...sheet.references, { kind, slot, src, role }] }
}

export function removeRef(sheet: ShotSheet, kind: RefKind, slot: number): ShotSheet {
  return { ...sheet, references: sheet.references.filter(r => !(r.kind === kind && r.slot === slot)) }
}
