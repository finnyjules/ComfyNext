# Type Studio — Effect Gallery Modal

**Date:** 2026-06-25
**Status:** Approved design, ready for implementation plan
**Scope:** Replace the Type Studio editor's bare effect `<select>` dropdown with a visual gallery modal (card grid + detail), where each card shows a cached thumbnail of the effect's default look. Addresses the onboarding gap from the hardening audit ("can't see what Tunnel/Slit-Scan looks like before selecting").

## Background

- The editor ([SpaceTypeSurface.vue](app/components/vue-canvas/SpaceTypeSurface.vue):710-713) picks the effect via `<select v-model="effectId">` over `SPACE_TYPE_EFFECTS`. Switching `effectId` already triggers the existing watcher → `applyEffectDefaults` (control defaults + default scene).
- The app has a shared gallery shell, [CatalogModal.vue](app/components/CatalogModal.vue): props `open/title/subtitle/items/selectedId/searchQuery/searchPlaceholder/confirmLabel/...`; emits `close`, `confirm(item)`, `update:selectedId`, `update:searchQuery`; slots `#card({item,focused})`, `#detail({item})`. Several galleries (Text-effect, Model, Lora, Voice…) wrap it.
- The hardening pass capped live WebGL contexts (~16), so a grid of live preview canvases is out. Thumbnails must be static.

## Decisions (from brainstorming)

- Reuse `CatalogModal` (don't build new gallery chrome).
- Thumbnails render each effect's **default look** (control defaults + a fixed sample word), generated **once** via a single shared offscreen engine and **cached** for the session.

## Architecture

### Thumbnail generator — `app/lib/spacetype/thumbnails.ts` (new)

```ts
export function effectThumbnails(): Promise<Record<string, string>>  // { effectId: objectURL }, memoized
```
- Module-level memoized promise. On first call: if `detectWebGL()` is false → resolve `{}` (graceful: cards fall back to label-only).
- Otherwise create **one** `SpaceTypeEngine` on a detached `document.createElement('canvas')` sized `320×200`, `alpha:false`, `bgColor` from `defaultSpaceTypeState()`. Await `ensureSpaceTypeFont(defaultFont)` once.
- For each effect in `SPACE_TYPE_EFFECTS`: `params = defaultsFromControls(e.controls)`, `params.text = 'Type'`; build a `SpaceTypeState = { ...defaultSpaceTypeState(), effectId: e.id, params }`; `engine.setEffect(e)`; `engine.build(params, texOptsFromState(state))`; `engine.renderFrame(0, params)`; `URL.createObjectURL(await engine.frameToBlob())` → map entry. Wrap each effect in try/catch so one failure (e.g. an effect needing a drawn path) just skips its thumb.
- `finally { engine.dispose() }` — one transient WebGL context, released immediately. (`build`/`renderFrame` already catch internally per the hardening guards, so a bad effect renders blank rather than throwing.)

### Gallery component — `app/components/vue-canvas/SpaceTypeEffectGalleryModal.vue` (new)

A thin wrapper over `CatalogModal`:
- Props: `selectedId: string`. Emits: `close`, `select: [id]`.
- `onMounted` → `thumbs.value = await effectThumbnails()`.
- `items = SPACE_TYPE_EFFECTS.map(e => ({ id: e.id, label: e.label }))`, filtered by a local `searchQuery` (label substring).
- `draftId = ref(selectedId)`; `@update:selected-id → draftId`; `@confirm(item) → emit('select', item.id)`; `@close → emit('close')`.
- `#card` slot: a `16:10` stage with `<img :src="thumbs[item.id]">` (or the label if missing) + the label below.
- `#detail` slot: bigger thumbnail + label.

### Editor wiring — `SpaceTypeSurface.vue`

- Add `import SpaceTypeEffectGalleryModal from './SpaceTypeEffectGalleryModal.vue'` and `const showEffectGallery = ref(false)`.
- Replace the effect `<select>` (lines 711-713) with a **button** showing the current `effect.label` (and a ▾), `@click="showEffectGallery = true"` (same input styling as the old select).
- Render `<SpaceTypeEffectGalleryModal v-if="showEffectGallery" :selected-id="effectId" @select="onPickEffect" @close="showEffectGallery = false" />` in the template (CatalogModal is fixed/teleported, so placement is flexible).
- `function onPickEffect(id: string) { effectId.value = id; showEffectGallery.value = false }` — the existing `effectId` watcher does the rest (switch + defaults + default scene).

## Testing

- **Unit:** `effectThumbnails` is memoized (same promise across calls) and resolves to an object that is empty under no-WebGL (jsdom) — i.e. graceful fallback. (Generation itself is WebGL → verified in-app.)
- **Manual/in-app** (per project convention): open the editor, click the effect button → gallery shows a thumbnail per effect; search filters; picking one switches the effect (and the editor applies its defaults/default scene); no console "too many contexts" errors (one transient engine).

## Out of scope (later)

- Per-effect categories/grouping (flat searchable grid for now).
- Thumbnails from each effect's saved **default scene** rather than control defaults (use control defaults for now).
- Animated/video thumbnails; live detail-pane preview.
- Revoking object URLs (session-lived; ~23 small blobs).
