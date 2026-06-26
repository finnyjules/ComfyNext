# Cylinder Repeats + Granular Speeds + Seamless-Loop Export

**Date:** 2026-06-25
**Status:** Approved design, ready for implementation plan
**Scope:** Three related changes: (A) a "repeats per ring" slider on the Cylinder effect, (B) finer Cylinder motion speeds, and (C) a general "Seamless loop" video-export option so fractional speeds still loop perfectly.

## Background

The Cylinder effect ([cylinder.ts](app/lib/spacetype/effects/cylinder.ts)) wraps the text **once** around each vertical-axis ring (glyphs spread uniformly over 360°; `count` = number of rings). Motions are normalized to the loop: `update(t01, params)` advances by `speed × t01 × 2π` with `t01 ∈ [0,1)`. The export renders `round(fps × loopDuration)` frames. For a seamless loop, each periodic speed must complete a **whole number of cycles** over the loop — so today `waveSpeed` is `Math.round()`-ed to integers and `spinSpeed` steps coarsely (`0.25`). Finer/fractional speeds break the seam, because over one loop a fractional cycle-count lands the last frame off from the first **regardless of duration**.

Key insight enabling (C): rendering **k loops** (where `k × speed` is whole for every periodic speed) makes fractional speeds complete whole cycles → seamless, with the rate/look unchanged.

## Part A — Repeats-per-ring slider (Cylinder)

- New control: `{ key: 'ringRepeat', label: 'Repeats per ring', kind: 'slider', min: 1, max: 8, step: 1, default: 1, group: 'Ribbon' }` (next to `count`/`radius`).
- `buildScene`: read `R = Math.max(1, Math.floor(n(params,'ringRepeat')))`. Wrap the per-glyph placement (the inner `gi` loop) in an outer `rep` loop `0..R-1`, and spread over the total `R × nGlyphs`:
  `a0 = ((rep * ringNGlyphs + gi) / (R * ringNGlyphs)) * 2π`. Each glyph entry stores `nGlyphs: R * ringNGlyphs`.
- `R = 1` is byte-identical to today.
- **Structural** (rebuild on change) — not added to `liveKeys`.

## Part B — Granular Cylinder speeds

- **Spin speed:** change its step `0.25 → 0.05` (value is used directly in `update`, so finer step = finer control immediately). Range/default unchanged.
- **Wave speed:** remove the internal rounding at [cylinder.ts:263](app/lib/spacetype/effects/cylinder.ts) — `Math.max(0, Math.round(n(params,'waveSpeed')))` → `Math.max(0, n(params,'waveSpeed'))` — so its `0.05` step actually changes the rate.
- These now produce fractional cycle-counts, which Part C makes loopable.

## Part C — "Seamless loop" video export (general)

### Seam field

Add optional `loopKeys?: string[]` to the `SpaceTypeEffect` interface ([effect.ts](app/lib/spacetype/effect.ts)) — the params that are "cycles/turns per loop" and must hit whole cycles for a seam. Cylinder declares `loopKeys: ['waveSpeed', 'spinSpeed', 'spinRingOffset']`. Absent → an effect exports exactly as today (k=1).

### Helper — `app/lib/spacetype/loop.ts` (new, pure)

```ts
import type { Params } from './effect'
/** Smallest k in [1, cap] such that every loopKey's value × k is within eps of a whole number,
 *  so all periodic motions complete whole cycles over k loops (→ seamless). Returns 1 if loopKeys
 *  is empty/absent; returns cap as a best-effort fallback if none qualifies. */
export function loopMultiplier(params: Params, loopKeys: string[] | undefined, cap = 60, eps = 1e-3): number
```

For each k from 1..cap, check `|k*v - Math.round(k*v)| < eps` for every `v = Number(params[key])`; return the first k that satisfies all. (On the `0.05` grid, k ≤ 20 always resolves.)

### Engine — render at an arbitrary loop-time

Refactor `engine.ts`: extract the body of `renderFrame` (after the `t01` computation) into `renderFrameAt(t01: number, params: Params)` — renders at a normalized loop-time that may exceed 1 (no `% frameCount` wrap). `renderFrame(index, params)` computes `t01 = (index % frameCount)/frameCount` then calls `renderFrameAt(t01, params)`. At integer t01, `renderFrameAt` is identical to the existing behavior.

### Export wiring

- New ref `seamlessLoop = ref(false)` in `SpaceTypeSurface`; a **"Seamless loop"** `StudioSwitch` in the Output section (near Duration/FPS).
- In `generateVideo`, when `seamlessLoop.value` is on:
  - `const k = loopMultiplier(params, effect.value.loopKeys)`.
  - `const origFrames = Math.max(1, Math.round(fps.value * loopDuration.value))`.
  - Call `ensureSpaceTypeBake` with `cfg` whose `loopDuration` is `loopDuration.value * k` (so it renders `k × origFrames` frames), and a `renderFrame` callback that renders at the **unwrapped** time: `(i) => { engine.renderFrameAt(i / origFrames, params); return engine.frameToBlob(W, H) }`.
  - Encode at the same `fps` → the video is `k×` longer and loops seamlessly; rate/look unchanged.
- When off, `generateVideo` is unchanged (today's path).

## Testing

- **Cylinder (A):** unit — glyph count for a ring scales ×`ringRepeat` (R copies of the text); existing cylinder tests stay green.
- **loopMultiplier (C):** unit — `loopMultiplier({s:1.3}, ['s'])===10`; `({s:0.05},['s'])===20`; integer speeds → 1; empty loopKeys → 1; multiple keys → common k; no-solution → cap.
- **renderFrameAt (C):** the refactor preserves `renderFrame` behavior (existing `spacetype-bake`/effect tests green); `renderFrameAt` accepts t01 > 1 without throwing.
- Manual/in-app (visual + WebGL, per project convention): Cylinder repeats look right; a fractional spin/wave speed exported with "Seamless loop" on plays a clean loop (no jump) and is k× the duration.

## Out of scope

- Declaring `loopKeys` on effects other than Cylinder (they keep today's export). Add per-effect later as needed.
- Persisting the `seamlessLoop` toggle in the saved node config (it's an export-time choice).
- Snapping/rounding speeds (we extend the render, never alter the look).
