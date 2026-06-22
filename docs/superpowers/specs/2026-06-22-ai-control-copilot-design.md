# AI Control Copilot ("Vibe Control") — Design

**Date:** 2026-06-22
**Status:** Approved (design), pending implementation plan
**Scope of this spec:** Phase 1 — the shared control-copilot loop, proven end-to-end on **Type Studio**.

---

## 1. Summary

A shared, live natural-language layer for the studios. The user types a phrase
("warmer, more chaotic, heavier"); an LLM proposes parameter changes within the
*currently-active* effect; the changes apply to the live preview immediately and
are presented as a **ratifiable proposal** the user keeps, reverts, or hand-tweaks.

The AI emits **params, not pixels** — it navigates the space the procedural engine
already spans. It never generates imagery, never rewrites the user's text, and
(in v1) never makes structural changes.

This is the first of three possible AI directions explored:

- **#3 Drive the controls** — this spec. Cheapest, lowest risk, increases the ROI of
  the deep control sets already built.
- **#2 Generate the input** (per-studio; strongest in Texture and Shader) — deferred.
- **#1 Stylize the output** (universal; beware video temporal cost) — deferred.

A fourth idea worth recording for later: **procedural-as-conditioner** — feed studio
output (3D-text depth, Truchet edges) into AI generation as a ControlNet/structure
signal. Most defensible, but out of scope here.

---

## 2. Decisions (locked)

| Decision | Choice |
|---|---|
| AI's role | Drive the controls (params, not pixels) |
| Interaction | Live NL, presented as a **proposal** |
| Authority | **Params only, within the current effect/mode.** No effect/mode/pass-stack switching. |
| Proposal UX | **Hybrid:** live preview + summary header + in-place highlights |
| Phase 1 studio | **Type Studio** (`SpaceTypeSurface.vue`) |
| Model | Haiku-tier (`claude-haiku-4-5-20251001`) — cheap, metered |
| Text content | **Off-limits.** AI styles the message, never rewrites it. |

---

## 3. Architecture

### 3.1 The shared seam — `ControlDescriptor`

A thin per-studio adapter normalizes each studio's controls to one shape, so the
LLM loop is studio-agnostic.

```ts
interface DescribedControl {
  path: string            // 'jitter' (flat) or 'adjust.exposure' (nested, Shader)
  label: string
  kind: 'slider' | 'select' | 'color' | 'font'   // AI-editable kinds only
  min?: number; max?: number; step?: number
  options?: string[]
  group?: string
  hint?: string           // semantic hint — the quality lever (see 3.3)
  current: number | string
}

interface ControlDescriptor {
  describe(currentParams): DescribedControl[]   // only AI-editable, only currently-visible
  apply(patch: Record<string, number | string>): void
}
```

Adapter cost by studio (Phase mapping):
- **Type / Texture** — ≈ free. Their `ControlSpec[]` (`~/lib/spacetype/effect.ts`) already
  carries `key/label/kind/min/max/step/options/group`. The adapter filters to AI-editable
  kinds and (Texture) honors `when` predicates for "currently-visible."
- **Gradient** — small. `ANIMATABLE` covers numerics only; selects/colors must be gathered.
- **Shader** — the only real adapter. Path-addressed (`adjust.exposure`), per-pass stack.

Phase 1 implements the **Type adapter only**, plus the generic loop everything else reuses.

### 3.2 AI-editable filter

Derived from `kind`, overridable per-control via an optional `aiEditable` flag on `ControlSpec`:

