# Embed bundle network leak — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get `spacetype.js` to zero network references, so a Space Type embed can be exported at all — and add the gate that would have caught this.

**Architecture:** Both leaks have the same shape: a module that mixes a **network fetcher** with a **pure synchronous reader of a module-level cache**. The render path only needs the reader. Split each so the reader lives in a network-free module, leave the fetcher where it is, and re-point the render-path importers. No behaviour changes.

## The problem, measured

```
shader.js     0 absolute URLs
gradient.js   0 absolute URLs
spacetype.js  20 absolute URLs   ← including live fonts.googleapis.com links
```

`export.ts` runs `externalRefs()` on the final HTML and throws when it finds a network reference. With 20 in the bundle, **every Space Type export throws, for every config**. The gate works — it fails loudly rather than shipping something broken — but the surface cannot ship until this is fixed.

### Leak 1 — fonts

`app/lib/spacetype/effects/index.ts` statically imports all 25 effects. Twelve of them import from `~/data/google-fonts`:

```ts
import { resolveFontFamily } from '~/data/google-fonts'
import { resolveFontFamily, fontHasWeightAxis } from '~/data/google-fonts'
```

That module contains `loadGoogleCatalog()` (a `fetch`) and imports `~/data/variable-fonts.ts`, which carries ~10 hardcoded `https://fonts.googleapis.com/...` literals plus licence URLs.

**But neither function needs any of that.** Read `google-fonts.ts:95-110`:
- `resolveFontFamily(value)` reads the module-level `catalog`, and uses `VARIABLE_FONTS` **only** to map a legacy id to a family name (`v.id` → `v.family`). It never touches `cssUrl` or `ttfPath`.
- `fontHasWeightAxis(family)` reads only `catalog`. It does not touch `VARIABLE_FONTS` at all.

In an embed the catalog is always null, and both already degrade gracefully by design (`resolveFontFamily` returns the value as a family name; `fontHasWeightAxis` returns `true`).

### Leak 2 — the shader-effect catalog

`app/lib/spacetype/fills.ts:7` imports `getEffectSync` from `~/lib/shaderfx/catalog`, which also exports `fetchShaderFxCatalog()` (`$fetch('/sailor/shader_effects')`) and `assetUrl()`. Same shape: `getEffectSync` is a pure read of a module-level cache.

## Global Constraints

- **No behaviour change.** This is a pure restructure. Every existing consumer must keep working; 20 files import `~/data/google-fonts`, and only the render-path ones should move.
- **The new modules must import nothing that fetches and contain no URL literals.** That is the whole point.
- Unit tests: `frontend/tests/unit/**/*.unit.spec.ts`, `cd frontend && npx vitest run`.
- Run `cd frontend && npm run build:embed` after any change under `app/lib/` that a bundle reaches.
- Baseline: 6 unit tests fail on main (`agent-capability-routing`, `gradientfx-frame-source`, `spacetype-palette`). Ignore them; add none.
- TypeScript typecheck has ~328 pre-existing errors — not a gate.
- Git: main-direct, explicit paths only. A parallel session shares this checkout with ~100 files of WIP. Never `git add -A` or `git stash`; never stage `frontend/package.json` or `frontend/pnpm-lock.yaml`.

---

### Task 1: The gate that would have caught this

Write it first, and watch it fail. No embed bundle has ever been scanned by `externalRefs` — the gate only ever ran on final HTML, which is why this reached a built artifact unnoticed.

**Files:**
- Modify: `frontend/tests/unit/embed-build-output.unit.spec.ts`

- [ ] **Step 1: Add the scan**

For each built bundle in `frontend/public/embed/`, run the repo's own `externalRefs()` from `frontend/app/lib/embed/bundle.ts` over the file's text and assert it returns `[]`. Use the real function — do not write a second pattern set, because a divergent copy would drift from the gate that actually runs at export time.

Report what it finds per bundle in the failure message, so a future failure names the offending URL rather than just a count.

- [ ] **Step 2: Run it and confirm it fails for exactly the right reason**

`cd frontend && npx vitest run tests/unit/embed-build-output.unit.spec.ts`

Expected: **shader and gradient pass, spacetype fails** listing `fonts.googleapis.com` URLs. If shader or gradient also fail, stop and report — that would mean the problem is wider than diagnosed.

- [ ] **Step 3: Commit the failing gate**

Commit it red, with the failing output quoted in the message body. It documents the defect and makes the next two commits provably the fix.

```bash
git add frontend/tests/unit/embed-build-output.unit.spec.ts
git commit -m "test(embed): scan built bundles for network references (currently failing)"
```

---

### Task 2: Split the font resolver

**Files:**
- Create: `frontend/app/lib/font/resolveFamily.ts`
- Modify: `frontend/app/data/google-fonts.ts`
- Modify: the 12 effects under `frontend/app/lib/spacetype/effects/` that import `~/data/google-fonts`
- Test: `frontend/tests/unit/font-resolve-family.unit.spec.ts`

**Interfaces:**
- Produces: `resolveFontFamily(value: string): string`, `fontHasWeightAxis(family: string): boolean`, `setFontCatalog(cat: GoogleFontLike[] | null): void`, and a `LEGACY_FONT_IDS` id→family map

- [ ] **Step 1: Write the failing test**

