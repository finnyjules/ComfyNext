# Compositor: paste an image + copy a wired image into the frame

**Date:** 2026-07-24
**Status:** Approved design
**Builds on:** the Compositor's local-layer add paths (`addImageFromFile` via drag-drop / Add-image / brand picker), the wired-image model (`layers` computed, `sailor_hiddenWired`, `sailor_stackOrder`), the wired visibility mask (`WiredTreatment.maskUrl`, shipped 2026-07-23), and `wiredCutoutPlacement` in `frontend/app/lib/compositor/smartSelect.ts`.

## Problem

Two gaps in getting images *into* a frame and making them editable there:

1. **No paste.** An image on the clipboard (a screenshot, a copied image) cannot be pasted into an open Compositor. The only direct-add paths are drag-drop, the Add-image button, and the brand picker. Worse, `VueNodeCanvas` has a global window `paste` listener that turns a clipboard image into a standalone **Image node on the graph** — so pressing Cmd+V with the modal open produces a stray node instead of a layer.

2. **Wired images are second-class and permanently tethered.** An image wired through the Compositor's ports renders in the frame but stays dependent on that connection, and several features remain local-only (notably Generate fill). There is no way to say "make this image part of the frame" — to bake the wired image into a local layer that survives unplugging the wire and supports every local-layer feature.

## Approach

Two independent, small features sharing existing machinery. Neither introduces a new persistence primitive.

- **Paste** reuses `addImageFromFile` — the identical path drag-drop already uses — so upload, layer creation, history and selection behave exactly like an existing add.
- **Copy into frame** bakes what the user currently sees into a normal local image layer, placed with the already-unit-tested `wiredCutoutPlacement`, then hides the now-redundant wired slot.

Rejected for copy-into-frame: rendering the wired layer to a full-artboard-sized PNG. It would reproduce cloner stamps, but the result is a frame-sized raster that can't be moved or scaled as an image — the opposite of the goal (a normal, editable image layer).

---

## Feature A: Paste an image into the Compositor

### Behavior
With the Compositor modal open, Cmd/Ctrl+V with an image on the clipboard adds it as a local image layer, centered on the artboard (identical to drag-drop, which also ignores the drop point today), selected, and recorded in history.

### Listener + precedence
Register in the modal's existing `onMounted` / `onUnmounted`:

```ts
window.addEventListener('paste', onModalPaste, true)   // CAPTURE phase
```

Capture phase is load-bearing: `VueNodeCanvas` registers its global `handlePaste` on `window` in the bubble phase (`VueNodeCanvas.vue:4571`). A same-target bubble listener cannot be pre-empted by another bubble listener registered later, so the modal must listen in capture, which runs first. When the modal consumes an image it calls **`e.preventDefault()` + `e.stopImmediatePropagation()`** so the node-canvas handler never runs and no stray Image node is created.

### Guards (mirror `VueNodeCanvas.handlePaste`)
Do nothing (and do **not** preventDefault) when:
- `e.target` or `document.activeElement` is/among `input, textarea, select, [contenteditable]` — so pasting text into the agent prompt bar, a layer-rename field, or a text layer keeps working.
- The clipboard holds no image. Normal paste (including in-app node paste) proceeds untouched.

### Extraction
Same two-source read as the node canvas: `clipboardData.items` entries with `kind === 'file' && type.startsWith('image/')` (covers screenshots and copied images), falling back to `clipboardData.files[0]` when it is an image. Then `await addImageFromFile(file)`.

Out of scope: pasting SVG markup as editable paths, and pasting image URLs. Images only.

---

## Feature B: Copy a wired image into the frame

### Entry point
A hover-revealed button on the **wired layer's row** in the Layers panel, beside the existing Lock and Hide buttons (wired rows have no delete, so this is the row's only content-affecting action). Icon: `Copy` (lucide). Title: **"Copy into frame — bakes a local copy and hides the wired layer (not undoable; use Show to restore)"**. `data-testid="wired-copy-into-frame"`.

### What gets copied ("what you see")
1. Read the slot's decoded element from `wiredImageEls[slot]` (an `HTMLImageElement`, or a `HTMLCanvasElement` for a live studio slot). If absent, toast and abort.
2. Draw it at its **native** dimensions (`naturalWidth/Height`, or `width/height` for a canvas) into an offscreen canvas — native, not capped, since this is a straight copy and fidelity matters.
3. If the slot has a `maskUrl` treatment, apply it `destination-out` over the copy at the same native dims — the same operation and polarity `drawWiredImageLayer` uses, so painted/smart-selected hiding is baked in.
4. `toDataURL('image/png')` → `inpaint.uploadDataUrl(dataUrl, 'framecopy')` → filename. Wrap the pixel read in try/catch: on failure (tainted canvas), toast and abort with no partial state.

