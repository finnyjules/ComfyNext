# Shape Studio — Design Spec

**Date:** 2026-07-10
**Status:** Approved for planning
**Author:** brainstormed with Claude

## Summary

Shape Studio is a frontend-only canvas node that opens a full-screen studio for
generating **faceted 3D solids rendered flat** — matte, no specular or reflections,
graphic and poster-like. Two modes share one render/color/grain engine:

- **Primitive mode** — pick a known solid (cube, sphere, cone, prism, cylinder,
  torus, icosahedron, octahedron) and render it faceted-flat.
- **Gem mode** — a seeded convex hull of scattered points produces a unique
  faceted stone (the reference "Prism Generator" look), reshaped by Vertices,
  Depth, and Spread.

The user drags to **orbit** the shape in real time, colors it with a
color-harmony palette or a mapped Type Studio fill, adds grain/distortion, and
**exports a PNG** at a chosen aspect ratio and canvas size. A **Seed** + per-section
**locks** let re-roll produce "different versions of the same idea" — lock the
palette and re-roll for the same colors on a new stone, or lock the shape for a
new palette on the same stone.

Reference inspiration: a "Prism Generator" — a low-poly faceted gem on black,
each triangular facet filled with a gradient from a harmony palette (Analogous /
Triadic), driven by a scrubbable Seed, with Vertices / Depth / Spread shape
controls and Grain / Distortion style controls.

**v1 ships PNG export only.** Looping-video export is an explicit fast-follow
(the shape already animates; the shared bake→encode path already exists).

## Goals

- Two modes (Primitive, Gem) behind one engine and one control panel.
- The "flat" aesthetic: faceted geometry, **no lighting** — color comes from
  vertex colors or a mapped fill, never from a light rig.
- Real-time orbit to frame the shot.
- Two fill paths, toggleable: **Facets** (per-vertex harmony colors) and
  **Surface** (a Type Studio fill mapped across the shape).
- Seeded re-roll with per-section locks.
- PNG export at chosen aspect ratio / canvas size; Export/Import Settings.

## Non-Goals (v1)

- **Video / looping export** — designed for but deferred to a fast-follow.
- **Variation grid / light-table** discovery surface — deferred; the lock model
  covers "same idea, new version" for v1.
- Boolean/CSG shape combining, multiple shapes per canvas, custom mesh import.
- Realistic materials (glass refraction, dispersion, environment reflections).
  This studio is deliberately flat.

## Where It Lives (follows existing studio convention)

Studios in this codebase are **frontend-only canvas nodes** that open a
full-screen Surface modal — not routes. Shape Studio follows the same pattern
established by SpaceType / Gradient / Shader / Texture studios.

**New files:**

- `frontend/app/components/vue-canvas/ShapeStudioNode.vue` — the small on-canvas
  card.
- `frontend/app/components/vue-canvas/ShapeStudioSurface.vue` — the full-screen
  editor (mounts `StudioModalShell`, owns the animation loop and orbit).
- `frontend/app/lib/shapefx/` — pure logic:
  - `engine.ts` — the Three.js render engine (modeled on
    `lib/spacetype/engine.ts`).
  - `geometry.ts` — seeded geometry generation (primitives + gem hull).
  - `color.ts` — vertex-color assignment from a harmony palette (Facets mode).
  - `randomize.ts` — seeded re-roll of unlocked config sections.
  - `rng.ts` — copied from `lib/gradientfx/rng.ts` (`makeRng`, `randomSeed`).
  - `config.ts` — the `ShapeConfig` type + `DEFAULT_CONFIG`.
- `frontend/app/pages/dev/shape-studio-lab.vue` — dev harness for headless
  iteration and screenshot verification.

**Registration (five touchpoints, same as every studio):**

1. `frontend/app/composables/useVueNodes.ts` — add `ShapeStudio: 'shape-studio'`
   to `NODE_TYPE_MAP`.
2. `frontend/app/components/vue-canvas/VueNodeCanvas.vue` — component map
   `markRaw` registration; dangling-output guard list; `shapeStudioOpenForId` ref
   + `handleOpenShapeStudio`; `window.addEventListener('sailor:openShapeStudio', ...)`;
   mount `<ShapeStudioSurface v-if="shapeStudioOpenForId" :node-id="...">`.