Cover the behaviour that must be preserved exactly, taken from the current implementation:
- empty value → `'Inter'`
- a value matching a catalog family → returned unchanged
- a legacy id (e.g. `'inter'`) → its family name
- an unknown value → returned unchanged (assumed to already be a family)
- `fontHasWeightAxis` with no catalog → `true` (the deliberate "don't wrongly hide the weight slider" default)
- `fontHasWeightAxis` for a family with a `wght` axis → `true`; for one with a single static weight and no `wght` axis → `false`

Also assert the module has **no URL literals** — read its own source and check for `http`. That is the regression guard for this whole task.

- [ ] **Step 2: Run it and confirm it fails**

- [ ] **Step 3: Implement**

Move the two functions verbatim. Extract `LEGACY_FONT_IDS` from `VARIABLE_FONTS` as a plain id→family map with **no URLs** — it is the only thing `resolveFontFamily` needs from that file. Add `setFontCatalog()` so the app can populate the cache.

This module must import nothing that fetches. If you need a type from elsewhere, use `import type` (erased at build).

- [ ] **Step 4: Re-point consumers**

`app/data/google-fonts.ts` re-exports both functions from the new module and calls `setFontCatalog()` wherever it currently assigns `catalog`, so its 20 existing importers are unaffected.

The 12 effects import from `~/lib/font/resolveFamily` instead.

**Verify the catalog is still actually populated in the app.** If `setFontCatalog` is never called, `resolveFontFamily` silently degrades to identity everywhere — the app would still render, in the wrong font, with no error. Trace the call and say where it happens.

- [ ] **Step 5: Rebuild and measure**

```bash
cd frontend && npm run build:embed
```

Report `spacetype.js`'s new URL count and byte size. Expect a drop in both.

- [ ] **Step 6: Confirm no regression, then commit**

Run the full unit suite; confirm the baseline 6 and no more.

```bash
git add frontend/app/lib/font/resolveFamily.ts frontend/app/data/google-fonts.ts frontend/app/lib/spacetype/effects/ frontend/tests/unit/font-resolve-family.unit.spec.ts
git commit -m "refactor(font): network-free family resolver for the render path"
```

---

### Task 3: Split the shader-effect catalog reader

**Files:**
- Create: `frontend/app/lib/shaderfx/catalogStore.ts`
- Modify: `frontend/app/lib/shaderfx/catalog.ts`, `frontend/app/lib/spacetype/fills.ts`
- Test: `frontend/tests/unit/shaderfx-catalog-store.unit.spec.ts`

**Interfaces:**
- Produces: `getEffectSync(id: string): EffectDef | null`, `setShaderFxCatalog(cat: ShaderFxCatalog | null): void`

- [ ] **Step 1: Write the failing test**

`getEffectSync` returns `null` before any catalog is set; returns the matching effect after `setShaderFxCatalog`; returns `null` for an unknown id. Plus the same no-URL-literals assertion on the module's own source.

Preserve one documented behaviour exactly — read the comment on `getEffectSync` in `catalog.ts` first: a failed refetch must leave the previous good catalog in place rather than blanking a working sync reader.

- [ ] **Step 2: Run it and confirm it fails**

- [ ] **Step 3: Implement and re-point**

Move the module-level cache and `getEffectSync` into `catalogStore.ts`. `catalog.ts` keeps `fetchShaderFxCatalog` and `assetUrl`, imports the store, calls `setShaderFxCatalog` on success, and **re-exports `getEffectSync`** so its existing importers are unaffected.

`spacetype/fills.ts` imports from the store instead. Check whether `shaderfill/field.ts` should too — it imports both `getEffectSync` and `fetchShaderFxCatalog`, so it may legitimately need the fetching module. Decide and explain.

- [ ] **Step 4: Rebuild and verify the gate is GREEN**

```bash
cd frontend && npm run build:embed && npx vitest run tests/unit/embed-build-output.unit.spec.ts
```

Task 1's scan must now pass for all three bundles. **If any URL remains, report exactly which and where it comes from** rather than widening the test.

- [ ] **Step 5: Report the final numbers**

`spacetype.js` URL count (target 0) and byte size, before and after the whole plan. Adjust the size ceiling downward to match the new reality — a ceiling left at the old value stops detecting anything.

- [ ] **Step 6: Full suite, then commit**

```bash
git add frontend/app/lib/shaderfx/catalogStore.ts frontend/app/lib/shaderfx/catalog.ts frontend/app/lib/spacetype/fills.ts frontend/tests/unit/shaderfx-catalog-store.unit.spec.ts frontend/tests/unit/embed-build-output.unit.spec.ts
git commit -m "refactor(shaderfx): network-free catalog reader for the render path"
```

---

## Done when

- `externalRefs()` returns `[]` for all three built bundles, asserted by a test that was demonstrated failing first
- `spacetype.js` is materially smaller (three.js is only ~332 KB of the original 1.85 MB, so most of the rest was this leaked machinery)
- The app still resolves fonts and shader effects correctly — verified by tracing that the catalogs are still populated, not by assuming
- No new unit-test failures beyond the baseline 6

## Why this is worth doing regardless of embeds

A rendering library reaching sideways into app *data* modules with CDN URLs baked in is a layering violation. It will bite again the next time anything needs `lib/spacetype` in isolation — a worker, a test harness, a server-side render. The embed bundle is just the first consumer strict enough to notice.
