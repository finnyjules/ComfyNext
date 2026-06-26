# Vessell Shared Fill Palette (Type Studio)

**Date:** 2026-06-25
**Status:** Approved design, ready for implementation plan
**Scope:** Replace the fragmented per-effect fill defaults in Type Studio with one shared "Vessell" palette, applied as each effect's default fills (seeded-shuffled per effect). First slice of the broader "Vessell across the board" direction — scoped to **Type Studio only** here.

## Background

Each of the 17 fill-capable Space Type effects declares its own `fillList` `default` JSON, and they're fragmented: three *different* `DEFAULT_FILLS` constants (cascade = black/white, blend = blue/cyan/orange/yellow, onionburst = pink/yellow patterns) plus bespoke one-offs (Ball's 6 panels, Ribbon's gradient, several plain single white/dark fills). There is **no shared palette**. This introduces one.

The Extrude (boost) effect does **not** use the fill-list system — its side colors are individual pickers (`boostColor1…5`) and its patterns (grid/noise) are separate controls.

## Decisions (from brainstorming)

- **Shared palette, structure preserved:** each effect keeps *how many* fills it currently uses; only the fills' content comes from the shared palette.
- **Colors AND patterns per slot:** the palette is one ordered list of full fill recipes (slot 1 solid, slot 2 stripes, slot 3 grid, slot 4 ombre, slot 5 qr, slot 6 checkerboard).
- **Per-effect seeded shuffle:** each effect gets a different but FIXED shuffle of the palette (seeded by effect id). Deterministic — reproducible defaults, testable, stable bakes.
- **Stripes → 6** (was 3). **Extrude → 6** colors (colors-only; its patterns stay its own grid/noise controls).
- Semantically-named fill slots (Spiral "Underside gradient", Streamer "Front colors", Contour/Tunnel "Colors", SliceGlitch "Palette") are **included** — they adopt the shared seeded palette like everything else.

## The canonical palette

`VESSELL_FILLS: Fill[]` — 6 ordered slots (approximate hexes from the reference screenshot; exact values may be tuned during review):

| slot | type | a | b | textColor | angle | density |
|------|------|---|---|-----------|-------|---------|
| 1 | solid | `#2563ff` | `#0a0a2e` | `#0a0a2e` | 45 | 8 |
| 2 | stripes | `#ef8fcb` | `#e3685a` | `#101014` | 45 | 8 |
| 3 | grid | `#e3685a` | `#edb07f` | `#ffffff` | 45 | 8 |
| 4 | ombre | `#86e8c0` | `#eef07f` | `#2a1838` | 45 | 8 |
| 5 | qr | `#edb07f` | `#e98fcf` | `#ffffff` | 45 | 8 |
| 6 | checkerboard | `#eef07f` | `#e98fcf` | `#0a0a0a` | 45 | 8 |

(angle/density are the `Fill` defaults; only stripes/grid/ombre/checkerboard/qr read them.)

## Architecture

### New: `app/lib/spacetype/palette.ts`

```
import { mulberry32, hashSeed } from './rng'
import { type Fill, serializeFills } from './fillTile'

export const VESSELL_FILLS: Fill[] = [ /* the 6 slots above */ ]

// Deterministic Fisher-Yates shuffle of a copy of VESSELL_FILLS, seeded by `seedKey`.
function shuffledPalette(seedKey: string): Fill[]

// First `count` slots of the per-seed shuffle, serialized to the params JSON string.
// If count > palette length, cycle (slot = shuffled[i % len]).
export function defaultFillsFor(count: number, seedKey: string): string

// Same seeded shuffle, returns the first `count` PRIMARY colors (Fill.a) — for Extrude.
export function vessellColorsFor(count: number, seedKey: string): string[]
```

- The shuffle is a copy (never mutate `VESSELL_FILLS`).
- `serializeFills` / `Fill` re-exported from `fillTile.ts` (THREE-free), so `palette.ts` stays THREE-free too.

### Wiring: the 17 fill-list effects

Replace each effect's `default:` string with `defaultFillsFor(N, '<effectId>')`, N = current count (stripes raised to 6):

| N | effects (id) |
|---|---|
| 1 | field, cylinder, melt, elastic, ribbon, turntable, contour, tunnel |
| 2 | cascade |
| 4 | coil, blend, streamer |
| 5 | onionburst, spiral |
| 6 | ball, sliceGlitch, **stripes** (was 3) |

- Delete the three `DEFAULT_FILLS` constants (cascade.ts, blend.ts, onionburst.ts) and all inline default JSON.
- Effects whose fill key isn't `fills` (contour/tunnel = `colors`, sliceGlitch = `palette`) keep their key; only the `default` value changes.
- The effect's own `id` is the seed (e.g. `defaultFillsFor(6, 'ball')`).

### Extrude (boost) — colors-only, 6

- Add control `boostColor6` (kind `color`, group `Color`) after `boostColor5`.
- Seed `boostColor1…6` defaults from `vessellColorsFor(6, 'boost')` (so they match the shared palette, per-effect-shuffled).
- Extend the side-color ramp from 5→6 wherever the boostColors are assembled into the `sideColorAt` sampler (the array currently `[boostColor1..5]` → `[..6]`). No other Extrude logic changes; its grid/noise pattern controls are untouched (colors-only, as decided).

## Testing

New `frontend/tests/unit/spacetype-palette.unit.spec.ts`:
- `defaultFillsFor` is deterministic: same `(count, seedKey)` → identical output across calls.
- Different `seedKey`s generally produce different orderings (sample a few effect ids).
- `defaultFillsFor(n)` returns exactly `n` fills; cycling works for `n > VESSELL_FILLS.length`.
- **Consistency guard:** for every registered effect with a fill-list control, its declared `default` equals `defaultFillsFor(N, id)` for that effect's N — so no effect drifts back to a one-off. (Extrude: its `boostColor1…6` defaults equal `vessellColorsFor(6, 'boost')`.)

Existing fill/effect tests must stay green (the fill *rendering* is unchanged; only default *values* move).

## Consequences (intended)

- Single-fill effects no longer all look identical — each gets a different seeded slot (could be a pattern, not always solid). Ribbon's gradient default is replaced by its seeded slot.
- Multi-fill effects pick up the patterned slots in their per-effect order.
- The whole studio's default palette is now retunable by editing one array.

## Out of scope (later)

- Propagating the Vessell palette to the other studios (Gradient/Shader/Texture) + Compositor fills — the broader "Vessell across the board" project.
- A user-facing palette picker / preset switching. This change only sets defaults.
- Giving Extrude true per-slot *patterns* (it stays colors-only).