- **Editable:** `slider`, `select`, `color`, `font`.
- **Excluded (v1):** `text`, `textList` (the user's words are sacred); `path`, `fillList`
  (structured JSON — too fiddly/risky to emit blind).

### 3.3 Schema enrichment — `hint`

Add an optional `hint: string` to `ControlSpec`. Terse labels ("Coherence", "Jitter")
don't tell a model what a control *does visually*. The hint does:

> `hint: "higher = chaotic/scattered; lower = clean/aligned"`

This is the primary quality lever. It doubles as human tooltip text — one edit, two wins.
Hints are added incrementally; controls without a hint still work (label-only) but map worse.

### 3.4 The loop

1. User types a phrase in the studio's copilot bar.
2. Frontend POSTs `{ descriptor: describe(params), current, phrase, apiKey }` to a backend route.
3. Route → Haiku, which returns a **structured patch**: `{ patch: {path: value}, rationale: string }`.
4. **Backend validates the patch against the descriptor** before returning:
   - drop any `path` not in the descriptor;
   - numerics: coerce to number, clamp to `[min,max]`, snap to `step`;
   - selects: reject values not in `options`;
   - colors: validate hex.
   Raw LLM JSON never reaches studio state unvalidated.
5. Frontend applies the validated patch to the live preview via `apply()`, after
   snapshotting "before".
6. UI shows the proposal (§4); user **Keeps**, **Reverts**, or hand-tweaks any control.

### 3.5 Backend route

New `server/api/vibe.post.ts`, following the existing `server/api/explain.post.ts` pattern
(direct `fetch` to `api.anthropic.com`, `x-api-key` from request body, `anthropic-version`
header). Differences: Haiku model; request a JSON/tool-shaped response; run §3.4 validation
server-side; return `{ patch, rationale }`. Metering hooks per the wallet/credits plan
(text call — pennies; cheapest AI surface in the app).

---

## 4. UX (Type Studio)

Hybrid of "in-place" and "diff card", validated via mockup. Must be built from the existing
studio primitives and tokens — **no parallel design language** (see §5).

- **Copilot bar** at the top of the `#controls` slot in `SpaceTypeSurface.vue`: text input +
  Apply, styled as the existing studio controls.
- **Live preview updates immediately** on apply — the canvas is the evaluation, not a dialog.
- **Summary header** appears below the bar: "✦ N changes", the one-line rationale, and a
  single **Keep / Revert**. Each change is a **clickable chip** ("Jitter 0.10→0.46") that
  scrolls to + focuses the real control.
- **In-place highlights:** the actual moved controls render in an "AI-touched" state
  (amber accent + a dashed *ghost marker at the old value*) so the user can hand-tweak any of
  them where they live in the panel. They are **not** dimmed/gated.
- **Keep** clears the proposal state; **Revert** restores the "before" snapshot.

Color language: amber = AI-touched, emerald = commit/Keep, white = primary accent.
**No purple/violet** (project convention).

Open UX refinements (decide during build, not blocking): header collapsible after first read;
per-chip reject (the `×`); behavior at 8+ changed params (chips wrap/scroll).

---

## 5. Design-system constraint

The copilot UI must stay current with the app's design and reuse existing pieces:

- Controls render through the same Studio primitives Type Studio already uses:
  `StudioSlider`, `StudioSelect`, `StudioColor`, `StudioSegmented`, `StudioSwitch`,
  `StudioButton` (`app/components/vue-canvas/studio/`).
- The "AI-touched" and proposal-header styling are **additive states/wrappers** on those
  primitives and the existing panel, not new bespoke components.
- Follow the Linear-grade dark restyle tokens already in use (white accent, glassy cards,
  no dividers). When the studios' shared styling evolves, the copilot inherits it for free
  because it is built on the same primitives.

---

## 6. Integration points in `SpaceTypeSurface.vue`

- **Source of controls:** `effect.value.controls` (already `ControlSpec[]`), grouped into
  `sections` by `group`. The descriptor reads from here, filtered by §3.2.
- **Surface-injected controls** (gradient stops, loop, dimensions, transparent) and the
  **shared post-FX** layer are not all in `effect.controls`. v1 descriptor sources from
  `effect.controls`; **task: confirm whether post-FX controls are `ControlSpec`-shaped and,
  if so, include them** (post-FX like bloom/chroma are excellent NL targets — "dreamier",
  "grimier"). If they're not ControlSpec-shaped, defer post-FX to a follow-up.
- **`apply()` must respect the `hydrating` guard.** The effect watcher resets params on
  effect change and is guarded by `hydrating` during scene restore. The copilot's `apply()`
  must set params through the same guarded path so accepting a proposal can't trip the
  persistence race fixed previously.
- **Snapshot/restore:** "before" snapshot is a shallow copy of the reactive `params` (plus
  any post-FX params if included); Revert restores it.

---

## 7. What's explicitly out of scope (Phase 1)

- Gradient / Shader / Texture adapters (Phase 2 — reuse the same loop, component, route).
- Structural authority (switching effect / mode / pass stack).
- "Give me N variations" thumbnail grid.
- AI-baked semantic presets.
- Directions #1 (output stylize), #2 (input generation), and procedural-as-conditioner.

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| LLM maps language poorly to params | `hint` field; iterate hints; proposal is ratifiable, not auto-committed |
| Hallucinated keys/values corrupt state | Server-side validation/clamp against descriptor (§3.4) |
| "Slot-machine" distrust | Live preview + visible diff + Keep/Revert + hand-tweak |
| Persistence race on apply | Route `apply()` through the `hydrating`-guarded path (§6) |
| Cost creep | Haiku; single call per request; metered via wallet |
| Design drift from the app | Build on existing Studio primitives/tokens only (§5) |