3. `frontend/app/data/studio-options.ts` — add a `StudioOption`
   (label "Shape Studio", a lucide icon e.g. `Box` or `Gem`, `nodeType: 'ShapeStudio'`).
4. `frontend/app/lib/agent/capabilities.ts` — add an `AgentCapability`
   (`kind: 'studio', frontendOnly: true`) to `STUDIOS[]`.
5. Reuse `StudioModalShell.vue` chrome and the `studio/` sub-controls
   (`StudioSlider`, `StudioColor`, `StudioSwitch`, `StudioSection`,
   `PalettePicker`, `FillSwatch`).

Communication uses the existing `window` `CustomEvent` bus: open with
`sailor:openShapeStudio { detail: { nodeId } }`; emit the result with
`sailor:shapeStudioOutput { detail: { sourceNodeId, nodeType: 'Image', widgetOverrides } }`
(all studios reuse the SpaceType output handler).

## The Render Engine (`shapefx/engine.ts`)

Three.js, modeled on `SpaceTypeEngine`. Key decisions:

- **Flat via no lights.** A `MeshBasicMaterial` with `vertexColors: true`. Each
  facet's color is interpolated from its three vertex colors — this reproduces
  the gradient-per-facet look with zero lighting realism. No light rig at all.
- **Orthographic camera by default** (keeps the shape graphic/diagrammatic);
  perspective is a toggle. `SpaceTypeEngine` already builds both cameras and
  supports `setProjection`.
- **Grain + distortion** as a light post pass via the engine's `PostChain`
  composer (already present in the SpaceType engine).
- **PNG export** via `frameToBlob(targetW?, targetH?)` — renders then
  `canvas.toBlob('image/png')`, with optional supersampled bake (render at
  `W*SS` then downscale) for crisp facet edges.
- Lifecycle mirrors `SpaceTypeEngine`: `build`, `setSize`, `setProjection`,
  `setPan`, `setPost`, `dispose` (dispose geometries/materials/textures +
  `renderer.dispose()`). WebGL probe via `lib/spacetype/webgl.ts` `detectWebGL()`.
- The animation loop lives in the Surface (`requestAnimationFrame` calling
  `engine.render(orbitState, params)`), not the engine — same split as
  `SpaceTypeSurface` / `GradientStudioSurface`.

### Geometry (`shapefx/geometry.ts`)

Pure and seeded. Returns non-indexed `BufferGeometry` (flat facets, crisp edges).

- **Primitives** — Three's built-in geometries (`BoxGeometry`, `SphereGeometry`,
  `ConeGeometry`, `CylinderGeometry`, `TorusGeometry`, `IcosahedronGeometry`,
  `OctahedronGeometry`), converted to non-indexed. A **facet density** control
  maps to segment counts / icosahedron detail so a sphere can read coarse
  (chunky facets) or fine.
- **Gems** — a seeded point cloud (count driven by **Vertices**, distribution by
  **Spread**, elongation by **Depth**) → `ConvexGeometry` (from
  `three/examples/jsm/geometries/ConvexGeometry`) for the faceted hull.

## Color & Fill (Facets / Surface toggle)

A `fillMode: 'facets' | 'surface'` switch selects the color path. Both reuse
existing libraries.

- **Facets mode** (`shapefx/color.ts`) — build a palette with
  `lib/color/harmony.ts` (`harmonize` / `harmonyHues`; controls: Harmony type,
  Base hue, Saturation, Lightness). Assign a color to each vertex by a seeded
  rule (options: per-facet, by depth/Z, by height/Y) and write it into the
  geometry's `color` attribute. This is the reference look.
- **Surface mode** — build a texture from a Type Studio fill via
  `lib/spacetype/fills.ts` (`fillTexture` / `fillAtlasTexture`; fill types
  `solid | gradient | ombre | grid | noise | checkerboard | stripes | qr` from
  `lib/spacetype/fillTile.ts`) and map it across the shape's UVs. Color comes
  from the mapped fill while facets still read through depth. Seamless patterns
  and images land here. Uses `MeshBasicMaterial { map }` (still unlit/flat).

