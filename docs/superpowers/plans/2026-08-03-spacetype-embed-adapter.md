# Space Type Embed Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Space Type the third embeddable surface — and the first one that carries real transparency and real fonts.

**Architecture:** `SpaceTypeEngine` already fits the `EmbedSurface` contract almost exactly, so the adapter is thin. The genuinely new work is **assets**: Space Type renders text, and an embed cannot fetch a font. The font must be inlined as a base64 `@font-face` and awaited before the first frame — inside `mount()`, which is async precisely for this.

**Tech Stack:** TypeScript, Vue 3 / Nuxt 4, three.js, WebGL2, Vite (library mode), Vitest, Playwright.

**Prior art:** [web embed export](2026-07-28-web-embed-export.md) · [gradient adapter](2026-07-28-gradient-embed-adapter.md) · [spec](../specs/2026-07-28-web-embed-export-design.md)

## Established facts (verified — trust these)

- `SpaceTypeEngine` is **already an exported class** (`app/lib/spacetype/engine.ts:46`). No per-instance work is needed — unlike Shader and Gradient, which each required a task for it.
- `renderFrameAt(t01: number, params: Params): void` at `engine.ts:322` — **already normalized t01, already synchronous**. This is `setTime` almost verbatim.
- `dispose(): void` at `engine.ts:383` already exists. `setSize()` exists too.
- All 62 files under `app/lib/spacetype/` are **Vue-free**.
- `EngineOptions` (`engine.ts:9`): `{ effect, width, height, fps, loopDuration, alpha, bgColor, projection?, panX?, panY?, preserveDrawingBuffer? }`.
- **`alpha: boolean` is a real engine option** → Space Type is the first surface where `caps.alpha` is genuinely `true`. Shader and Gradient were both measured opaque, so the bundler's `transparent` plumbing has never had a consumer. This task gives it one.
- The 25 effects are all imported by `app/lib/spacetype/effects/index.ts`, so **the bundle includes all of them**. There is no per-config tree-shaking, because bundles are prebuilt before any config exists.
- Per-effect state now lives on `root.userData` and `update()` takes `root` (commit `3f1f905d4`). This is what allows two engines — and therefore two embeds — to coexist. **Do not build this adapter on a tree where that is reverted.**
- **Fonts:** `charLayout.ts:74` and `textTexture.ts:49` build a CSS font string (`"${fontFamily}", sans-serif`) and draw to a 2D canvas. The font must therefore be present in the *document*. In the app, `app/composables/useTemplateFonts.ts:36` injects `<link href="https://fonts.googleapis.com/css2?family=…">`. **An embed cannot do that.**
- `app/composables/useUploadedFonts.ts:49` already builds base64 `@font-face` rules for uploaded fonts. **Reuse that shape.**

## Global Constraints

- **The exported HTML must contain zero network references.** `externalRefs()` enforces it and `exportEmbedHtml` throws on violation. A `fonts.googleapis.com` link would be caught — but only if the font path goes through the bundler, so do not bypass it.
- **Vue and Nuxt must never appear in an embed bundle.** `lib/spacetype` is clean; keep it that way. Do NOT import from `app/composables/**` into the adapter — copy the `@font-face` string-building logic into a Vue-free module instead.
- **Unit tests**: `frontend/tests/unit/**/*.unit.spec.ts`, `cd frontend && npx vitest run` (vitest, node env, no DOM).
- **Browser tests**: `frontend/tests/*.spec.ts`, Playwright. Dev server at `PW_BASE_URL`; on this machine `http://127.0.0.1:3000`. **Always `127.0.0.1`, never `localhost`** — localhost hits the IPv6 listener and returns HTTP 426.
- **Run `npm run build:embed` after changing anything under `app/lib/embed/surfaces/`.** Exports inline the PREBUILT bundle; skipping this makes changes appear to do nothing.
- Known baseline: 6 unit tests fail on main (`agent-capability-routing`, `gradientfx-frame-source`, `spacetype-palette`) — ignore them and add none. TypeScript typecheck has ~328 pre-existing errors — not a gate.
- Git: commit directly to main, staging only explicit paths. A parallel session shares this checkout. Never `git add -A` or `git stash`; never stage `frontend/package.json` or `frontend/pnpm-lock.yaml`.

