# Studio control rebuild — design

Date: 2026-08-04
Status: approved, not yet planned
Prompted by: DialKit (https://joshpuckett.me/dialkit), whose panel is denser and more
capable per control than ours.

## In plain terms

Every knob and slider in Sailor is drawn as two stacked lines: a name with a number
above, a thin rail below. That is roughly 62 pixels per setting, and there is no way
to type an exact number anywhere in the app — you can only drag.

This replaces that with a single compact row. The row itself is the slider: name on
the left, value on the right, and the row fills up as the value rises. One row, 28
pixels, and the same shape whether it holds a slider, a colour, a dropdown or a
switch. Click the number to type an exact value. Double-click to go back to the
default. Drag anywhere on the row to change it.

Four new kinds of control come with it: a **button** (for reset/shuffle/randomise,
which are hand-written in every studio today), a **dial** for rotation settings, a
**spring** editor for motion, and an **XY pad** for settings that come in pairs. The
pad gets built but deliberately stays switched off until the agent and motion layers
understand two-value controls.

Then the new row is swept across every panel in the app — the studios, the
Compositor, the widgets, Smart Layout.

## Why now

`ControlSpec` is already the source of truth for three consumers — the inspector, the
agent's vocabulary, and motion's animatable targets. The row is the one part of that
chain that never got the same treatment: 167 `<input type="range">` elements are
hand-written across 35 files, 57 of them in Gradient Studio alone. Improving the row
once therefore improves every studio at once, and the improvement is blocked on
nothing.

## Decisions locked in brainstorming

| Question | Decision |
| --- | --- |
| Scope | Full sweep, every surface — not just the schema-driven studios |
| Mechanism | Component swap per row; **not** a schema migration |
| Row design | Row-as-track: the row *is* the control, all kinds share the shape |
| Extra capabilities | Typed value entry, nested folders, copy-values-as-JSON |
| Dropped | Version snapshots, per-control keyboard shortcuts |
| New kinds | `action`, `angle`, `spring`, plus `xy` built but not applied |
| Structure | One row component, two entry points, one render path |

## Architecture

### `StudioRow.vue` (new)

Owns the 28px shell and nothing kind-specific:

- label, optional hint tooltip
- the fill layer behind the row
- a slot for the kind's value renderer
- the `VariableGlyph` and the right-click bind menu
- drag-to-change, click-to-position, double-click-to-reset
- typed value entry

### `lib/studio/row.ts` (new)

The pure, testable half. No DOM:

- `fillFraction(value, min, max)` — including the centre-origin case
- `isBipolar(min, max)` — `min < 0 && max > 0`
- `formatValue(value, step)` — decimal places derived from `step`
- `parseTyped(input, spec)` — what a typed string resolves to, or rejection
- `resetValue(spec)` — the declared `default`, else the existing heuristic

`isBipolar` is used by **both** the fill origin and the reset target, so a bipolar
slider's fill origin and its double-click destination cannot disagree. That heuristic
currently lives inline in `plugins/studio-reset.client.ts` with no test on it.

### Kind renderers

A `kind → component` registry. Each renderer draws only the value side of the row.
Adding a kind is one small component plus one registry line.

Existing kinds: `slider`, `switch`, `text`, `textList`, `fillList`, `gradientStops`,
`color`, `select`, `font`, `path`, `curve`.
New kinds: `action`, `angle`, `spring`, `xy`.

### Two entry points, one render path

- `StudioControlPanel.vue` maps a `ControlSpec[]` to rows, as today.
- `StudioSlider` / `StudioSelect` / `StudioColor` / `StudioSwitch` keep their current
  prop APIs but become thin adapters: each builds a one-element `ControlSpec`
  internally and hands it to `StudioRow`.

Two consequences. The 88 existing `<StudioSlider>` call sites need no edits. And
converting a surface to schema-driven *later* becomes deleting wrapper calls rather
than rewriting rows — so the schema-first end state stays reachable incrementally
instead of being a prerequisite.

### Expandable rows

`spring`, `xy`, `curve`, `path`, `gradientStops` and `fillList` cannot fit in 28px.
Those render the row as a header that expands to a body beneath it, so the uniform
row shape survives the complex kinds rather than being abandoned for them.

## Interactions

| Gesture | Result |
| --- | --- |
| Drag on the row | Change the value. Shift = fine (existing `scrubValue`, 0.15 factor) |
| Click on the bar | Jump the value to that position. A click is a press-and-release with no movement, so it never competes with a drag |
| Click the number | Becomes an editable field; Enter commits, Escape reverts |
| Double-click the row | Back to the default |
| Right-click | The existing promote/bind/unbind menu |

Rubber-band overflow past the ends (DialKit has it) is **excluded** — it fights the
clamp and adds state for a purely cosmetic flourish.

## New kinds in detail

### `action`

A row that is a button, with an `onAction` callback. Replaces the hand-written
reset / shuffle / randomise / preset buttons scattered through the studios.

Declaring an action does **not** by itself let the agent press it: the agent applies
parameter *values*, and a button is not a value. Agent-invocable actions are a
follow-on, explicitly out of scope here.

### `angle`

A small dial at the right of the row with a needle; drag around it to rotate, shift
snaps to 15°. Dragging the row still scrubs linearly. Nineteen rotation parameters
currently run 0–360 on a linear rail — 11 declared in schema files, 8 hand-written in
markup.

### `spring`

Stored as a JSON string exactly as `curve` already is — either
`{ visualDuration, bounce }` or `{ stiffness, damping, mass }`. The expanded body
shows a live curve preview.

A spring describes the *shape* of a movement, but baking a video asks "where is this
at frame 37", so it needs a length to sample against. It takes that from the clip it
animates, like every other motion target.

### `xy`

One pad driving two keys. Built and available, applied nowhere — by explicit
instruction.

The reason that is the right call: every other control owns exactly one key, and both
the agent layer and the motion layer rely on that. A pad owns two. Those layers need
teaching before any parameter pair moves onto it, and that teaching is a separate
piece of design. The eventual prize is 22 `X`/`Y` pairs in the schema files alone —
`Center X/Y`, `Offset X/Y`, `Light angle X/Y`, `Scene rotate X/Y` and the rest — which
is 44 rows collapsing to 22.

## Colour

`StudioColor` is better than DialKit's equivalent (which is a hex field plus the OS
picker) and does not change: saturation pad, hue bar, alpha over a checkerboard,
screen eyedropper, hex / RGB / OKLCH entry. Only its *placement* changes — hex text
then swatch on the right of the row. The swatch is already 28px.