Switching modes swaps the material/attribute setup; the geometry is unchanged.

## Controls, Locks & Re-roll

Right panel = collapsible `StudioSection`s mirroring the reference, **each with a
🔒 lock toggle**:

- **Shape** — mode (Primitive / Gem); primitive picker *or* gem Vertices / Depth /
  Spread; facet density; projection (orthographic / perspective).
- **Palette** (Facets mode) *or* **Fill** (Surface mode) — harmony / base hue /
  saturation / lightness, or the fill-type picker + fill params.
- **Style** — grain, distortion, background color (incl. transparent).
- **Canvas** (not lockable) — aspect ratio, width, height, Export PNG,
  Export/Import Settings.

**Seed & re-roll.** One **Seed** value (scrubbable) + a **Re-roll** button.
Re-roll advances the seed and regenerates every **unlocked** section via
`shapefx/randomize.ts` (seeded with `makeRng` from the copied `rng.ts`). Locked
sections keep their current params. This delivers "different versions of the same
idea": lock Palette → same colors, new stone; lock Shape → same stone, new
palette.

## Data Flow & State

- All studio state is one serializable `ShapeConfig` object (in
  `shapefx/config.ts`): `seed`, `fillMode`, per-section params, and a `locks`
  record. `DEFAULT_CONFIG` is the single source of truth for initial values.
- Because state is one plain object: **Export/Import Settings** (JSON), agent
  parameter-binding, and persistence all come for free — same as other studios.
- **Render pipeline:** `ShapeConfig` → `geometry.ts` (build geometry for
  seed+shape params) → `color.ts` or `fills.ts` (apply fill) → `engine.render`
  (orbit + post) → canvas. Orbit state (camera angle) is Surface-local UI state,
  not part of `ShapeConfig`, but is captured at export time so the PNG matches
  the framed view.
- **Export:** `engine.frameToBlob(w, h)` → `recordAsset(...)` → emit
  `sailor:shapeStudioOutput` with `nodeType: 'Image'`.

## Error Handling

- **No WebGL** — `detectWebGL()` fails → the Surface shows a graceful message
  instead of a black canvas (same pattern as SpaceType).
- **Degenerate gem hull** — if a seeded point cloud is collinear/too small to
  form a hull, `geometry.ts` retries with a jittered seed / falls back to a
  minimum tetrahedron rather than throwing.
- **Import Settings** — validate the parsed JSON against `ShapeConfig` shape;
  on mismatch, merge over `DEFAULT_CONFIG` (deep-merge) so partial/old configs
  stay safe (same guard pattern noted for Shader Studio).
- **Dispose** — the Surface disposes the engine on unmount / node close to avoid
  WebGL context leaks (studios are limited to a handful of live contexts).

## Testing

- **Unit (pure logic, no THREE where possible):**
  - `geometry.ts` — same seed → identical vertex buffer (determinism); Vertices /
    Depth / Spread monotonically affect point count / bounds; degenerate-hull
    fallback produces valid geometry.
  - `color.ts` — vertex colors come from the harmony palette; same seed →
    identical color attribute; assignment rules (facet / depth / height) differ.
  - `randomize.ts` — locked sections are byte-identical across re-roll; unlocked
    sections change; same seed → same result.
  - `config.ts` — Import merges over `DEFAULT_CONFIG`; round-trips
    export→import.
- **Visual (required — never ship WebGL on unit tests alone):** drive the
  `shape-studio-lab.vue` harness, screenshot each mode (cube, sphere, gem),
  each fill mode (Facets, Surface), and a re-roll-with-lock pair, and get visual
  sign-off. Watch for the rAF background-tab mount hang seen in other studios
  when screenshotting headless.

## Fast-Follow (post-v1)

- **Looping video export** — reuse `lib/spacetype/bake.ts`
  (`ensureSpaceTypeBake`) → `uploadFrameBatch(blobs, 'spacetype')` →
  `POST /sailor/spacetype_encode` → emit `shapeStudioOutput` with
  `nodeType: 'Video'`. A slow auto-rotate / gradient-drift becomes the loop.
- **Variation grid** — a 2×2 / 3×3 of nearby-seed variations to promote from,
  reusing the sketchbook/light-table thinking.
