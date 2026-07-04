# Input Affordances — Variable Glyph + Scrubbable Slider

**Date:** 2026-07-04
**Status:** Design approved in intent (user: glyph mockup + "yes that's amazing!" on the scrub mockup); details below decided autonomously, open questions flagged §8.
**Relates to:** `2026-07-03-variables-collections-design.md` (the promote/bind system this skins), `2026-07-03-smart-layout-creator-flow-design.md`.

## 1. Motivation

Two pieces of the same complaint — the studio/Smart-Layout inputs don't feel like a
creative tool:

- **Discoverability.** Turning a control into a variable is a right-click no one discovers.
  Nothing in an input *signals* it can become a variable (Figma solves this with an in-field
  hexagon glyph). The binding system is fully built; it's invisible.
- **Slider feel.** The rail slider is the baseline shape. What's missing is *interaction* —
  precise value control the way Blender/After Effects/Figma give it: scrub the number.

Both live in the same tiny label/value row of the same shared primitive, so they're specified
and built together to touch that primitive once.

## 2. Feature A — the variable glyph

### 2.1 Visual language
A small **hexagon**, echoing Figma's variable glyph. Deliberately **neutral white-opacity —
never pastel, never purple** (pastel marks AI affordances in this app; a variable is not AI).
- **Outline hexagon = "can become a variable."**
- **Filled hexagon = "is a variable."**

### 2.2 Discoverability
**Hover-reveal.** Idle controls show nothing (no clutter across dozens of sliders). The outline
hexagon fades in (`opacity 0→~0.75`) when the control's row is hovered. **Filled hexagons are
always visible** — they're state, not an affordance. This answers "hidden" without permanent noise.

### 2.3 Placement, by field shape
- **Boxed inputs** (Smart Layout inspector region/position fields; select/color boxes): the
  hexagon sits **inside the input's right edge** — literal Figma placement.
- **Rail sliders / label-row controls** (most studio controls): the hexagon sits at the **end of
  the label/value row**, where today's post-bind chip already lives. One consistent "variable
  handle" per control either way.

### 2.4 Behavior
- **One click on an outline hexagon promotes immediately** — dispatches the *existing* promote
  path (`comfynext:promoteControl` for studios, `comfynext:promoteLayoutElement` for Smart
  Layout). Zero new binding logic; this is a discoverability skin over the finished system.
- **Right-click** (kept everywhere) opens the existing menu: bind to an existing column / manage.
- **Bound state:** the hexagon fills; **the control's value readout shows the column name** (see
  the mockup — a bound "Blur" reads `blur`). This lets us **retire the separate name-pill chip**
  (`BindableControlChip`), so there's one affordance, not two. Click/right-click the filled
  hexagon → go to collection / unbind (existing menu).

### 2.5 Component
`VariableGlyph.vue` — presentational only. Props `{ bound: boolean; columnKey: string | null }`,
emits `promote` (click when unbound) and `menu` (click when bound; contextmenu always). The parent
owns hover-reveal state and forwards `promote`/`menu` to the existing handlers. Mirrors how
`BindableControlChip` forwards today.

### 2.6 Integration points
- The four shared studio primitives — `StudioSlider`, `StudioColor`, `StudioSelect`,
  `StudioSegmented` — driven by the surface's `boundColumnFor(key)` + promote/menu handlers. One
  integration covers every Type Studio control.
- `BindableRow` (Gradient / Shader / Texture inline controls) — replaces the chip it renders today.
- Smart Layout inspector boxed fields (`GridPropertyPanel`) — inside-the-edge placement.

## 3. Feature B — the scrubbable slider

The shape barely changes; the interaction is the upgrade.

### 3.1 Scrub the numeric readout
Pointer-drag the value readout left/right to change it. Mapping: `value = startValue +
deltaPx * (range / SCRUB_PX)` where `SCRUB_PX ≈ 260` (full range over ~260px of drag),
snapped to `step`, clamped to `[min, max]`. **Hold Shift → fine** (delta × ~0.15). Cursor
`ew-resize`; a subtle dotted underline marks the number as draggable.

### 3.2 Track jump/drag
Click or drag anywhere on the track sets the value at that position. (Rail sliders using native
`<input type=range>` already get click-on-track; the custom rail — if any — replicates it.)

### 3.3 Bipolar center-fill
When `min < 0 < max`, the fill grows from a **center origin line** toward the value (right for
positive, left for negative) instead of from the left edge — signed params read correctly at a
glance. Visual only; no value-model change.

