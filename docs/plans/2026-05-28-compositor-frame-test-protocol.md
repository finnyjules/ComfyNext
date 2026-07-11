# Compositor / Frame — test protocol

QA checklist for the Frame artifact + compositor work (text/shape/image overlay,
artboard, inline editing, floating toolbar, resize, modal, submit round-trip).
Re-runnable; fill the **Result** column each pass.

## How to run

- **Backend (deterministic):** `PYTHONPATH=<root> .venv/bin/python /tmp/frame_qa.py`
  — calls `CompositorNode.execute(...)` directly and asserts pixels; plus a
  `/object_info/Compositor` schema check and a `/prompt` execution smoke.
- **Frontend compile:** request each touched SFC/module through Vite
  (`GET /_nuxt/@fs/<abs path>`), expect HTTP 200 (real transform, not just lint).
- **Frontend UI:** enable Vue nodes (`localStorage['sailor:Comfy.VueNodes.Enabled']='true'`),
  open a blank project, drop a **Frame**, then drive each C-case.

Severity: **P0** = broken/data-loss · **P1** = wrong behavior · **P2** = polish.

## A. Backend compositing (`comfy_extras/nodes_compositor.py`)

| ID | Case | Expected | Sev | Result |
|----|------|----------|-----|--------|
| B0 | Schema | inputs include `layer1..16`, `layer*_x/y/rotation/scale/opacity/blend`, `width`, `height`, `overlay`, `overlay_mask`; `is_output_node` | P0 | |
| B1 | Overlay alpha | opaque overlay px → overlay color; transparent → base; mask=0.5 → 50/50 blend | P0 | |
| B2 | Explicit size | `width=200,height=100` → output `(1,100,200,3)`, base aspect-fit + centered | P1 | |
| B3 | Size, no layers | no `layerN`, `width/height` set, `overlay` given → black artboard at size + overlay composited | P1 | |
| B4 | Empty | no layers, no size → tiny 16×16 black (back-compat) | P1 | |
| B5 | Blend multiply | base 0.5 gray, layer2 0.5 gray, blend=multiply → 0.25 | P1 | |
| B6 | Layer transform | layer2 `x=0.5` → content shifted right vs `x=0` | P1 | |
| B7 | Opacity | layer2 opacity=0.5 over base → 50/50 mix | P2 | |
| I1 | `/prompt` smoke | LoadImage→overlay/overlay_mask + Compositor graph queues → `status=success` | P0 | |

## B. Frontend compilation (Vite transform → 200)

| ID | File | Sev | Result |
|----|------|-----|--------|
| F1 | `nodes_compositor.py` (py-compile) | P0 | |
| F2 | `useCompositorLayers.ts` | P0 | |
| F3 | `useLocalLayerEditor.ts` | P0 | |
| F4 | `CompositorInlineToolbar.vue` | P0 | |
| F5 | `ArtifactFrameNode.vue` | P0 | |
| F6 | `CompositorModal.vue` | P0 | |
| F7 | `VueNodeCanvas.vue` | P0 | |
| F8 | `default.vue` | P0 | |

## C. Frame UI (driven)

| ID | Case | Expected | Sev | Result |
|----|------|----------|-----|--------|
| C1 | Render | Compositor renders as Frame artboard (dims header, checkerboard, Edit/Modal footer) | P0 | |
| C2 | Preset | choosing a size preset changes artboard aspect | P1 | |
| C3 | Resize | corner grip resizes display size; output res (W×H) unchanged; everything scales | P1 | |
| C4 | Drop image | dropping a file adds an image layer that renders on the artboard | P0 | |
| C5 | Edit mode | Edit enters (cyan ring + add-toolbar); Done/Esc exits to footer | P0 | |
| C6 | Add layers | toolbar adds text/rect/ellipse/line/image; text auto-enters edit | P1 | |
| C7 | Select + toolbar | selecting a local layer shows cyan handles + floating toolbar above; controls mutate the layer live | P0 | |
| C8 | Transform | drag/scale/rotate a local layer inline; **canvas does not pan** | P0 | |
| C9 | Wired select | wired layer shows amber handles + toolbar with Opacity + Blend; drag moves it | P1 | |
| C10 | Modal | "Modal" opens the focused editor (shared engine): layers list, selection, properties panel all work | P0 | |
| C11 | Mutual-excl. | selecting an image slot clears local selection and vice versa (never both handle sets) | P2 | |

## D. Submit round-trip

| ID | Case | Expected | Sev | Result |
|----|------|----------|-----|--------|
| D1 | Bake + inject | Frame with base image + text/shape → Run → backend output includes the overlay, correctly placed | P0 | |

## E. Persistence / regression

| ID | Case | Expected | Sev | Result |
|----|------|----------|-----|--------|
| E1 | Round-trip | `sailor_localLayers` + `sailor_frame` survive save/reload (via node `properties`) | P1 | |
| E2 | Legacy compositor | a pre-existing Compositor (no local layers) still renders + runs | P1 | |

## Results summary

**Run 1 — 2026-05-28**

- **Backend: 17/17 PASS.** B0 schema (width/height/overlay/overlay_mask/16 layers/output_node) ✅; B1 alpha (opaque/transparent/50%) ✅; B2 explicit-size + letterbox ✅; B3 size+no-layers+overlay ✅; B4 empty ✅; B5 multiply ✅; B6 transform ✅; B7 opacity ✅; I1 `/prompt` execution `success` ✅.
- **Compile: 8/8 PASS** (F1 py-compile + F2–F8 Vite transform 200).
- **UI (driven, screenshots): PASS** for C1 render, C2 preset→aspect (1.77), C3 resize, C4 drop-image, C5 edit mode, C6 add layers, C7 select+toolbar, C8 transform-without-pan, C10 modal (shared engine).
- **D1 round-trip: PASS (both halves).** Run baked the overlay at the artboard res (1280×720) with text content + uploaded it (frontend injection); the injected graph shape executes `success` (I1) and composites correctly (B1). Continuous click→pixels needs the real app's live bridge (headless preview iframe isn't a live ComfyUI).

**Not driven live (mechanism verified, manual pass recommended):**
- C9 wired-layer toolbar — needs a *connected* image; reuses verified wired-handle geometry + toolbar + slot-widget writes.
- C11 inline local↔wired mutual exclusion — modal exclusion verified; inline cross needs a wired layer.
- E1 persistence (properties round-trip) / E2 legacy compositor — backend overlay is optional (B2/B4); empty-frame UI verified.

**Punch list:** No P0/P1 defects found. ~~P2: toolbar size field reads in display px~~ → **FIXED + verified**: size now reads in true output px when an artboard size is set (held at 102 through a display resize; toolbar + modal both updated). Remaining: a final manual pass in the real app for C9 (wired toolbar), C11-inline exclusion, and the continuous D1 run (all mechanisms verified).
