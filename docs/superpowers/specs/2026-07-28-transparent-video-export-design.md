# Transparent Video Export — Design

*2026-07-28 · Companion to [Web Embed Export](2026-07-28-web-embed-export-design.md), independent of it*

## The problem

Sailor's video export flattens transparency onto black. Not because the alpha is lost upstream — it
survives the entire pipeline — but because the final encode uses a codec that cannot carry it.

The path today, e.g. `frontend/app/components/vue-canvas/ArtifactFrameNode.vue`:

1. Each frame renders client-side and is serialized with `canvas.toBlob(..., 'image/png')` — **PNG, with
   alpha intact**
2. The frame list POSTs to `/sailor/spacetype_encode`
3. `comfy_extras/nodes_timeline.py` encodes server-side, and at line ~1650 does exactly what it says:

   > `# Flatten RGBA onto black — h264/yuv420p has no alpha channel`

So alpha reaches the encoder and is discarded there, by choice, because of `libx264` + `yuv420p`.

## Why it matters

Transparent output is what lets a Sailor piece sit *over* something — a photo, a coloured section, live
text — rather than inside its own opaque rectangle. Without it, every motion export is a sealed box.

## Format reality

There is no single transparent video file that plays everywhere. Any design must choose per destination:

| Format | Alpha | Plays where | Notes |
|---|---|---|---|
| H.264 / MP4 | ✗ | Everywhere | Current default. No alpha channel exists in the format |
| VP9 / WebM (`yuva420p`) | ✓ | Chrome, Firefox, Edge | Not reliable in Safari |
| HEVC / MP4 (`hvc1` + alpha) | ✓ | Safari, macOS, iOS | Not Chrome on Windows |
| ProRes 4444 / MOV | ✓ | No browser | Editing handoff only; very large |
| PNG sequence | ✓ | n/a | Lossless, huge, universal for compositing tools |
| Luminance matte (2nd file) | ✓ (via masking) | Anywhere the host supports masks | Figma's own official workaround |

## Proposed scope

**Add an alpha-capable branch to the existing encoder rather than a new pipeline.** The frames already
arrive as RGBA PNGs; only the codec configuration changes.

Minimum viable:

- **VP9/WebM with `yuva420p`** as the transparent option, `libx264` remaining the default
- Export UI exposes a **Transparent background** toggle, enabled only when the source actually has alpha
- When transparent is selected, format switches to WebM and the UI says plainly that Safari may not play it

Worth considering, not required:

- **Luminance matte pass** — a second video where brightness encodes transparency. Unlocks working
  transparency in Figma via [their documented workaround](https://forum.figma.com/suggest-a-feature-11/prototyping-with-transparent-videos-3744),
  which is otherwise the only route there. Scene3D already does multi-pass bakes, so the machinery is nearby.
- **PNG sequence export** for handoff into After Effects and similar.

## Non-goals

- HEVC-with-alpha. Doubles the encode matrix to serve one browser family.
- Auto-detecting the viewer's browser and serving a different file. That's a hosting concern, and Sailor
  is local-first.

## Open questions

- ~~Does the ComfyUI-side ffmpeg/PyAV build include `libvpx-vp9`?~~ **RESOLVED 2026-07-28 — yes.**
  PyAV 17.0.0, `libvpx-vp9` encoder present, and it advertises `yuva420p` among its pixel formats.
  `libvpx`, `libx264` and `prores_ks` are also available. Nothing needs installing; this is purely a
  codec branch now.
- Do all render paths actually produce alpha? `frontend/app/lib/engine/gl/glRenderer.ts` creates its
  context with `alpha: false`, so at least one path is opaque by construction and would need changing or
  explicitly excluding from the toggle.
- Does the existing frame cache (`ensureSpaceTypeBake`) key on the alpha setting? If not, toggling
  transparency could silently return flattened cached frames.
