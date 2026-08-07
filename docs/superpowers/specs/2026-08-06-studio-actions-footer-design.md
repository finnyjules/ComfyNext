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
2. **Download** (grey secondary): the studio's file outputs — one plain button when
   there's a single format, a `Download ▾` menu when there are several.
3. **Add to canvas** (blue primary, far right): the one universal deliverable, named
   the same everywhere. A plain button for static studios, an `Add to canvas ▾`
   (*As image · As video*, plus *Send to timeline* where supported) for animated ones.

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
  // ── zone ② downloads (grey secondary; plain button if length 1, ▾ if >1) ──
  downloads?: StudioFooterAction[]
  // ── zone ③ add-to-canvas (blue primary; plain if length 1, ▾ if >1) ──
  canvas?: StudioFooterAction[]
}

interface StudioFooterAction {
  label: string
  onClick: () => void
  disabled?: boolean
  busy?: boolean               // shows a spinner / busy label on the trigger
  icon?: Component             // optional leading icon (e.g. Dices for Roll)
}
```

The component owns:
- **Layout**: `status + utilities` left, a `flex-1` spacer, then `downloads` then
  `canvas` docked right. Reuses the existing `StudioModalShell` `#actions` footer row
  (full-width, hairline-topped) — no new chrome.
- **Button-or-menu collapse**: an array of length 1 renders as a single button
  (labelled with that one action's `label`); length ≥ 2 renders a `▾` trigger
  (`Download ▾` / `Add to canvas ▾`) opening an upward menu (`absolute bottom-full
  right-0`, matching Space Type's current render menu).
- **Styling**: `canvas` uses `StudioButton variant="primary"` (blue); `downloads`
  uses `variant="secondary"`; `utilities` use `variant="subtle"`. Menus reuse the
  existing dark-panel menu styling already in Space Type.
- **Busy/disabled**: a `busy` action shows a spinner + optional busy label and is
  disabled; menu triggers disable while any of their actions is busy.

### Escape hatch

Space Type's *As video* item carries a **transparent-background** checkbox + Safari
warning that modifies the export. The component exposes a named slot keyed to a menu
item (e.g. `#canvas-menu-extra`) so Space Type can render that sub-option under its
*As video* row. No other studio uses it.

## Per-studio footer contents

| Studio | ① utilities | ② downloads | ③ canvas |
|---|---|---|---|
| Space Type | — | Embed | As image · As video · Send to timeline |
| Scene3D | — | Video (mp4) | As image · As video |
| Texture | Roll | PNG | Add to canvas (image) |
| Gradient | Copy config | Embed | As image · As video |
| Shader | — | Embed | As image · As video |
| Shape | Import · Export settings | PNG | Add to canvas (image) ← **new** |
| Vector | Play/Pause · Import · Export settings | PNG · SVG | As image · As video ← **new** |

### The one behaviour addition: Shape & Vector gain canvas output

Both already render a blob for their PNG/SVG download. Adding "Add to canvas" reuses
that blob through the same `uploadFrameBatch` path the other five studios use — a
small, well-trodden wiring, not new rendering. Vector is animated (it has Play/Pause
and motion presets), so it gets the *As image · As video* menu; Shape is static, so a
plain button. Everything else in this change is relabel + reorganize.

## Wording (fixed vocabulary)

- Canvas: **Add to canvas** (static) / **Add to canvas ▾** → **As image**, **As video**,
  **Send to timeline**. Retires *Render*, *Export to Canvas*, *Send to canvas*,
  *Generate as image/video*.
- Download: **Download PNG** / **Download SVG** / **Download video** / **Export embed**,
  or **Download ▾** when there are ≥ 2. ("Export embed" keeps its name — it produces a
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

- **Unit**: the button-or-menu collapse logic and zone assembly are pure enough to
  test in isolation if extracted to a helper (`length 1 → button`, `≥2 → menu`,
  `busy disables trigger`, error-wins-over-saved status precedence).
- **Live**: drive the real app — open each of the 7 studios, confirm the footer shows
  the right zones, that `Add to canvas` actually drops an artifact (assert the upload
  ran / a node appeared, not just that a button exists), that Download produces the
  file, and that the Saved ✓ indicator reflects a real edit. Verify Shape & Vector's
  new canvas path end-to-end. Reverting a wiring under HMR to reproduce a failure is
  the standard here — a button that *looks* right proves nothing.

## Rollout

1. Build `StudioActionsFooter` + the pure collapse/zone helper (+ unit tests).
2. Convert one studio as the reference (Vector Type — it has the most zones: utilities,
   a 2-item download menu, and the new canvas menu), verify live.
3. Sweep the remaining six, each verified live.
4. Remove the now-dead Save handlers' button wiring (keep the auto-save).