All eight studios already use it. Around 30 places still use the browser's native
colour box — Compositor toolbars, Smart Layout panels, widgets, the timeline, the
brand palette — and the sweep replaces those.

**The alpha trap.** A native colour input cannot express transparency; `StudioColor`
can, and emits 8-digit `#rrggbbaa` the moment alpha drops below 1. A meaningful amount
of our code treats 8 digits as invalid and substitutes black or the default —
`lib/shaderfx/params.ts` already carries a deliberately widened `isParamHex` to
survive exactly this, and nothing else does.

So the `color` control gains an `alpha` flag defaulting to **off**, enabled per
control only where the receiving code has been checked. Without this the sweep
introduces a silent colour-turns-black bug in thirty places at once.

## Sections

`groupIntoSections` is flat: one group string, one section. It extends to treat
`'Canvas/Shadow'` as a path and build a tree. Additive — an order array with no
slashes behaves exactly as it does now.

## Copy values

A button in the panel header copies the current parameter set to the clipboard as
JSON. No persistence implications.

## The sweep

Build the row and the kinds first, proving them on the four already schema-driven
surfaces (Texture, Shape, Vector Type, ShaderFill) — they need no migration, they
simply start looking different.

Then surface by surface, largest first:

| Surface | Raw range inputs |
| --- | --- |
| `GradientStudioSurface.vue` | 57 |
| `CompositorModal.vue` | 17 |
| `SpaceTypeSurface.vue` | 12 |
| `ShaderStudioSurface.vue` | 12 |
| `WidgetTextOnPath.vue` | 11 |
| `compositor/CompositorClonerPanel.vue` | 11 |
| `templates/SectionInspector.vue` | 6 |
| remainder (28 files) | ≤3 each |

167 total across 35 files, plus 30 native colour inputs.

Gradient gets a bonus: each of its rows is wrapped in a `BindableRow`, which exists
only because there was no single row to put the bind glyph into. There is now, so that
wrapper and its extra half-row of vertical space disappear as Gradient is swept.

## Behaviour changes to expect

1. **Double-click reset gets more correct.** Today the rule is `data-default`, else 0
   when the slider crosses zero, else the minimum — and many hand-written rows never
   set `data-default`, so they currently snap to their minimum rather than to their
   real default. Rows with a spec will snap to the declared default. Rows swapped in
   without a spec and without a default keep the old rule exactly.
2. **Double-click reset spreads.** It is a directive on range inputs today, so only
   sliders have it. In the row, every kind gets it.
3. **Colours in non-studio panels gain a real picker**, with alpha off by default per
   the trap above.

## Out of scope

- Version snapshots and per-control keyboard shortcuts
- Agent-invocable actions
- Applying `xy` to any existing parameter pair
- Migrating any surface to a `ControlSpec` (component swap only)

## Testing

Unit tests cover `lib/studio/row.ts` — fill fraction, the bipolar predicate, value
formatting, parsing typed input, and reset selection — plus the nested-section tree
built by `groupIntoSections`.

Unit tests cannot prove the sweep. Whether a swept row still writes to the right
parameter is precisely the class of bug that passes a test and fails in the app. Each
swept surface is therefore verified by driving it in the browser and confirming the
render actually changes — not by looking at it and declaring it fine. Where a surface
has a deliberately-broken control available, use it: a control that visibly does
nothing is the only proof the wiring is real.

## Risks

**The wrong-key swap.** 167 mechanical edits across ~10,000 lines of surface code is
where a mistyped parameter key hides: the row looks perfect and silently drives
something else. Mitigated by sweeping surface by surface rather than all at once, so a
mistake is contained to one studio, and by per-row reviewable diffs.

**Two entry points drifting.** Mitigated structurally — the prop-based wrappers build
a `ControlSpec` and render through the same `StudioRow`, so there is one render path,
not two.

**The alpha trap**, above. The `alpha`-off default is the mitigation.
