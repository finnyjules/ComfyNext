# Type Studio — Per-Effect Default Scenes ("Make as default")

**Date:** 2026-06-25
**Status:** Approved design, ready for implementation plan
**Scope:** Let the user author a scene in the Type Studio editor and persist it, self-service, as that effect's default look — so fresh nodes (card preview + editor) of that effect open looking like the authored scene. Type Studio only.

## Background

- A scene authored in the editor is held as `{ effectId, params, gradientStops, post, projection, panX, panY, bgColor, fps, loopDuration, dimsKey, W, H, transparent }` and persisted per-node at `node.data.properties.sailor_spaceType` (`saveConfig`).
- An effect's defaults today are only its per-control `default:` values (the `params`); the studio settings (post-FX, projection, background, gradient) are global (`defaultSpaceTypeState`), not per-effect.
- The **node card** preview ([SpaceTypeNode.vue](app/components/vue-canvas/SpaceTypeNode.vue)) builds its engine from `SpaceTypeState` and currently applies only effect + bg — **not** post-FX or projection/pan. `SpaceTypeState` (state.ts) lacks `post`/`projection`/`panX`/`panY`.

## Decisions (from brainstorming)

- **Full scene** default: `params + post + projection + panX/Y + bgColor + gradientStops`. **Excludes** output `dims`/`fps`/`W`/`H` (export settings, not the look).
- **Self-service**: a "Make as default" button writes a per-effect file via a backend route; the app loads it. No Claude round-trip. Files are committable (ship with the app).
- **Fresh cards** reflect the default scene immediately (via a shared cached fetch) — which requires the card to render post/projection/pan too.
- **Camera neutralized on save**: when saving a default, force `rotateX=rotateY=rotateZ=0`, `panX=panY=0`, `scale=1` so the default opens clean, not locked to the authoring angle. (Only param keys that exist on the effect are touched; scale→1 because 0 = invisible.)
- A node's own **saved config always wins** — default scenes only fill fresh/unconfigured nodes and effect-switches.

## Architecture

### Scene file shape

`custom_nodes/sailor_bridge/scene_defaults/<effectId>.json` (committable):

```json
{
  "params": { "...": "effect params (camera-neutralized)" },
  "post": { "bloom": false, "...": "..." },
  "projection": "perspective",
  "panX": 0,
  "panY": 0,
  "bgColor": "#0e0e10",
  "gradientStops": [{ "color": "#3b5bff", "on": true }]
}
```

`effectId` is the filename, not in the body. `effectId` is validated server-side (`^[a-z0-9]+$`) to prevent path traversal.

### Backend routes (`comfy_extras/`, next to the existing `/sailor/spacetype_encode`)

- `POST /sailor/space_default/{effect_id}` — validate `effect_id`; `json.dump` the request body to `scene_defaults/<effect_id>.json` (create dir if missing). Return `{ ok: true }`. Reject invalid ids (400).
- `GET /sailor/space_defaults` — read every `*.json` in `scene_defaults/`, return `{ "<effectId>": <scene>, ... }` (empty `{}` if none). One call; the frontend caches it.

(`SCENE_DEFAULTS_DIR` resolved relative to the bridge module so it's stable regardless of CWD.)

### Frontend: shared cache — `app/composables/useSpaceDefaults.ts` (new)

```ts
type Scene = { params: Params; post?: PostSettings; projection?: 'perspective'|'isometric'
               panX?: number; panY?: number; bgColor?: string; gradientStops?: GradientStop[] }
let _cache: Promise<Record<string, Scene>> | null = null
export function loadSpaceDefaults(): Promise<Record<string, Scene>>  // GET once, cached (resolves {} on error)
export function spaceDefaultFor(id: string): Scene | null            // sync read after load resolves
export async function saveSpaceDefault(id: string, scene: Scene): Promise<void> // POST + update cache in place
```

- `loadSpaceDefaults` memoizes the GET promise (module-level) so N cards share one fetch; network failure resolves to `{}` (graceful — falls back to today's defaults).
- `saveSpaceDefault` POSTs then writes the scene into the resolved cache map, so already-mounted/new cards see it without a reload.

### Scene helpers — `app/lib/spacetype/scene.ts` (new, THREE-free)

- `neutralizeCamera(params: Params): Params` — returns a copy with `rotateX/rotateY/rotateZ→0`, `scale→1` **only for keys present**.
- `applySceneToState(base: SpaceTypeState, scene: Scene): SpaceTypeState` — merge a scene over a base state (params replace; post/projection/pan/bg/gradientStops override when present). Pure; unit-tested.

### `SpaceTypeState` extension (state.ts)

Add optional `post?: PostSettings`, `projection?: 'perspective'|'isometric'`, `panX?: number`, `panY?: number`. `defaultSpaceTypeState()` leaves them undefined (neutral). No change to existing consumers (optional fields).

### Node card apply (SpaceTypeNode.vue)

1. **Render post/projection/pan in the card** (new): build the engine with `projection`, and call `engine.setPost(state.post ?? DEFAULT_POST)`, `engine.setPan(state.panX ?? 0, state.panY ?? 0)` in mount + rebuild. (Makes the card faithful to the scene generally — also fixes saved nodes not showing post/projection.)
2. **Apply default scene for fresh nodes:** the `state` becomes a ref initialized from saved config if present, else `defaultSpaceTypeState()`. On mount, if there was **no** saved config, `await loadSpaceDefaults()`; if `spaceDefaultFor(state.effectId)` exists, set `state = applySceneToState(defaultSpaceTypeState(), scene)`, rebuild the preview, and stamp it onto `node.data.properties.sailor_spaceType` so it persists. If none, unchanged.

### Editor apply (SpaceTypeSurface.vue)

1. **`loadConfig()`**: if the node has no saved config, `await loadSpaceDefaults()` and, if a scene exists for `effectId`, hydrate params/post/projection/pan/bg/gradientStops from it (before building the engine).
2. **Effect-switch watch / `applyEffectDefaults`**: after resetting to the new effect's control defaults, if `spaceDefaultFor(newEffectId)` exists, apply it over the defaults (params + post + projection + pan + bg + gradient).
3. **"Make as default" button** (in the Effect card, next to "Reset to defaults"):
   - Build the scene: `params: neutralizeCamera({ ...params }); post: { ...post }; projection; panX: 0; panY: 0; bgColor; gradientStops`.
   - `await saveSpaceDefault(effectId, scene)`; on success show a toast/inline confirmation. (Does **not** mutate the live editor sliders — only the saved payload is neutralized.)
4. **"Reset to defaults"** (existing `applyEffectDefaults`): after restoring control defaults, apply the default scene if present — so reset returns to the authored default, not the bare control defaults.

## Precedence (single rule)

`node saved config` > `effect default scene` > `effect control defaults + global defaults`.

## Testing

- **Unit (frontend):** `neutralizeCamera` (zeros rotate/scale only for present keys, leaves others), `applySceneToState` (params replace, partial overrides, missing fields fall through), `useSpaceDefaults` cache memoization + graceful failure (mock fetch).
- **Unit (backend, `tests-unit/`):** POST writes the file; GET returns the map; invalid `effect_id` rejected (no traversal).
- Existing Space Type suite stays green (optional state fields, no behavior change when no scene files exist).
- **In-app sign-off (per project convention):** author a scene → Make as default → confirm a fresh node's card + editor open with that look (camera neutral), and a saved node is untouched.

## Out of scope (later)

- A "clear default" / manage-defaults UI (for now, overwrite by saving again; delete the JSON to remove).
- Propagating the pattern to other studios.
- Capturing dims/fps in the default.
