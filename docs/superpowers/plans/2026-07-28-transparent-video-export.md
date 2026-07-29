# Transparent Video Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Sailor motion export keep its transparency, instead of having it flattened onto black at the last step.

**Architecture:** The alpha already survives the entire pipeline — frames are rendered to RGBA PNGs client-side and uploaded, and the server discards the alpha at encode time purely because `h264`/`yuv420p` cannot carry it. This adds a VP9/WebM branch alongside the unchanged `libx264` default, threads an `alpha` flag from the caller, and exposes it in the UI only where the frames genuinely contain transparency.

**Tech Stack:** Python (aiohttp + PyAV), TypeScript, Vue 3 / Nuxt 4.

**Spec:** [2026-07-28-transparent-video-export-design.md](../specs/2026-07-28-transparent-video-export-design.md)

## Established facts (verified, trust these)

- **The dependency gate is CLEAR.** `.venv/bin/python` reports PyAV 17.0.0 with `libvpx-vp9` available as an encoder, advertising `yuva420p`. `libvpx`, `libx264`, `prores_ks` also present. Nothing to install.
- The encode route is `comfy_extras/nodes_timeline.py:1596`, `POST /sailor/spacetype_encode`.
  Body: `{ frames: string[], fps: number, width: number, height: number }`. Response: `{ filename }`, written into the ComfyUI input dir and read back by the frontend via `/view?filename=…&type=input`.
- The flatten is at roughly `nodes_timeline.py:1650`, inside a nested `_encode()`:
  ```python
  # Flatten RGBA onto black — h264/yuv420p has no alpha channel
  if im.mode == "RGBA":
      bg = PILImage.new("RGB", im.size, (0, 0, 0))
      bg.paste(im, mask=im.split()[-1])
      im = bg
  ```
  Frames arrive as PNGs opened with PIL, so `im.mode == "RGBA"` is the alpha-bearing case.
- Current stream setup: `out.add_stream("h264", rate=Fraction(fps,1))`, `pix_fmt = "yuv420p"`, `options = {"preset": "veryfast", "crf": "20"}`, frames fed via `av.VideoFrame.from_ndarray(arr, format="rgb24")`. Output name is hardcoded `spacetype_<ms>.mp4`.
- Six frontend callers: `SpaceTypeSurface.vue`, `CompositorModal.vue`, `Scene3DStudioSurface.vue`, `ArtifactFrameNode.vue`, `ShaderStudioSurface.vue`, `GradientStudioSurface.vue`.
- **Shader and Gradient render opaque** — both were measured during the embed work and declare `caps.alpha: false`. They are NOT candidates for the toggle. The alpha-bearing surfaces are Space Type, Compositor, and Scene3D.

## Global Constraints

- **The default path must not change.** An export with no `alpha` flag must produce a byte-comparable H.264 MP4 exactly as today. This route is used by six surfaces; a regression here breaks every video export in the app.
- ComfyUI must be restarted for Python changes to take effect. It runs on `127.0.0.1:8188`; the frontend dev server on `127.0.0.1:3000`. **Always `127.0.0.1`, never `localhost`.**
- Python is run via the repo venv: `.venv/bin/python`.
- TypeScript typecheck has ~328 pre-existing errors repo-wide — NOT a gate.
- 16 unit tests fail on main for unrelated pre-existing reasons — ignore them.
- Git: commit directly to main, staging only explicit paths. A parallel session shares this checkout and commits continuously. **Never `git add -A`, `git add .`, or `git stash`.** Never stage `frontend/package.json` or `frontend/pnpm-lock.yaml`.

---

### Task 1: The alpha branch in the encoder

**Files:**
- Modify: `comfy_extras/nodes_timeline.py` (the `_spacetype_encode_route` handler and its nested `_encode`)
- Test: `tests-unit/sailor_encode_alpha_test.py` (create; follow whatever convention that directory already uses — read a neighbouring test first)

**Interfaces:**
- Consumes: nothing
- Produces: the route accepts an optional `"alpha": true` in its JSON body; when set, it writes a `.webm` encoded with `libvpx-vp9` at `yuva420p` and returns that filename. Response shape is unchanged: `{ "filename": "..." }`.

- [ ] **Step 1: Write the failing test**

The test must prove two things: that an alpha export genuinely carries transparency, and that the default path is untouched.

Generate RGBA PNG frames with a known transparent region (e.g. a fully-opaque square on a fully-transparent background), call the encode function, then probe the output with PyAV and assert the decoded frame has an alpha plane with a genuinely transparent pixel where you put one.

Read an existing test in `tests-unit/` first and match its style. If the encode logic is only reachable through the aiohttp route, refactor the nested `_encode` into a module-level helper you can call directly — that refactor is in scope and makes this testable, but it must not change behaviour.

