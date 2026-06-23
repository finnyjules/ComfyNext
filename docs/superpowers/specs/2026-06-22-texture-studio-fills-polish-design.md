# Texture Studio — Phase-1 Fills Polish Design

**Date:** 2026-06-22
**Status:** Approved (design); implementation plan pending

## Summary
Refine the per-region fill system (Slices 1a/1b/1c) with four user-facing improvements + code cleanup, all backward compatible:
1. **3–4 gradient stops** (currently 2).
2. **Per-fill opacity** that blends the fill toward the tile background color.
3. **Share a fill across roles** via a `link` fill type.
4. **Modal UX niceties**: collapsible per-role sections, live fill swatch, per-role reset.

Builds on the existing engine: per-role fill evaluation in `evalFill`, the `Fill` union in `types.ts`, `fillForRole`/`roles.ts`, and the Fills panel in `TextureStudioSurface.vue`. No new modes/geometry.

## Non-goals
- Blend modes beyond opacity (multiply/screen/etc) — deferred (opacity-over-background only).
- More than 4 gradient stops.
- New lattices/families.

## 1. Per-fill opacity (P1)
- **Data:** add `opacity?: number` (0–1, default 1) to every `Fill` variant.
- **Shader:** per-role uniform `u_fillOpacity[3]` (float, default 1). At the END of `evalFill`, after computing the fill color `col`, `return mix(u_bg, col, u_fillOpacity[r])` (`u_bg` = `params.background`). Applies uniformly to solid/gradient/image/pattern.
- **render():** set `u_fillOpacity[r]` from the resolved fill's `opacity` (default 1) in the per-role loop.
- **UI:** an Opacity StudioSlider (0–100%, shown as 0–1) in every fill block; writes back a complete Fill with `opacity`.
- **Seamlessness:** opacity is constant per role → unaffected.
- **Back-compat:** missing `opacity` ⇒ 1 ⇒ identical render.

## 2. 3–4 gradient stops (P2)
- **Data:** the gradient `Fill` already has `stops: GradientStop[]`. UI currently writes exactly 2; allow 2–4.
- **Shader:** add `u_fillStopCount[3]` (int, 2–4), `u_fillStops[12]` (vec3 — `r*4 + k`), `u_fillStopPos[12]` (float). The ramp value `g` is computed exactly as today (cell = clamped dot; tile = mirrored ramp with the integer-wave-number snap — unchanged, so still seamless). New `vec3 gradColor(int r, float g)` clamps `g` to `[pos[0], pos[count-1]]` then walks segments `k=0..count-2`, returns `mix(stops[base+k], stops[base+k+1], localT)` for the segment containing `g`. (vec3/float uniform arrays are dynamically indexable in GLSL ES 3.00 — only samplers are not.) evalFill's gradient branch returns `gradColor(r, g)` instead of `mix(C0,C1,g)`. (Keep/repurpose `u_fillC0/C1` or replace with the stops arrays — implementation chooses; the stops arrays are the source of truth.)
- **render():** upload `u_fillStopCount[r]` + each stop's color/pos for gradient fills; non-gradient roles set count to 0 (or leave — gradColor only runs for type 1).
- **UI:** the gradient block renders the stops list: each stop a StudioColor + a position StudioSlider (0–1); an **Add stop** button (enabled while count<4) and a **Remove** affordance per stop (enabled while count>2). Add inserts a stop (e.g. midpoint) and keeps stops position-sorted; writes back a complete gradient Fill. A `setStop(rk,i,idx,patch)` helper keeps handlers clean.
- **Seamlessness:** multi-stop interpolation is over `g` (still periodic at tile frame) → unaffected.
- **Back-compat:** a 2-stop gradient renders identically (gradColor with 2 stops == the old 2-stop mix).

