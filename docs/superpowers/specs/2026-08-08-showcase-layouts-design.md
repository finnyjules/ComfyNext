# Showcase — pluggable layouts for Expressive Studio — design

*2026-08-08. Generalises the `ring` effect into a layout host. Follows the ring tune-up / fills / rename to Expressive Studio.*

## In plain language

The `ring` effect grew a whole content engine — tiles (words · image cards · fills), a content editor,
bend, corner radius, card ratio, type controls, camera, motion, loop. A "ring" is just *one way to
arrange* those tiles. This splits the arrangement out: the effect becomes **Showcase**, which owns all
the content machinery, and **layout** becomes a knob inside it — Ring, and (v1) three new ones:
**Sphere Wall**, **Card Tunnel**, **Grid**. Switch the layout and your content, fills, type, and bend
all carry over; only the arrangement changes. Adding a layout becomes a ~30-line module, not a new
500-line effect — the factory thesis, applied to layouts.

Naming (decided): **Expressive Studio** (the studio) → **Showcase** (the effect, in the gallery) →
**Ring / Sphere Wall / Card Tunnel / Grid** (the layouts).

## Why not just add each layout as a separate gallery effect

The existing 25 Space Type effects are self-contained, glyph-only programs that don't share the ring's
tile/fill/card engine, and switching effects re-initialises params (it would wipe your content). Making
Sphere/Tunnel/Grid separate effects would mean either copying the ~500-line tile engine per layout (the
render-parity trap) or losing content on every switch. One host + pluggable placement avoids both.

## The model

### `ShowcaseLayout` — the pluggable unit

New file `app/lib/spacetype/layouts/index.ts` (+ one module per layout):

```ts
interface ShowcaseLayout {
  id: string          // 'ring' | 'sphere' | 'tunnel' | 'grid'
  label: string       // 'Ring' | 'Sphere Wall' | 'Card Tunnel' | 'Grid'
  controls: ControlSpec[]                 // layout-specific knobs; each carries showIf {key:'layout', equals:<id>}
  place(i: number, n: number, p: Params, t01: number): TileTransform   // PURE placement
  loopRates?(p: Params): number[]         // this layout's whole-cycle motion rates (spin/travel/drift)
}
export const SHOWCASE_LAYOUTS: ShowcaseLayout[]
export function getLayout(id: string): ShowcaseLayout   // case-insensitive; falls back to 'ring'
```

`TileTransform` is the existing `{ x, y, z, rotY, scale }` from `ringLayout.ts`. (A later layout may
want full `rotX/rotZ`; extend `TileTransform` then, not now — grid/tunnel/sphere are expressible with
the current fields plus the group-level ring-opening/tilt already applied by the effect.)

### The Showcase effect (the renamed `ring` effect)

- **`effectId` stays `'ring'`** (saved docs store it — no migration, no alias risk); **`label` becomes
  `'Showcase'`**. A code comment explains the id/label mismatch. The default `layout` is `'ring'`, so
  every existing ring document opens as the ring layout, pixel-identical.
- New **`layout` control**: `{ key: 'layout', label: 'Layout', kind: 'select', options: <layout ids>,
  default: 'ring', group: 'Ribbon' }` (or a dedicated 'Layout' section — must be in `SPACE_TYPE_SECTIONS`).
  **Live** (in `liveKeys`) — switching layout is an `update()`-time placement swap, no rebuild.
- **Control re-categorisation.** Today's ring controls split into:
  - **Shared** (stay on the effect, apply to every layout): `content`, all fills (`wordFill`, per-card
    fills), type (`font`/`typeWeight`/`typeYScale`/`tracking`), `cardSize`, `padding`, `cornerRadius`,
    `bend`, `cardRatio`, `backFade`, `perspective`, `speed`, `direction`, `repeat`, camera.
  - **Ring-specific** (move into the `ring` layout module, `showIf` layout==ring): `radius` (Ring size),
    `ringTilt`, `ringOpening`.
