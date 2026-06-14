# Kinetic Export via Bake — Implementation Plan (Part 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make timeline Motion (kinetic) clips export correctly — today they render in preview but are silently dropped from the rendered video.

**Architecture:** On export, each Motion clip is baked headless to an alpha PNG sequence by the *same* `renderMotionClip` that drives preview (so parity is inherent), uploaded under `input/`, and cached on the clip by a source-key hash. The Python exporter gets a `motion` clip handler that loads frame N as RGBA and composites it through the existing alpha-aware pixel path. The clip stays a Motion clip throughout — the bake is a cache, never a clip-type swap.

**Tech Stack:** Vue 3 / TypeScript (frontend), Vitest (frontend unit), Python + Pillow + NumPy + PyAV (export), Pytest (`tests-unit/comfy_extras_test/`).

**Spec:** `docs/superpowers/specs/2026-06-13-kinetic-export-and-keyframe-lanes-design.md`

**Deviations from spec (discovered during planning, against real code):**
1. **No "sequence asset".** The asset-import route (`/comfynext/asset_import`) probes a *single* media file; a PNG sequence doesn't fit that model. Baked frames are a render cache, not user assets, so they live on the clip in a new `motion_bake` field, not in the asset library. (This also sidesteps the spec's open question about sequence-asset GC — the cache is replaced in place on re-bake.)
2. **`_transform_and_alpha` gains a `preserve_alpha` flag.** It currently does `src_pil.convert("RGB")` (drops alpha). Without this, a baked overlay's transparent background composites as a black box over the whole canvas.

---

## File Structure

- **Create** `frontend/app/lib/engine/motionClipBake.ts` — `motionClipSourceKey()` (pure hash) + `bakeMotionClipFrames()` (headless render → PNG blobs) + `ensureMotionBake()` (bake+upload if stale). One responsibility: turn a Motion clip into a cached alpha PNG sequence.
- **Create** `frontend/tests/unit/motion-clip-bake.unit.spec.ts` — unit tests for `motionClipSourceKey` (the only part testable without a real canvas; `toBlob` is unavailable in jsdom — the bake itself is verified in the browser-acceptance task).
- **Modify** `frontend/shared/timeline/types.ts` — add `MotionBake` interface + `motion_bake?` on `MotionClip`.
- **Modify** `frontend/app/components/vue-canvas/TimelineEditor.vue:861-922` (`renderViaFFmpeg`) — bake motion clips before export, attach `motion_frames` to the payload.
- **Modify** `comfy_extras/nodes_timeline.py` — `_transform_and_alpha` (preserve_alpha), `_adapt_edit_state` (carry `motion_frames`), `_prepare_render_clips` (motion handler), `render_frame_np` (motion source + alpha composite).
- **Modify** `tests-unit/comfy_extras_test/timeline_render_frame_test.py` — add motion + preserve_alpha tests.

---

### Task 1: Data model — `MotionBake` + `motion_bake` field

**Files:**
- Modify: `frontend/shared/timeline/types.ts` (near the `MotionClip` interface, currently ~line 267)

- [ ] **Step 1: Add the `MotionBake` interface and the clip field**

Find the `MotionClip` interface (it currently reads roughly):

```ts
export interface MotionClip extends BaseClip {
  kind: 'motion'
  layer: MotionTextLayer
}
```

Replace it with:

```ts
/** Cached headless bake of a Motion clip's pixels: one alpha PNG per clip frame,
 *  uploaded under input/. A render cache, NOT a user asset — lives on the clip.
 *  source_key mismatch (or a frame-count mismatch) ⇒ stale ⇒ re-bake on export. */
export interface MotionBake {
  source_key: string
  frames: string[]   // input/ filenames, frame order; length === clip.length
  fps: number
}

export interface MotionClip extends BaseClip {
  kind: 'motion'
  layer: MotionTextLayer
  /** Cached export bake (populated on render). Absent ⇒ never baked. */
  motion_bake?: MotionBake
}
```

