# Scene3D Environment Presets + Prism Material Preset

**Date:** 2026-08-12
**Status:** Approved (brainstormed with Julien)

## Plain-language summary

Glass in 3D Studio already knows how to split light into rainbows (the Dispersion
slider), but every scene lives inside the same bright grey virtual room, so there are
no crisp light streaks to split — glass renders washed-out instead of prismatic. This
feature gives the scene a choice of environments — the current room, a black studio
with long bright light bars, a soft product-photo studio, and a two-colour neon setup —
plus a one-click "Prism" button that sets glass up to catch the light the way the
reference images do (glass prisms with rainbow dispersion fringes on black).

## Goal

Reproduce the "refractive prism" aesthetic: transparent glass volumes on a black
background with chromatic dispersion rainbow streaks in both reflections and
refraction. The material capability exists (`glass` + `dispersion` on
`MeshPhysicalMaterial`); the blocker is the hardcoded `RoomEnvironment` env map,
which is uniformly bright and gives dispersion nothing high-contrast to fringe.

## Doc model (`frontend/app/lib/scene3d/config.ts`)

- New field `lighting.environment: EnvironmentKind`.
- `export type EnvironmentKind = 'room' | 'darkStrips' | 'softbox' | 'colorGels'`
- `export const ENVIRONMENT_KINDS: EnvironmentKind[]` (validation list, mirrors
  `LIGHTING_PRESETS`).
- Default `'room'` — fully backwards-compatible; missing/invalid values normalize to
  `'room'` in the same normalizer block that handles the other `lighting.*` fields.

## Engine (`frontend/app/lib/scene3d/engine.ts`)

- `setupEnvironment()` gains the environment kind. It builds the corresponding
  procedural scene and runs it through the existing `PMREMGenerator` path.
- Env target rebuilds **only when the kind changes** (track current kind on the
  engine); the old `envTarget` is disposed before replacing. No per-frame work.
- Context-loss recovery (`engine.ts` restore path, which already notes the PMREM env
  target does not survive) rebuilds whichever kind is current — not hardcoded Room.
- Headless bake / rebake paths construct engines through the same setup, so they get
  the right environment with no extra wiring; verify, don't assume.

### The four environments

Each is a tiny procedural `THREE.Scene` (~30 lines), PMREM'd once:

1. **Room** — existing `RoomEnvironment`, unchanged, stays the default.
2. **Dark studio** (`darkStrips`) — black void + 5–7 long thin very bright emissive
   bars (white with slight warm/cool variance, varied angles and distances, like
   studio strip softboxes). Produces crisp streak highlights; dispersion turns them
   into rainbow bands. The reference look.
3. **Softbox** (`softbox`) — mid-grey void + one or two huge soft-edged rectangular
   white panels. Classic product-render look: big gradient windows sliding across
   surfaces; flattering on metals and clearcoat.
4. **Color gel duo** (`colorGels`) — black void + two opposing coloured area sources
   (magenta from one side, cyan from the other). Two-tone neon album-art look.

Soft edges are achieved by a canvas-gradient emissive texture or geometry falloff —
whichever reads better; the PMREM blur pass already softens hard geometry
substantially, so start with plain emissive planes and only add falloff if needed.

## UI (`frontend/app/components/vue-canvas/Scene3DStudioSurface.vue`)

- **Lighting section:** an "Environment" segmented control — Room / Dark studio /
  Softbox / Color gels — alongside the existing lighting preset picker. Existing
  presets (studio/soft/dramatic/flat) continue to control env *intensity* and
  shadows; environment controls env *content*. They compose.
- **Material panel, glass section:** a **Prism** chip (StudioButton, action blue per
  colour conventions). One click applies:
  - material: `roughness 0`, `transmission 1`, `ior 1.55`, `thickness 1.5`,
    `dispersion 3.5`, `attenuationDistance 0` (off)
  - scene: `lighting.environment = 'darkStrips'`, `background = '#000000'`
  - It is an apply-values action, not a mode — no state tracked, sliders stay live
    for tweaking afterwards.

## Agent controls (`frontend/app/lib/scene3d/agentControls.ts`)

- Expose `lighting.environment` in the scene-wide controls doc so the agent can
  switch environments ("put this in the dark studio").

## Error handling

- Env target disposal on kind switch and on engine dispose (no leaked render
  targets).
- Context loss: restore path rebuilds the current kind.
- Unknown/legacy kind values in saved docs normalize to `'room'`.

## Testing

- **Unit:** config normalization round-trip for `lighting.environment` (valid kinds
  pass through, invalid/missing → `'room'`); Prism chip writes exactly the expected
  material + scene values.
- **Runtime proof** (graceful-fallback lesson — "it rendered" is not evidence):
  pixel-diff the same scene across environments — room vs darkStrips must differ;
  darkStrips with dispersion 0 vs 5 must differ. Screenshot evidence in the
  verification pass.

## Out of scope

- Image-based HDRI loading (new asset pipeline, large files).
- Animated environments (would re-PMREM per frame).
- Sunset/horizon and Ring-light environments — easy fast-follows if these four land.
- A material preset *gallery* — the Prism chip is a single apply-values button.
