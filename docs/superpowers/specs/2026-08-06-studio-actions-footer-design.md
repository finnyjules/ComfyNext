# Studio actions footer — one consistent bottom bar for every studio

*Design · 2026-08-06*

## Plain-language summary

Every studio modal (Space Type, Scene3D, Texture, Gradient, Shader, Shape, Vector
Type) has a row of action buttons at the bottom. Right now each one does its own
thing: some have a Save button, most don't; the single most important action —
"put the result on the canvas" — is called five different names (*Render*, *Export
to Canvas*, *Send to canvas*, *Generate as image*), and two studios (Shape, Vector)
can't put anything on the canvas at all even though they sit on one. This makes the
footer feel like seven different apps.

This change gives every studio the **same footer**, built from one shared component,
laid out in three zones left→right:

1. **Status + utilities** (quiet, left): an auto-save indicator, then studio-specific
   helpers (Roll, Import/Export settings, Copy config, Play/Pause).
2. **Download ▾** (grey secondary): a menu button whose submenu lists the studio's file
   outputs (PNG · SVG · Export embed).
3. **Render on canvas ▾** (blue primary, far right): a menu button whose submenu lists
   the studio's canvas outputs (*As image · As video · Send to timeline*).

The two right-hand buttons are **always the same two buttons**, each opening its own
submenu — no per-studio collapsing between button and menu. It reuses Space Type's
"Render" verb, which was the good one; the fix was that it had been applied
inconsistently (five names for the same act) — now every studio renders to the canvas
through the same button. Submenus list only outputs the studio **already produces** —
this change invents no new render path (the sole exception is Shape/Vector gaining *As
image*, reusing the blob they already render for their PNG download). A zone with no
outputs simply omits its button (e.g. Scene3D has no file download).

The explicit **Save** button is removed everywhere (all studios already auto-save;
it was reassurance in 2 of 7). A quiet `Saving… / Saved ✓ / ⚠ error` indicator takes
its place in the left zone.

## Why

Two facts discovered while surveying the seven footers:

- **Every studio already persists its config automatically** — Space Type via a
  continuous `watch`, Scene3D dirty-tracked, and Texture/Gradient/Shader/Shape/Vector
  all save-on-close (`saveParams` / `saveConfig` / `closeEditor`). The explicit "Save"
  button in Space Type + Scene3D guards nothing the auto-save doesn't already cover.
- **"Put the rendered result on the canvas" is the one universal deliverable**, and
  it is literally the same operation everywhere: render a blob locally, `uploadFrameBatch`
  it, drop an artifact on the canvas. Confirmed identical in `generateImage`
  (Gradient), `sendToCanvas` (Texture), `exportToCanvas` (Scene3D). No paid model
  calls. The five different verbs are five costumes on one action.

## Current state (the mess)

| Studio | Save? | "put on canvas" verb | file downloads | utilities |
|---|---|---|---|---|
| Space Type | Save | **Render ▾** (image/video/timeline) | Export embed (in menu) | — |
| Scene3D | Save | **Export to Canvas** | — (mp4 via bake) | — |
| Texture | — | **Send to canvas** | Download PNG | Roll |
| Gradient | — | **Generate as image / video** | Export embed | Copy config |
| Shader | — | **Generate as image / video** | Export embed | — |
| Shape | — | — *(none)* | **Export PNG** (a download) | Import/Export settings |
| Vector | — | — *(none)* | **Export PNG / SVG** (downloads) | Play, Import/Export settings |

## Target: `StudioActionsFooter`

A single shared component, fed a declarative spec by each studio and rendering the
three zones + all button-or-menu logic itself. Same factory pattern as `StudioButton`
and `StudioRow`: consistency is guaranteed by structure, not discipline, and a future
studio gets the footer for free.

### The spec a studio passes

```ts
interface StudioFooterSpec {
  // ── zone ① status ──
  status?: {
    saving?: boolean          // → "Saving…"
    saved?: boolean           // → "Saved ✓" (emerald)
    error?: string | null     // → "⚠ {error}" (red), wins over saved/saving
  }
  // ── zone ① utilities (quiet, subtle buttons; left, after status) ──
  utilities?: StudioFooterAction[]
  // ── zone ② downloads → "Download ▾" menu button (omitted if empty) ──
  downloads?: StudioFooterAction[]
  // ── zone ③ canvas → "Render on canvas ▾" menu button (omitted if empty) ──
  canvas?: StudioFooterAction[]
}

interface StudioFooterAction {
  label: string
  onClick: () => void
  disabled?: boolean
  busy?: boolean               // shows a spinner / busy label on the trigger
  icon?: Component             // optional leading icon (e.g. Dices for Roll)
  subtitle?: string            // small dim second line, menu items only (e.g. a caveat)
}
```

The component owns:
- **Layout**: `status + utilities` left, a `flex-1` spacer, then `downloads` then
  `canvas` docked right. Reuses the existing `StudioModalShell` `#actions` footer row
  (full-width, hairline-topped) — no new chrome.