- [ ] **Step 2: Verify the types compile**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: no new errors referencing `types.ts` / `MotionBake` (pre-existing unrelated errors, if any, are out of scope).

- [ ] **Step 3: Commit**

```bash
git add frontend/shared/timeline/types.ts
git commit -m "feat(kinetic): MotionBake type + motion_bake clip field"
```

---

### Task 2: Frontend — `motionClipSourceKey`

**Files:**
- Create: `frontend/app/lib/engine/motionClipBake.ts`
- Test: `frontend/tests/unit/motion-clip-bake.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/motion-clip-bake.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { motionClipSourceKey } from '../../app/lib/engine/motionClipBake'
import type { MotionClip } from '../../shared/timeline/types'

const CLIP: MotionClip = {
  id: 'm', kind: 'motion', start_frame: 0, in_frame: 0, length: 120,
  x: 0, y: 0, rotation: 0, scale: 1, opacity: 1,
  layer: {
    id: 'l', kind: 'text', text: 'AB', fontFamily: 'Inter', fontWeight: 400,
    fontSize: 0.1, color: '#fff', align: 'center', axes: { wght: 100 },
    axisKeyframes: [{ t: 0, axes: { wght: 100 } }, { t: 1, axes: { wght: 900 } }],
    animation: { offset: 0 },
  },
}

describe('motionClipSourceKey', () => {
  it('is stable for identical inputs', () => {
    expect(motionClipSourceKey(CLIP, 1080, 1920, 30))
      .toBe(motionClipSourceKey(CLIP, 1080, 1920, 30))
  })
  it('changes when the layer text changes (affects baked pixels)', () => {
    const a = motionClipSourceKey(CLIP, 1080, 1920, 30)
    const b = motionClipSourceKey({ ...CLIP, layer: { ...CLIP.layer, text: 'XY' } }, 1080, 1920, 30)
    expect(a).not.toBe(b)
  })
  it('changes when canvas dims change', () => {
    expect(motionClipSourceKey(CLIP, 1080, 1920, 30))
      .not.toBe(motionClipSourceKey(CLIP, 720, 1280, 30))
  })
  it('does NOT change when only the clip transform changes (composited, not baked)', () => {
    const a = motionClipSourceKey(CLIP, 1080, 1920, 30)
    const b = motionClipSourceKey({ ...CLIP, x: 0.2, opacity: 0.5, rotation: 10 }, 1080, 1920, 30)
    expect(a).toBe(b)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/motion-clip-bake.unit.spec.ts`
Expected: FAIL — cannot resolve `../../app/lib/engine/motionClipBake`.

- [ ] **Step 3: Create the file with the source-key function**

Create `frontend/app/lib/engine/motionClipBake.ts`:

```ts
/** Headless bake of a timeline Motion clip → an alpha PNG sequence, plus the
 *  source-key cache. Baking runs the SAME renderMotionClip that drives preview,
 *  so export parity is inherent. */
import type { MotionClip, MotionBake } from '~~/shared/timeline/types'
import { renderMotionClip } from './motionClipRenderer'
import { uploadFrameBatch } from '~/composables/useKineticRenderer'

/** FNV-1a over everything that affects the BAKED pixels: the layer spec, the
 *  clip's frame count, fps, and canvas dims. The clip-level transform / opacity
 *  / keyframes are applied at COMPOSITE time (export), not baked, so they are
 *  deliberately excluded — moving or fading the clip must not invalidate the bake. */
export function motionClipSourceKey(clip: MotionClip, W: number, H: number, fps: number): string {
  const s = JSON.stringify({ layer: clip.layer, length: clip.length, fps, W, H })
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/motion-clip-bake.unit.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/engine/motionClipBake.ts frontend/tests/unit/motion-clip-bake.unit.spec.ts
git commit -m "feat(kinetic): motionClipSourceKey + unit tests"
```

---

### Task 3: Frontend — `bakeMotionClipFrames` + `ensureMotionBake`