## 3. Share a fill across roles (P3)
- **Data:** new `Fill` variant `{ type: 'link'; to: string }` (`to` = a role key of the same family).
- **Resolution (JS, in `fills.ts`):** `fillForRole(p, roleKey, roleIndex)` — if the stored fill is a `link`, resolve the target role's fill, following links with a **visited-set cycle guard**; on a cycle, missing target, or self-link, fall back to the role's `legacyFill`. Resolution returns a concrete solid/gradient/image/pattern Fill (never a link), so the renderer is unchanged — the linked role's region is painted with the target's fill (and, for image/pattern, the same texture is bound to the linked role's unit).
- **UI:** the type picker gains `'link'`. When a role is a link, show a single StudioSelect of the OTHER role keys (`rolesFor(params)` minus self) and hide all other controls; the role header swatch mirrors the target's. `setFillType('link')` seeds `{type:'link', to:<first other role>}`.
- **Renderer note:** `render()` already calls `fillForRole` per role, which now returns the resolved fill — image/pattern linked roles bind the target's texture to their own unit (`2+r`), guarded by the same `_lastFillSrc[r]` key (the resolved src/pattern-key), so transitions re-upload correctly.
- **Edge:** a role index used for cell-local coords stays the linked role's own index (the fill is evaluated at the linked role's pixels) — correct.

## 4. Modal UX niceties (P4, surface only)
- **Collapsible roles:** each role is a header (name + swatch + type) that toggles its body. State: a reactive `Set<string>` of expanded role keys (default: all expanded, or first expanded — implementation picks; default all-expanded preserves current behavior).
- **Live swatch** per role header: solid → a color chip; gradient → a CSS `linear-gradient(angle, stops…)` chip; image → a small `<img>` thumbnail (rasterViewUrl); pattern → a small glyph/label; link → mirror the target's swatch.
- **Reset to default** per role: a small control that deletes `params.fills[roleKey]` and re-renders (role falls back to legacy solid).
- No shader changes.

## Cleanup (folded into the touching slice)
- Drop the unused `defaultFill` export (fills.ts).
- Add the `setStop`/`setGradient`-style helpers used by multi-stop.
- Fold the now-empty `'Color'` entry in `TEXTURE_SECTIONS` (sections.ts) into `'Fills'`; update the color controls' `group` to `'Fills'` (they remain `when:()=>false`) and the texturefx-controls unit test accordingly. The `'Color'` string is removed from the allow-list.

## Components / files
- `frontend/app/lib/texturefx/types.ts` — `opacity` on fills; `link` variant; (gradient `stops` already present).
- `frontend/app/lib/texturefx/fills.ts` — link resolution + cycle guard in `fillForRole`; drop `defaultFill`; optional pure `gradColorAt(stops, g)` helper for unit testing the multi-stop interpolation.
- `frontend/app/lib/texturefx/renderer.ts` — `u_fillOpacity`, `u_fillStopCount/Stops/StopPos`; `gradColor` GLSL; opacity mix at evalFill end; uniform uploads.
- `frontend/app/lib/texturefx/sections.ts` + `controls.ts` — `'Color'`→`'Fills'` fold.
- `frontend/app/components/vue-canvas/TextureStudioSurface.vue` — opacity slider, multi-stop UI, link UI, collapsible/swatch/reset.
- Tests: `frontend/tests/unit/texturefx-fills.unit.spec.ts` — multi-stop `gradColorAt` interpolation; link resolution (hop, cycle→legacy, missing→legacy); opacity default.

## Sub-slices (each = build → review → sign-off)
- **P1 — opacity:** data + shader mix + per-fill slider. (renderer + types + surface)
- **P2 — multi-stop gradients:** shader gradColor + uniforms + stops UI + `gradColorAt` unit test. (renderer + surface + test)
- **P3 — share-fill link:** `link` variant + `fillForRole` resolution/cycle-guard + unit tests + link UI. (types + fills + surface + test)
- **P4 — modal UX:** collapsible + swatch + reset; fold cleanup (sections/controls/defaultFill). (surface + sections + controls + fills + test)

## Testing
- **Unit:** `gradColorAt(stops,g)` (segment interpolation, clamping, 2- and 4-stop); link resolution (single hop, chain, cycle→legacy, self→legacy, missing target→legacy); opacity default = 1 ⇒ unchanged.
- **Visual (harness + sign-off):** multi-stop gradient (3–4 colors, cell + tile, seamless); opacity fade toward background per fill type; never ship shader changes on unit tests alone.
- **Regression:** no `fills`, and 2-stop/opaque fills, render byte-identical to Phase-1.

## Open / future
- Blend modes (multiply/screen) — deferred.
- Per-stop midpoint/easing — deferred.