### Placement (must look identical)
Build the local layer via `addImageFromName(name, aspect, partial)` where `partial` comes from `wiredCutoutPlacement(fullBbox, wiredTransform, iw, ih, capW, capH, W, H)` with `fullBbox = {minX:0, minY:0, maxX: iw-1, maxY: ih-1}` and `capW/capH = iw/ih` (the copy is at native dims). This function's existing unit test asserts precisely this case: a full-image bbox reproduces the wired image's own on-artboard position, size and rotation.

Additionally carry over, so appearance is unchanged:
- `opacity` and `blend` from the wired layer.
- `maskedByKey` / `maskShowSource` from the slot's treatment, if set (locals support `maskedByKey`), so a wired image clipped by another layer's silhouette stays clipped. Not baked into pixels — carried as the same treatment.

### Z-order
Insert the new key `l:<newId>` into `sailor_stackOrder` **immediately after `w:<slot>`** (the array is stored bottom→top, so "after" = directly above the wired slot it replaces). Without this the copy would jump to the top of the stack and change the composite.

### Wired slot fate
Set (not toggle) the slot in `sailor_hiddenWired` so the frame shows one image, not two. The wire remains in the graph and is harmless; unplugging it later changes nothing visually, which is the point of the feature. Unhiding the row restores the live wired version at any time.

### Stale-flag cleanup (the trap fix)
`sailor_hiddenWired` / `sailor_lockedWired` are bare slot-number arrays that are **never pruned**. Today, hiding a slot and then unplugging its wire leaves a stale entry, so wiring a *different* image into that same port later renders it **invisible** with no visible cause.

Fix: prune entries for slots that currently have no wired source. This is safe because `layers` is derived purely from **edges** (`resolveWiredSourceKind` over `props.nodes`/`props.edges`), not from image-load state — a slot is present iff a wire exists, so there is no transient window in which a legitimately hidden slot looks absent. A newly wired image is therefore always visible by default. Run the prune where the modal already reconciles wired state (on the `layers` change) and write only when something actually changes, to avoid redundant node writes.

### Cloner limitation
A wired slot may carry a `cloner` (repeating stamps) — wired-only editor state with no local-layer equivalent. The copy reproduces the **base stamp only**. When copying a slot with an active cloner, show a toast: "Copied the base image — cloner repeats aren't carried over." Do not silently drop it.

## Error handling

- Missing/undecoded wired element → toast, abort, no layer added.
- Pixel read fails (tainted canvas) → toast, abort, no partial state.
- Upload fails → toast, abort; the wired slot is **not** hidden (hide only after the layer is successfully added, so a failure never leaves an empty frame).
- Paste with no clipboard image → no-op, event untouched.

## Undo

- The copied layer is added via the local editor, so Cmd+Z removes it.
- The `sailor_hiddenWired` write is a node property and is **not** in the undo history — the same pre-existing gap as every wired treatment (`maskedByKey`, `maskUrl`). So undo immediately after a copy removes the layer and leaves the slot hidden, i.e. that image disappears. Recovery is the row's **Show** toggle. This is stated in the button's tooltip rather than hidden.

## Testing

- **Unit:** stale-flag pruning (entries for wire-less slots dropped; entries for live slots kept; no write when nothing changes). Z-insert (a new local key lands directly above its wired key in a bottom→top order array; unrelated order preserved). Both are pure array logic and belong in a helper module so they are testable in the vitest node env.
- **Existing coverage relied on:** `wiredCutoutPlacement`'s full-bbox identity test already pins the placement math.
- **E2E (running app):** paste a screenshot into an open Compositor → one image layer appears, **no** stray Image node on the graph; paste into the prompt bar still types text. With a wired image: Copy into frame → the composite looks unchanged, the new local layer sits at the same z, the wired row is hidden; unplug the wire → the copy survives; wire a different image into that port → it is visible (not silently hidden). Copy a masked wired image → the mask is baked into the copy.

## Out of scope (follow-ups)

- A bulk "copy all wired layers into the frame" action.
- Reproducing cloner repeats in the copy.
- Pasting SVG markup or image URLs.
- Putting wired treatments / hidden flags into the undo history (pre-existing gap, affects several features).
