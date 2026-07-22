# 3D Studio — Google-catalog Font Picker (shared with Type Studio)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The 3D Studio's text primitive gets Type Studio's rich font picker (searchable ~1900-family Google catalog, ✨ describe-a-font AI suggestions, variable badge) instead of the 16-entry local `.otf` select — by (1) extracting the picker out of `SpaceTypeSurface.vue` into a shared component and (2) bridging Google families to parseable TTF binaries for opentype outline extraction.

**Verified premise (controller, live):** requesting `https://fonts.googleapis.com/css2?family=X:wght@W&display=swap` with a **non-browser User-Agent** (e.g. `curl/8`) returns `format('truetype')` URLs on `fonts.gstatic.com`; the binary is a real sfnt (`00 01 00 00`). The vendored opentype in `outlines.ts` (three's TTFLoader parser) handles TrueType, and `commandsToContours` already processes quadratic `Q` commands.

## Global Constraints

- **No new deps.** Reuse `loadGoogleCatalog`/`useFontSuggest`/`useGoogleFontPreview`, the vendored opentype, existing Studio* controls.
- **`content.font` string is the only contract change**: it now also accepts a `google:Family` / `google:Family@700` scheme alongside local URLs (`/fonts/*.otf`). `geoKeyFor`, `fontTokens`, `fontGen`, `refreshTextGeometry`, `fontError` all key on that same string and must keep working UNCHANGED.
- **Variable-font axes are OUT OF SCOPE** for 3D (opentype reads the default instance only). Weight IS in scope via per-weight static files. Space Type keeps its axes sliders — they stay in `SpaceTypeSurface.vue`, NOT in the shared picker.
- **Type Studio behavior must not change** — the extraction is a refactor; same markup/classes, same catalog, same suggest flow, same `params.font` family-name storage.
- The route lives under the ALREADY-ALLOWLISTED `/api/scene3d` prefix (`comfyui-proxy.ts` NITRO_API_PREFIXES) — do NOT touch `comfyui-proxy.ts`; it is dirty with a parallel session's uncommitted edits on the allowlist lines.
- Tests: vitest from `frontend/`; gate per task = named suites green + `npx vue-tsc --noEmit | grep -iE 'scene3d|FontPicker|SpaceTypeSurface|Scene3DStudioSurface'` empty.
- Main-direct, file-scoped commits; never stage parallel-session dirty files.

## File structure

- Create `frontend/server/api/scene3d/google-font-file.get.ts` — family/weight → TTF binary proxy with in-memory cache (under the allowlisted `/api/scene3d` prefix).
- Modify `frontend/app/lib/scene3d/outlines.ts` — `google:` scheme resolution in the font loader + pure `fontSourceUrl()` + `fontDisplayName()` helpers.
- Create `frontend/app/components/vue-canvas/FontPicker.vue` — extracted shared picker.
- Modify `frontend/app/components/vue-canvas/SpaceTypeSurface.vue` — re-wire to FontPicker (behavior-preserving).
- Modify `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue` — font row uses FontPicker (+ weight select for google families).
- Tests: append to `frontend/tests/unit/scene3d-outlines.unit.spec.ts`.

---

## Task 1: TTF proxy route

**Files:** `frontend/server/api/scene3d/google-font-file.get.ts` (new). No other file.

- Query: `family` (required), `weight` (optional int, default 400), `italic` OUT of v1.
- Fetch `https://fonts.googleapis.com/css2?family=<Fam with +>:wght@<W>&display=swap` with header `User-Agent: curl/8` (explicit — undici's default may change). Regex the first `url(https://fonts.gstatic.com/...)` occurrence; require `format('truetype')` in the block, else 502 with a clear message.
- Fetch the gstatic binary; respond with `content-type: font/ttf`, `cache-control: public, max-age=86400, immutable`.
- In-memory cache `Map<family@weight, {at, buf}>` with 24h TTL and a simple size cap (~50 entries, evict oldest) — mirrors `googleCatalog.ts` conventions.
- 404 when Google returns 400/404 for an unknown family (surface `statusMessage`).
- [ ] Verify live against the running dev server (`curl -s "http://127.0.0.1:3000/api/scene3d/google-font-file?family=Bungee" | xxd -l4` → `0001 0000`; unknown family → JSON error, correct status). No unit harness for nitro routes — live check is the gate. Commit the one file.

## Task 2: `google:` scheme in the scene3d font loader

**Files:** `frontend/app/lib/scene3d/outlines.ts`; test `frontend/tests/unit/scene3d-outlines.unit.spec.ts`.

**Interfaces produced:**
```ts
export function fontSourceUrl(value: string): string
// '/fonts/X.otf'            -> '/fonts/X.otf' (passthrough)
// 'google:Inter'            -> '/api/scene3d/google-font-file?family=Inter'
// 'google:Playfair Display@700' -> '/api/scene3d/google-font-file?family=Playfair+Display&weight=700'
export function fontDisplayName(value: string): string
// '/fonts/ABCROM-Bold.otf' -> 'ABC ROM Bold' (AVAILABLE_FONTS label; basename fallback)
// 'google:Inter@700'       -> 'Inter'
export function parseGoogleFontValue(value: string): { family: string; weight?: number } | null
```
- `fetchAndParse` fetches `fontSourceUrl(url)`; the cache (`pending`/`resolved`) stays keyed by the RAW value string — so `google:Inter` and `google:Inter@700` are distinct cache entries, matching distinct geometries. No other loader change; failure semantics unchanged.
- [ ] TDD: RED tests for the three helpers (mapping table above, plus: malformed weight `@abc` → weight omitted; empty family → null; display-name fallback for an unknown local url) → impl → GREEN. Full outlines suite + tsc gate. Commit.

## Task 3: extract `FontPicker.vue`, re-wire Type Studio

**Files:** `frontend/app/components/vue-canvas/FontPicker.vue` (new); `frontend/app/components/vue-canvas/SpaceTypeSurface.vue`.

- Move from `SpaceTypeSurface.vue` (state ~417–452, markup ~1262–1312): trigger button, search input + ✨ Ask AI, "Variable fonts only" `StudioSwitch` row, ✨ Suggested list (in-face previews via `useGoogleFontPreview`), filtered catalog list (120 cap) with `var` badges, empty/loading states. Keep the exact classes/markup so Type Studio looks identical.
- Component contract: `modelValue: string` (what the trigger shows — the caller-formatted display name), `pinned?: { label: string; value: string }[]` (rendered above the catalog under a small "Sailor" header; emitted verbatim), `showVariableToggle?: boolean` (default true). Emits `select` with `{ kind: 'google', family } | { kind: 'pinned', value }`. The picker owns open/close/search/suggest state internally; closes on select.
- `SpaceTypeSurface.vue`: the `c.kind === 'font'` branch becomes `<FontPicker :model-value="String(params[c.key])" @select="…selectFont(c.key, family)…">` — no `pinned`. The axes sliders (`varAxisList`), `fontIsVariable` note, and `fontAxes` machinery STAY in SpaceTypeSurface below the picker. Remove only the moved state (`fontPickerOpen`, `fontSearch`, `variableOnly`, `filteredFonts`, `isVar`/`varAxes`, suggest wiring) — `fontCatalog`/`resolveFontFamily`/`googleAxisList` remain (axes need them).
- [ ] Gate: tsc grep empty; existing spacetype unit suites untouched/green (`npx vitest run tests/unit --dir` NOT needed — run `tests/unit/spacetype-*.unit.spec.ts` if present, else skip); browser check deferred to Task 5. Commit both files.

## Task 4: 3D Studio font row → FontPicker (+ weight select)

**Files:** `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue`.

- Replace the font `StudioSelect` + `fontLabel` proxy with `<FontPicker :model-value="fontDisplayName(selected.content.font ?? DEFAULT_FONT_URL)" :pinned="AVAILABLE_FONTS.map(f => ({ label: f.label, value: f.url }))" :show-variable-toggle="false" @select="…">`.
  - `pinned` pick → `content.font = value` (local url, exactly today's behavior).
  - `google` pick → `content.font = 'google:' + family` (no weight suffix on first pick).
- Weight select: when `parseGoogleFontValue(content.font)` is non-null, show a small `StudioSelect` of the family's catalog weights (from `loadGoogleCatalog()` — the Surface loads it for the picker anyway; fall back to `[400]` until resolved). Change → `content.font = 'google:Fam@W'` (400 may stay explicit; simplest). Hidden for local fonts.
- The existing font watch (`loadFont(url)` + settle-time guards + `fontGen`/`refreshTextGeometry`/`fontError`) and the engine need NO changes — verify by reading, note in report. `DEFAULT_FONT_URL` seeding unchanged.
- [ ] Gate: tsc grep empty; scene3d suites green (engine/config/outlines at minimum). Commit.

## Task 5: gates + browser E2E both studios

- [ ] Full scene3d suite + outlines + tsc grep empty.
- [ ] Browser (dev :3000, hard-reload first — HMR-stale graphs mislead here, see memory): **3D Studio**: Text primitive → font row opens the searchable picker; Sailor group pinned on top (pick one — still works); search "Bungee" → pick → mesh rebuilds in Bungee glyphs (cold google load: placeholder then heal, Size row follows); weight select appears for a multi-weight family (e.g. Inter 400→900 changes stroke weight); save→reopen round-trips `google:` values; ✨ Ask AI returns suggestions. **Type Studio**: open a Space Type node → font picker looks/behaves as before (search, suggest, variable toggle, axes sliders still present for a variable family).
- [ ] Final whole-branch review (path-scoped), then ledger close-out.

## Notes

- The picker emits families; only the 3D surface wraps them in `google:` — FontPicker stays studio-agnostic.
- Google TTFs are static instances; a variable family served via `:wght@W` returns an instanced static file — correct for extrusion.
- Offline/failed catalog: picker shows "Loading fonts…" forever but pinned Sailor fonts still work; route failures surface via the existing `fontError` line. No new error machinery.
