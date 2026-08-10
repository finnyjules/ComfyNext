# Frame "Add image" can pick an image already on the canvas

**Date:** 2026-08-10
**Status:** Design approved, ready for implementation plan

## Plain-language summary

In the Frame/Compositor, the "Add image" button adds an image *layer* but only
lets you upload a file from disk. There's no way to add an image that's already
on the canvas (a generated result, a wired image, another node's output). This
change makes "Add image" offer both: **upload from computer** *and* **pick an
image that's already on the canvas** — the same canvas-image grid the shape-fill
flow already uses.

## Goals

- Clicking "Add image" opens a small popover with an "Upload from computer"
  option plus a grid of the canvas's images; picking one adds it as a layer.
- Works in **both** places the "Add image" button appears: the full Compositor
  modal and the inline Frame node (feature-parity rule).
- Reuse what exists — the `FillImagePicker` grid and the paste path's URL→File
  logic — rather than inventing new mechanisms.

## Non-goals

- Changing the shape-fill flow (it already has canvas-image picking).
- Live-linking a picked image (it's a **snapshot** — copied to the input dir at
  pick time — matching how shape-fill and paste already behave).
- Brand images (they keep their own separate `BrandImagePicker` button).

## Background — current state (verified)

- **Add image → layer**, upload-only: the "Add image" button calls
  `triggerAddImage()` which clicks a hidden file input; `onAddImageFile` →
  `addImageFromFile(file)` (`useLocalLayerEditor.ts:664`, POSTs to
  `/upload/image`, measures aspect, `addLocal(createImageLayer(name, aspect))`).
  Two instances: `CompositorModal.vue:4177` and `ArtifactFrameNode.vue:978`.
- **Canvas-image grid already exists**: `FillImagePicker.vue`
  (`compositor/FillImagePicker.vue`) injects `vueFlowNodes` and renders a grid of
  every node whose `data.images[0]` is a URL; emits `pick: [src]`. Used today by
  the shape-fill `FillControl`.
- **URL→File already exists** in the paste path: `pastedNodeImageFile()`
  (`CompositorModal.vue:3391`) does `fetch(url)` → blob → `new File(...)` →
  `addImageFromFile`. `imageUrlForNode` (`lib/canvas/nodeImage.ts:28`) resolves a
  node's image URL.

## Design

### 1. Shared URL→File helper — `frontend/app/lib/canvas/imageUrlToFile.ts` (new)

Extract the exact logic already inside `pastedNodeImageFile` into a pure,
testable helper:

```ts
export async function imageUrlToFile(url: string, fallbackName = 'canvas.png'): Promise<File> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`image fetch failed (${res.status})`)
  const blob = await res.blob()
  if (!blob.type.startsWith('image/')) throw new Error(`not an image (${blob.type || 'unknown'})`)
  const name = new URLSearchParams(url.split('?')[1] ?? '').get('filename') || fallbackName
  return new File([blob], name, { type: blob.type })
}
```

Refactor `pastedNodeImageFile` to call `imageUrlToFile(url, 'pasted.png')` (DRY —
same behaviour, proves the shared unit).

### 2. Composable helper — `useLocalLayerEditor.ts` `addImageFromCanvasSrc`

```ts
// Add an image layer from a canvas node's image URL (a snapshot: the URL is
// fetched and uploaded to the input dir, exactly like drag-drop/paste).
async function addImageFromCanvasSrc(src: string) {
  if (!src) return
  await addImageFromFile(await imageUrlToFile(src))
}
```

Export it alongside `addImageFromFile` / `addImageFromName`.

### 3. Shared popover — `frontend/app/components/vue-canvas/compositor/AddImageSourcePopover.vue` (new)

A small popover the two toolbars share. Content only — each surface owns its own
trigger button (they differ in size/style) and toggles `open`.

- Props: `open: boolean`.
- Emits: `upload: []`, `pick: [src: string]`, `close: []`.
- When `open`: an absolute-positioned panel with an "Upload from computer"
  button (emits `upload`) and `<FillImagePicker @pick="s => emit('pick', s)" />`.
  A click-away / Escape closes (emits `close`).
- `FillImagePicker` already handles the empty state ("No images on the canvas
  yet."), so the grid degrades gracefully; the Upload button is always present.

### 4. Wire both toolbars

For each of `CompositorModal.vue` and `ArtifactFrameNode.vue`:
- Add an `addMenuOpen` ref. The existing "Add image" button now toggles
  `addMenuOpen` instead of directly clicking the file input.
- Render `<AddImageSourcePopover :open="addMenuOpen" @upload="onUploadChoice"
  @pick="onPickCanvasImage" @close="addMenuOpen = false" />` next to the button.
- `onUploadChoice` → `addMenuOpen = false` then the existing
  `imageInputRef.click()` (unchanged upload path).
- `onPickCanvasImage(src)` → `addMenuOpen = false` then
  `editor.addImageFromCanvasSrc(src)` (CompositorModal binds the composable at
  its top; ArtifactFrameNode already uses `editor.addImageFromFile`).
- The hidden `<input type="file">` and `onAddImageFile` handler stay exactly as
  they are; `BrandImagePicker` stays a separate button.

## Edge cases

- **Empty canvas**: grid shows its empty state; Upload still works.
- **Picked node image fails to fetch / isn't an image**: `imageUrlToFile`
  throws; the caller wraps in try/catch and logs/toasts like the existing add
  paths do — no layer added.
- **`vueFlowNodes` inject**: available in both surfaces (FillControl already uses
  FillImagePicker inside CompositorModal; ArtifactFrameNode is a canvas node
  under the same provider).

## Testing

- **Unit** (`imageUrlToFile`): with a mocked `fetch` — returns a `File` whose
  name is the URL's `?filename=` value; falls back to the given name when absent;
  throws on non-ok response; throws on non-image blob. (This is the pure,
  testable unit; the composable glue + popover + toolbars are verified live.)
- **Browser-pane** (canvas glue, not unit-testable here): open the Compositor,
  click "Add image", confirm the popover shows the canvas grid + Upload; pick a
  canvas image → a new image layer appears with that image; Upload still adds a
  layer; repeat on the inline Frame node. Screenshot both.
