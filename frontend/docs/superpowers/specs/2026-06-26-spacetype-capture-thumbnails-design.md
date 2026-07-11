# Type Studio — Capture-and-save Effect Thumbnails

**Date:** 2026-06-26
**Status:** Approved design, ready for implementation plan
**Scope:** Replace the auto-generated effect-gallery thumbnails (offscreen engine) with manually-captured thumbnails: a "Capture thumbnail" button in the editor snapshots the current preview frame and saves it per-effect; the gallery loads the saved images. Drop the auto-generator.

## Background

- The gallery currently calls `effectThumbnails()` ([thumbnails.ts](app/lib/spacetype/thumbnails.ts)) which renders each effect's default look via one shared offscreen engine. The user finds these "clunky" and not worth perfecting — manual capture is more reliable.
- The scene-defaults feature already establishes the backend pattern: per-effect committable files under `custom_nodes/sailor_bridge/scene_defaults/` via `POST/GET /sailor/space_default*` routes ([nodes_timeline.py](../../../comfy_extras/nodes_timeline.py), `_valid_effect_id`, `_scene_defaults_dir`). The app also already serves PNGs (`web.Response(body=…, content_type="image/png")`).

## Decisions (from brainstorming)

- The Capture button snapshots the **current preview frame** (what's on screen).
- Visibility is a **code flag** `SHOW_THUMB_CAPTURE` (visible now; flipped off / removed when all thumbnails are captured).
- Drop the offscreen auto-generator entirely; effects without a captured thumbnail show a clean label-only card.

## Architecture

### Backend routes (`comfy_extras/nodes_timeline.py`, beside the scene-default routes)

- `_scene_thumbnails_dir()` → `custom_nodes/sailor_bridge/scene_thumbnails/` (mirror `_scene_defaults_dir`).
- `POST /sailor/space_thumbnail/{effect_id}` — validate `effect_id` (`_valid_effect_id`); `data = await request.read()` (raw PNG bytes); write `<dir>/<effect_id>.png` (mkdir if needed). Return `{ok: true}`.
- `GET /sailor/space_thumbnails` — for each `<id>.png` in the dir (id passing `_valid_effect_id`), return `{ id: f"/sailor/space_thumbnail/{id}?v={int(mtime)}" }` (the `?v=mtime` busts browser cache on re-capture). Empty `{}` if none.
- `GET /sailor/space_thumbnail/{effect_id}` — validate; read `<id>.png`, return `web.Response(body=data, content_type="image/png")`; 404 if missing. (The `?v=` query is ignored server-side, only for cache-busting.)

### Frontend composable — `app/composables/useEffectThumbnails.ts` (new)

Mirrors `useSpaceDefaults`:
```ts
export function loadEffectThumbnails(): Promise<Record<string, string>>   // memoized GET → {id: url}; {} on failure
export function effectThumbUrl(id: string): string | null                  // sync read of the resolved map
export async function saveEffectThumbnail(id: string, blob: Blob): Promise<boolean>  // POST bytes + update cache
export function __resetEffectThumbnailsCache(): void                        // test-only
```
- `saveEffectThumbnail` POSTs the blob (`method:'POST', body: blob`) and, on success, sets `_resolved[id] = `/sailor/space_thumbnail/${id}?v=${Date.now()}`` so already-mounted galleries refresh.

### Editor — Capture button (`SpaceTypeSurface.vue`)

- Module const `const SHOW_THUMB_CAPTURE = true`.
- `const capturingThumb = ref(false)`.
- `async function captureThumbnail()`: `stopPreview()`; compute `tw = 480, th = Math.max(1, Math.round(tw * H.value / W.value))` (preserve output aspect); `engine.renderFrame(previewFrame, params)` (the current displayed frame); `const blob = await engine.frameToBlob(tw, th)` (downscales); `await saveEffectThumbnail(effectId.value, blob)`; `finally { startPreview() }`.
- Template: a `v-if="SHOW_THUMB_CAPTURE"` button next to "Make as default" — `{{ capturingThumb ? 'Capturing…' : 'Capture thumbnail' }}`.

### Gallery — load saved thumbnails (`SpaceTypeEffectGalleryModal.vue`)

- Replace `effectThumbnails` import/use with `loadEffectThumbnails`: `onMounted(async () => { thumbs.value = await loadEffectThumbnails() })`. Cards keep using `thumbs[id]` (now a URL) with the label-only `v-else` fallback. No other change.

### Removals

- Delete `app/lib/spacetype/thumbnails.ts` and `tests/unit/spacetype-thumbnails.unit.spec.ts` (the offscreen generator).

## Testing

- **Backend (pytest):** `_scene_thumbnails_dir` is under the bridge; POST writes `<id>.png` and rejects invalid ids; GET map lists existing ids with a `?v=` URL.
- **Frontend (vitest):** `useEffectThumbnails` memoizes the GET, resolves `{}` on failure, and `saveEffectThumbnail` updates the cache (mock fetch) — mirrors the `useSpaceDefaults` test.
- **Manual/in-app:** frame an effect → "Capture thumbnail" → open the gallery → that effect's card shows the captured image; re-capturing updates it; effects not yet captured show label-only.

## Notes / out of scope

- Same **gitignore caveat** as scene-defaults: `scene_thumbnails/` lives under the gitignored `custom_nodes/` — works at runtime, but the PNGs won't commit/ship until a `.gitignore` exception is added (the still-open decision from the default-scenes work).
- `SHOW_THUMB_CAPTURE` is flipped off (or the button removed) once thumbnails are captured.
- No bulk "capture all" or thumbnail cropping UI — capture is one effect at a time at the current frame.
