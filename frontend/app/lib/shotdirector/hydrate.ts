// frontend/app/lib/shotdirector/hydrate.ts
// Defensive hydration of a persisted ShotSheet (node.data.properties.sailor_shotDirector)
// and pure reference-list helpers. Mirrors the shaderstudio hydrateConfig pattern.

import {
  createDefaultShotSheet, CAMERA_MOVE_PHRASE, MOVE_DIRECTIONS,
  type CameraDirection, type CameraMove, type CastMember, type Ref, type RefKind, type ShotSheet,
} from './types'

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}
function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}
function str(v: unknown, d: string): string {
  return typeof v === 'string' ? v : d
}

/** Validate the camera block: unknown move → default; direction kept only if the
 *  move allows it (so a stale direction from a move change is dropped). */
function hydrateCamera(cam: Record<string, unknown>, d: ShotSheet): ShotSheet['camera'] {
  const move: CameraMove = (typeof cam.move === 'string' && cam.move in CAMERA_MOVE_PHRASE)
    ? cam.move as CameraMove : d.camera.move
  const allowed = MOVE_DIRECTIONS[move] as string[]
  const direction = (typeof cam.direction === 'string' && allowed.includes(cam.direction))
    ? cam.direction as CameraDirection : undefined
  return {
    shotType: str(cam.shotType, d.camera.shotType) as ShotSheet['camera']['shotType'],
    move,
    pacing: str(cam.pacing, d.camera.pacing) as ShotSheet['camera']['pacing'],
    ...(direction ? { direction } : {}),
  }
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
    camera: hydrateCamera(cam, d),
    constraints: arr<string>(r.constraints),
    cast: arr<CastMember>(r.cast)
      .filter(c =>
        c && typeof c.slug === 'string' && typeof c.name === 'string'
        && (c.via === 'wire' || c.via === 'picker'))
      .map(c => ({ slug: c.slug, name: c.name, via: c.via, ...(typeof c.variantId === 'string' && c.variantId !== 'default' ? { variantId: c.variantId } : {}) })),
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
