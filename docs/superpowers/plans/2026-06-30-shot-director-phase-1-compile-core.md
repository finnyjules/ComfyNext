# Shot Director — Phase 1: Compile Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure-TypeScript core of the Shot Director — the `ShotSheet` data model, validation rules, per-model capability profiles, and the compiler that turns a `ShotSheet` into a terse, best-practice Seedance prompt string + Replicate input object.

**Architecture:** Four focused modules under `frontend/app/lib/shotdirector/`, with no Vue/DOM/network dependencies so they are fully unit-testable in isolation. `types.ts` defines the data model and the fixed cinematic vocabulary. `rules.ts` validates a sheet's invariants. `profiles.ts` declares what each video model can honor and how to assemble its input object. `compile.ts` assembles the canonical-order prose (weaving in `[Image1]`-style reference tags), then delegates model-input assembly to the active profile and reports the word-count budget. This phase ships a tested library; the studio UI (Phase 2) and backend dispatch/AI endpoints (Phase 3) build on top of it.

**Tech Stack:** TypeScript, Vitest (unit tests, `frontend/tests/unit/*.unit.spec.ts`, relative imports).

## Global Constraints

These are hard rules from the design spec (`docs/superpowers/specs/2026-06-30-shot-director-design.md`). Every task's requirements implicitly include this section:

- **Reference grammar is bracketed: `[Image1]` / `[Video1]` / `[Audio1]`** — never `@Image 1`. 1-based slot numbers.
- **Exactly one primary camera move** per shot/beat — `camera.move` is a single value from the 8 canonical moves, never a list.
- **No photography jargon** — no `fps`, `lens`, f-stop, or ISO fields anywhere. Camera pacing uses the words `slow | smooth | gradual | gentle`.
- **Word budget:** warn at **> 100 words**, hard error at **> 600 words** (Seedance's recommended ≤ 600).
- **Mode is exclusive:** `mode: 'reference'` cannot carry `firstFrame`/`lastFrame`; `mode: 'firstLastFrame'` cannot carry `references`. (Mirrors the Replicate schema: `reference_images` is mutually exclusive with `image`/`last_frame_image`.)
- **Audio references require ≥ 1 image or video reference.**
- **Beats are bounded:** at most **3** beats; each beat must fit within `format.durationS`; beats are disallowed when `format.durationS === -1` (intelligent duration — no timeline to lay against).
- **Seedance real option sets:** durations `[3, 5, 10, 15]` (or `-1` = intelligent); resolutions `['720p', '1080p']`; aspect ratios `['16:9','9:16','1:1','4:3','3:4','21:9','adaptive']`.

---

## File Structure

- `frontend/app/lib/shotdirector/types.ts` — data model (`ShotSheet`, `Ref`, `Beat`, enums), the fixed vocabulary maps (shot types, camera moves, reference roles), and `createDefaultShotSheet()`.
- `frontend/app/lib/shotdirector/rules.ts` — `validateShotSheet(sheet, profile)` returning a list of `ValidationIssue`.
- `frontend/app/lib/shotdirector/profiles.ts` — `ModelProfile` interface, `SEEDANCE_PROFILE`, a seam-proving stub profile, and a lookup registry.
- `frontend/app/lib/shotdirector/compile.ts` — `compileShot(sheet, profile)` returning `{ prompt, input, wordCount, issues }`, plus the internal prose builder.
- `frontend/tests/unit/shotdirector-types.unit.spec.ts`
- `frontend/tests/unit/shotdirector-rules.unit.spec.ts`
- `frontend/tests/unit/shotdirector-profiles.unit.spec.ts`
- `frontend/tests/unit/shotdirector-compile.unit.spec.ts`

All test commands run from `frontend/`: `npm run test:unit -- <path>` (which runs `vitest run <path>`).

---

### Task 1: Data model & vocabulary (`types.ts`)

**Files:**
- Create: `frontend/app/lib/shotdirector/types.ts`
- Test: `frontend/tests/unit/shotdirector-types.unit.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (later tasks rely on these exact names/types):
  - Types: `ShotMode`, `ShotType`, `CameraMove`, `Pacing`, `RefKind`, `RefRole`, `Ref`, `Beat`, `DialogueLine`, `ShotAudio`, `ShotFormat`, `ShotCamera`, `ShotSheet`.
  - Const maps: `SHOT_TYPE_PHRASE: Record<ShotType,string>`, `CAMERA_MOVE_PHRASE: Record<CameraMove,string>`, `ROLE_PURPOSE: Record<RefRole,string>`, `ROLES_BY_KIND: Record<RefKind, RefRole[]>`.
  - Factory: `createDefaultShotSheet(): ShotSheet`.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/shotdirector-types.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  createDefaultShotSheet,
  SHOT_TYPE_PHRASE, CAMERA_MOVE_PHRASE, ROLE_PURPOSE, ROLES_BY_KIND,
  type ShotType, type CameraMove, type RefRole,
} from '../../app/lib/shotdirector/types'

const SHOT_TYPES: ShotType[] = ['wide', 'medium', 'close-up', 'extreme-close-up', 'establishing']
const CAMERA_MOVES: CameraMove[] = ['push-in', 'pull-out', 'pan', 'track', 'orbit', 'aerial', 'handheld', 'locked-off']
const ROLES: RefRole[] = [
  'identity-lock', 'lighting-copy', 'composition-lock', 'style-transfer',
  'camera-copy', 'motion-transfer', 'sequence-extend', 'beat-sync', 'lip-sync', 'mood',
]

describe('shotdirector vocabulary', () => {
  it('every shot type and camera move has a phrase', () => {
    for (const s of SHOT_TYPES) expect(SHOT_TYPE_PHRASE[s], s).toBeTruthy()
    for (const m of CAMERA_MOVES) expect(CAMERA_MOVE_PHRASE[m], m).toBeTruthy()
  })

  it('every reference role has a purpose phrase', () => {
    for (const r of ROLES) expect(ROLE_PURPOSE[r], r).toBeTruthy()
  })

  it('roles-by-kind only references known roles and covers each kind', () => {
    for (const kind of ['image', 'video', 'audio'] as const) {
      expect(ROLES_BY_KIND[kind].length, kind).toBeGreaterThan(0)
      for (const role of ROLES_BY_KIND[kind]) expect(ROLES).toContain(role)
    }
  })
})

describe('createDefaultShotSheet', () => {
  it('produces a reference-mode sheet with sane Seedance defaults and no beats', () => {
    const s = createDefaultShotSheet()
    expect(s.mode).toBe('reference')
    expect(s.references).toEqual([])
    expect(s.beats).toEqual([])
    expect(s.camera.move).toBe('locked-off')
    expect(s.format.durationS).toBe(5)
    expect(s.format.resolution).toBe('1080p')
    expect(s.format.aspectRatio).toBe('16:9')
    expect(s.audio.generate).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:unit -- tests/unit/shotdirector-types.unit.spec.ts`
Expected: FAIL — cannot resolve `../../app/lib/shotdirector/types`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/app/lib/shotdirector/types.ts`:

```ts
// frontend/app/lib/shotdirector/types.ts
// Data model for the Shot Director studio — a structured, editable "intent"
// for a single video shot that compiles to a terse best-practice prompt +
// reference wiring. Persisted at node.data.properties.comfynext_shotDirector.
// Pure data + vocabulary; no Vue/DOM/network here.

export type ShotMode = 'reference' | 'firstLastFrame'

export type ShotType =
  | 'wide' | 'medium' | 'close-up' | 'extreme-close-up' | 'establishing'

// The 8 canonical camera moves. Exactly one primary move per shot/beat.
export type CameraMove =
  | 'push-in' | 'pull-out' | 'pan' | 'track'
  | 'orbit' | 'aerial' | 'handheld' | 'locked-off'

export type Pacing = 'slow' | 'smooth' | 'gradual' | 'gentle'

export type RefKind = 'image' | 'video' | 'audio'

export type RefRole =
  // image roles
  | 'identity-lock' | 'lighting-copy' | 'composition-lock' | 'style-transfer'
  // video roles
  | 'camera-copy' | 'motion-transfer' | 'sequence-extend'
  // audio roles
  | 'beat-sync' | 'lip-sync' | 'mood'

export interface Ref {
  kind: RefKind
  /** 1-based slot per kind — renders as [Image{slot}] / [Video{slot}] / [Audio{slot}]. */
  slot: number
  /** data: URL or hosted URL passed to Replicate. */
  src: string
  role: RefRole
  /** freeform refinement folded into the purpose phrase. */
  note?: string
}

export interface Beat {
  id: string
  startS: number
  endS: number
  action: string
  shotType?: ShotType
  move?: CameraMove
  pacing?: Pacing
  /** slots (per-kind) whose references apply to this beat. */
  activeRefSlots?: number[]
  /** cached preview still (flux-schnell), filled by the UI in a later phase. */
  keyframeUrl?: string
}

export interface DialogueLine {
  speaker?: string
  line: string
}

export interface ShotCamera {
  shotType: ShotType
  move: CameraMove
  pacing: Pacing
}

export interface ShotAudio {
  generate: boolean
  dialogue?: DialogueLine[]
  sfxNote?: string
}

export interface ShotFormat {
  aspectRatio: string   // includes 'adaptive'
  durationS: number     // Seedance set; -1 allowed (intelligent)
  resolution: string
  seed?: number
}

export interface ShotSheet {
  intent: string
  mode: ShotMode

  subject: string
  action: string
  environment: string
  lighting: string
  style: string
  camera: ShotCamera
  constraints: string[]

  references: Ref[]
  firstFrame?: string
  lastFrame?: string

  beats: Beat[]
  audio: ShotAudio
  format: ShotFormat
}

// ---- Fixed vocabulary (drives deterministic prose in compile.ts) -----------

export const SHOT_TYPE_PHRASE: Record<ShotType, string> = {
  'wide': 'Wide shot',
  'medium': 'Medium shot',
  'close-up': 'Close-up',
  'extreme-close-up': 'Extreme close-up',
  'establishing': 'Establishing shot',
}

export const CAMERA_MOVE_PHRASE: Record<CameraMove, string> = {
  'push-in': 'push-in',
  'pull-out': 'pull-out',
  'pan': 'pan',
  'track': 'tracking shot',
  'orbit': 'orbit',
  'aerial': 'aerial shot',
  'handheld': 'handheld movement',
  'locked-off': 'locked-off, static camera',
}

export const ROLE_PURPOSE: Record<RefRole, string> = {
  'identity-lock': "the character's identity and wardrobe",
  'lighting-copy': 'the lighting style',
  'composition-lock': 'the scene composition',
  'style-transfer': 'the visual style',
  'camera-copy': 'the camera movement',
  'motion-transfer': 'the subject motion',
  'sequence-extend': 'continuation from where it ended',
  'beat-sync': 'beat synchronization',
  'lip-sync': 'lip-sync timing',
  'mood': 'the mood and pacing',
}

export const ROLES_BY_KIND: Record<RefKind, RefRole[]> = {
  image: ['identity-lock', 'lighting-copy', 'composition-lock', 'style-transfer'],
  video: ['camera-copy', 'motion-transfer', 'sequence-extend'],
  audio: ['beat-sync', 'lip-sync', 'mood'],
}

export function createDefaultShotSheet(): ShotSheet {
  return {
    intent: '',
    mode: 'reference',
    subject: '',
    action: '',
    environment: '',
    lighting: '',
    style: '',
    camera: { shotType: 'medium', move: 'locked-off', pacing: 'smooth' },
    constraints: [],
    references: [],
    beats: [],
    audio: { generate: true },
    format: { aspectRatio: '16:9', durationS: 5, resolution: '1080p' },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:unit -- tests/unit/shotdirector-types.unit.spec.ts`
Expected: PASS (3 + 1 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/shotdirector/types.ts frontend/tests/unit/shotdirector-types.unit.spec.ts
git commit -m "feat(shot-director): ShotSheet data model + cinematic vocabulary"
```

---

### Task 2: Validation rules (`rules.ts`)

**Files:**
- Create: `frontend/app/lib/shotdirector/rules.ts`
- Test: `frontend/tests/unit/shotdirector-rules.unit.spec.ts`

**Interfaces:**
- Consumes: `ShotSheet`, `RefKind` from `./types`; `ModelProfile` type is only referenced structurally, so to avoid a circular import `rules.ts` accepts a minimal `RefCaps` shape rather than importing `profiles.ts`.
- Produces:
  - `type IssueLevel = 'error' | 'warning'`
  - `interface ValidationIssue { level: IssueLevel; code: string; message: string }`
  - `interface RefCaps { maxRefImages: number; maxRefVideos: number; maxRefAudios: number; supportsFirstLastFrame: boolean }`
  - `function validateShotSheet(sheet: ShotSheet, caps: RefCaps): ValidationIssue[]`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/shotdirector-rules.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createDefaultShotSheet, type ShotSheet, type Ref } from '../../app/lib/shotdirector/types'
import { validateShotSheet, type RefCaps } from '../../app/lib/shotdirector/rules'

const CAPS: RefCaps = { maxRefImages: 9, maxRefVideos: 3, maxRefAudios: 3, supportsFirstLastFrame: true }

const img = (slot: number): Ref => ({ kind: 'image', slot, src: 'x', role: 'identity-lock' })
const aud = (slot: number): Ref => ({ kind: 'audio', slot, src: 'x', role: 'mood' })

function codes(sheet: ShotSheet) {
  return validateShotSheet(sheet, CAPS).map(i => i.code)
}

describe('validateShotSheet', () => {
  it('a fresh default sheet has no issues', () => {
    expect(validateShotSheet(createDefaultShotSheet(), CAPS)).toEqual([])
  })

  it('flags reference mode carrying a first frame', () => {
    const s = createDefaultShotSheet()
    s.firstFrame = 'data:...'
    expect(codes(s)).toContain('mode-conflict')
  })

  it('flags firstLastFrame mode carrying references', () => {
    const s = createDefaultShotSheet()
    s.mode = 'firstLastFrame'
    s.references = [img(1)]
    expect(codes(s)).toContain('mode-conflict')
  })

  it('flags audio references with no visual reference', () => {
    const s = createDefaultShotSheet()
    s.references = [aud(1)]
    expect(codes(s)).toContain('audio-needs-visual')
  })

  it('allows audio references when an image reference is present', () => {
    const s = createDefaultShotSheet()
    s.references = [img(1), aud(1)]
    expect(codes(s)).not.toContain('audio-needs-visual')
  })

  it('flags more than three beats', () => {
    const s = createDefaultShotSheet()
    s.beats = [0, 1, 2, 3].map(i => ({ id: `b${i}`, startS: i, endS: i + 1, action: 'x' }))
    expect(codes(s)).toContain('too-many-beats')
  })

  it('flags beats when duration is intelligent (-1)', () => {
    const s = createDefaultShotSheet()
    s.format.durationS = -1
    s.beats = [{ id: 'b0', startS: 0, endS: 2, action: 'x' }]
    expect(codes(s)).toContain('beats-need-duration')
  })

  it('flags a beat that overflows the clip duration', () => {
    const s = createDefaultShotSheet()
    s.format.durationS = 5
    s.beats = [{ id: 'b0', startS: 0, endS: 8, action: 'x' }]
    expect(codes(s)).toContain('beat-overflow')
  })

  it('flags too many image references for the profile', () => {
    const s = createDefaultShotSheet()
    s.references = Array.from({ length: 10 }, (_, i) => img(i + 1))
    expect(codes(s)).toContain('too-many-image-refs')
  })

  it('flags video references when the profile supports none', () => {
    const s = createDefaultShotSheet()
    s.references = [img(1), { kind: 'video', slot: 1, src: 'x', role: 'camera-copy' }]
    const caps: RefCaps = { ...CAPS, maxRefVideos: 0 }
    expect(validateShotSheet(s, caps).map(i => i.code)).toContain('videos-unsupported')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:unit -- tests/unit/shotdirector-rules.unit.spec.ts`
Expected: FAIL — cannot resolve `../../app/lib/shotdirector/rules`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/app/lib/shotdirector/rules.ts`:

```ts
// frontend/app/lib/shotdirector/rules.ts
// Pure invariant checks for a ShotSheet. Returns a flat list of issues;
// never throws. The UI blocks Render when any 'error' issue is present.

import type { RefKind, ShotSheet } from './types'

export type IssueLevel = 'error' | 'warning'

export interface ValidationIssue {
  level: IssueLevel
  code: string
  message: string
}

// Minimal capability shape rules need — a structural subset of ModelProfile,
// declared here to keep rules.ts free of a profiles.ts import cycle.
export interface RefCaps {
  maxRefImages: number
  maxRefVideos: number
  maxRefAudios: number
  supportsFirstLastFrame: boolean
}

function countKind(sheet: ShotSheet, kind: RefKind): number {
  return sheet.references.filter(r => r.kind === kind).length
}

export function validateShotSheet(sheet: ShotSheet, caps: RefCaps): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const err = (code: string, message: string) => issues.push({ level: 'error', code, message })

  const images = countKind(sheet, 'image')
  const videos = countKind(sheet, 'video')
  const audios = countKind(sheet, 'audio')

  // Mode exclusivity (mirrors the Replicate schema).
  if (sheet.mode === 'reference' && (sheet.firstFrame || sheet.lastFrame)) {
    err('mode-conflict', 'Reference mode cannot use a first/last frame — switch modes or clear the frames.')
  }
  if (sheet.mode === 'firstLastFrame' && sheet.references.length > 0) {
    err('mode-conflict', 'First/last-frame mode cannot use reference images — switch modes or clear the references.')
  }
  if (sheet.mode === 'firstLastFrame' && !caps.supportsFirstLastFrame) {
    err('firstlast-unsupported', 'This model does not support first/last-frame input.')
  }

  // Audio references need at least one visual reference.
  if (audios > 0 && images === 0 && videos === 0) {
    err('audio-needs-visual', 'Audio references require at least one image or video reference.')
  }

  // Reference capacity vs the model profile.
  if (images > caps.maxRefImages) err('too-many-image-refs', `At most ${caps.maxRefImages} image references.`)
  if (videos > caps.maxRefVideos) {
    err(caps.maxRefVideos === 0 ? 'videos-unsupported' : 'too-many-video-refs',
      caps.maxRefVideos === 0 ? 'This model does not support reference videos.' : `At most ${caps.maxRefVideos} video references.`)
  }
  if (audios > caps.maxRefAudios) {
    err(caps.maxRefAudios === 0 ? 'audios-unsupported' : 'too-many-audio-refs',
      caps.maxRefAudios === 0 ? 'This model does not support reference audios.' : `At most ${caps.maxRefAudios} audio references.`)
  }

  // Beats.
  if (sheet.beats.length > 3) err('too-many-beats', 'A shot can have at most 3 beats.')
  if (sheet.beats.length > 0 && sheet.format.durationS === -1) {
    err('beats-need-duration', 'Set a concrete duration to use beats (intelligent duration has no timeline).')
  }
  for (const b of sheet.beats) {
    if (b.endS <= b.startS) err('beat-order', `Beat "${b.id}" ends before it starts.`)
    if (sheet.format.durationS > 0 && b.endS > sheet.format.durationS) {
      err('beat-overflow', `Beat "${b.id}" runs past the ${sheet.format.durationS}s clip.`)
    }
  }

  return issues
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:unit -- tests/unit/shotdirector-rules.unit.spec.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/shotdirector/rules.ts frontend/tests/unit/shotdirector-rules.unit.spec.ts
git commit -m "feat(shot-director): ShotSheet invariant validation"
```

---

### Task 3: Capability profiles (`profiles.ts`)

**Files:**
- Create: `frontend/app/lib/shotdirector/profiles.ts`
- Test: `frontend/tests/unit/shotdirector-profiles.unit.spec.ts`

**Interfaces:**
- Consumes: `ShotSheet`, `RefKind` from `./types`; `RefCaps` shape from `./rules` (structurally).
- Produces:
  - `type ModelInput = Record<string, unknown>`
  - `interface ModelProfile { id: string; label: string; maxRefImages: number; maxRefVideos: number; maxRefAudios: number; supportsFirstLastFrame: boolean; supportsGenerateAudio: boolean; wordBudgetWarn: number; wordBudgetHard: number; refTag(kind: RefKind, slot: number): string; buildInput(sheet: ShotSheet, prompt: string): ModelInput }`
  - `const SEEDANCE_PROFILE: ModelProfile`
  - `const SEEDANCE_STUB_OTHER: ModelProfile` (seam-proving stub)
  - `const SHOT_PROFILES_BY_ID: Record<string, ModelProfile>`
  - `function getProfile(id: string): ModelProfile` (falls back to `SEEDANCE_PROFILE`)

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/shotdirector-profiles.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createDefaultShotSheet, type Ref } from '../../app/lib/shotdirector/types'
import { SEEDANCE_PROFILE, getProfile } from '../../app/lib/shotdirector/profiles'

const img = (slot: number): Ref => ({ kind: 'image', slot, src: `img${slot}`, role: 'identity-lock' })
const vid = (slot: number): Ref => ({ kind: 'video', slot, src: `vid${slot}`, role: 'camera-copy' })
const aud = (slot: number): Ref => ({ kind: 'audio', slot, src: `aud${slot}`, role: 'mood' })

describe('SEEDANCE_PROFILE', () => {
  it('declares the real Replicate capacities and word budget', () => {
    expect(SEEDANCE_PROFILE.maxRefImages).toBe(9)
    expect(SEEDANCE_PROFILE.maxRefVideos).toBe(3)
    expect(SEEDANCE_PROFILE.maxRefAudios).toBe(3)
    expect(SEEDANCE_PROFILE.wordBudgetWarn).toBe(100)
    expect(SEEDANCE_PROFILE.wordBudgetHard).toBe(600)
  })

  it('tags references with bracket grammar', () => {
    expect(SEEDANCE_PROFILE.refTag('image', 1)).toBe('[Image1]')
    expect(SEEDANCE_PROFILE.refTag('video', 2)).toBe('[Video2]')
    expect(SEEDANCE_PROFILE.refTag('audio', 3)).toBe('[Audio3]')
  })

  it('buildInput maps reference-mode arrays sorted by slot and sets format', () => {
    const s = createDefaultShotSheet()
    s.format = { aspectRatio: '9:16', durationS: 10, resolution: '720p', seed: 42 }
    s.references = [img(2), img(1), vid(1), aud(1)]
    const input = SEEDANCE_PROFILE.buildInput(s, 'PROMPT')
    expect(input).toEqual({
      prompt: 'PROMPT',
      duration: 10,
      resolution: '720p',
      aspect_ratio: '9:16',
      reference_images: ['img1', 'img2'],
      reference_videos: ['vid1'],
      reference_audios: ['aud1'],
      generate_audio: true,
      seed: 42,
    })
  })

  it('buildInput maps first/last-frame mode and omits aspect_ratio + refs', () => {
    const s = createDefaultShotSheet()
    s.mode = 'firstLastFrame'
    s.firstFrame = 'FIRST'
    s.lastFrame = 'LAST'
    s.audio.generate = false
    const input = SEEDANCE_PROFILE.buildInput(s, 'PROMPT')
    expect(input).toEqual({
      prompt: 'PROMPT',
      duration: 5,
      resolution: '1080p',
      image: 'FIRST',
      last_frame_image: 'LAST',
      generate_audio: false,
    })
  })

  it('getProfile falls back to Seedance for unknown ids', () => {
    expect(getProfile('does-not-exist').id).toBe('seedance-2.0')
    expect(getProfile('seedance-2.0')).toBe(SEEDANCE_PROFILE)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:unit -- tests/unit/shotdirector-profiles.unit.spec.ts`
Expected: FAIL — cannot resolve `../../app/lib/shotdirector/profiles`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/app/lib/shotdirector/profiles.ts`:

```ts
// frontend/app/lib/shotdirector/profiles.ts
// Per-model capability declarations. A profile says what a video model can
// honor and how to assemble its Replicate input object from a ShotSheet +
// the compiled prompt string. Phase 1 fully implements Seedance and ships a
// seam-proving stub; other real models land in a later phase.

import type { RefKind, ShotSheet } from './types'

export type ModelInput = Record<string, unknown>

export interface ModelProfile {
  id: string
  label: string
  maxRefImages: number
  maxRefVideos: number
  maxRefAudios: number
  supportsFirstLastFrame: boolean
  supportsGenerateAudio: boolean
  wordBudgetWarn: number
  wordBudgetHard: number
  /** in-prompt reference tag, e.g. [Image1]. */
  refTag(kind: RefKind, slot: number): string
  /** assemble the model's Replicate input from the sheet + compiled prompt. */
  buildInput(sheet: ShotSheet, prompt: string): ModelInput
}

function bracketTag(kind: RefKind, slot: number): string {
  const label = kind === 'image' ? 'Image' : kind === 'video' ? 'Video' : 'Audio'
  return `[${label}${slot}]`
}

function srcsByKind(sheet: ShotSheet, kind: RefKind): string[] {
  return sheet.references
    .filter(r => r.kind === kind)
    .sort((a, b) => a.slot - b.slot)
    .map(r => r.src)
}

export const SEEDANCE_PROFILE: ModelProfile = {
  id: 'seedance-2.0',
  label: 'Seedance 2.0',
  maxRefImages: 9,
  maxRefVideos: 3,
  maxRefAudios: 3,
  supportsFirstLastFrame: true,
  supportsGenerateAudio: true,
  wordBudgetWarn: 100,
  wordBudgetHard: 600,
  refTag: bracketTag,
  buildInput(sheet, prompt) {
    const input: ModelInput = {
      prompt,
      duration: sheet.format.durationS,
      resolution: sheet.format.resolution,
    }
    if (sheet.mode === 'reference') {
      input.aspect_ratio = sheet.format.aspectRatio
      const images = srcsByKind(sheet, 'image')
      const videos = srcsByKind(sheet, 'video')
      const audios = srcsByKind(sheet, 'audio')
      if (images.length) input.reference_images = images
      if (videos.length) input.reference_videos = videos
      if (audios.length) input.reference_audios = audios
    } else {
      if (sheet.firstFrame) input.image = sheet.firstFrame
      if (sheet.lastFrame) input.last_frame_image = sheet.lastFrame
    }
    input.generate_audio = sheet.audio.generate
    if (sheet.format.seed && sheet.format.seed > 0) input.seed = sheet.format.seed
    return input
  },
}

// Seam-proving stub: a hypothetical model with a smaller reference surface and
// no video/audio refs. Real per-model profiles (Veo/Kling/Wan) land in a later
// phase; this exists so the compiler + rules are exercised across differing
// capabilities in Phase 1.
export const SEEDANCE_STUB_OTHER: ModelProfile = {
  id: 'stub-basic',
  label: 'Basic (stub)',
  maxRefImages: 3,
  maxRefVideos: 0,
  maxRefAudios: 0,
  supportsFirstLastFrame: false,
  supportsGenerateAudio: false,
  wordBudgetWarn: 100,
  wordBudgetHard: 600,
  refTag: bracketTag,
  buildInput(sheet, prompt) {
    return {
      prompt,
      aspect_ratio: sheet.format.aspectRatio,
      duration: sheet.format.durationS,
    }
  },
}

export const SHOT_PROFILES_BY_ID: Record<string, ModelProfile> = {
  [SEEDANCE_PROFILE.id]: SEEDANCE_PROFILE,
  [SEEDANCE_STUB_OTHER.id]: SEEDANCE_STUB_OTHER,
}

export function getProfile(id: string): ModelProfile {
  return SHOT_PROFILES_BY_ID[id] ?? SEEDANCE_PROFILE
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:unit -- tests/unit/shotdirector-profiles.unit.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/shotdirector/profiles.ts frontend/tests/unit/shotdirector-profiles.unit.spec.ts
git commit -m "feat(shot-director): per-model capability profiles (Seedance + stub)"
```

---

### Task 4: The compiler (`compile.ts`)

**Files:**
- Create: `frontend/app/lib/shotdirector/compile.ts`
- Test: `frontend/tests/unit/shotdirector-compile.unit.spec.ts`

**Interfaces:**
- Consumes: `ShotSheet`, `SHOT_TYPE_PHRASE`, `CAMERA_MOVE_PHRASE`, `ROLE_PURPOSE` from `./types`; `validateShotSheet`, `ValidationIssue` from `./rules`; `ModelProfile`, `ModelInput` from `./profiles`.
- Produces:
  - `interface CompileResult { prompt: string; input: ModelInput; wordCount: number; issues: ValidationIssue[] }`
  - `function buildPrompt(sheet: ShotSheet, profile: ModelProfile): string`
  - `function countWords(text: string): number`
  - `function compileShot(sheet: ShotSheet, profile: ModelProfile): CompileResult`

The prose is assembled in the canonical best-practice order (Subject → Action → Environment → Camera → Style → References → Dialogue → Constraints). When beats exist, the Camera+Action portion is replaced by timed `[Ns] …` segments. Reference tags are only emitted in `reference` mode.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/shotdirector-compile.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createDefaultShotSheet, type Ref } from '../../app/lib/shotdirector/types'
import { SEEDANCE_PROFILE } from '../../app/lib/shotdirector/profiles'
import { buildPrompt, countWords, compileShot } from '../../app/lib/shotdirector/compile'

function baseSheet() {
  const s = createDefaultShotSheet()
  s.subject = 'A jazz singer in a red dress'
  s.action = 'steps up to the microphone and begins to sing'
  s.environment = 'a dim, smoky 1950s jazz club'
  s.lighting = 'warm rim light from a single spotlight'
  s.style = 'grainy 16mm film'
  s.camera = { shotType: 'medium', move: 'push-in', pacing: 'slow' }
  s.constraints = ['jitter', 'bent limbs']
  return s
}

describe('countWords', () => {
  it('counts whitespace-separated tokens', () => {
    expect(countWords('  one   two three ')).toBe(3)
    expect(countWords('')).toBe(0)
  })
})

describe('buildPrompt — reference mode, no beats', () => {
  it('assembles canonical-order prose with bracketed reference tags', () => {
    const s = baseSheet()
    const img: Ref = { kind: 'image', slot: 1, src: 'x', role: 'identity-lock' }
    const vid: Ref = { kind: 'video', slot: 1, src: 'x', role: 'camera-copy' }
    s.references = [img, vid]
    s.audio.dialogue = [{ line: 'Good evening, everyone.' }]

    expect(buildPrompt(s, SEEDANCE_PROFILE)).toBe(
      'A jazz singer in a red dress steps up to the microphone and begins to sing, '
      + 'in a dim, smoky 1950s jazz club. '
      + 'Warm rim light from a single spotlight; grainy 16mm film. '
      + 'Medium shot, slow push-in. '
      + "Use [Image1] for the character's identity and wardrobe; [Video1] for the camera movement. "
      + '"Good evening, everyone." '
      + 'Avoid jitter, bent limbs.',
    )
  })

  it('omits reference tags in first/last-frame mode', () => {
    const s = baseSheet()
    s.mode = 'firstLastFrame'
    s.firstFrame = 'FIRST'
    const prompt = buildPrompt(s, SEEDANCE_PROFILE)
    expect(prompt).not.toContain('[Image')
    expect(prompt).toContain('Medium shot, slow push-in.')
  })
})

describe('buildPrompt — beats', () => {
  it('renders timed segments in place of the camera line', () => {
    const s = baseSheet()
    s.format.durationS = 8
    s.beats = [
      { id: 'b0', startS: 0, endS: 4, action: 'she walks to the bar', shotType: 'wide', move: 'locked-off', pacing: 'smooth' },
      { id: 'b1', startS: 4, endS: 8, action: 'she picks up a glass', shotType: 'close-up', move: 'push-in', pacing: 'slow' },
    ]
    const prompt = buildPrompt(s, SEEDANCE_PROFILE)
    expect(prompt).toContain('[0s] Wide shot, smooth locked-off, static camera. She walks to the bar.')
    expect(prompt).toContain('[4s] Close-up, slow push-in. She picks up a glass.')
    // The single non-beat camera line must NOT also appear.
    expect(prompt).not.toContain('Medium shot, slow push-in.')
  })
})

describe('compileShot', () => {
  it('returns prompt + input + word count with no issues for a valid sheet', () => {
    const s = baseSheet()
    s.references = [{ kind: 'image', slot: 1, src: 'img1', role: 'identity-lock' }]
    const r = compileShot(s, SEEDANCE_PROFILE)
    expect(r.issues).toEqual([])
    expect(r.wordCount).toBeGreaterThan(0)
    expect(r.input.prompt).toBe(r.prompt)
    expect(r.input.reference_images).toEqual(['img1'])
  })

  it('adds a warning when the prompt exceeds the word budget', () => {
    const s = baseSheet()
    s.action = 'sings ' + 'la '.repeat(120)
    const r = compileShot(s, SEEDANCE_PROFILE)
    expect(r.wordCount).toBeGreaterThan(100)
    expect(r.issues.some(i => i.level === 'warning' && i.code === 'word-budget-warning')).toBe(true)
  })

  it('surfaces validation errors from the sheet', () => {
    const s = baseSheet()
    s.references = [{ kind: 'audio', slot: 1, src: 'a', role: 'mood' }]
    const r = compileShot(s, SEEDANCE_PROFILE)
    expect(r.issues.some(i => i.code === 'audio-needs-visual')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:unit -- tests/unit/shotdirector-compile.unit.spec.ts`
Expected: FAIL — cannot resolve `../../app/lib/shotdirector/compile`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/app/lib/shotdirector/compile.ts`:

```ts
// frontend/app/lib/shotdirector/compile.ts
// Turns a ShotSheet into a terse, best-practice prompt string (canonical
// Subject→Action→Environment→Camera→Style→References→Dialogue→Constraints
// order) plus the model's Replicate input object, and reports the word budget.
// Deterministic and pure — pinned by golden tests.

import {
  CAMERA_MOVE_PHRASE, ROLE_PURPOSE, SHOT_TYPE_PHRASE,
  type Beat, type ShotSheet,
} from './types'
import { validateShotSheet, type RefCaps, type ValidationIssue } from './rules'
import type { ModelInput, ModelProfile } from './profiles'

export interface CompileResult {
  prompt: string
  input: ModelInput
  wordCount: number
  issues: ValidationIssue[]
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function capitalize(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s
}

/** "Medium shot, slow push-in." for the shot's single camera line. */
function cameraLine(shotType: ShotSheet['camera']['shotType'], move: ShotSheet['camera']['move'], pacing: string): string {
  return `${SHOT_TYPE_PHRASE[shotType]}, ${pacing} ${CAMERA_MOVE_PHRASE[move]}.`
}

/** "[0s] Wide shot, smooth locked-off, static camera. She walks to the bar." */
function beatLine(sheet: ShotSheet, b: Beat): string {
  const shotType = b.shotType ?? sheet.camera.shotType
  const move = b.move ?? sheet.camera.move
  const pacing = b.pacing ?? sheet.camera.pacing
  const cam = `${SHOT_TYPE_PHRASE[shotType]}, ${pacing} ${CAMERA_MOVE_PHRASE[move]}.`
  const action = b.action.trim().replace(/\.$/, '')
  return `[${b.startS}s] ${cam} ${capitalize(action)}.`
}

/** "Use [Image1] for …; [Video1] for …." — reference mode only. */
function referenceSentence(sheet: ShotSheet, profile: ModelProfile): string {
  if (sheet.mode !== 'reference' || sheet.references.length === 0) return ''
  const parts = [...sheet.references]
    .sort((a, b) => (a.kind.localeCompare(b.kind) || a.slot - b.slot))
    .map(r => {
      const purpose = ROLE_PURPOSE[r.role]
      const note = r.note ? ` (${r.note.trim()})` : ''
      return `${profile.refTag(r.kind, r.slot)} for ${purpose}${note}`
    })
  return `Use ${parts.join('; ')}.`
}

function dialogueSentence(sheet: ShotSheet): string {
  const lines = sheet.audio.dialogue ?? []
  if (lines.length === 0) return ''
  return lines
    .map(d => (d.speaker ? `${d.speaker}: "${d.line.trim()}"` : `"${d.line.trim()}"`))
    .join(' ')
}

export function buildPrompt(sheet: ShotSheet, profile: ModelProfile): string {
  const segments: string[] = []

  // Subject + Action + Environment.
  const subject = sheet.subject.trim()
  const action = sheet.action.trim().replace(/\.$/, '')
  const env = sheet.environment.trim()
  let opener = subject
  if (action) opener = opener ? `${opener} ${action}` : capitalize(action)
  if (env) opener = opener ? `${opener}, in ${env}.` : `In ${env}.`
  else if (opener) opener = `${opener}.`
  if (opener) segments.push(opener)

  // Lighting + Style.
  const look = [sheet.lighting.trim(), sheet.style.trim()].filter(Boolean).map(capitalize)
  if (look.length) segments.push(`${look.join('; ')}.`)

  // Camera — timed beats replace the single camera line when present.
  if (sheet.beats.length > 0) {
    for (const b of sheet.beats) segments.push(beatLine(sheet, b))
  } else {
    segments.push(cameraLine(sheet.camera.shotType, sheet.camera.move, sheet.camera.pacing))
  }

  // References, Dialogue, Constraints.
  const refs = referenceSentence(sheet, profile)
  if (refs) segments.push(refs)
  const dlg = dialogueSentence(sheet)
  if (dlg) segments.push(dlg)
  if (sheet.constraints.length) segments.push(`Avoid ${sheet.constraints.join(', ')}.`)

  return segments.join(' ')
}

export function compileShot(sheet: ShotSheet, profile: ModelProfile): CompileResult {
  const caps: RefCaps = {
    maxRefImages: profile.maxRefImages,
    maxRefVideos: profile.maxRefVideos,
    maxRefAudios: profile.maxRefAudios,
    supportsFirstLastFrame: profile.supportsFirstLastFrame,
  }
  const issues = validateShotSheet(sheet, caps)
  const prompt = buildPrompt(sheet, profile)
  const wordCount = countWords(prompt)

  if (wordCount > profile.wordBudgetHard) {
    issues.push({ level: 'error', code: 'word-budget-exceeded', message: `Prompt is ${wordCount} words; the limit is ${profile.wordBudgetHard}.` })
  } else if (wordCount > profile.wordBudgetWarn) {
    issues.push({ level: 'warning', code: 'word-budget-warning', message: `Prompt is ${wordCount} words; best practice is under ${profile.wordBudgetWarn}.` })
  }

  const input = profile.buildInput(sheet, prompt)
  return { prompt, input, wordCount, issues }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:unit -- tests/unit/shotdirector-compile.unit.spec.ts`
Expected: PASS (all cases, including the two golden prompt strings).

- [ ] **Step 5: Run the whole shot-director suite + typecheck**

Run: `cd frontend && npm run test:unit -- tests/unit/shotdirector-*.unit.spec.ts`
Expected: PASS (all four spec files).

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json` (or the repo's typecheck script if one exists)
Expected: no new errors in `app/lib/shotdirector/**`.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/shotdirector/compile.ts frontend/tests/unit/shotdirector-compile.unit.spec.ts
git commit -m "feat(shot-director): ShotSheet -> Seedance prompt + input compiler"
```

---

## Self-Review

**1. Spec coverage (Phase 1 scope only):**
- `ShotSheet` data model (Context/Reference/Action/Framing/Timing + audio + format) → Task 1. ✓
- Invariants (mode XOR, audio-needs-visual, beat cap, beats-need-duration, beat overflow, ref capacity) → Task 2. ✓
- Capability profiles + Seedance implementation + seam-proving stub + `[ImageN]` grammar → Task 3. ✓
- Compiler: canonical-order terse prose, reference tags, beats-as-timed-segments, dialogue in quotes, constraints as "avoid …", word budget → Task 4. ✓
- Removal of `fps`/`camera_fixed` and multi-reference backend wiring → **Phase 2 (backend)**, not this plan. The compiler already omits fps/lens entirely (Global Constraints). ✓
- Studio surface, director bar, seed-from-intent, keyframe previews → **Phases 2–3.** ✓

**2. Placeholder scan:** No TBD/TODO; every code step contains complete, runnable code; both golden prompt strings are spelled out in full. ✓

**3. Type consistency:** `ShotSheet`, `Ref`, `Beat`, `RefCaps`, `ModelProfile`, `ModelInput`, `ValidationIssue`, `CompileResult`, `buildPrompt`, `countWords`, `compileShot`, `getProfile`, `SEEDANCE_PROFILE` are used with identical signatures across Tasks 1–4. `rules.ts` deliberately defines `RefCaps` (not an import of `ModelProfile`) to avoid a `rules ↔ profiles` cycle; `compile.ts` adapts a `ModelProfile` into a `RefCaps` before calling `validateShotSheet`. ✓

## Note on a spec refinement

The spec described the compiler "throwing typed errors (`WordBudgetError`, `ModeConflictError`)." This plan instead returns those as `issues` in `CompileResult` (non-throwing), which is friendlier for the live UI (show warnings/errors inline, disable Render on any error) and easier to unit-test. Behavior is equivalent; only the delivery mechanism changed.