Assert specifically:
- alpha export: output path ends `.webm`, the decoded stream's `pix_fmt` carries alpha, and a pixel you made transparent decodes with alpha ≈ 0
- default export: output ends `.mp4`, codec is h264, and a frame you made transparent decodes as BLACK (the existing flatten-onto-black behaviour, unchanged)

- [ ] **Step 2: Run the test and confirm it fails for the right reason**

Run: `.venv/bin/python -m pytest tests-unit/sailor_encode_alpha_test.py -v`
Expected: FAIL — the `alpha` parameter is not honoured, output is `.mp4`

If pytest is not the runner used in `tests-unit/`, use whatever is, and say so.

- [ ] **Step 3: Implement the branch**

In `_spacetype_encode_route`, read the flag and choose the container and codec:

```python
alpha = bool(data.get("alpha", False))
ext = "webm" if alpha else "mp4"
out_name = f"spacetype_{int(time.time() * 1000)}.{ext}"
```

In `_encode`, branch the stream setup:

```python
if alpha:
    # VP9 in WebM is the only alpha-capable combination that plays in
    # Chrome/Firefox/Edge. Safari will not play it — the UI says so.
    stream = out.add_stream("libvpx-vp9", rate=Fraction(fps, 1))
    stream.pix_fmt = "yuva420p"
    # b:v 0 selects constant-quality mode, where crf actually governs.
    stream.options = {"crf": "30", "b:v": "0"}
else:
    stream = out.add_stream("h264", rate=Fraction(fps, 1))
    stream.pix_fmt = "yuv420p"
    stream.options = {"preset": "veryfast", "crf": "20"}
```

and branch the per-frame conversion, keeping the existing flatten for the default path:

```python
if alpha:
    im = im.convert("RGBA")
    arr = np.array(im, dtype=np.uint8)
    av_frame = av.VideoFrame.from_ndarray(arr, format="rgba")
else:
    # unchanged: flatten RGBA onto black — h264/yuv420p has no alpha
    ...
```

**Two things to verify empirically rather than assume**, and report what you find:
1. Whether `av.VideoFrame.from_ndarray(..., format="rgba")` feeding a `yuva420p` stream preserves alpha through PyAV's conversion, or whether the frame needs an explicit `.reformat(format="yuva420p")`.
2. Whether `auto-alt-ref` must be disabled (`{"auto-alt-ref": "0"}`) for alpha to survive — some libvpx builds drop the alpha plane when alt-ref frames are enabled. If the test passes without it, leave it out and say so; do not add options speculatively.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `.venv/bin/python -m pytest tests-unit/sailor_encode_alpha_test.py -v`
Expected: PASS

- [ ] **Step 5: Prove the default path is genuinely unchanged**

Encode the same frame set with no `alpha` flag before and after your change and confirm the outputs are equivalent (same codec, same dimensions, same frame count; byte-identical if the encoder is deterministic, otherwise compare decoded pixels). Paste the evidence.

- [ ] **Step 6: Commit**

```bash
git add comfy_extras/nodes_timeline.py tests-unit/sailor_encode_alpha_test.py
git commit -m "feat(encode): VP9/WebM alpha branch alongside the h264 default"
```

---

### Task 2: Thread the flag through the frontend

**Files:**
- Create: `frontend/app/lib/engine/encodeVideo.ts`
- Modify: the six callers that POST to `/sailor/spacetype_encode`
- Test: `frontend/tests/unit/encode-video.unit.spec.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `encodeFrames(opts: { frames: string[]; fps: number; width: number; height: number; alpha?: boolean }): Promise<{ filename: string; ext: 'mp4' | 'webm' }>`

Right now the POST body and the `a.download = '...mp4'` filename are duplicated across six components. With an `alpha` flag and a variable extension, that duplication becomes a bug source — a caller that requests alpha but hardcodes `.mp4` produces a file the OS mislabels.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/encode-video.unit.spec.ts`. Stub `$fetch`/`fetch` and assert:
- the POST body includes `alpha: true` only when requested, and omits it (or sends `false`) otherwise
- the returned `ext` is `'webm'` when the server returns a `.webm` filename and `'mp4'` otherwise — derive it from the RESPONSE, not from the request, so the server stays authoritative
- a server error surfaces as a rejected promise with a useful message, not a silent undefined

- [ ] **Step 2: Run and confirm it fails**

Run: `cd frontend && npx vitest run tests/unit/encode-video.unit.spec.ts`

- [ ] **Step 3: Write the helper, then migrate the callers**

Write `encodeFrames`, then replace the inline POST in each of the six callers with a call to it, and derive each download filename's extension from the returned `ext` rather than hardcoding `.mp4`.

Read each call site before editing. Some pass extra state or set progress messages — preserve that exactly; this is a refactor, not a redesign. Do not change any caller's behaviour beyond routing through the helper.

- [ ] **Step 4: Confirm green and no regression**

