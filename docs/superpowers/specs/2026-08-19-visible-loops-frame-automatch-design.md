# Visible loops + Frame auto-match — design

**Date:** 2026-08-19
**Status:** approved, ready for planning

## Plain-language summary

Two connected annoyances:

1. When you turn on **Seamless loop** in a studio, you can't tell how long the
   loop actually is. You set a "loop duration" (say 6s), but if the effect has
   motion at fractional speeds the studio silently plays it for a multiple of
   that (6s → 12s) so every motion finishes a whole cycle. That true length is
   never shown.
2. When you wire that studio into a **Frame**, you have no idea whether the Frame
   loops or how long. It actually *does* loop (it derives a loop from the longest
   wired studio) — but there's no UI saying so, and for fractional-speed effects
   it loops at the wrong (base) length, so it can seam mid-motion.

This feature makes the loop length **visible** in the studio and on the Frame, and
makes the Frame **auto-match** its wired studios so it loops seamlessly.

## Goal / success criteria

- In a studio, the Seamless-loop control shows the resulting length live
  (e.g. "Seamless loop · 12.0s").
- A Frame with one animated studio loops at that studio's *true* seamless length,
  automatically, with a visible badge ("⟳ 12s").
- A Frame with several animated studios loops at the least-common length where all
  of them complete whole cycles (LCM), capped at ~60s with a quiet warning.
- Existing nodes (no saved seamless flag) behave exactly as before (no regression).

## The one idea: `StudioFrameSource.duration` is the honest seamless length

Studios already implement `StudioFrameSource` with a `duration` getter that the
Frame consumes (`lib/studio/frameSource.ts`). This is the single seam between
studios and the Frame. We make `duration` mean **"seconds before the loop repeats
with no seam."** The Frame stays dumb: it reads each slot's `duration` and
reconciles them. Studios stay decoupled: each computes its own honest length.

- **Space Type** currently reports base `loopDuration` — the gap. Fix it to report
  `loopDuration × k`, where `k = loopMultiplier(effect.loopRates(params))` when
  Seamless loop is on, else `k = 1`.
- Other studios (Gradient, etc.) already report their real `motion.duration` and
  have no k-multiplier concept, so they're already honest. **Out of scope** — no
  changes.

## Components / units of change

### 1. Shared loop math — `lib/compositor/loopReconcile.ts` (new)

Pure, unit-tested. No Vue/DOM.

- `effectiveLoopSeconds(loopDuration: number, k: number): number` → `loopDuration * k`.
  (Trivial, but named so both the studio readout and the frame source use one
  definition.)
- `reconcileLoops(slots: {seconds: number, fps: number}[], capSeconds = 60):
  { duration: number, fps: number, capped: boolean }`
  - Common base fps = `max(fps)` across slots (Frame already uses max fps).
  - Each slot's period in common frames = `round(commonFps * seconds)`.
  - Combined = `lcm(all period frame counts)` (integer LCM — exact, no float LCM).
  - If `combined / commonFps > capSeconds`: clamp to the largest multiple of the
    single longest slot that fits under the cap, set `capped = true`.
  - Return `{ duration: combined / commonFps, fps: commonFps, capped }`.
  - Empty / all-still slots → the existing `deriveMasterClock` null path still owns
    that (this helper is only called with ≥1 animated slot).
- `lcm(a, b)` / `gcd` integer helpers, `lcm` reducing over the list, guarding 0.

**Why a shared module, not inline in masterClock:** the LCM math is the testable
core; `deriveMasterClock` stays a thin adapter, and the studio readout reuses
`effectiveLoopSeconds`.

### 2. Master clock — `lib/compositor/masterClock.ts` (change)

`deriveMasterClock` switches its derived branch from "max duration, max fps" to
`reconcileLoops(...)`. The manual override branch is unchanged. Return type gains
an optional `capped?: boolean` so the Frame can show the warning. Existing
`masterFrameIndex` / `slotPhase01` are untouched — per-slot looping via
`slotPhase01(t, slotDuration)` already completes whole cycles inside an LCM master,
which is exactly what makes the combined loop seamless.

### 3. Space Type — persist the flag + report the true length

- `lib/spacetype/state.ts`: add `seamless?: boolean` to `SpaceTypeState`
  (default `false` via `defaultSpaceTypeState`). Backward compatible: absent →
  false → base duration → today's behavior.
- `SpaceTypeSurface.vue`: `seamlessLoop` ref loads from / saves into `cfg`
  (currently local-only — line ~1316 `cfg` computed, plus the load paths that read
  `c.loopDuration`). Add a live readout next to the switch (see UI below).
- `SpaceTypeNode.vue`: the `makeSpaceTypeFrameSource({ getClock })` closure computes
  `k = state.seamless ? loopMultiplier(getEffect(state.effectId).loopRates?.(state.params) ?? []) : 1`
  and returns `duration: effectiveLoopSeconds(state.loopDuration, k)`. (The node
  already has the effect + params to hand.)

### 4. Studio UI readout — `SpaceTypeSurface.vue` (change)

Beside the existing `<span>Seamless loop</span><StudioSwitch>` (line ~2164):
a muted live length, `· {{ effectiveSeconds.toFixed(1) }}s`, computed from
`loopDuration`, `fps`-independent, and `k`. Updates as duration/params change.
Uses the shared `effectiveLoopSeconds` + `loopMultiplier`.

### 5. Frame badge — `ArtifactFrameNode.vue` (change)

A small corner badge on the card, shown whenever `masterClock` is non-null and
`duration > 0`: `⟳ {{ Math.round(masterClock.duration) }}s`. Rendered in the
template (not on the canvas), visible at rest — so you see it before hovering.
If `masterClock.capped`, the badge gets a subtle warning affordance (amber dot +
tooltip "loop capped at 60s"). Styling follows existing card chrome
(action-blue accent only per the colour conventions; amber reserved for the
warning).

## Data flow

```
Studio (SpaceType) config { loopDuration, seamless, effectId, params }
  → frameSource.duration = loopDuration × k            (k from effect.loopRates)
    → Frame deriveMasterClock → reconcileLoops(slots)  (LCM across wired slots)
      → masterClock { duration, fps, capped }
        → badge "⟳ Ns"  +  bake/export length  +  per-slot slotPhase01 looping
```

## Testing

- `tests/unit/loop-reconcile.unit.spec.ts` (new): `reconcileLoops` — single slot
  passthrough; 6s+4s→12s; 6s+7s→42s; cap engages + `capped:true`; equal durations;
  fractional seconds via frame base; `lcm`/`gcd` guards (0, 1). `effectiveLoopSeconds`.
- `tests/unit/compositor-master-clock.unit.spec.ts` (extend): derived branch now
  LCM not max; override branch unchanged; null path unchanged.
- Manual/live: studio readout tracks loopDuration/params; Frame badge shows;
  a fractional-rate effect wired into a Frame plays without a mid-loop seam.

## Out of scope (YAGNI)

- Manual loop-length override control on the Frame (auto-match only; number shown,
  not editable). Trivial to add later as a `sailor_frame.clock` UI.
- Seamless-loop concept for studios that don't have it (they report honest
  durations already).
- Changing the export/bake pipeline beyond it inheriting the corrected
  `masterClock.duration`.