### 3.4 Double-click reset
Preserved via the existing `v-studio-reset` directive.

### 3.5 Boxed-scrub variant
The Smart Layout inspector's numeric region/position fields (boxed, no rail) get the **same scrub**
on their number — this is where scrub matters most for precise placement, and where the glyph
already lands (§2.3). Included in v1 (open question §8).

### 3.6 Accessibility
Scrub is **purely additive** — pointer-only. Keyboard users keep native range arrows (rail) and
direct type-in (boxed fields); typing a value is never removed. No a11y regression.

### 3.7 Mechanism
A pure helper `scrubValue({ startValue, deltaPx, min, max, step, scrubPx, fine }): number`
(TDD-tested: px→value, step snap, shift-fine, clamp) plus a thin **`v-scrub` directive** (mirrors
the existing `v-studio-reset` directive) that any numeric readout attaches — used by `StudioSlider`
*and* the Smart Layout boxed fields. Bipolar fill % is a second pure helper (`fillGeometry`).

## 4. The intersection (glyph + scrub in one row)

Both occupy the value/label row. Coherence rule: **a bound control is not scrubbable** — its value
comes from the collection, so the readout shows the *column name* (not a draggable number) and the
`v-scrub` handle is inert while bound. Unbind → the number and its scrub return. This is why the two
features ship in the same slice for `StudioSlider`: the readout is simultaneously the scrub target,
the bound-name display, and the glyph's neighbor.

## 5. Architecture summary

```
VariableGlyph.vue        presentational hexagon (outline/filled), emits promote|menu
useScrub / v-scrub       directive over a numeric readout → drag-to-scrub
lib: scrubValue()        pure px→value (snap, fine, clamp) — unit-tested
lib: fillGeometry()      pure bipolar fill origin/width — unit-tested
StudioSlider.vue         + glyph slot + v-scrub on readout + bipolar fill + bound-name display
StudioColor/Select/Segmented.vue   + glyph slot
BindableRow.vue          glyph replaces the name chip
GridPropertyPanel.vue    boxed fields: inside-edge glyph + v-scrub
```

No change to the binding data model, promote events, resolve/preview, or batch paths.

## 6. Phasing (slices)

1. **Glyph component + scrub core.** `VariableGlyph.vue`, `scrubValue`/`fillGeometry` pure libs
   (TDD), `v-scrub` directive.
2. **StudioSlider** gets both — glyph, scrub, bipolar fill, bound-name display. Wire into
   Type Studio (its surface passes bound state + handlers). Retire the chip there.
3. **StudioColor / Select / Segmented** get the glyph.
4. **BindableRow** (Gradient / Shader / Texture) — glyph replaces its chip.
5. **Smart Layout inspector** — inside-edge glyph + boxed scrub on numeric fields.
6. **Browser verification** — hover-reveal, one-click promote, scrub feel (shift-fine, bipolar),
   bound-name display, no a11y regression; screenshots.

## 7. Testing

- **Pure units:** `scrubValue` (px mapping, step snap, shift-fine factor, clamp at both ends);
  `fillGeometry` (left-origin vs center-origin %, negative values). Both mirror the collection
  libs' vitest style.
- **Component/behavior:** the glyph's promote-vs-menu emit by bound state; the bound-control
  scrub-disabled rule.
- **Visual sign-off (required):** the feel is the point — verified in-app via screenshots per the
  project rule that visual output never ships on unit tests alone.

## 8. Open questions (decisions made; overrule freely)

1. **Boxed-scrub in v1?** Included (Smart Layout numeric fields). Could defer to keep slice 5 to
   just the glyph. — I default *in*, since the glyph already touches those fields.
2. **`SCRUB_PX` (drag distance for full range):** 260px default; per-control override for
   very large ranges (e.g. a 0–2000 field) so it isn't hyper-sensitive — a `scrubPx` prop.
3. **Bound value readout:** show the column *name* (mockup) vs the resolved *value*. I chose the
   name (it tells you *which* variable at a glance; the value is visible on the canvas/preview).
4. **Retire `BindableControlChip` entirely** vs keep it as a fallback. I default retire (one
   affordance) — the glyph + tooltip + bound-name readout replace it.

## 9. Out of scope

- Number field free-typing redesign (existing type-in stays as-is).
- Curve/keyframe editors (Toolcraft-adjacent, not this round).
- Adopting `@pixel-point/toolcraft` — it's a React kit; incompatible with the Vue app. Reference only.
- Any change to studio *value models*, binding resolution, or batch rendering.