## The failure mode this plan is designed around

**A missing font does not look broken.** Canvas falls back to `sans-serif`, so the export renders confidently in the wrong typeface. Nobody notices until a client does. Every verification step below must assert the *actual font* was used, never merely that text appeared.

---

### Task 1: Vue-free font inlining

**Files:**
- Create: `frontend/app/lib/embed/fontFace.ts`
- Test: `frontend/tests/unit/embed-font-face.unit.spec.ts`

**Interfaces:**
- Produces: `fontFaceRule(opts: { family: string; weight: number; dataUrl: string }): string`, and `fontFaceId(family: string, weight: number): string`

- [ ] **Step 1: Write the failing test**

Cover: a well-formed `@font-face` rule containing the family, the weight and the data URI; CSS-escaping of a family name containing a quote or backslash (read `cssEscape` in `app/composables/useUploadedFonts.ts` and match its behaviour); and a rejection when `dataUrl` is not a `data:` URI, because a remote URL here would silently defeat self-containment.

- [ ] **Step 2: Run it and confirm it fails**

`cd frontend && npx vitest run tests/unit/embed-font-face.unit.spec.ts`

- [ ] **Step 3: Implement**

Mirror `useUploadedFonts.ts:49`'s rule shape. This module must import nothing — no Vue, no composables — so it can travel into the bundle.

- [ ] **Step 4: Confirm green, then commit**

```bash
git add frontend/app/lib/embed/fontFace.ts frontend/tests/unit/embed-font-face.unit.spec.ts
git commit -m "feat(embed): Vue-free @font-face rule builder for embeds"
```

---

### Task 2: The Space Type adapter

**Files:**
- Create: `frontend/app/lib/embed/surfaces/spacetype.ts`
- Create: `frontend/app/lib/embed/entry-spacetype.ts`
- Modify: `frontend/app/lib/embed/surfaces.ts` (one registry line)
- Modify: `frontend/package.json` (`build:embed` builds a third bundle)
- Test: extend `frontend/tests/unit/embed-registry.unit.spec.ts` and `frontend/tests/unit/embed-build-output.unit.spec.ts`

**Interfaces:**
- Produces: default-exported `EmbedSurface` with `kind: 'spacetype'`; `SpaceTypeEmbedConfig` = `{ effectId: string; params: Params; opts: Omit<EngineOptions, 'effect'>; duration: number; font: { family: string; weight: number; dataUrl: string } | null }`

- [ ] **Step 1: Write the failing registry test**

Assert `embedSurfaceKinds()` contains `spacetype`, that `loadEmbedSurface('spacetype')` resolves with `kind === 'spacetype'`, and — **unlike the other two** — that `caps.alpha` is `true`.

- [ ] **Step 2: Run it and confirm it fails**

- [ ] **Step 3: Write the adapter**

Shape it on `surfaces/gradient.ts`. The essentials:

- Resolve the effect from `effects/index.ts` by `effectId`; **throw** on an unknown id rather than falling back to a default effect — a silently substituted effect is a wrong export that looks right.
- **Inject the font and await it inside `mount()`, before the first render.** `mount()` is async exactly for this. Build the rule with `fontFaceRule()`, append a `<style>` to `document.head`, then `await document.fonts.load(\`${weight} 16px "${family}"\`)` and `await document.fonts.ready`. Skip only when `font` is null.
- Construct `new SpaceTypeEngine({ ...cfg.opts, effect })`, append its canvas to the container, and drive it with `renderFrameAt(t01, params)` in `setTime` — no conversion needed, it already takes t01.
- `setSize` calls the engine's `setSize`; `destroy` removes the canvas and calls `engine.dispose()`.
- `caps: { alpha: true }` — genuinely true here, unlike the first two surfaces.

- [ ] **Step 4: Register and emit a third bundle**

Add `spacetype: () => import('./surfaces/spacetype')` to `REGISTRY`, create `entry-spacetype.ts` mirroring `entry-gradient.ts`, and add a third `SAILOR_EMBED_SURFACE=spacetype` invocation to `build:embed`. `emptyOutDir` is already `false`, so the earlier bundles survive — verify all three exist after a build.

- [ ] **Step 5: Extend the build-output test, and set an honest ceiling**