**Files:**
- Modify: `frontend/app/lib/engine/motionClipBake.ts`

No unit test: `bakeMotionClipFrames` needs a real `<canvas>`/`toBlob`, which jsdom does not implement. Correctness is verified end-to-end in Task 7 (Python composite of baked frames) and Task 8 (browser acceptance). Mirror of the proven pattern in `frontend/app/lib/motion/bake.ts` (offscreen canvas → `clearRect` for transparency → `toBlob` → `uploadFrameBatch`), but calling `renderMotionClip` per frame instead of the old `paintLayerStack`.

- [ ] **Step 1: Append the bake + ensure functions**

Append to `frontend/app/lib/engine/motionClipBake.ts`:

```ts
/** Render every clip-local frame to an offscreen canvas (transparent bg) and
 *  collect alpha PNG blobs. Caller must ensure fonts are loaded first. */
export async function bakeMotionClipFrames(
  clip: MotionClip, W: number, H: number, fps: number,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob[]> {
  const total = Math.max(1, Math.round(clip.length))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(W))
  canvas.height = Math.max(1, Math.round(H))
  const ctx = canvas.getContext('2d')!
  const blobs: Blob[] = []
  for (let i = 0; i < total; i++) {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height) // transparent background
    renderMotionClip(ctx, clip, i, canvas.width, canvas.height, fps)
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'))
    if (!blob) throw new Error(`motion bake: frame ${i} produced no blob`)
    blobs.push(blob)
    onProgress?.(i + 1, total)
  }
  return blobs
}

/** Ensure `clip.motion_bake` is fresh for this canvas; bake + upload if stale.
 *  Mutates and returns clip.motion_bake. Fonts must be ensured by the caller. */
export async function ensureMotionBake(
  clip: MotionClip, W: number, H: number, fps: number,
  onProgress?: (done: number, total: number) => void,
): Promise<MotionBake> {
  const key = motionClipSourceKey(clip, W, H, fps)
  const wanted = Math.max(1, Math.round(clip.length))
  const cached = clip.motion_bake
  if (cached && cached.source_key === key && cached.frames.length === wanted) {
    return cached
  }
  const blobs = await bakeMotionClipFrames(clip, W, H, fps, onProgress)
  const frames = await uploadFrameBatch(blobs, 'motionclip')
  if (frames.length !== blobs.length) {
    throw new Error(`motion bake: uploaded ${frames.length}/${blobs.length} frames — retry`)
  }
  const bake: MotionBake = { source_key: key, frames, fps }
  clip.motion_bake = bake
  return bake
}
```

- [ ] **Step 2: Verify it type-checks and existing unit tests still pass**

