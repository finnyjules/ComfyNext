# 3D Studio — primitives + add toolbar

**Date:** 2026-07-17
**Status:** approved (brainstorm with Julien)
**Scope:** extend the shipped 3D Studio (spec: 2026-07-16-3d-studio-design.md) with
8 new primitives and a proper add-object toolbar. Frontend-only; no backend change.

## Problem

The editor's only add-object control is a native `<select>` labeled "+ Add" in the
viewport's top-left overlay. Julien could not find it — it reads as a filter, not
an add button, and its OS dropdown looks alien to the app. The primitive set (6)
is also missing common shapes.

## Decisions (from brainstorm)

| Question | Decision |
|---|---|
| New primitives | capsule, pyramid, prism, icosahedron, octahedron, dodecahedron, torusKnot, ring (total 14) |
| Add UI | Bottom-center floating toolbar in the Smart Layout / Grid editor style — NOT one button per shape |
| Menu shape | Single "+ Primitive" button opening a popup menu above it (Grid editor Brand-panel mechanic) |
| Upload GLB | Moves from the Objects rail into the bottom toolbar, after a divider |
| Top-left overlay | Keeps gizmo mode (Move/Rotate/Scale), snap, Set camera; native select removed |

## Design

### Bottom toolbar (new)

Floating pill centered over the viewport's bottom edge, inside the surface's
`#preview` viewport container (absolute, `bottom-3 left-1/2 -translate-x-1/2`),
styled exactly like the Grid editor's tool pill
(`bg-[#1a1a1a]/95 rounded-[12px] p-1.5 border border-[#2a2a2a] shadow-lg`,
`h-8 px-2.5` icon+label buttons, `w-px h-5 bg-white/10` dividers — see
`frontend/app/components/templates/GridEditorShell.vue` bottom cluster):

- **"+ Primitive"** button (Plus icon + label). Click toggles a popup card above
  the button (`absolute bottom-full mb-2`, `bg-[#161616] border border-white/10
  rounded-lg shadow-2xl`): a 2-column grid of the 14 shapes, icon + name per row,
  grouped with tiny uppercase section labels — Basics (box, sphere, cylinder,
  cone, torus, plane), Solids (capsule, pyramid, prism), Polyhedra (icosahedron,
  octahedron, dodecahedron), Decorative (torus knot, ring). Clicking a shape:
  `addPrimitive(kind)` (existing handler — adds at origin, selects, marks dirty),
  close the popup. Esc / outside click closes the popup (do not close the modal —
  reuse the surface's existing capture-phase Esc precedence: popover open →
  consume the Esc, mirroring the StudioColor guard).
- Divider, then **"Upload GLB"** (Upload icon + label) — the existing
  `uploadGlbFile` flow relocated from the Objects rail; the rail's upload button
  is removed, its object list stays.
- Icons from `lucide-vue-next` where a real glyph exists (Box, Circle→sphere,
  Cylinder, Cone, Torus, Square→plane, Pill→capsule, Pyramid, Triangle→prism,
  Donut→ring if present); nearest-match glyphs (Gem, Diamond, Hexagon,
  Infinity) for polyhedra/torus knot. Implementer verifies each name against the
  installed lucide-vue-next export list and substitutes the closest available
  glyph where a name is missing — no new icon dependency.

### Objects rail

Empty-state copy becomes: "Empty scene — add a primitive from the toolbar below,
or upload a GLB." (No upload button in the rail anymore.)

### Model + engine

- `frontend/app/lib/scene3d/config.ts`: `PrimitiveKind` union and
  `PRIMITIVE_KINDS` grow to the 14 kinds above (order = menu order). `parseDoc`
  validation is driven by `PRIMITIVE_KINDS`, so old docs parse unchanged and new
  kinds round-trip with zero further changes. `createPrimitive`'s numbered-name
  base derives from the kind as today ("torusKnot" → "TorusKnot" is acceptable;
  prettier labels live in the menu, not the doc).
- `frontend/app/lib/scene3d/engine.ts` `geometryFor()` new cases:
  - capsule: `CapsuleGeometry(0.35, 0.5, 8, 24)`
  - pyramid: `ConeGeometry(0.55, 1, 4, 1)` rotated `rotateY(Math.PI / 4)` for an
    axis-aligned square footprint
  - prism: `CylinderGeometry(0.5, 0.5, 1, 3)`
  - icosahedron: `IcosahedronGeometry(0.55)`
  - octahedron: `OctahedronGeometry(0.55)`
  - dodecahedron: `DodecahedronGeometry(0.55)`
  - torusKnot: `TorusKnotGeometry(0.4, 0.12, 128, 16)`
  - ring: `RingGeometry(0.22, 0.5, 48)` rotated `rotateX(-Math.PI / 2)` flat like
    plane
- Flat kinds (plane, ring) render double-sided: in `syncObject`, set
  `material.side = THREE.DoubleSide` for those kinds (fixes plane's existing
  invisible-from-below behavior in passing; other kinds stay front-side).

## Error handling

Nothing new — adding a primitive is synchronous; the popup has no failure modes.
Upload GLB keeps its existing error handling from the rail.

## Testing

- Unit (extend `frontend/tests/unit/scene3d-config.unit.spec.ts`): round-trip a
  doc containing every one of the 14 kinds; `parseDoc` still drops an unknown
  kind (e.g. `"blob"`) rather than erroring.
- Browser (dev-lab `/dev/scene3d-lab` + canvas): toolbar renders; menu opens
  above the button; each group adds its shapes; Esc closes menu without closing
  the modal; Upload GLB works from its new home; bake renders the new shapes in
  all three passes; ring/plane visible from below.
- Gates: scene3d vitest files green; `npx vue-tsc --noEmit | grep -i scene3d`
  clean; typecheck total at baseline.

## Out of scope

Rendered 3D thumbnails in the menu (standalone-tool territory); per-primitive
parameters (segment counts, knot p/q); toolbar drag-to-place.
