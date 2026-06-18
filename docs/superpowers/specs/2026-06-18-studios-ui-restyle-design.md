# Studios UI restyle + app-wide accent unification (design)

**Date:** 2026-06-18
**Status:** In review

## Goal

A restyle + consistency + usability pass on the three media "studios" (Gradient, Shader,
Type/Space Type), plus an app-wide unification of the accent color. Today the studios share
chrome but diverge in control styling, and the app uses a grab-bag of accent colors
(blue-600 primary in Shader Studio, emerald elsewhere, stray cyan/sky/indigo) that reads as
inconsistent.

## Aesthetic (approved via mockups)

Linear-grade refined dark:
- **Near-black layered surfaces**: modal `#0e0e10`-class base, panels via `white/[0.02–0.05]`.
- **Bordered section cards, NO standalone dividers.** Each control section is a subtle card
  (`bg-white/[0.03]`, `border border-white/[0.06]`, rounded) separated from the next by GAP
  only. Remove the horizontal rules between sections and the vertical preview↔controls rail
  seam — the card borders provide all needed structure. (User: "I like the borders around the
  cards; it's the horizontal and vertical dividers between sections I don't like.")
- **White is the only accent** — primary buttons (white fill / near-black text), active
  toggles, active segmented options, slider fill + thumb, focus rings. No blue/emerald/etc.
- **Slim controls**: 2px slider rails, ~12px thumb, white fill, subtle white focus ring; mono
  value readouts.
- **Font**: `PP Neue Montreal` (already the app's `--font-sans` in `app/assets/css/main.css`),
  so studios inherit it; value readouts use a mono fallback stack.

## Scope & architecture

The three studios render through two shared components — `StudioModalShell` and `StudioSection`
(`frontend/app/components/vue-canvas/`) — so the chrome work is centralized. Plus a small set of
new shared control primitives so the control *look* unifies too.

### Phase 1 — Shared chrome + tokens
- `StudioModalShell`: add a **header** slot/area — studio title · breadcrumb (current effect) ·
  `esc` hint + close (`ti-x`). Refine the frame (border, radius). Keep `preview` / `actions` /
  `controls` slots. Remove the vertical rail border between preview and controls.
- `StudioSection`: keep the bordered-card treatment, drop any inter-section divider; muted
  section label; optional **switch** in the badge slot (replaces the enable checkbox); chevron
  collapse; sections separated by gap.
- Define accent usage as white via Tailwind opacity utilities (no new token system needed).
- Propagates to all three studios immediately.

### Phase 2 — Shared control primitives
New small components under `vue-canvas/` (or a `studio/` subfolder), used by all three studios:
- `StudioSlider` — label · slim rail · mono value · white focus ring.
- `StudioSwitch` — replaces enable checkboxes (`accent-emerald-500` → white switch).
- `StudioSegmented` — binary / few-option enums (e.g. Pattern Linear/Concentric) instead of a
  `<select>`.
- `StudioSelect` — styled dropdown for many-option enums.
- `StudioButton` — `primary` (white) / `secondary` (ghost) / `subtle` (muted) variants.

Migration:
- **Type Studio** auto-builds its controls from a `ControlSpec` list (`SpaceTypeSurface.vue`
  renders slider/select/color/switch per `kind`) — one central place → biggest single win;
  map `kind` → primitive.
- **Shader** and **Gradient** studios adopt the primitives in their hand-written control markup.

### Phase 3 — Consistency + app-wide accent sweep
- Normalize the three studios' footers (Shader's `bg-blue-600` → white primary), headers,
  labels, spacing.
- **App-wide accent sweep (~44 files):** replace decorative/brand/primary accent classes with
  white/white-opacity equivalents across the frontend.
  - **Convert → white:** `blue`, `sky`, `cyan`, `indigo`, and **emerald used as an accent**
    (primary buttons, active states, `accent-emerald-*`, decorative borders/rings, the run/▶
    control's emerald).
  - **Keep (functional status, not accents):** `red` (errors/destructive), `amber` (warnings),
    and `green/emerald` where it genuinely signals success/confirmation (e.g. toast checkmarks).
  - Done as a reviewed pass (audit each hit accent-vs-semantic), not a blind find-replace.

## Components changed / added

| File | Change |
|---|---|
| `StudioModalShell.vue` | add header (title/breadcrumb/close), refine frame, drop rail divider |
| `StudioSection.vue` | bordered card kept, dividers removed, switch-in-badge, muted label |
| `studio/StudioSlider.vue` (new) | slim rail + value + focus ring |
| `studio/StudioSwitch.vue` (new) | toggle switch |
| `studio/StudioSegmented.vue` (new) | segmented control |
| `studio/StudioSelect.vue` (new) | styled select |
| `studio/StudioButton.vue` (new) | white primary / ghost / subtle |
| `SpaceTypeSurface.vue` | map ControlSpec `kind` → primitives; header title/breadcrumb |
| `ShaderStudioSurface.vue` | adopt primitives; blue→white |
| `GradientStudioSurface.vue` | adopt primitives |
| ~44 frontend files | accent sweep (decorative → white; keep semantic) |

## Rollout

Phased, with an in-app review checkpoint after each phase (the surfaces are GPU/flag-gated, so
verification is the user's in-app visual check). The app-wide accent sweep is the last phase so
the studio work — the part with mockup sign-off — lands and is reviewable first.

## Testing / verification

- Component primitives: light Vitest where there's pure logic (e.g. value formatting, segmented
  selection) — most are presentational and verified visually.
- Each phase: a clean self-contained diff + in-app visual check by the user.
- `vue-tsc` clean on all touched files.

## Open question for review

- Confirm the **semantic-color exception** (keep red/amber/success-green; convert everything
  else to white). If you want those unified too, say so.

## Deferred

- Real preview zoom/pan (the zoom pill is dropped from v1).
- Resizable / larger modal.
- A formal design-token layer (using Tailwind opacity utilities for now).