- **Dispatch.** `buildScene` is unchanged (it builds tiles/materials; placement isn't baked at build).
  `update()` resolves `const layout = getLayout(params.layout)` and, per tile, calls
  `layout.place(i, n, params, t01)` instead of `ringTransform` directly. `loopRates(params)` delegates
  to `getLayout(params.layout).loopRates?.(params) ?? [1]`. The group-level ring-opening/tilt rotation
  stays applied by the effect (it's a viewing transform, not placement) — but see per-layout camera note.
- The effect's `controls` = shared controls **+** every layout's controls concatenated (each already
  `showIf`-gated), so the panel shows only the active layout's knobs. Motion + agent derive from the
  full declared list, as today. `getLayout` is the single source for the picker's options.

### `ringTransform` → the `ring` layout

Move `ringTransform` (in `ringLayout.ts`) into the `ring` layout module unchanged (it stays exported
from `ringLayout.ts` too, since tests import it there — or re-export). `bentOffset` stays in
`ringLayout.ts` (it's bend math, layout-agnostic). The `ring` layout's `place` = `ringTransform`; its
controls = radius/ringTilt/ringOpening (showIf ring); its `loopRates` = the current speed-based one.

## The three new layouts (pure placement, unit-testable like `ringTransform`)

Each is a pure `place(i, n, p, t01) → TileTransform` + a small control list. Camera: v1 reuses the
shared camera/perspective; each layout picks sensible defaults for its own controls so the resting look
is good (verified live).

- **Sphere Wall** — tiles on a Fibonacci sphere of radius `R` (`sphereRadius` control), each facing
  radially outward; the sphere spins over the loop (`speed` → whole turns about Y). Placement:
  `i`th of `n` at the Fibonacci point (`y = 1 − 2(i+0.5)/n`, `r = √(1−y²)`, `θ = i·golden angle + spin`);
  `rotY` faces outward. Even distribution + seam (t01 0==1) are the unit tests.
- **Card Tunnel** — tiles receding down `−Z`, wrapping toward the camera over the loop. Each tile at
  depth `z = −((i/n + speed·t01) mod 1)·depth` (`tunnelDepth` control), arranged on a small cross-section
  ring/offset (`tunnelSpread`), facing the camera (`rotY≈0`). Nearest tiles largest via perspective.
  Seam by construction (mod 1). Unit test: wrap continuity, depth ordering.
- **Grid** — `cols` columns (`gridCols` control) × ceil(n/cols) rows in the XY plane, centred, facing the
  camera; spacing from `padding`/`cardSize`; a gentle per-tile loop is optional (defer — static grid is
  fine for v1). Placement: `col = i % cols`, `row = floor(i/cols)`, `x/y` from grid position centred on
  origin. Unit test: n tiles land on the expected grid coordinates; centring.

## Layout picker UI

v1: the `layout` **select control renders automatically** from its `ControlSpec` (no new UI) — that IS
the picker. A thumbnail gallery (like `SpaceTypeEffectGalleryModal`) is a fast-follow, not v1. Presets
(named param snapshots → the 55-entry gallery look) are the step after that.

## Testing

- **Unit (pure):** one placement test per new layout in `tests/unit/` (mirroring
  `spacetype-ring-layout`): Sphere — n points on radius R, roughly even (bounded nearest-neighbour),
  seam t01 0==1; Tunnel — depths wrap continuously, seam, nearest-in-front ordering; Grid — i maps to
  the right (col,row), centred, count. **Ring parity:** the `ring` layout's `place` returns exactly what
  `ringTransform` returned (assert identical for sample i/n/params) — the refactor must not move the ring
  a pixel. `getLayout('ring')`/case-insensitive/fallback-to-ring covered.
- **Effect:** an image-card doc builds and updates under each layout without throwing (dispatch works);
  `layout` default is `'ring'`; a legacy doc (no `layout` key) resolves to the ring layout via
  `RING_DEFAULTS` backfill and renders as before.
- **Manual/live:** switch Showcase's Layout between Ring/Sphere/Tunnel/Grid — content, fills, type, bend
  all carry over; each arrangement reads right; the old ring look is unchanged at layout=ring. Deferred
  to the user pass.

## Risks

- **Ring-parity regression.** The refactor is the risk: the ring must render identically at
  `layout='ring'`. Mitigated by the parity unit test (`ring` layout ≡ `ringTransform`) and keeping
  `ringTransform` the literal `place`.
- **Control array growth + `showIf`.** ~4 layouts × ~3 controls each, `showIf`-gated. The section-order
  test and the `SPACE_TYPE_SECTIONS` group guard still apply — every new control's `group` must be
  listed. Watch the collapsed-capsule/agent surfaces (a declared control widens agent vocab unless
  `agent:false`; layout controls should be agent-legible, so leave them on).
- **Live layout switch vs bend/geometry.** All v1 layouts use the same tile meshes; only `place` differs,
  applied in `update()`. So `layout` is safely live. If a future layout needs different build-time
  geometry, it becomes structural then — out of scope now.
- **Camera per layout.** Grid/Tunnel want a more head-on camera than Ring's opened pose. v1 leans on the
  shared camera + good per-layout control defaults; a per-layout `camera()` hint is a fast-follow if the
  resting looks need it (flagged for the live pass).

## Done when

Showcase (the renamed ring effect) has a **Layout** picker with Ring · Sphere Wall · Card Tunnel · Grid;
switching rearranges the *same* content/fills/type/bend; the ring layout is pixel-identical to today
(parity-tested); each new layout's placement is pure and unit-tested; legacy ring docs open unchanged;
and adding layout #5 is one module + one registry line. Presets and a thumbnail gallery are the
fast-follows, out of this scope.
