# Phase 1 M3 — Dogfooding Checklist (WebGL preview engine)

**Enable** (browser console, then REOPEN the timeline editor — the flag is read when the editor mounts):

~~~js
localStorage.setItem('comfynext:Engine.WebGLPreview', 'true')
~~~

**Disable:** set to 'false' or remove the key, reopen the editor. The Canvas2D engine remains the default; WebGL2-less browsers fall back automatically (one console warning).

**Confirm it's active:** the preview canvas carries `data-engine="webgl"`.

## What to exercise (real projects)
- [ ] Scrub + play timelines with mixed clips (video, image, kinetic sequences, titles/lower-thirds)
- [ ] Audio: clips audible during play, volume + audio fades honored, stops on pause, follows seeks
- [ ] Long video assets (the >96MB WebCodecs cap routes them to the element source — look for the console note)
- [ ] Odd codecs / screen recordings / WebM (should warn + fall back per clip, never blank the preview)
- [ ] Long sessions: memory stays flat-ish while scrubbing (decoded-frame LRU is bounded at 24 frames/clip)
- [ ] Compare a render (`/comfynext/render_timeline`) against what the preview showed — WYSIWYG spot checks, esp. rotated/scaled clips

## Known accepted differences vs the old preview
- Titles/lower-thirds now honor transforms/keyframes/fades (matches exports; the old preview ignored them on live titles).
- Layer geometry is quantized like the exporter (the old preview used float fits) — ≤1px shifts, closer to what renders.
- Plain `text` clips don't render in either preview engine (exporter-only until Phase 2/3).
- Clips longer than their video source LOOP (matches exporter and old preview).

## Real-Safari manual pass (actual Safari, not just the webkit-engine CI project)
- [ ] Open the editor with the flag on; confirm `data-engine="webgl"`
- [ ] First play requires a click (autoplay policy) — audio starts after the gesture, clock falls back gracefully before it
- [ ] Video clips decode (WebCodecs) or visibly fall back to the element source — either is a pass; a blank layer is a fail
- [ ] Scrub accuracy on an H.264 asset (element fallback is allowed ±1 frame)
- [ ] Backgrounding the tab mid-play and returning: playback position holds

## Reporting
Console warnings prefixed `WebGLPreviewRenderer:` / `usePlaybackEngineGL:` / `TimelineEditor:` are the signal — copy them verbatim into issues. Flipping back is instant; nothing in the old path was touched.

**M4 gate:** a week of real use with no fallback triggers and no visual complaints → flip the default (design doc M4).