- **Two menu buttons**: `downloads` renders a `Download ▾` trigger, `canvas` a `Render
  on canvas ▾` trigger, each opening an upward menu (`absolute bottom-full right-0`,
  matching Space Type's current render menu) that lists its actions. Always a menu, even
  for a single item — the two buttons stay structurally identical across every studio. A
  zone with no actions omits its button entirely.
- **Styling**: the `Render on canvas ▾` trigger uses `StudioButton variant="primary"`
  (blue); `Download ▾` uses `variant="secondary"`; `utilities` use `variant="subtle"`.
  Menus reuse the existing dark-panel menu styling already in Space Type.
- **Busy/disabled**: a `busy` action shows a spinner + optional busy label on its menu
  row; a trigger disables while any of its actions is busy.

### Space Type's transparency — an action, not a checkbox

Today Space Type's render menu has a floating **Transparent background** *checkbox*
wedged between the render items. It reads as wrong because it is state sitting in a
list of actions — every neighbour is a verb, and this one is a form control.

The fix falls straight out of the model: transparency is just a **second video
action**. When the current frame actually has alpha, the canvas zone offers both
**As video** and **As video (transparent)** — the latter carrying the Safari caveat
as its `subtitle` ("WebM with real transparency · Safari can't play it"). When the
frame has no alpha, only plain **As video** shows; the checkbox — and the disabled
"turn on Transparent background in Output" teaching state — are gone. A user who wants
transparency enables it where it's actually configured, in the Output section.

This means **no escape-hatch slot is needed** — the whole thing is expressed in the
declarative `canvas[]` array as a conditional extra item. The component stays purely
data-driven; `StudioActionsFooter` never learns the word "alpha".

## Per-studio footer contents

Each studio shows a `Download ▾` and a `Render on canvas ▾` button (either omitted only
if its list is empty), whose submenu items are:

| Studio | ① utilities | ② Download ▾ | ③ Render on canvas ▾ |
|---|---|---|---|
| Space Type | — | Export embed | As image · As video · As video (transparent)† · Send to timeline |
| Scene3D | — | *(none — button omitted)* | As image |
| Texture | Roll | PNG | As image |
| Gradient | Copy config | Export embed | As image · As video |
| Shader | — | Export embed | As image · As video |
| Shape | Import · Export settings | PNG | As image ← **new** |
| Vector | Play/Pause · Import · Export settings | PNG · SVG | As image ← **new** |

### The one behaviour addition: Shape & Vector gain canvas output

Both already render a blob for their PNG/SVG download. Adding an `As image` canvas item
reuses that blob through the same `uploadFrameBatch` path the other five studios use — a
small, well-trodden wiring, not new rendering. Neither bakes a video-to-canvas today, so
their `Render on canvas ▾` lists only *As image* (a possible later follow-up for Vector,
which is animated — it would add an *As video* item, not change the structure). Everything
else in this change is relabel + reorganize.

† **As video (transparent)** is Space Type's alpha export, shown only when the current
frame has alpha (see the transparency section above) — a conditional extra item in the
`canvas[]` array, replacing today's floating checkbox.

## Wording (fixed vocabulary)

- Canvas: **Render on canvas ▾** → **As image**, **As video**, **As video (transparent)**
  (alpha frames only), **Send to timeline**. Retires *Add to canvas*, *Export to Canvas*,
  *Send to canvas*, *Generate as image/video*, and the floating *Transparent background*
  checkbox — "Render" is now the one consistent canvas verb.
- Download: **Download ▾** → **PNG**, **SVG**, **Export embed** (the formats studios
  actually produce today). ("Export embed" keeps its name inside the menu — it produces a
  self-contained web snippet, conceptually distinct from a media file.)
- Utilities keep their names: **Roll**, **Import settings**, **Export settings**,
  **Copy config**, **Play/Pause**.
- Status: **Saving…** / **Saved ✓** / **⚠ {error}**.

## Non-goals

- No change to *what* any studio renders or to the render/bake pipelines.
- No change to auto-save behaviour (only the redundant Save *button* is removed).
- No new download formats beyond what each studio already produces (plus the two new
  canvas paths for Shape/Vector).
- Not touching the node-card / non-modal surfaces; this is the studio modal footer only.

## Testing / verification

No component-test framework here by design (per the studio-control-row precedent), so:

- **Unit**: the zone assembly is pure enough to test in isolation if extracted to a
  helper (empty zone omits its button, `busy` disables its trigger, error-wins-over-
  saved status precedence).
- **Live**: drive the real app — open each of the 7 studios, confirm the footer shows a
  `Download ▾` and `Render on canvas ▾` (either omitted only when empty), that a `Render
  on canvas` submenu item actually drops an artifact (assert the upload ran / a node
  appeared, not just that a button exists), that a Download item produces the file, and
  that the Saved ✓ indicator reflects a real edit. Verify Shape & Vector's new canvas
  path end-to-end. Reverting a wiring under HMR to reproduce a failure is the standard
  here — a button that *looks* right proves nothing.

## Rollout

1. Build `StudioActionsFooter` + the pure zone-assembly helper (+ unit tests).
2. Convert one studio as the reference (Space Type — it exercises the most: a `Download ▾`,
   the full `Render on canvas ▾` menu with the transparency item, and the removed Save),
   verify live.
3. Sweep the remaining six, each verified live — including Shape & Vector's new canvas
   item end-to-end.
4. Remove the now-dead Save handlers' button wiring (keep the auto-save).