This bundle carries three.js plus all 25 effects. The existing per-surface ceilings are shader 60,000 / gradient 90,000. Measure the real size and set the spacetype ceiling with headroom, and **write a comment saying what the number is actually detecting** — a heavy dependency creeping in, not a size budget. Report the measured size.

Keep the no-Vue greps. They matter more here than anywhere: `lib/spacetype` is Vue-free today and this is the surface most likely to lose that.

- [ ] **Step 6: Build, confirm green, commit**

```bash
cd frontend && npm run build:embed
git add frontend/app/lib/embed/surfaces/spacetype.ts frontend/app/lib/embed/entry-spacetype.ts frontend/app/lib/embed/surfaces.ts frontend/package.json frontend/tests/unit/embed-registry.unit.spec.ts frontend/tests/unit/embed-build-output.unit.spec.ts
git commit -m "feat(embed): Space Type adapter, registry entry and third bundle"
```

---

### Task 3: Export action, with the font actually embedded

**Files:**
- Modify: `frontend/app/components/vue-canvas/SpaceTypeSurface.vue`
- Modify: `frontend/app/pages/dev/embed-harness.vue`
- Create/extend: `frontend/tests/embed-spacetype.spec.ts`

- [ ] **Step 1: Get the font bytes at export time**

The studio knows its family and weight. The export must turn that into a `data:` URI. Investigate how the app already fetches font *files* — `app/lib/scene3d/outlines.ts:79-121` resolves a `google:Family@weight` token to a real URL and fetches it for 3D text extrusion. **Reuse that resolution path** rather than inventing a second one; report what you found and what you reused.

If the family is a system font with no fetchable file, set `font: null` and have the UI say plainly that the piece will use the viewer's system font. Do not silently export a broken typeface.

- [ ] **Step 2: Add the export action**

Mirror `exportWebEmbed` in `GradientStudioSurface.vue` — in-flight guard, size shown **before** the download, error styling distinct from success. Note `SpaceTypeSurface.vue` already has a Transparent toggle from the video work; the embed export should default `opts.alpha` to the same value so the two exports agree about background.

- [ ] **Step 3: Extend the harness and write the tests**

Add a `__embedHarnessSpaceType` namespace following the gradient precedent (do **not** re-architect into a `kind` parameter). Cover the same layers proven for the other surfaces: mount, setTime changes pixels, setSize, destroy, **two instances on one page**, repeated mount/destroy releases WebGL contexts, adapter matches the studio path, exported file matches the adapter, and corruption makes the comparison fail.

- [ ] **Step 4: THE FONT TEST — the one that matters**

Prove the exported file renders in the **real font**, not a fallback. Rendering "text appeared" is not evidence.

Suggested approach: export the same piece twice, once with the real font inlined and once with `font: null`, and assert the rendered pixels **differ**. Then prove that check has teeth by pointing the `@font-face` at a deliberately different family and confirming the pixels change again.

If you find a more direct assertion — e.g. querying `document.fonts.check()` inside the exported page — prefer it and say why.

- [ ] **Step 5: Verify and commit**

```bash
cd frontend && npm run build:embed
PW_BASE_URL=http://127.0.0.1:3000 npx playwright test tests/embed-spacetype.spec.ts --project=chromium
PW_BASE_URL=http://127.0.0.1:3000 npx playwright test tests/embed-contract.spec.ts tests/embed-export.spec.ts tests/embed-parity.spec.ts tests/embed-gradient.spec.ts --project=chromium
```

Report the exported file size, and how much of it is the font.

---

## Done when

- All four embed bundles build from one `npm run build:embed`
- The Space Type suite passes and the three existing embed suites are unchanged
- An exported Space Type piece renders **in its real typeface**, proven by a test that can fail
- `caps.alpha` is `true` and a transparent export genuinely composites over a page background — the first time that plumbing does anything

## Open questions to resolve during the work, not before

- **Bundle size.** three.js plus 25 effects will dwarf the other bundles. If it exceeds roughly 1.5 MB, say so prominently — it may argue for per-effect bundles, which would be a real architectural change and worth surfacing rather than absorbing.
- **Font subsetting.** A full TTF may be 100–300 KB. Subsetting to the glyphs actually used would cut that hard, but adds a dependency. Out of scope for v1; note the measured cost.