Run: `cd frontend && npx vitest run tests/unit/encode-video.unit.spec.ts`
Run: `cd frontend && npx vitest run` — no NEW failures beyond the known baseline.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/engine/encodeVideo.ts frontend/tests/unit/encode-video.unit.spec.ts frontend/app/components/vue-canvas/SpaceTypeSurface.vue frontend/app/components/vue-canvas/CompositorModal.vue frontend/app/components/vue-canvas/Scene3DStudioSurface.vue frontend/app/components/vue-canvas/ArtifactFrameNode.vue frontend/app/components/vue-canvas/ShaderStudioSurface.vue frontend/app/components/vue-canvas/GradientStudioSurface.vue
git commit -m "refactor(encode): single encodeFrames helper with an alpha option"
```

---

### Task 3: The Transparent toggle, where alpha actually exists

**Files:**
- Create: `frontend/app/lib/engine/hasAlpha.ts`
- Modify: `frontend/app/components/vue-canvas/SpaceTypeSurface.vue`
- Test: `frontend/tests/unit/has-alpha.unit.spec.ts`

**Interfaces:**
- Consumes: `encodeFrames` from Task 2
- Produces: `canvasHasAlpha(source: HTMLCanvasElement, sampleMax?: number): boolean`

Space Type first: type on a transparent background is the canonical case for this feature, and it is one of the three surfaces whose renderer preserves alpha (the others being Compositor and Scene3D). Shader and Gradient are excluded — both were measured opaque during the embed work.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/has-alpha.unit.spec.ts` covering `canvasHasAlpha`:
- a fully opaque source → `false`
- a source with any pixel below full alpha → `true`
- a fully transparent source → `true`
- downsampling must not produce a false negative: a source with a SMALL transparent region must still report `true`

That last case is the one that matters. If the implementation samples too coarsely it will miss small transparent areas and silently offer an opaque-only export. Choose the sampling strategy so that test passes, and if you cannot make sampling reliable, read every pixel of a downscaled copy rather than sparsely sampling the full one — correctness over speed.

vitest runs in a node environment with no DOM. If `HTMLCanvasElement` is unavailable, make `canvasHasAlpha` take an `ImageData`-like `{ data, width, height }` so the logic is testable, and have the caller pass `ctx.getImageData(...)`.

- [ ] **Step 2: Run and confirm it fails**

Run: `cd frontend && npx vitest run tests/unit/has-alpha.unit.spec.ts`

- [ ] **Step 3: Implement, then wire the toggle**

Implement `canvasHasAlpha`, then in `SpaceTypeSurface.vue`:
- detect alpha from the surface's own rendered frame (reuse whatever canvas the existing bake path already produces — do not render an extra frame just to test)
- add a **Transparent background** checkbox beside the existing video-export action, `:disabled` when no alpha was detected, with a title explaining why it is unavailable
- when enabled, say plainly in the UI that the result is a WebM and that Safari will not play it. Do not bury this — a user who discovers it from a client is worse off than one who read it here
- pass `alpha` through to `encodeFrames` and name the download from the returned `ext`

Follow the file's existing export-action conventions (message ref, in-flight guard, error styling). Read them first.

- [ ] **Step 4: Verify in the running app**

Restart ComfyUI so the Python change is live:
```bash
.venv/bin/python main.py --listen 127.0.0.1 --port 8188
```

Then export a Space Type piece with the toggle on, and verify the produced file **actually has alpha** — do not judge by eye against a dark page.

⚠️ **The obvious probe gives a FALSE NEGATIVE.** PyAV auto-selects ffmpeg's native `vp9` decoder, which does not merge WebM's `BlockAdditional` alpha side-channel — a correctly-encoded transparent file decodes as fully opaque. You must force the `libvpx-vp9` decoder. Task 1 established this; its test file contains the working alpha-aware decode helper. **Reuse that helper** (`tests-unit/sailor_encode_alpha_test.py`) rather than writing a fresh probe, and if you do write one, force the decoder explicitly.

An `alpha min` of 0 with `max` 255 proves real transparency. If `alpha min` is 255, first confirm you are not hitting the native-decoder false negative before concluding the feature is broken.

Report that output verbatim.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/engine/hasAlpha.ts frontend/tests/unit/has-alpha.unit.spec.ts frontend/app/components/vue-canvas/SpaceTypeSurface.vue
git commit -m "feat(export): transparent background toggle in Space Type"
```

---

## Done when

- An alpha export decodes with a real alpha plane — proven by the PyAV probe, not by looking at it
- The default MP4 path is provably unchanged
- The toggle is offered only where alpha genuinely exists, and says plainly that WebM excludes Safari

## Deliberately not in this plan

Per the spec: HEVC-with-alpha (doubles the encode matrix for one browser family), browser-sniffing to serve different files (a hosting concern; Sailor is local-first), the luminance-matte pass, and PNG-sequence export.

Extending the toggle to **Compositor** and **Scene3D** — the other two alpha-bearing surfaces — is deliberately left as a follow-up once the pattern is proven on Space Type.