Run: `cd frontend && npx vitest run tests/unit/motion-clip-bake.unit.spec.ts`
Expected: PASS (still 4 tests; the new exports don't break the source-key tests).

- [ ] **Step 3: Commit**

```bash
git add frontend/app/lib/engine/motionClipBake.ts
git commit -m "feat(kinetic): bakeMotionClipFrames + ensureMotionBake (cache by source key)"
```

---

### Task 4: Python — `_transform_and_alpha` preserves source alpha

**Files:**
- Modify: `comfy_extras/nodes_timeline.py:641-681` (`_transform_and_alpha`)
- Test: `tests-unit/comfy_extras_test/timeline_render_frame_test.py`

- [ ] **Step 1: Write the failing test**

Append to `tests-unit/comfy_extras_test/timeline_render_frame_test.py`:

```python
def test_transform_preserve_alpha_keeps_transparency(tmp_path):
    """preserve_alpha=True must carry the source's per-pixel alpha through;
    the default (False) flattens to opaque (correct for opaque photo/video clips)."""
    from PIL import Image as _Image
    transparent_white = _Image.new("RGBA", (64, 36), (255, 255, 255, 0))
    _rgb, alpha = NT._transform_and_alpha(transparent_white, 64, 36, 0, 0, 0, 1, preserve_alpha=True)
    assert float(alpha.max()) == 0.0, "transparent source must stay transparent"
    _rgb2, alpha2 = NT._transform_and_alpha(transparent_white, 64, 36, 0, 0, 0, 1)
    assert float(alpha2.max()) > 0.0, "default path makes the fitted region opaque"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/julien/Documents/GitHub/ComfyNext && .venv/bin/python -m pytest tests-unit/comfy_extras_test/timeline_render_frame_test.py::test_transform_preserve_alpha_keeps_transparency -v`
Expected: FAIL — `TypeError: _transform_and_alpha() got an unexpected keyword argument 'preserve_alpha'`.

- [ ] **Step 3: Add the `preserve_alpha` parameter**

In `_transform_and_alpha` (line 641), change the signature:

```python
def _transform_and_alpha(src_pil: "PILImage.Image", canvas_w: int, canvas_h: int,
                        x: float, y: float, rotation: float, scale: float,
                        preserve_alpha: bool = False) -> tuple[np.ndarray, np.ndarray]:
```

Then change the first convert (line 657) from:

```python
    fitted = src_pil.convert("RGB").resize((fit_w, fit_h), PILImage.BILINEAR)
```

to:

```python
    # preserve_alpha: keep the source's per-pixel alpha (baked overlays). Default:
    # flatten to RGB then opaque RGBA (correct for photo/video clips that fill
    # their fitted rect). The later `.convert("RGBA")` is a no-op if already RGBA.
    fitted = src_pil.convert("RGBA" if preserve_alpha else "RGB").resize((fit_w, fit_h), PILImage.BILINEAR)
```

(The existing `rgba = fitted.convert("RGBA")` on line 670 already preserves alpha when `fitted` is RGBA; no other change needed.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/timeline_render_frame_test.py::test_transform_preserve_alpha_keeps_transparency -v`
Expected: PASS.

- [ ] **Step 5: Run the full file to confirm no regression (rotated-corners test still green)**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/timeline_render_frame_test.py -v`
Expected: all PASS (the existing image/opacity/rotation tests use the default path, unchanged).

- [ ] **Step 6: Commit**

```bash
git add comfy_extras/nodes_timeline.py tests-unit/comfy_extras_test/timeline_render_frame_test.py
git commit -m "feat(kinetic): _transform_and_alpha preserve_alpha for baked overlays"
```

---

### Task 5: Python — render Motion clips from baked frames

This task wires the `motion` kind through all three export stages, driven by one integration test.

**Files:**
- Modify: `comfy_extras/nodes_timeline.py` — `_adapt_edit_state` (~757), `_prepare_render_clips` (~806, after the `text` branch), `render_frame_np` (~879)
- Test: `tests-unit/comfy_extras_test/timeline_render_frame_test.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests-unit/comfy_extras_test/timeline_render_frame_test.py`:

```python
def _alpha_square_png(tmp_path, name, square_rgb, size=(64, 36)):
    """Transparent canvas with an 8x8 opaque square of `square_rgb` at center."""
    from PIL import Image as _Image
    img = _Image.new("RGBA", size, (0, 0, 0, 0))
    w, h = size
    for yy in range(h // 2 - 4, h // 2 + 4):
        for xx in range(w // 2 - 4, w // 2 + 4):
            img.putpixel((xx, yy), (*square_rgb, 255))
    p = os.path.join(str(tmp_path), name)
    img.save(p)
    return p


def test_motion_clip_composites_with_alpha(tmp_path):
    """A baked alpha PNG sequence: the opaque center shows the square color,
    the transparent surround shows the background (no black box)."""
    f0 = _alpha_square_png(tmp_path, "m0.png", (255, 255, 255))
    f1 = _alpha_square_png(tmp_path, "m1.png", (255, 0, 0))
    state = _flat_state([{
        "kind": "motion", "motion_frames": [f0, f1],
        "start_frame": 0, "length": 2, "in_frame": 0,
        "x": 0, "y": 0, "rotation": 0, "scale": 1, "opacity": 1,
        "blend": "normal", "fade_in": 0, "fade_out": 0,
    }], total=2, bg="#336699")
    clips = NT._prepare_render_clips(state)
    try:
        frame0 = NT.render_frame_np(state, clips, 0)
        frame1 = NT.render_frame_np(state, clips, 1)
    finally:
        NT._close_render_clips(clips)
    bg = [0x33 / 255, 0x66 / 255, 0x99 / 255]
    # frame 0: white center over bg corner
    assert np.allclose(frame0[18, 32], [1, 1, 1], atol=2 / 255), f"center {frame0[18, 32]}"
    assert np.allclose(frame0[2, 2], bg, atol=2 / 255), f"corner {frame0[2, 2]} should be bg"
    # frame 1 indexes the SECOND baked frame: red center
    assert np.allclose(frame1[18, 32], [1, 0, 0], atol=2 / 255), f"center {frame1[18, 32]}"


def test_motion_clip_without_frames_is_skipped(tmp_path):
    """A motion clip with no baked frames must be skipped (warn), not crash,
    leaving the background untouched."""
    state = _flat_state([{
        "kind": "motion", "motion_frames": [],
        "start_frame": 0, "length": 2, "in_frame": 0,
        "x": 0, "y": 0, "rotation": 0, "scale": 1, "opacity": 1,
        "blend": "normal", "fade_in": 0, "fade_out": 0,
    }], total=2, bg="#336699")
    clips = NT._prepare_render_clips(state)
    try:
        arr = NT.render_frame_np(state, clips, 0)
    finally:
        NT._close_render_clips(clips)
    assert np.allclose(arr[18, 32], [0x33 / 255, 0x66 / 255, 0x99 / 255], atol=1e-6)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/timeline_render_frame_test.py::test_motion_clip_composites_with_alpha tests-unit/comfy_extras_test/timeline_render_frame_test.py::test_motion_clip_without_frames_is_skipped -v`
Expected: FAIL — `test_motion_clip_composites_with_alpha` gets bg at center (motion never rendered → `KeyError`/skip), `test_motion_clip_without_frames_is_skipped` may already pass incidentally (motion silently dropped today).

- [ ] **Step 3a: Carry `motion_frames` through `_adapt_edit_state`**

In `_adapt_edit_state`, in the `out["clips"].append({...})` dict (line ~757), add one entry alongside `"keyframes"`:

```python
                "text":        clip.get("text"),
                "keyframes":   clip.get("keyframes"),
                "motion_frames": clip.get("motion_frames"),
            })
```

- [ ] **Step 3b: Add the motion handler in `_prepare_render_clips`**

In `_prepare_render_clips`, immediately after the `if kind == "text":` block ends (after its `continue`, ~line 824) and before `path = c.get("path")`, insert:

```python
        if kind == "motion":
            # Baked alpha PNG sequence (one file per clip-local frame). Resolve
            # filenames against input/ like other clip paths; skip (warn) if the
            # bake is missing/stale so a kinetic clip never silently crashes.
            frames = c.get("motion_frames") or []
            resolved = []
            for fn in frames:
                p = fn if os.path.isabs(fn) else os.path.join(folder_paths.get_input_directory(), fn)
                if os.path.exists(p):
                    resolved.append(p)
            if not resolved:
                logging.warning("timeline: motion clip has no baked frames (stale/un-baked) — skipping")
                continue
            entry["frame_paths"] = resolved
            entry["duration"] = None
            clips.append(entry)
            continue
```

(`logging` and `folder_paths` are already imported at module top — confirm with `grep -n "^import logging\|^import folder_paths\|import folder_paths" comfy_extras/nodes_timeline.py`; both are used elsewhere in the file.)

- [ ] **Step 3c: Read the motion source frame in `render_frame_np`**

In `render_frame_np`, in the "Get source PIL for this frame" block (line ~879), change:

```python
        if L["kind"] in ("image", "text"):
            src_pil = L["pil"]
        else:  # video
```

to:

```python
        if L["kind"] in ("image", "text"):
            src_pil = L["pil"]
        elif L["kind"] == "motion":
            fp = L["frame_paths"]
            idx = local_f if local_f < len(fp) else len(fp) - 1
            src_pil = PILImage.open(fp[max(0, idx)])  # RGBA, alpha preserved below
        else:  # video
```

Then change the transform call (line ~901) from:

```python
        rgb, alpha = _transform_and_alpha(src_pil, W, H, tf["x"], tf["y"], tf["rotation"], tf["scale"])
```

to:

```python
        rgb, alpha = _transform_and_alpha(
            src_pil, W, H, tf["x"], tf["y"], tf["rotation"], tf["scale"],
            preserve_alpha=(L["kind"] == "motion"),
        )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/timeline_render_frame_test.py -v`
Expected: all PASS, including the two new motion tests.

- [ ] **Step 5: Run the broader timeline suite for regressions**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/timeline_state_test.py tests-unit/comfy_extras_test/timeline_render_frame_test.py -v`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add comfy_extras/nodes_timeline.py tests-unit/comfy_extras_test/timeline_render_frame_test.py
git commit -m "feat(kinetic): export Motion clips via baked alpha PNG sequence"
```

---

### Task 6: Frontend — bake motion clips on export

**Files:**
- Modify: `frontend/app/components/vue-canvas/TimelineEditor.vue:861-878` (`renderViaFFmpeg`)

This is an integration task (no jsdom test — the canvas bake needs a browser). Verified in Task 7.

- [ ] **Step 1: Confirm the font-ensure helper's signature**

Run: `cd frontend && grep -n "export function ensureMotionFonts\|export async function ensureMotionFonts" app/composables/useTemplateFonts.ts`
Note the exact signature — the next step calls it to load each motion clip's variable font (full axis range) before baking, so the baked weight is correct. If it takes the whole edit state, pass `es`; if it takes clips/fonts, collect the motion clips' `layer.fontFamily` and pass those.

- [ ] **Step 2: Add imports**

At the top of `<script setup>` in `TimelineEditor.vue`, add:

```ts
import { ensureMotionBake } from '~/lib/engine/motionClipBake'
import { ensureMotionFonts } from '~/composables/useTemplateFonts'
import type { MotionClip } from '~~/shared/timeline/types'
```

- [ ] **Step 3: Bake motion clips before building the payload**

In `renderViaFFmpeg`, replace lines 867-878 (from `const es = store.state.value` through the close of the path-resolution loop) with:

```ts
  const es = store.state.value
  const assetLib = assetsList.value
  const fps = es.canvas.fps
  const W = es.canvas.width
  const H = es.canvas.height

  // Bake any Motion clips against the REAL store clips first so motion_bake
  // caches across exports (a re-export with no kinetic edits skips re-baking).
  await ensureMotionFonts(es)   // adjust arg to match Step 1's signature
  for (const track of es.tracks) {
    for (const clip of track.clips) {
      if (clip.kind === 'motion') {
        try {
          await ensureMotionBake(clip as MotionClip, W, H, fps)
        } catch (err: any) {
          renderError.value = `kinetic bake failed: ${err?.message ?? err}`
          return
        }
      }
    }
  }

  const payload: any = JSON.parse(JSON.stringify(es))
  for (const track of payload.tracks) {
    for (const clip of track.clips) {
      if (clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'audio') {
        const asset = assetLib.find((a: any) => a.id === clip.asset_id)
        if (asset) clip.path = asset.path
      } else if (clip.kind === 'motion') {
        clip.motion_frames = clip.motion_bake?.frames ?? []
      }
    }
  }
```

(`renderError`/`renderResult`/`renderProgress` are already reset at the top of the function, lines 863-865 — leave those.)

- [ ] **Step 4: Verify it type-checks**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -i "TimelineEditor\|motionClipBake" | head`
Expected: no errors from these files.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/TimelineEditor.vue
git commit -m "feat(kinetic): bake Motion clips on export, attach motion_frames"
```

---

### Task 7: Browser acceptance — kinetic clip survives export

**Files:** none (manual/automated in-app verification per the kinetic verification caveats in `project-kinetic-timeline`).

- [ ] **Step 1: Start the stack**

Backend: `cd /Users/julien/Documents/GitHub/ComfyNext && .venv/bin/python main.py --listen 127.0.0.1 --port 8188`
Frontend: `cd frontend && npm run dev`

- [ ] **Step 2: Author + export**

In the timeline editor: add a Kinetic Text clip, give it an animated axis (e.g. wght 100→900), place a video/image clip behind it, then run the FFmpeg export.

- [ ] **Step 3: Verify the bake fired and frames uploaded**

Confirm `input/motionclip_*.png` files were created:
Run: `ls -t /Users/julien/Documents/GitHub/ComfyNext/input/motionclip_*.png 2>/dev/null | head`
Expected: one PNG per clip frame, newest first.

- [ ] **Step 4: Verify the exported video contains the text over alpha**

Open the rendered output and confirm the kinetic text appears, animates, and composites over the background clip (no black box around it). Note: the WebGL preview canvas can't be screenshot-read (see `project-kinetic-timeline` caveats) — verify the *exported file*, not the preview.

- [ ] **Step 5: Verify caching**

Re-run export without editing the kinetic clip; confirm no new `motionclip_*.png` timestamps appear (cache hit via source_key). Then edit the text and re-export; confirm a fresh batch appears.

- [ ] **Step 6: Commit (notes only, if any harness was added)**

No code commit expected. Record results in the PR description.

---

## Self-Review

**Spec coverage (Part 1 — Export):**
- "Motion clips export correctly with alpha" → Tasks 4, 5, 7. ✓
- "Auto-bake on export, cached by source_key" → Tasks 2, 3, 6 (`motionClipSourceKey` + `ensureMotionBake` cache check + Step 5 verification). ✓
- "Same renderer for preview and bake → parity" → Task 3 (`bakeMotionClipFrames` calls `renderMotionClip`). ✓
- "Clip stays a Motion clip, bake is a cache" → Task 1 (`motion_bake` field, not a clip-type swap). ✓
- "Stale/missing bake surfaces a warning, not a silent drop" → Task 5 Step 3b (`logging.warning`) + Task 5 `test_motion_clip_without_frames_is_skipped`. ✓
- Spec's "register a sequence asset" → **intentionally replaced** by clip-stored `motion_bake` (deviation documented in header). ✓
- "Golden fixture for a kinetic clip" → the alpha-composite pytest (Task 5) is the parity gate for v1; a full Playwright golden fixture is **deferred to the keyframe-lanes plan** (Part 2), where animated lanes give a richer fixture. Noted here so it isn't silently dropped.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; the one "confirm signature" step (Task 6 Step 1) is a concrete lookup against an existing function, not a placeholder.

**Type consistency:** `MotionBake { source_key, frames, fps }` defined in Task 1 and used identically in Tasks 3 and 6. `motion_frames` (export payload field) is set in Task 6 and read in Task 5 (`_adapt_edit_state`, `_prepare_render_clips`). `frame_paths` (prepared-clip field) is set in Task 5 Step 3b and read in Task 5 Step 3c. `preserve_alpha` defined in Task 4 and used in Task 5 Step 3c. Consistent.

---

## Notes for Part 2 (Keyframe Lanes)

The lane editor will extend `motionClipSourceKey`'s inputs implicitly (it already hashes the whole `clip.layer`, so new per-property keyframes are covered automatically — no key change needed). When lanes add transform keyframes that differ from `BaseClip.keyframes`, confirm the bake key still excludes clip-level transform (composited, not baked) while including any layer-internal animation.
