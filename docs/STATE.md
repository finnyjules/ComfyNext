# State of the Build — Sailor

*Surveyed 2026-07-25 (three parallel codebase sweeps). Update when surfaces land or capabilities change. Companion to [VISION.md](VISION.md) and [ROADMAP.md](ROADMAP.md).*

## Scale

~158k lines in `frontend/app` · 308 components · 27 registered node types · ~22 creative surfaces · 389 unit specs + 20 E2E specs · `frontend/server` 8.6k lines · 50 house styles · 50 image models + ~17 video models.

## Surface maturity map

Legend: **bake** = render/export path · **motion** = animatable · **inspector** = panel UI · **agent** = agent-legible (control descriptor or command surface).

| Surface | bake | motion | inspector | agent | engine LOC |
|---|---|---|---|---|---|
| Space Type | ✅ + clip bake | ✅ timeline clip | ✅ | ✅ descriptor | 11,202 |
| Vector Type Studio | ✅ PNG + SVG export (9 fill types, 6 as real vector; multi-fill/stroke stack + extrude + skew/arc) | ✅ full incl. stagger, preset gallery, **colour tracks**, and 4 per-glyph effects (blink · axis scatter · grade flicker · draw-on) | ✅ | ✅ descriptor (unverified live) | — |
| Scene3D Studio | ✅ 3-pass + mp4 | ✅ own timeline (groups animate) | ✅ + object tree | ❌ | ~6,300 (+ SVG import) |
| Compositor / Frame | ✅ | ✅ motion clips | ✅ | ✅ commands | 1,667 (+1,041 motion) |
| Timeline (NLE) | ✅ webm/mp4 + server | ✅ native | ✅ | ❌ | shared/timeline |
| Gradient Studio | ✅ | ✅ 30 targets, path-based | ✅ (hand-written) | ✅ descriptor | 2,620 |
| Shader Studio | ✅ | ✅ path tracks | ✅ (data-driven) | ✅ descriptor | 806 + 63 effects |
| Texture Studio | ✅ | ❌ | ✅ (data-driven) | ✅ commands | 2,041 |
| Shape Studio | ✅ | ❌ | ✅ | ❌ | 761 |
| Shot Director | ✅ | ✅ keyframes | ✅ | ❌ | 988 |
| Smart Layout | ✅ batch export | ❌ | ✅ | ✅ commands | 7,262 (UI) |
| Lip-Sync Studio | ❌ (server) | ❌ | ✅ | ❌ | 82 |
| LoRA Trainer | n/a (server) | — | ✅ | ❌ | 2,424 (UI) |
| Voice Trainer | n/a (server) | — | partial | ❌ | 341 (UI) |
| Character / Sheet | ✅ sheet gen (5-panel composite) + 10-tile stress | ❌ | ✅ states + stress grid | ✅ capability | — |
| Pose Mannequin | ✅ control img | ❌ | modal | ❌ (excluded) | — |
| Inpaint / Region | ✅ backend | — | toolbar | ✅ ops | — |
| Collection (sweeps) | — | — | ✅ | ✅ | backbone |

### Character system unification + Higgsfield sheets — LANDED 2026-08-13 (`6f4a2e1e0`..`HEAD`)

Full-unification refactor (Approach C, chosen over targeted cleanup) shipped across 14 tasks: the nine competing representations of "a character" (registry record · hand-copied client mirror · LoRA sidecar · `sailor_character*` node props · `CastMember` · materialized `Ref` · `LipSyncSheet.face` · `TrainerSeed` · free-text `subject`) collapse into one shared `CharacterState` model (`frontend/shared/characters/types.ts`), parsed from three legacy record eras at read time. Variants are **states** (Cal-clean / Cal-wet / Cal-bloody, per Higgsfield's one-asset-per-state rule); each state generates five panels — headless full-body front + back, large ¾ portrait, smile + no-smile face close-ups (`nano-banana-pro` via the existing `/api/inpaint/nano-gen` rail) — client-baked into one composite sheet (`sheetImage`) that is **THE identity asset both image and video generation consume identically**. The silent LoRA-vs-ConsistentFace image fork is gone: "Use in image" is now a visible two-way choice when a LoRA exists, and a LoRA-less character goes straight to the sheet path. The state descriptor now reaches the Shot Director's compiled cast clause (`Name (descriptor) [ImageN]`). A state must survive a **10-tile stress test** (`ideogram-character` via `/api/cloud-train/character-shot`, $0.08/tile — the same production rail ConsistentFaceNode uses, chosen over Seedream since no Seedream reference-edit endpoint exists) to reach `locked`; a content edit reverts it to `draft`. Also landed: `useCharacters()` as the one client store (module-level cache, identity-first ref resolution) replacing five `window` CustomEvents with a typed in-module bus (`lib/characters/bus.ts`); per-state PATCH with an `expectedUpdatedAt` 409 guard replacing full-array replace + five stale-closure guards; `sailor_characterBinding` as the one node property (three legacy `sailor_character*` props still read, never written); auto-spend-on-mount removed. Verified end-to-end (`frontend/tests/character-sheet.spec.ts`): casting a character into a Shot Director and generating writes the FilmShotNode's `model_options.image_urls[0]` from the state's sheet filename and the compiled prompt's cast clause from its descriptor; "Use in image" wires an Image node carrying the SAME bare sheet filename into a ConsistentFaceNode — the acceptance property (images and video consume the same asset) holds through two independent consumers. Methodology: Higgsfield's Seedance character-sheet guide. Spec: [2026-08-12-character-system-unification-design.md](superpowers/specs/2026-08-12-character-system-unification-design.md) · plan: [2026-08-12-character-system-unification.md](superpowers/plans/2026-08-12-character-system-unification.md) (`f5a09ee15`).

**Owed — live paid verification** (code-complete, unit + E2E green, no real backend call made yet): one live 5-panel sheet generation end-to-end (~$0.40–0.70, nano-banana-pro × 5 panels + composite bake); one live 10-tile stress test + Lock (~$0.80, `ideogram-character` × 10); one Seedance render from a sheet-cast Shot Director character (confirms the compiled `image_urls` actually resolves and the model honors the identity lock in a real render, not just in the submitted payload).

#### Character Studio workbench — LANDED 2026-08-13

Presentation-only refactor on top of the character-system unification above: the six-section `CharacterLibraryPanel` is gone, replaced by a thin `CharacterRosterPanel` (one card per character — portrait, name, readiness chip, training-pipeline chip, `StudioButton` "Image"/"Shot" actions, "+ New character") and `CharacterStudioModal`, a workbench where the composite sheet is the stage: looks rail on the left (one row per state, click to switch, "+ New look" expands *Describe*/*Dress her* inline creators), the sheet with per-panel hover-to-redo regions, descriptor line, photos drawer, and a footer that builds/rebuilds the sheet or enters test mode. All orchestration (sheet gen, reroll, stress run, dress, state CRUD, descriptor save) moved verbatim off the old panel into `useCharacterStudio.ts`; a new pure `lib/characters/readiness.ts` is the ONLY source of status wording — the hidden state machine (`status`/`stressResult`) now speaks exclusively in a four-word vocabulary: **Not built** (grey, no sheet yet) · **Not tested** (grey, sheet built, never stress-tested) · **N/10 poses** (amber, a stress test judged but incomplete) · **Ready** (blue, locked). The words "locked"/"draft"/"stress"/"variant" never reach user-facing text anywhere in the roster or modal (grep-verified); `CharacterNode`/`CharacterPickerModal` badges were reworded the same way. **Kill list:** `CharacterLibraryPanel.vue` and the `CharacterSheetNode` canvas node both deleted outright (registration removed, saved-graph degrade verified — a graph referencing the old node type no longer crashes on load).

Test mode (10-tile stress grid, ✓/✕ per tile) now **persists partial judgments**: marking any tile mid-test writes a real `stressResult: { passes, total, at }` immediately (`partialResultPatch`), so leaving test mode early or switching looks doesn't lose progress — readiness reads it back as "N/10 poses" rather than reverting to "Not tested". Judging the 10th tile fires **auto-ready** (`shouldAutoReady`/`autoReadyIfComplete`): the state locks without a separate confirm click, a toast announces `"‹Name› is ready"`, and the modal drops back to the sheet automatically. Entering test mode itself never spends — the stage shows an inline **money-gate confirm** ("This generates 10 test images · ~$0.80" + Cancel/Confirm) before `runStressTest` fires; this is the one explicit click that can spend money in the whole modal, mirroring the sheet-build button's own cost label.

Verified end-to-end (`frontend/tests/character-sheet.spec.ts`, route-mocked fixture, no real spend): Scenario A (Shot Director's own "+ Cast" picker → Generate) and Scenario B (roster's "Image" button) both still resolve to the same sheet-filename identity asset; new Scenario C opens a roster card into the studio modal and asserts the readiness badge is exactly one of the four vocabulary words, the rendered modal contains none of the retired locked/draft/stress/variant wording, and the looks rail lists the fixture's states. Scenario A deliberately keeps using the dialog's own picker rather than the roster's "Shot" button — that button only drops an unwired `Character` node onto the canvas (`castEdges.ts`'s `via: 'wire'` path needs a real drag-to-wire, unit-tested separately, not driven headlessly in this codebase's E2E). Targeted suite: 13 files / 181 tests green (`character-readiness`, `character-studio-composable`, `character-model`, `character-registry`, `character-state-patch`, `characters-composable`, `character-bus`, `character-stress`, `sheet-generation`, `sheet-composite`, `shotdirector-cast`, `shotdirector-cast-edges`, `capsule-persistence`). Typecheck: 415 errors total (within the drifting cross-session baseline), zero naming `readiness`/`CharacterStudio`/`CharacterRoster`.

**Still owed — live paid verification** (unchanged from the unification entry above, plus): the 5-panel sheet generation, the 10-tile stress test + auto-ready, and the Seedance sheet-cast render all still need one live paid run each through the NEW workbench surface specifically (code paths are identical to the unification-era ones, but never exercised through this UI); the money-gate confirm screen itself has not been visually checked live; the "Dress her" new-look flow (garment photo or text → dress → keep-look) has unit coverage but no live run.

Spec: [2026-08-13-character-studio-workbench-design.md](superpowers/specs/2026-08-13-character-studio-workbench-design.md) · plan: [2026-08-13-character-studio-workbench.md](superpowers/plans/2026-08-13-character-studio-workbench.md).

### Scene3D environment presets + Prism material chip — LANDED 2026-08-13 (`e271165c6`..`34d2ef6be`)

3D Studio's env map is no longer hardcoded `RoomEnvironment`: a scene-level **Environment** control (Lighting section: Room / Dark / Softbox / Gels) picks a procedural PMREM world — `lighting.environment` in the doc, `environments.ts` builds each tiny HDR scene (MeshBasicMaterial colours >1.0 read as light sources through the float PMREM). **Dark studio** (black void + 6 bright strip bars) is the one that unlocks the refractive-prism look: glass + the existing `dispersion` param finally has high-contrast light to split, so streak highlights fringe into rainbows in both reflection and refraction. **Softbox** = product-render panels; **Gels** = opposing magenta/cyan neon. A one-click **Prism** chip (glass Transparency section) applies the tuned recipe (glass, roughness 0, IOR 1.55, thickness 1.5, dispersion 3.5) + Dark env + black background in one action. Engine rebuilds the env target only on kind change and on context restore (current kind, not hardcoded Room); `lighting.environment` is agent-controllable (`controls.ts` select). Verified with real clicks in the Browser pane: Room-vs-Dark pixel diff (washed grey slab vs black + streaks), dispersion 0-vs-5 at fixed framing (white streaks vs rainbow fringes + warm caustic), chip click-through, 4-env distinctness. Spec: [2026-08-12-scene3d-environment-presets-design.md](superpowers/specs/2026-08-12-scene3d-environment-presets-design.md) · plan: [2026-08-12-scene3d-environment-presets.md](superpowers/plans/2026-08-12-scene3d-environment-presets.md).

### Compositor gradient-map post effect — LANDED 2026-08-10 (`747068d15`..`8965b19f6`)

Image layers on a Frame get a **Gradient Map** post effect — recolour by luminance through a **fully-customisable multi-stop ramp** (dark→…→bright), i.e. Duotone with any number of colour stops. Almost pure reuse: the maths ports `shader_effects/gradient_map.frag` to a CPU kernel `gradientMapInPlace` (modelled on `duotoneInPlace`, same luminance coeffs + mix formula), the panel reuses the existing `StudioGradientRamp` multi-stop editor, and the `{pos,color}` stop shape is shared verbatim. It's a `CHAIN_TYPE` in the Compositor's own post system (`postEffects.ts`) — no GPU, no shared-manifest change — so it lands in the canvas-2D chain (`adjust → duotone → gradientMap → bloom → vignette → grain`) and is available per-image-layer AND whole-frame for free. Params: the ramp (fully custom), Mix (0–1), Contrast (−1..1).

Built subagent-driven TDD (2 tasks, each reviewed clean; whole-feature review merge-recommended). **6 unit specs** on the kernel, including a **duotone-parity check** (black→white 2-stop at contrast 0/mix 1 == `duotoneInPlace`) that proves the ramp maths matches the established effect rather than merely running, plus edge cases (mix 0 / empty / single-stop flat tint / unsorted). **Owed:** live Browser-pane click-through (handed to Julien — leader-lock on his open tab). **Minor (inherited, not blocking):** `StudioGradientRamp` floors at 2 stops (`scene3d` `GRADIENT_STOPS_MIN`) so the kernel's single-stop path is UI-unreachable; and alpha-hex stops preview translucent but render opaque (`hexToRgb` strips alpha, same as duotone — [[studio-color-picker-emits-alpha-hex]]). Spec: [2026-08-10-compositor-gradient-map-design.md](superpowers/specs/2026-08-10-compositor-gradient-map-design.md) · plan: [2026-08-10-compositor-gradient-map.md](superpowers/plans/2026-08-10-compositor-gradient-map.md).

### Frame "Add image" can pick a canvas image — LANDED 2026-08-10 (`38fec4153`..`548e92942`)

The Frame/Compositor "Add image" button was upload-only; it now offers **upload from computer OR pick an image already on the canvas**, in both the full Compositor modal and the inline Frame node. Almost entirely reuse: the canvas-image grid `FillImagePicker` (already used by the shape-fill flow) and the paste path's URL→File logic, extracted into a shared, unit-tested `lib/canvas/imageUrlToFile.ts` (which `pastedNodeImageFile` now also uses — DRY). A composable helper `addImageFromCanvasSrc(src)` fetches the picked node's image URL and routes it through the existing `/upload/image` + `createImageLayer` path (snapshot semantics — a picked image is copied to the input dir, not live-linked, matching shape-fill/paste). A shared `AddImageSourcePopover.vue` both toolbars mount presents Upload + the grid.

Built subagent-driven TDD (2 tasks, each reviewed clean; opus... sonnet final whole-branch review). The **final review earned its keep**: the per-task reviews (typecheck + wiring) passed a picker that would have rendered **clipped/invisible** — it was `position:absolute` inside `overflow-hidden` ancestors (the modal root and `.frame-shell`), so the panel opened off the clipped bottom edge and the click looked dead; and Escape fell through to close the whole modal / exit edit mode. Both fixed (`548e92942`): the picker now **Teleports to `<body>`** (fixed centered overlay, escaping the clip — same reason `StudioColor` teleports; inject('vueFlowNodes') still resolves because Teleport moves DOM not the component tree), and an early `addMenuOpen` guard in both parents' Escape handlers closes only the picker. Tradeoff of the teleport fix: the picker is now a centered modal-style dialog, not a dropdown anchored under the button. **Owed:** live Browser-pane click-through (handed to Julien — opening a competing Browser pane on :3000 would fight the leader-lock on his open tab). Spec: [2026-08-10-frame-add-image-from-canvas-design.md](superpowers/specs/2026-08-10-frame-add-image-from-canvas-design.md) · plan: [2026-08-10-frame-add-image-from-canvas.md](superpowers/plans/2026-08-10-frame-add-image-from-canvas.md).

### Restyle from image accepts a moodboard as the style source — LANDED 2026-08-09 (`5c5243463`..`2d1ffacbf`)

Moodboards used to reach only the Generate-an-image node; **Restyle from image** took a content photo + one style *image* and nothing else. Now a moodboard can drive a restyle: its images (≤3) become the style references and its taste reading rides the TASTE wire, **overriding** the single `style_image` slot. The result — "redraw this photo in my moodboard's look" — is a one-wire operation.

The spine is **reuse the existing moodboard style channel**, not a parallel one. `RestyleFromImageNode` (Python) gains the same two appended inputs Generate has — a `_TASTE.Input("style_in")` socket (the compiled taste block flows in server-side when wired) and a hidden `style_refs` widget (`{folder, files[]}` JSON, input-dir relative). `execute` now: when a validated `style_refs` payload is present, sends `image_input = [content_url, *board_urls]` on the Nano Banana engines (content first, ≤3 board images as STYLE-only refs via the shared `_STYLE_REFS_INSTRUCTION`) and folds the taste block in as extra direction — the single `style_image` is ignored; the IP-Adapter engine (single-image only) falls back to the board's first image; with no board the path is byte-for-byte the old single-style behaviour; a restyle with no board **and** no style image now raises instead of crashing the encoder. Frontend: a new pure `applyMoodboardToRestyleNode` attaches the board with **no model switch** (restyle already defaults to Nano Banana 2, and its engine selector isn't the shared catalog — so the switch/marker path is never entered); `styleInject` generalised to write `style_refs` for both node types by name; the four canvas moodboard-wire gates now route through one shared `nodeTakesMoodboard()` predicate; and applying a board **disconnects any wire feeding `style_image`** and disables that slot in the node UI (greyed, non-connectable, tooltip "Moodboard is providing the style"). The chip renders on restyle with "refs ✓" and — because restyle never sets the switch marker — **no** "Switched to Nano Banana" banner.

Built subagent-driven TDD (5 tasks, each reviewed clean; final whole-branch review on opus clean — no Critical/Important). **6 Python + 42 frontend unit specs** green at HEAD (restyle execute: ref-array shape/cap, IP-Adapter fallback, taste fold, no-board parity, malformed-degrades, no-source raise; `applyMoodboardToRestyleNode` no-switch/refs/single-carrier; `styleInject` restyle path). VueNodeCanvas.vue shares an uncommitted parallel-session hunk — only this feature's hunks were staged (`git apply --cached` of a line-range-filtered patch). **USER-CONFIRMED live 2026-08-09** ("worked beautifully") after a ComfyUI restart — the schema change isn't picked up until the Python backend reloads (Nuxt hot-reloads TS/Vue but object_info is read once at startup); until then the TASTE wire lands on the still-IMAGE `style_image` and the graph is rejected at submit. **Deferred Minor (fast-follow):** an imageless/deleted-image board on restyle disconnects `style_image` then raises, discarding the still-usable taste block (Generate degrades to text-only; restyle could too). Spec: [2026-08-09-restyle-moodboard-style-design.md](superpowers/specs/2026-08-09-restyle-moodboard-style-design.md) · plan: [2026-08-09-restyle-moodboard-style.md](superpowers/plans/2026-08-09-restyle-moodboard-style.md).

### Fonts — Pangram + Off-Type library across every picker — LANDED 2026-08-09 (`ca70fe3a6`..`15c84bf74`)

Sailor knew two font sources: Google Fonts and a handful of hand-wired locals (PP Neue Montreal). Julien's licensed desktop collection — the full **Pangram Pangram Foundry** library plus the **Off-Type** foundry — now flows through every font surface: **105 families / 1,302 OTF faces**, auto-catalogued, without hand-wiring 1,300 files or committing 200 MB to git.

The spine is **one generator → one manifest → two worlds**. `frontend/scripts/build-font-library.mjs` walks `Assets/Fonts/` (both bundles, gitignored — the OTFs live only on disk), parses each face with **fontkit**, and keys on the *typographic* name records (`preferredFamily`/`preferredSubfamily`, not the weight-split `familyName`) so "PP Editorial New Heavy" groups under "PP Editorial New" at weight 900 rather than fracturing into its own family. Output is the committed `app/data/library-fonts.manifest.json`. A Nitro route `GET /api/library-font/<id>` streams the OTF by stable face id (id-keyed lookup + path-traversal guard, mirroring the uploaded-brand-font route; it also had to be added to the `comfyui-proxy` allowlist or the proxy swallows it). The shared catalog `app/data/library-fonts.ts` is the single consumer surface (`librariesByFoundry` · `resolveLibraryFace` nearest-weight · `libraryFontUrl` · `filterLibraryGroups` · `libraryToken`), feeding **both** font worlds from that one manifest: the **CSS/DOM** world via a `useLibraryFonts` composable that injects one `@font-face` per face, and the **outline/3D** world via a new `local:Family@weight` token that `fontSourceUrl` resolves to the route through an *injected resolver* — so `outlines.ts` stays dependency-light and out of the embed bundle's network checks, the same inversion `resolveFamily.ts` already uses. Space Type also needed its CSS/canvas render path taught `local:` (it renders text two ways). All three pickers gained source tabs: main + widget = **Google | Pangram** (Off-Type is a labelled section inside Pangram); template = **Google | Pangram | Brand**, each tab defaulting to the source that owns the current value and driven by the one shared `filterLibraryGroups` helper.

Built subagent-driven TDD (10 tasks, each reviewed clean; then a final whole-branch review on opus). **32/32 unit specs** across 8 files (helpers, manifest invariants, route resolver + traversal guard, catalog, `local:` token round-trip, `@font-face` builder, filter, server family→face resolver). Runtime-verified against the live server **by measurement, not by eye** ([[graceful-fallback-hides-integration-failure]] discipline): `/api/library-font/<id>` returns `200 font/otf` with SFNT signature `OTTO` (real CFF/OpenType that opentype.js parses); `document.fonts.load`+`check` succeed; `measureText("Handgloves 123")` gives three distinct widths — fallback serif **313.3**, PP Mori **334.4**, PP Editorial New **256.9** — proving the licensed faces actually render and two families genuinely differ. The **final review caught two output-surface parity gaps** the per-task lens missed — persisted Compositor frames + motion bake weren't *injecting* the library `@font-face` (only `document.fonts.load`-ing it, which no-ops on an unregistered face), and the template **satori PNG** render had no library branch (a picked Pangram family 404'd to Google → Inter). Both **fixed** (`65e8af086`): the two persisted paths now inject via `useLibraryFonts().ensure` like the live modal, and the server render resolves a family→face OTF via a new `resolveLibraryFaceByFamily` helper (library takes precedence over the Google loader). **Owed:** the interactive picker click-through on the canvas (a parallel session held the dev-server leader-lock and the hidden Browser pane pauses rAF, so 3D wouldn't render — a Julien hand-check); the Space Type **web-embed export** still degrades a library font to system (data-URI inlining not yet wired); and satori italic / non-400-700 weights follow the render file's pre-existing tier convention (nearest-weight snaps, so Book=375 renders; italic falls back — file-wide, not library-specific). Minor: the main FontPicker doesn't yet default its active tab to the current value's source (widget + template pickers do). Spec: [2026-08-09-pangram-font-library-integration-design.md](superpowers/specs/2026-08-09-pangram-font-library-integration-design.md) · plan: [2026-08-09-pangram-font-library.md](superpowers/plans/2026-08-09-pangram-font-library.md).

### Pattern Studio — output sheet (resolution + density) — LANDED 2026-08-08 (`abcb05274`..`741fa048f`)

Pattern Studio always exported exactly **one square 1024×1024 tile** — no size control existed anywhere. It now has an **Output tab** (the `Design | Output` strip Type and Gradient already use; Pattern has no motion, so Output takes that slot) where you set the exported **sheet** and the **tile size** inside it. Resolution is the sheet, **density is the tile against it** — a 512px tile on a 4K sheet reads as a fine field, a 2048px tile as four big ones. Presets `Tile · square` / 16:9 / 9:16 / 2048² / 4K / Custom (W/H), tile 128–2048. Repeats are derived and shown (`3.75 × 2.11 repeats`) with a chip that lights only when the export **self-tiles** — free crop, nothing snaps.

The structural bet is **one resolver, four render paths**. `~/lib/texturefx/sheet.ts` is pure (`sheetFromParams` · `repeatsFor` · `isTileable` · `isSheetFramed` · `fitLetterbox` · `tilePositions` · `drawSheet`) and deliberately **renderer-free** — `controls.ts` imports it and sits in the Collection resolver's dynamic import graph, so the GL-dependent bake lives in a separate `bake.ts`. Studio export and the node's headless cascade bake are now **literally the same function** (`bakeSheetBlob`); both previews scale the tile to its on-screen size, so previewing a 4K sheet never costs a 4K render ([[smart-layout-render-parity]] discipline). Default params resolve to 1024×1024 from a 1024 tile, so **every already-saved pattern exports unchanged** — locked by a unit assertion and by measurement. The node card keeps its full-bleed swatch on `Tile · square` (that output is a material sample) and letterboxes once a real sheet is chosen.

Built subagent-driven TDD (6 tasks, each reviewed). Review caught a **Critical in the plan's own formula**: on the Tile preset `s.w === s.tile`, so `s.tile * (box.w / s.w)` collapses to `box.w` and `tilePx` cancels — every existing node card would have drawn one enlarged tile cropped 33% off the bottom instead of the repeating swatch. Fixed with a `view` sheet that has zero dependence on the sheet; also made the card's clip `try/finally` (the 2D context persists across frames, so a throw left it permanently clipped). The final review found the resolver's own **source-of-truth split** — `isSheetFramed` and `sheetFromParams` disagreed on an unrecognised preset label — plus the fact that **preset labels are persisted identities**, so a copy edit or a Unicode `×`/`·` normalisation would silently re-export saved patterns at 1024². Labels are now locked by test. **87/87 tests**; final whole-branch review (opus) = merge-ready.

Runtime-verified in the browser, not by eye: the real PNG from the *As image* button measured **1920×1080**; the same sheet at tile 512 vs 2048 measured motif periods of **128px vs 512px** (exactly 4×, so the density dial moves real pixels); the default card's period-148 match was 360/360 while 140/160/120 all failed (a discriminating test, not a vacuous one); the letterbox matched `fitLetterbox` row-for-row; settings survived a full reload. **Owed:** the cascade's `bakeOutput` was proven only through the shared function it calls (`renderSheetCanvas` → 1024², 1080×1920, 3840×2160, 1500×700 live) — `toBlob` never fires in a hidden Browser pane, so the end-to-end cascade click is unrun. Spec: [2026-08-08-pattern-studio-output-sheet-design.md](superpowers/specs/2026-08-08-pattern-studio-output-sheet-design.md) · plan: [2026-08-08-pattern-studio-output-sheet.md](superpowers/plans/2026-08-08-pattern-studio-output-sheet.md).

### Compositor / Frame — image fill for shapes — LANDED 2026-08-08 (`26b837787`..`2759d69c1`)

Selecting a shape in a Frame now lets you fill it with an image picked from **any image-bearing node on the canvas** (thumbnail picker via injected `vueFlowNodes`), with fit modes **Cover / Contain / Tile / Stretch** plus **scale** and **X/Y offset**. The picked URL is a **snapshot** (frozen at pick time — survives deleting the source node). Structurally it's a 4th `Paint` variant `ImageFill` (`~/lib/compositor/paint.ts`), plain JSON so it round-trips with the layer; because every shape kind already carries `fill: Paint`, one addition made them all image-fillable. Renders through the **shared** `resolvePaint` as a `CanvasPattern` reading a shared bitmap cache (`~/lib/paint/imageFillCache.ts`) that hosts preload via `ensureLayerImages` — so Frame node, Compositor modal, and export bake stay pixel-identical ([[smart-layout-render-parity]] discipline). Widening the union forced `isImageFill` guards in every Paint consumer (`paintTileBox`, `descriptor.inputKey`, `toVector`→null SVG-embed fast-follow, `FillSwatch`). The centered-origin pattern matrix is **numerically pinned** by a RecCtx test. Offered on shape **fill only** in v1 (behind an `allowImage` prop; excluded from the nested shader-input editor). Feature suite **49/49**; final whole-branch review (opus) = merge-ready. **Owed:** interactive click-through (cross-surface parity, fit cycling, source-node deletion, save/reload). Spec: [2026-08-08-shape-image-fill-design.md](superpowers/specs/2026-08-08-shape-image-fill-design.md) · plan: [2026-08-08-shape-image-fill.md](superpowers/plans/2026-08-08-shape-image-fill.md).

### Smart Layout — Round 2b: the staging library — LANDED 2026-08-09 (`dd0d25556`..`109cf3d00`)

The library Julien asked for, built from the full 23-layout [backpocket.so](https://backpocket.so/) study: **exactly 14 stagings in 4 families** — Type-dominant (statement's edge-cropped giant, manifesto's inverted numeral-mass with a serif knob, index's two-per-row ruled table, stacked), Photo-as-block (tower/split/frame rebuilt + corner with a *vertical hero* option), Photo-as-field (cover's overprint, lockup's serif jewel, header/footer bands — all `needsImage`, gated in Surprise and the panel), and Texture (repeat's hot-copy column running *behind* the photo, wall's dim edge-to-edge type field). Every composition uses the round-2a vocabulary for real: declared overlaps with **negative-control tests** (strip the declaration → the validator must name the collision), overhang crops, orientation, scrims, `opacity`. Registry housekeeping: `editorial`/`centered` retired via `STAGING_MIGRATIONS` (image-presence decides centered's heir), panel chips grouped by family. The final opus review caught the round's real hole: **multi-item tiers broke 4 stagings at 3 items and shipped silently** — the closing test matrix had run at the wrong grid size with default knobs (the same class of hole that hid the round-1 collapse). The fix wave landed item-count-aware stacking, a **96-block / 828-composition validator matrix at the production 78×78 grid**, a `gen.validation` stamp (no more silent-unvalidated output), fewest-reasons re-roll selection, `growLimit` sibling caps, the agent surface finally learning `opacity`/`orientation`/`overhang`, and **Family C proven in real pixels** (satori→resvg render; the re-reviewer deliberately inverted the z-order to prove the test discriminates). 1229/1231 unit + E2E ×2 green. **Owed:** Julien's own taste pass over the 14 compositions (geometry is review-verified, not taste-confirmed); 2c fast-follows (treatment ControlSpecs, per-item hide UI, palette-or-hex, texture-copy agent labels). Plan: [round2b-staging-library](superpowers/plans/2026-08-09-smart-layout-round2b-staging-library.md).

### Smart Layout — Round 2a: themes, multiplicity, tension — LANDED 2026-08-08 (`ce6561684`..`eaa434486`)

Julien's live critique of round 1 ("surfaces are useless — white on white", "can't add more of one element", "hierarchy needs to be more dramatic", "text and images should overlap and go over the canvas") plus a full 23-layout study of [backpocket.so](https://backpocket.so/) drove a second round (spec: [round2-themes-tension](superpowers/specs/2026-08-08-smart-layout-round2-themes-tension-design.md)). **Surfaces → themes:** one 7-swatch palette (black/white/paper/red/orange/green/blue), three roles (field/ink/accent), **ink resolved by WCAG luminance** (the white-on-white class of bug is structurally dead), accent-on-headline toggle, stamped into `template.brand` as the lowest merge layer so a project kit re-skins everything; **user-edited brand keys are pinned (`gen.brandEdits`) across ALL rolls — only an explicit theme pick adopts the new system** (decided policy). **Multi-item tiers:** `+ List`/`+ Detail` append; stagings distribute lists into slots (adaptive `singleRowSpan` keeps single items generous). **Dramatic type:** `heroScale` {0.10/0.14/0.18}×canvas-height, `lineHeight 0.92`, tight negative tracking; support+fineprint share one small size (3 sizes total — which also fixed a latent round-1 deadlock where every generation failed the ≤3-sizes validator and burned all 8 re-rolls). **The big root-cause:** stagings composed in a hardcoded 12×16 grid while the resolver reads `fineGridDims` (78×78 on v3) — every region silently collapsed to ~15% of canvas; compose-space now provably equals resolve-space. **Overlap + overhang** as declared moves (clamping-only principle: `remapRegionRaw` preserves fractional identity; drag/nudge past the edge auto-sets `overhang`, real-pointer E2E). **Text orientation** (vertical up/down, axis-swapped fit, shared predicates both renderers). **Opt-in photo treatment** (auto-grayscale explicitly rejected by Julien): grayscale via CSS (satori gate verdict: filters supported), duotone/grain via `sharp` at inline time mapping through the effective theme ink, bake failures fall back to the untreated image. Built subagent-driven, 12 tasks + per-task reviews + a final opus whole-round review whose fix wave closed 1 Critical (hex-parse crash reachable from the free-text Brand popover) + 7 Important (incl. Surprise discarding overrides, z-order clobbered on regen, vertical×grow ballooning). 439 unit tests + E2E ×2 green. **Next: plan 2b — staging library v2** (~6→14 composers across the studied families; where Julien stages the compositions himself), deliberately unwritten until now so it plans against real post-2a code.

### Smart Layout — Staging × Surface generation — LANDED 2026-08-08 (`f24f1f6f7`..`fa5cfcaf1`)

Smart Layout became **generatable**: rank content into **importance tiers** (Hero → Anchor → Support → Fine print) and Shuffle/Surprise through poster layouts, like the "Swiss Grid Studio" reference (MAT+FEST / HUS AV GLAS aesthetic). Variety-with-fidelity comes from **two independent axes** — **Staging** (6 hand-authored composers: Tower, Split, Frame, Centered, Editorial, Index) × **Surface** (5: flat, holographic, tint, split-field, duotone-photo). The structural bet: generation is a **pure engine** under `shared/template-grid/generate/` (rng · tiers · knobs · stagings · surfaces · validate · orchestrator) that emits the **existing `TemplateV3`** — so the resolver, Satori render, and format reflow are all inherited unchanged (no new render surface, [[smart-layout-render-parity]] protected). Every roll is **seeded** (mulberry32, salted per-axis) so it's reproducible; **tier `type` overrides ride the tier and survive a re-roll**; `origin:'staging'|'freeform'` means Shuffle regenerates only staged elements and never clobbers hand-added ones. Wired into the editor as a **Layout / Freeform** mode toggle (one toolbar; Layout mode adds semantic items +Headline/+Anchor/+List/+Detail), a right-panel **LayoutControlsPanel** (staging×surface chips, Shuffle/Surprise, per-axis lock, seed) + **TierTypePanel** (font/weight/tracking/colour). A freshly-dropped node seeds tiers from wired sockets and lays out one composition on open. Built subagent-driven TDD (15 tasks, each reviewed) — the review loops caught **5 real defects in the plan's own sample code**: `applyContrast` dead-code (staging hardcoded a foreground colour that always beat the surface contrast), a background-merge stale-image leak on surface switch, generation actions not marking the doc `dirty` (Save stayed disabled), a first-open **and** reopen duplicate-hero (autopopulateV2 + tier-seed both placing the same wired socket — fixed via a shared `omitConsumedProps` helper used by both paths), and an editorial hero/support overlap. **Engine suite 52/52 + E2E (real wired edge, Surprise seed-change, no-dup, reopen) green**; final whole-branch review (opus) = merge-ready. **Deferred fast-follows:** node-face Shuffle/Surprise; a larger library (15–20 stagings, more image surfaces); AI-driven generation via the existing AgentBar; tier content as live `{{ props }}` bindings (currently literal at seed time). Spec: [2026-08-07-smart-layout-staging-surface-generation-design.md](superpowers/specs/2026-08-07-smart-layout-staging-surface-generation-design.md) · plan: [2026-08-07-smart-layout-staging-surface-generation.md](superpowers/plans/2026-08-07-smart-layout-staging-surface-generation.md).

### Moodboards — the taste library reaches every generator — LANDED 2026-08-06/07 (Plan A `fe5d8281c`..`3d8529883` + A8 E2E; Plan B `dba12d688`..`60cca6e24` + B5)

A **moodboard** is now a first-class taste object: drop images on a Moodboard node → the modal uploads them (`input/moodboard_<ms>/`), a Fable read produces an *editable* reading (summary + curated named palette + avoids), and Save puts it in an app-level library (`/api/moodboards`, file-backed). From there it applies **weightlessly** (properties, no LoRA weights) to any multi-LoRA slot via the gallery's Moodboards tab, or to the **Generate-an-image node** via a node-face chip — the composed block is injected at submit time *by widget name* (`styleInject.ts`). On ref-capable models (the catalog's `multi-image` tag, now mirrored + parity-tested into the Python catalog) the board's first 3 images **ride along as style references** (data URLs into the nano builders, style-only instruction appended); applying to a non-ref model **legibly auto-switches** to `nano-banana-pro` with a notice + one-click Revert, and a manual model choice is never overridden. The node has a Python twin (`Moodboard` class_type, TASTE `style` output, TS↔Py block-compile parity) so the taste wire (`style_in`/`prompt_in` sockets, appended force-input) survives `graphToPrompt`; and Save registers the board's images as project **@refs** `mb-<slug>-0..2` — *flattened* into the input root (`/api/moodboards/refs`), because `/view` basenames subpath filenames (verified live: the graph loader takes subpaths, the app's widgets don't). Two E2Es prove the journeys against the live dev server (`moodboard-core.spec.ts`, `moodboard-wires.spec.ts` — real serialized workflows through the real injector/converter, broken controls throughout). **Honest opens:** a hand-dragged TASTE wire + a run through it (the E2E asserts serialization shape, not the drag); the paid checklist (one real nano render with a board, ~$0.15, + the nano-pro vs nano-2 A/B to settle the default); the node's `image` output port deferred (@refs supersede it in v1); refs on `EditImageNode`. Spec: [2026-08-06-moodboard-styles-design.md](superpowers/specs/2026-08-06-moodboard-styles-design.md).

### Space Type — Loft effect — LANDED 2026-08-07 (`a55590391`..`70c88bbd4`)

A new **Loft** Space Type effect sweeps a keyframed cross-section along an editable **3D bezier spine** defined by a list of **stops** — each stop is both a curve point (x,y,depth) and a profile keyframe (width/height/corner-radius/sides, roll, colour). It reproduces the reference aesthetic: iridescent line-loft spirals, gradient ribbons, lofted tubes. The seam: a **pure geometry core** — `loftStops.ts` (parse/serialize/presets) + `loftGeometry.ts` (Catmull-Rom spine w/ parallel-transport frames, per-stop prop/colour interpolation, superellipse + word contours, and the vertex/index/`aAlong` buffers) — is wrapped by `effects/loft.ts`, a THREE effect whose `ShaderMaterial` samples a per-stop colour **ramp** (`DataTexture`) by an `aAlong` attribute offset by a `uFlow` uniform (flow scrolls the gradient; spin turntables the root; `loopRates` closes the seamless loop). **Two render modes** (stroke = dense line-field, fill = skinned surface) and **two profile kinds**: a parametric shape OR a **word** — a word's glyph outlines (`scene3d/outlines.ts::textOutline`) become the swept cross-section, with the host pre-warming the font cache (`ensureEffectFonts`) so `buildScene` stays synchronous. Editing is a new **`profileStops` ControlSpec kind** + `ProfileStopsEditor.vue` (drag XY nodes on a canvas + per-stop inspector); preset spines (helix/wave/arch/s-curve/loop) stamp editable stops. Shared-engine change: `disposeRoot()` now disposes `isLineSegments` geometry/material (blast radius verified: loft only — `boost` uses `LineSegments2` which is `isMesh`). Built subagent-driven TDD, 9 tasks + review loops that caught **5 latent bugs in the plan's own sample code** (shared-ref return, zero-vector frame on coincident stops, an **inverted `sides`→roundness mapping** hidden by a loosened test, count-only geometry tests, GPU-leak on rebuild). **41 unit tests green**; final whole-branch review = READY TO MERGE. **Live-verified in the app** (Type Studio → Loft): fill + stroke render the gradient loft; word mode initially fell back silently because `CARRY_ON_SWITCH` carries a bare family (`'Inter'`) the opentype loader can't fetch — fixed with `outlineFontValue()` normalizing bare→`google:` on both cache sides (confirmed live: `google-font-file?family=Inter → 200`, word renders); preset-confirm now fires only on real hand-edits. **Deferred fast-follows:** flat mode only zeroes z (no head-on ortho path yet — spec hedged this); closed-loop colour seam where first/last stop colours differ; the `fontSourceUrl` double-wrap that double-fetches a font shared with Scene3D. Spec: [2026-08-07-spacetype-loft-effect-design.md](superpowers/specs/2026-08-07-spacetype-loft-effect-design.md) · plan: [2026-08-07-spacetype-loft-effect.md](superpowers/plans/2026-08-07-spacetype-loft-effect.md).

**Refined 2026-08-08** (`91b875892`..`b36a62035`, plan [2026-08-08-spacetype-loft-refinements.md](superpowers/plans/2026-08-08-spacetype-loft-refinements.md)) — three user-driven refinements: (1) a global **Shape** picker (oval/capsule/rectangle/polygon/star/word via `shapeContour`) replaces the abstract per-stop Sides/Radius sliders; (2) colour is now the **shared fill control** — a `colorSource` fill|stops toggle, where `fill` maps solid/gradient/**ombre** along the sweep via `rampFromFill` (patterns→primary), with per-stop colour kept as a mode; (3) **Spacing** breaks the sweep into discrete stacked rings (`buildSlicedLoftGeometry`, elements + gap). Stops slimmed to position/size/roll/colour (per-stop sides/radius dropped; `parametricProfileContour`/`loftContours` deleted). New-loft default = oval + ombre gradient + slight spacing. 6 TDD tasks; review caught a **legacy-doc word-guard regression** (`ensureEffectFonts` gated word-font preload on raw `params.shape` not `resolveShape(params)`, so old `profileKind:'word'` docs would silently fall back to oval) + the recurring count-only geometry-test gap (hardened with index-value asserts). 50 loft unit tests green; live-verified in the app: spacing→discrete rings, colour-source toggle + fill control, oval shape render. Spec: [2026-08-08-spacetype-loft-refinements-design.md](superpowers/specs/2026-08-08-spacetype-loft-refinements-design.md).

**Round 3a 2026-08-08** (`72f5566c4`..`a286c9445`, plan [2026-08-08-spacetype-loft-stroke-fill.md](superpowers/plans/2026-08-08-spacetype-loft-stroke-fill.md)) — stroke/fill refinements: (1) **fill distribution** — `rampFromFill` now spreads ALL fills across the sweep as colour stops (gradient/ombre→2, solid/pattern→1 primary), with a `fillMode` **blend** (smooth gradient) vs **steps** (hard-edged solid bands) toggle; (2) **filled cross-sections** — fill mode now emits centroid-fan **caps** so Fill produces solid discs (spaced = solid coins, continuous = closed tube; word skipped — its holed glyphs aren't star-shaped); (3) **stroke width** — strokes are now adjustable-width **ribbons** (in-plane offset → closed strip, rendered as a Mesh with the gradient shader) since WebGL ignores GL line width. 3 TDD tasks; review caught a DRY drift (a 4th inline copy of the roll/placement math in `buildSlicedLoftGeometry`, factored to shared `rolledPoint2D`/`place2D`). 65 loft unit tests green. Live visual of the new caps/stroke-width owed (shared dev server was unresponsive at verification time). **Round 3b (designed, not built):** on-preview bezier spine editor + "edit all stops" master controls. Spec: [2026-08-08-spacetype-loft-stroke-fill-design.md](superpowers/specs/2026-08-08-spacetype-loft-stroke-fill-design.md).

**Round 3c 2026-08-08** (`ff258b590`..`725e09336`, plan [2026-08-08-spacetype-loft-illustrator-blend.md](superpowers/plans/2026-08-08-spacetype-loft-illustrator-blend.md)) — colour now works like **Illustrator's blend tool**. Was: a 1-D ramp *along* the sweep (each cross-section one flat colour). Now: a **2-D colour texture** — *across* the circle (U) × *along* the sweep (V). Each fill paints a whole circle's face (a gradient fill = gradient across the circle at its `angle`); fills map first→last; circles between interpolate the fills stop-by-stop (a solid = a 2-stop gradient, so gradient→white fades correctly). Every vertex gains an `aAcross` coordinate (`acrossCoord` projects the unit contour point onto the gradient axis); `build2DFillRamp` builds the texture (blend/steps along V); the shader samples `vec2(vAcross, fract(vAlong+uFlow))`. `colorSource=stops` uses `stretchAcross` (flat across). v1 uses one representative gradient angle (first gradient fill's); per-fill angle interpolation is a follow-up. 3 TDD tasks, all reviewed clean (2-D layout hand-traced, all 6 vertex sites confirmed writing `across`, DataTexture dims/UV no-transpose). 78 loft unit tests green. Also this day: UX fixes (`f20159dc8`,`3f12fbf17`,`b36a62035`) — Copies→**Count** merged (interpolated sliced spine so rings don't collapse) and surfaced into the open **Style** section (was hidden in collapsed Layout); default fills → two solids (1 fill = uniform model). Live visual owed (the running dev server belongs to a parallel chat; my Browser tools can't reach it). Spec: [2026-08-08-spacetype-loft-illustrator-blend-design.md](superpowers/specs/2026-08-08-spacetype-loft-illustrator-blend-design.md).

**Round 3d 2026-08-08** (`a9c7de9e1`..`979fb5825`, plan [2026-08-08-spacetype-loft-editall-circle.md](superpowers/plans/2026-08-08-spacetype-loft-editall-circle.md)) — (1) **Circle shape** added (always perfectly round — the unit-circle contour scaled UNIFORMLY, `height:=width` in buildScene, so it stays circular regardless of per-stop Width/Height); **Capsule removed** (it was identical to a full-radius Rectangle — the oval/capsule confusion); legacy `capsule` docs migrate via `resolveShape`→`rectangle` + `buildScene` forcing `rectRadius=1` (pill preserved). Shape list now `circle/oval/rectangle/polygon/star/word`. (2) **"Set all stops"** master Width/Height/Roll/Colour controls in `ProfileStopsEditor` (pure `applyToAllStops`, shares the safe commit path). 2 TDD tasks, both reviewed clean (uniform-scale + capsule migration verified in code; setAll re-hydrate-loop-safe). 82 loft unit tests green. Live visual owed (running dev server is a parallel chat's). Minor deferred: a legacy saved capsule doc shows a blank shape-picker until re-picked (still renders as a pill). Spec: [2026-08-08-spacetype-loft-editall-circle-design.md](superpowers/specs/2026-08-08-spacetype-loft-editall-circle-design.md).

**Round 3b 2026-08-09** (`930a077e8`..`7493c4ccd`, plan [2026-08-08-spacetype-loft-spine-editor.md](superpowers/plans/2026-08-08-spacetype-loft-spine-editor.md)) — the loft's **ends became aimable** two ways. (1) The spine is now a **cubic bezier through the stops** instead of Catmull-Rom: `LoftStop` gained optional tangent fields (`ta`/`hlf`/`hlb`/`manual`), `autoSmoothStops` derives smooth handles for every non-manual stop (chord-direction tangent, ~⅓ handle lengths), and `sampleSpine` builds the per-segment bezier (`P1=stop[i]+ta·hlf`, `P2=stop[i+1]−ta·hlb`) — legacy stops auto-smooth on load so existing lofts render visually identical until a handle is dragged; the parallel-transport frame / endpoint-`t` / closed-wrap invariants are unchanged (frame tests still assert them). (2) An **`capAngle` "End cap angle" slider** shears the two OUTER end caps away from perpendicular (mitred tube ends) about the station binormal; `capAngle=0` is **byte-identical** to the old perpendicular caps (diff = additions only), interior band-end caps never shear. (3) A new **on-preview overlay** `LoftSpineEditor.vue` (modeled on `StringPathEditor`) lets you drag the spine's points AND per-stop **tangent handles** directly on the preview — dragging a node re-auto-smooths non-manual neighbours; dragging a handle flips that stop to `manual`; z/width/height/roll/colour/id pass through untouched. An **"Edit spine"** toggle (loft only) in `SpaceTypeSurface` mounts the overlay and forces the preview **head-on** via a *transient* `effectiveRenderParams()` spread (`rotateX/Y/Z=0`) that reaches ONLY the live-preview render — save/autosave/thumbnail/bake/export all read the real `params`, so the user's camera tilt is never zeroed on disk (traced every `renderFrameAt` call site); restores on toggle-off / effect-switch / unmount. 6 TDD tasks (1–3 unit-proven + reviewed, 4–5 UI code-reviewed), **92 loft unit tests green**. Review-loop catches: a bezier control-point sign trace, the `posAtU` endpoint-tangent extrapolation (verified it never emits a station past the endpoint), and an **overlay px/py double-count** that misaligned nodes from the cursor under letterboxing (fixed `832340c26`; the shipped `StringPathEditor` shares the identical latent bug → spawned a follow-up). Deferred fast-follows: head-on override zeroes rotation but not projection/pan (perspective+pan may not map 1:1 at frame edges); per-end cap angles (v1 is one global); full 3-D on-preview dragging (depth stays a slider); word-mode fill caps. **Live interaction owed** — the running dev server belongs to a parallel chat, so this session's browser can't drive the drag; Julien live-verifies the 5-point click-through (drag lands under cursor with a tilted camera; toggling off leaves rotateX/Y/Z untouched; effect-switch resets the toggle; closed-loop draws the extra segment; edits + camera persist on reload). Spec: [2026-08-08-spacetype-loft-spine-editor-design.md](superpowers/specs/2026-08-08-spacetype-loft-spine-editor-design.md).

### Expressive Studio (Space Type) — the tile seam — LANDED 2026-08-07 (`b3c9dff`..`d6e821a`)

Space Type's arrangement engine generalized from "a glyph" to a **tile** (a photo OR a word/letter) — the first step toward renaming it **Expressive Studio** (inspired by animos.app). New **`ring` layout** (upright cards orbiting in a seamless loop) renders **photos and words together**, fed by a content editor; uploads only. The seam: `content` is a JSON param → `parseContent`/`expandContent` (`tile.ts`, pure) → `ring.buildScene` consumes `ExpandedTile[]`; placement is `ringTransform` (`ringLayout.ts`, pure — atan2 rotY-wrap so the loop is numerically seamless). Content drives the tile count; the ring re-fits. Images preload before the synchronous build via `engine.setImageTextures` + `BuildEnv.imageTextures` (`imageTextures.ts`); words reuse `layoutChars`, one atlas per sourceId, glyph textures registered on `userData.tex` for disposal (mirroring `cylinder`). All 25 existing effects untouched — `ring` appended last so `getEffect`'s `[0]` fallback stays `ribbon`. 21 unit tests green; `ring` embeds clean (794KB). Content editor + image-upload path **user-confirmed in the live app** (which surfaced + fixed a Vue-3.5 `ref`-inside-`v-for` bug on "+ Add image", `d6e821a`). Built subagent-driven TDD, 7 tasks + 3 fix rounds, all reviewed. **Deferred with the "wire from canvas" expansion:** the WIRED cross-studio headless render preloads in `SpaceTypeNode.vue`'s `ensureHeadless()` (not `frameSource.ts`) — until hooked, a wired ring shows blank image tiles; the studio-modal export uses the live engine and is covered. Spec: [2026-08-06-expressive-studio-v1-design.md](superpowers/specs/2026-08-06-expressive-studio-v1-design.md) · plan: [2026-08-06-expressive-studio-v1.md](superpowers/plans/2026-08-06-expressive-studio-v1.md).

**Fast-follow — ring tune-up + word type controls + card ratio, USER-CONFIRMED 2026-08-07 (`f85e186`..`45e1981`).** The `ring` gained the full [animos.app](https://animos.app) control set and then some: **repeater** (duplicate elements around the ring to fill it), **padding**, **corner radius** (rounded-rect SDF mask on image cards via `onBeforeCompile`), **bend** (each card *curves* to the ring — subdivided plane + the pure `bentOffset` displacement, cached by `bendSig`), **ring opening** (± a second reveal axis composed with tilt — head-on ↔ full circle), **ring size**, **back fade** (per-card depth opacity), and **card ratio** (force image cards to 1:1/4:3/… by cover-cropping the photo in the `map_fragment` UV; words keep their text shape). Words got **global type controls** (font/weight/size/tracking/colour, mirroring `cylinder`'s variable-font pattern). Two live-found fixes: the placement **winding was reversed** so a word's letters read in order around the ring (was "NATURAL H S R E F"), and a **saved-doc NaN guard** — the ring's `n()` now falls back to `RING_DEFAULTS` for keys absent on pre-tune-up docs (the app's load path doesn't backfill control defaults; without this, old rings rendered blank). Every control is a declared `ControlSpec`, so all of it is agent-legible + keyframeable for free. Built subagent-driven TDD (~9 commits, each reviewed; the final whole-branch review caught the NaN). Specs: [ring-tuneup](superpowers/specs/2026-08-07-ring-tuneup-design.md) · [word-type-controls](superpowers/specs/2026-08-07-ring-word-type-controls-design.md) · [card-ratio](superpowers/specs/2026-08-07-ring-card-ratio-design.md).

### Scene3D — opalescent material — LANDED 2026-08-06 (`50f6f6d02`)

Tenth material type: **opalescent** (thin-film / holographic). A `MeshStandardMaterial` + `onBeforeCompile` in the fresnel/gradient mould — a spectral rainbow driven by the view-space normal and fresnel angle, so it flows and shifts as the object turns. Spectrum reuses the gradient stop ramp with a **vivid cyclic default** (a fresh opal is holographic, not the grey `color→gradientB` pair); steered by hue-shift / spectrum-bands / angle-response / rainbow-strength + an optional time flow (per-frame `refreshOpalTime`, gated by `sceneHasOpalFlow` like shaderFill). The five scalars are `ControlSpec`s (so agent + motion derive for free — a small crack in Scene3D's otherwise agent-dark surface). Live-verified: hue-shift 0→254 rotated the render 115° mean across 52/53 samples; strength→0 collapsed to grey (neutralization).

**Fast-follow (`e41cbc90c`): glossy/chrome finish.** Opal is now a `MeshPhysicalMaterial`, so it carries a **clearcoat + reflection** — matte soap-bubble at clearcoat 0, wet chrome-holo as it rises (metalness makes the rainbow tint the reflections). Reuses the existing `clearcoat`/`clearcoatRoughness`/`envMapIntensity` fields (no new data model); those three physical-coat controls just widen from standard/glass to include opalescent. Verified: clearcoat 1 + metalness 1 + roughness 0.1 gave a blown specular highlight (lum 255) over a saturated rainbow (mean sat 58→88).

## The factory metric (Act 1)

Cost for one parameter to be inspectable + agent-drivable + animatable + sweepable:

- **Shader Studio uniform: 1 declaration** (`shader_effects/manifest.json` entry) → all four generated.
- **Gradient Studio param: was 7 sites / 5 files**, range retyped 3×, animation **impossible**.

**Act 1, part 1 — LANDED 2026-07-25** (commits `341bbf81e`..`ce07eeaf2`). `lib/gradientfx/controls.ts` is now the single declarative `GRADIENT_CONTROLS` list, and **both** the agent vocabulary (`gradientAgentControls`) and the motion targets (`animatableTargets`) are *derived* from it. Motion moved from `{layer, param}` index targeting to dotted paths, with a migration for saved projects plus a fallback in `applyMotion` itself (the single render choke point, `renderer.ts:156`) so legacy tracks resolve on every path — node card, headless bake, and studio frame source all read the saved blob raw and never call `ensureConfigDefaults`.

**Measured outcome: animatable Gradient parameters went from 11 → 30**, verified live in the running app. `relief.grain`, `focus.blur` and the whole `flow.*` block can animate for the first time.

The schema is a **superset with per-consumer opt-in** (`agent: false` withholds from the agent, `animatable: false` from motion), so declaring a control can never silently widen another capability.

Still to do in Act 1: the generic inspector renderer (Gradient still has 432 lines of hand-written markup), new `ControlSpec` kinds (`segmented`, `repeater`, `custom`), and exposing the 11 now-declared Shape controls to the agent. Known misfits remain: Texture's colour-role system (`texturefx/roles.ts`), Space Type's scene-sequencing motion model.

## Hosted-mode switch + ledger core + spend log — LANDED 2026-08-11

Commits `93dd6a7e0`..`982edcd12` (10). Plan: [2026-08-11-hosted-mode-ledger-prep.md](superpowers/plans/2026-08-11-hosted-mode-ledger-prep.md) · roadmap: [2026-08-11-consumer-product-gap-list-and-roadmap.md](superpowers/specs/2026-08-11-consumer-product-gap-list-and-roadmap.md) · architecture stays the [2026-07-01 accounts spec](superpowers/specs/2026-07-01-accounts-credits-billing-design.md).

The vendor-free core of consumer-product Stages 1–2, built and tested with zero signups. **`server/utils/deployMode.ts`** is the master switch: no Clerk keys in env ⇒ local mode ⇒ exactly today's behavior — every hosted feature gates on it. **`server/db/schema.sql` + `server/utils/ledger.ts`** replace the mock ledger's guts: append-only double-entry with cached wallet balance, idempotent credit/debit, hold/settle/release (settle returns a `settled: boolean` discriminator so a released-then-settled hold is distinguishable from a real charge — refines the July spec's ambiguous no-op), FIFO consumption so expiring subscription grants burn before purchased packs, and an idempotent expiry sweep. 21 unit tests run against in-process PGlite (`@electric-sql/pglite`, devDependency) — real Postgres semantics, no server. **`server/utils/spendLog.ts`** instruments `runReplicate`/`runFal` with fire-and-forget JSONL (`.data/spend-events.jsonl`) so daily local use accumulates the consumption data the pricing decisions need.

Final review (whole-branch) caught one Critical the per-task reviews missed: concurrent calls sharing one DB session interleave BEGIN/COMMIT (the second BEGIN silently *joins* the first transaction — reviewer reproduced a lost update: two 300/400 debits on a 1000 wallet left 600, not 300). Fixed with a per-instance transaction mutex (`runExclusive` promise chain) + an adversarial concurrency test proven against the broken control. Gotchas for the Neon swap, recorded in `.superpowers/sdd/progress.md`: `replayOf` needs a unique-violation catch for concurrent duplicate webhooks; the Neon serverless HTTP one-shot driver cannot run multi-statement transactions (needs WebSocket Pool/Client or pg-over-TCP); `getBalance` must never be wrapped in the mutex (settle calls it from inside — self-deadlock).

**Fast-follow — Clerk scaffold, LANDED 2026-08-13 (`d9e1bfe33`).** First real vendor signup: the Clerk application "Sailor" exists (dev instance, Consumer type, Email + Google sign-in), `@clerk/nuxt` is registered in `nuxt.config.ts`, and catch-all sign-in/sign-up pages are scaffolded (unlinked, to be deployMode-gated in Stage 1 proper). The keys were deliberately moved out of `.env` into gitignored `.env.hosted` so the no-Clerk-keys ⇒ local-mode contract holds — dev server verified booting in local mode with the module present, API routes 200. Still owed for Stage 1: `server/middleware/auth.ts` JWT verification on `/api/**` + proxied ComfyUI paths, user-sync webhook, Neon-backed user rows.

**Fast-follow — ledger onto real Neon, LANDED 2026-08-13 (`bd320f7c9`).** Second vendor signup done: Neon project "Sailor" (`raspy-night-08677137`, aws-us-west-2, PG 18 — US region because users will be US-based; Neon Auth off, auth stays Clerk). The hardened schema is applied and the ledger now has a production driver: `server/utils/ledgerDb.ts` (one dedicated pg Client per handle — the single-session contract — with lazy reconnect for Neon's idle suspends, plus a `getSharedLedgerDb()` hosted singleton). Three review-deferred items closed: the 23505 unique-violation replay in credit/debit (the cross-session duplicate-webhook race), `wallets_reserved_nonneg` CHECK, and the holds/wallet-history indexes. Proof: the 21 PGlite tests untouched-green, plus a new env-gated live suite (4 tests) that drives **two real Neon sessions** into deterministic blocked-INSERT races — broken-control-proven (disabling the catch fails exactly the race tests). Connection strings live in `.env.hosted` only. Still deferred: consumeFifo batching, spendLog serialization test, fal ok-before-body-fetch. Next: auth middleware + user sync, then the meter route swaps mockLedger → real ledger.

## Studio controls — the row is the slider — LANDED 2026-08-05

Commits `b26c4a422`..`4040bdade` (10). Spec: [2026-08-04-studio-control-rebuild-design.md](superpowers/specs/2026-08-04-studio-control-rebuild-design.md) · plan: [2026-08-04-studio-control-row-foundation.md](superpowers/plans/2026-08-04-studio-control-row-foundation.md). Prompted by [DialKit](https://joshpuckett.me/dialkit).

Every studio control was two stacked lines — a label with a number above, a thin rail below — and **there was no way to type an exact value anywhere in the app**. Controls are now a single 28px row that *is* the slider: label left, value right, the row fills as the value rises. Click the number to type a value, drag anywhere to scrub, double-click to reset, right-click to bind. `StudioRow.vue` owns the shell; `studio/rows/` supplies only the value side per kind, so adding a kind is one component plus one registry line. `lib/studio/row.ts` holds the maths, unit-tested.

**One render path, two entry points.** `StudioControlPanel` drives rows from a `ControlSpec[]`; `StudioSlider`/`StudioSelect`/`StudioSwitch` keep their exact public props but build a one-element spec internally. 88 of 89 `StudioSlider` call sites needed no edit. Sections can now nest via `'Parent/Child'` group paths.

**Nine defects in the plan's own code, none reachable by synthetic events.** Every one passed a hand-dispatched `PointerEvent` and failed a real click. The worst: right-clicking a row ran click-to-position, so *opening the bind menu silently overwrote the value*. Also — `@pointerdown.stop` without `.prevent` let the compatibility `mousedown` blur-commit the typed-entry field shut the instant it opened, so clicking a number did nothing; Escape's removal-blur re-fired commit with the draft it had just discarded, making Escape behave as Enter; Enter double-committed; and `bindable !== false` was unreachable because Vue casts an absent Boolean prop to `false` — the variable glyph rendered on **no row at all**.

**The accessibility fix caused its own regression.** Giving the row `role="slider"` made the variable glyph and bound-column buttons focusable descendants of a children-presentational role — axe-core measured 7 serious `nested-interactive` violations. Fixed by moving role/tabindex/aria onto a childless track div. Worth noting the tooling trap: the Browser pane's own accessibility tree does *not* prune children-presentational, so it reported the broken markup as fine. Only axe-core on the live page caught it.

**Shift meant two different things and a comment claimed otherwise.** Shift-drag used an absolute grid, Shift-arrow a relative one — from 13 on a 0..100 control they gave 20 and 23 — under a docblock asserting they agreed. Both now route through one `coarseStepMultiplier()`, which also fixes the ×10 grid collapsing to endpoints on short ranges (`matToonSteps` 2..5 could only ever produce 2 or 5). Measured blast radius: 224 of 831 declared ranges. Shift still means FINE for `v-scrub`/`GridPropertyPanel`, documented in `scrub.ts`.

**Verification standard.** No component-test framework in this repo by design, so every component claim was proved by driving the real app and then *reverting the fix under HMR to reproduce the bug on the same gesture*. The final review closed three residual risks by driving them, including temporarily nesting Shape Studio to execute the `StudioSectionTree` recursion for the first time — the bespoke `#control-palette.harmony` slot survived it.

**Foundation only.** Two follow-on plans: four new kinds (`action`, `angle`, `spring`, and `xy` built-but-unapplied, plus a `segmented` kind — decided 2026-08-05, since dropping `segmentedMax` left the app with two answers to "pick one of three" and the schema path got the worse one), then the sweep of the ~167 remaining hand-written `<input type="range">` sites across 35 files.

**Studio sweep + docked actions — 2026-08-06** (commits `3b4f4561e`..`a1efa03ae`). Space Type, Shape, Vector Type and Scene3D moved their remaining bespoke controls onto labelled 28px rows, the Effect picker became the right pane's hero (prominence by size, not restyle), and every studio's AI input now docks under the preview as the one canonical bar (capped width, ✦ + ↑). Finally, **the modal's bottom is now reserved for actions**: `StudioModalShell` renders `#actions` in a full-width, hairline-topped footer with buttons docked bottom-right, so Save / Render / Send-to-canvas land in the same place in every studio instead of floating under the preview or pinned inside the controls column. The buttons themselves were then standardised on Vector Type's look (judged best): `StudioButton` now renders an action-blue primary + a subtle white/6% bordered secondary, both 12px medium on a 6px radius — settling the deferred primary-colour question in favour of action-blue and retiring the white primary (commit `79847bea5`). Verified live (harness): radius 6px, primary oklch action-blue, disabled 0.4 across variants; a healthy-pane pass to *see* the full accumulated look is still owed.

## Studio actions footer — one bottom bar for every studio — LANDED 2026-08-06

Spec: [2026-08-06-studio-actions-footer-design.md](superpowers/specs/2026-08-06-studio-actions-footer-design.md) · plan: [2026-08-06-studio-actions-footer.md](superpowers/plans/2026-08-06-studio-actions-footer.md). Built subagent-driven (11 tasks, per-task review + a whole-branch opus review).

Every studio's `#actions` bar did its own thing — some had a Save button, most didn't; the single most important action ("put the result on the canvas") was named five ways (*Render*, *Export to Canvas*, *Send to canvas*, *Generate as image*), and two studios (Shape, Vector) couldn't put anything on the canvas at all *despite their "Export PNG" already dispatching a canvas node* — a button named like a download that did the opposite. Now all seven (Space Type, Scene3D, Texture, Gradient, Shader, Shape, Vector) render one shared **`StudioActionsFooter`** from a declarative `{ status, utilities[], downloads[], canvas[] }` spec: quiet utilities + auto-save status on the left, and two fixed menu buttons on the right — a grey **`Download ▾`** (PNG everywhere, plus Video/SVG/Embed where they exist) and a blue **`Render on canvas ▾`** (As image · As video · Send to timeline). "Render on canvas" is the one canvas verb now.

**The Save button is gone; autosave-on-edit took its place.** A shared `useStudioAutosave(source, persist)` debounces a save on every edit and drives a real `Saving… / Saved ✓` (the user's call — the old "save on close" left nothing to honestly show). The pure `createAutosaveController` is fake-timer unit-tested; the watch is deferred to `onMounted→nextTick` so a studio's mount-time hydration doesn't false-flash "Saved ✓" on reopen.

**Behaviour added (small):** `Download PNG` on all seven (reusing each studio's existing image blob), `Download video` on the four that already run `encodeFrames`, and **Scene3D gained *As video* on the canvas** — it already encoded the clip but only ever downloaded it; the missing wire was a dispatch, not an encoder. No new renderers. Space Type's transparent-background *checkbox* became an `As video (transparent)` menu item (state → action).

**Bugs the reviews caught that shipping-blind would have missed:** the footer status first swallowed all progress/success/warning text (only errors showed) — fixed by adding a neutral `notice` channel before the sweep. Scene3D's `busy` wiring was *dead* (bound to a flag the video path never set) → a reentrancy guard. Camera damping re-triggered autosave into a permanent "Saving…" → camera sync pulled out of the reactive persist. Shape's autosave missed the width/height/aspect controls. My plan's `/input/<file>` fetch path 404s (not proxied) → `/view?…&type=input` across four studios. And the whole-branch review's headline: Space Type's `exportAlpha` latched `true` after one transparent export, silently making every later plain "As video" a Safari-incompatible transparent WebM. Footer logic unit-tested 11/11; each studio live-driven (real node drops / file saves), not just compiled.

## Shared post stack — grain retired, saved docs migrated — LANDED 2026-08-05

Commit `dca456e7d`. Report: [usp-task-8-report.md](../.superpowers/sdd/usp-task-8-report.md).

Sailor had **four** separate grain implementations. This closes out the shared post stack thread (Tasks 1–7: manifest, chain, Gradient/Texture/Shape adoption) by deleting the last two: Gradient's own `u_grain` GLSL block and Shape's own `uGrain` block. `shader_effects/post_grain.frag` is now the only grain implementation left. The two retired copies had already drifted apart under a comment insisting they hadn't — Gradient applied `g × u_grain × 0.16 × cover × midtone`, Shape applied `g × uGrain × 0.5 × midtone`, so the same slider value read ~3.1× stronger in Shape.

**Every existing document is migrated, not broken.** A legacy grain value is rewritten on load into `post.grain`/`post.grainAmount`, rescaled into the canonical 0.16 space, with `post.grainSize` pinned to 1 — the shared effect's cell-quantisation has no equivalent in either retired formula, so anything above 1 would have rendered every migrated document visibly coarser than before.

**Pixel-fidelity, measured on the actual bytes, not eyeballed.** A fixture doc rendered on the commit before this change and after, full RGBA buffers diffed byte-for-byte: Gradient landed ±1/255 (the honest cost of moving grain into a genuine second pass — an 8-bit quantise/re-upload round-trip); Shape landed **65,536/65,536 bytes exact**, true bit-for-bit, after the fix below.

**A GPU float-precision bug the migration exposed, not caused.** The shared stack's grain seed is a full unsigned 32-bit hash (up to ~4.29 billion) fed straight into a `fract()`-chain hash inside a GPU `highp float` (~24-bit mantissa). A float32 simulation confirmed it: at that magnitude the hash collapses to a constant, so grain silently degenerated from noise into a uniform colour wash. Pre-existing since the post stack was first wired to Gradient (Task 5); this task is what finally turned grain on broadly enough to hit it. Fixed by modding the seed the same way each file's own internal uniform already did.

**The brief's own instruction would have shipped a ~40/255 appearance change.** "Make Shape's post-pass trigger on distortion only" is what the task brief said to do, and it silently moves every existing Shape document (grain has defaulted on since before this task) onto a *different render path* — Shape's offscreen post target carries no MSAA, unlike the canvas's own antialiasing, an existing and unrelated quirk grain had always incidentally routed around. Proven by isolating it: forcing both old and new code through the *same* path (via distortion alone) measured bit-for-bit identical, so the discrepancy was 100% about which path a document takes, none of it about grain's own math. `postNeeded()` now keeps checking the old field for routing only — documented at length so a future pass doesn't "simplify" it back.

**Final review, 2026-08-05** (commits `7a29c58eb`, `f46668dfd`, `0f0f257a5`, `bf7994edf`, `c3d4654ad`; report: [usp-final-fixes-report.md](../.superpowers/sdd/usp-final-fixes-report.md)). Two of the findings were user-visible. A saved motion track pointing at the retired `relief.grain` already had a `path`, so the migration skipped it — and every frame re-created the field the migration had just deleted, which the legacy-wins render rule then read as "this document is un-migrated": on those documents the new Grain switch and both sliders were dead, and turning Grain off left it on. The rewrite now lives in one function both the migration and the per-frame path call, so the node card, bake and frame source agree with the studio. Separately, "Film" was mapped to the catalog's CRT shader at its own defaults, so under a label and hint copied verbatim from 3D Studio (whose Film is scanlines plus noise) it instead barrel-warped the frame, clipped the corners to black and double-applied a vignette. Fixed by a new `fixed` field on the manifest — the first way to pin a catalog uniform to a non-default constant, rather than a uniform being either a user control or whatever the catalog declared.

## Effects unified — Space Type & Scene3D onto the shared post stack — LANDED 2026-08-07

Spec: [2026-08-07-effects-unification-design.md](superpowers/specs/2026-08-07-effects-unification-design.md) · plan: [2026-08-07-effects-unification.md](superpowers/plans/2026-08-07-effects-unification.md). Subagent-driven (5 tasks, per-task review + an opus whole-branch review).

The shared 12-effect manifest + collapsible toggle-row renderer already existed and three 2D studios (Gradient/Texture/Shape) used it — but **Space Type hand-wrote its own "Post" section exposing only 4 effects** (its renderer could already do halftone/dot/glitch/film — just hidden), and **Scene3D hand-wrote a 9-effect "Effects" section** missing grain/vignette/duotone. Now all five studios render the *same* collapsible Effects list from `postControls()`, in the same order, gated only by depth: ambient occlusion stays Scene3D-only.

**A named `host` capability replaced the `threeD` boolean.** `postControls({ host })` — `'gl2d'` (the 3 2D studios; excludes gtao, drops GL-only params; byte-identical to the old `threeD:false`, asserted), `'three'` (Space Type — three.js without depth; excludes gtao), `'three-depth'` (Scene3D — includes gtao). The boolean couldn't express Space Type's "everything but ambient occlusion" case.

**The set gap closed by adding three passes — once.** Grain, vignette, and duotone were ported from the 2D chain's fragment shaders into three.js `ShaderPass`es (`lib/studio/post/threePasses.ts`), matched to the 2D look. The discovery that made it cheap: **Space Type and Scene3D share one `PostChain` render class**, so the passes were wired there once and both hosts lit up. No data migration — `post.*` already carried all 12 effects' fields, defaulted off; saved docs just light up. Space Type's already-built halftone/dot/glitch/film were un-hidden in the same move.

**What the reviews caught.** A vitest pixel-parity harness the plan assumed *doesn't exist* (every three.js test mocks the renderer) — the implementer refused to fabricate one; parity moved to live browser comparison (vignette/duotone matched Gradient side-by-side; grain verified qualitatively since its seed drifts). The ported vignette/duotone frags had to write `texel.a` not the 2D chain's hardcoded `1.0` (the chain relies on a separate alpha-restore pass the three.js path lacks). Task 1's signature change silently broke a *pre-existing* test suite still on the retired `{threeD}` API — missed by its own review because neither ran the broader post suite. And the opus whole-branch review caught agent-facing drift: Scene3D's `SCENE_GUIDANCE` still told the LLM post toggles "aren't agent-controllable" (now false — it would make the agent refuse). Unit tests 23/23; the two three.js studios live-driven, not just compiled.

**Deferred product calls:** grain crawls in Scene3D but is frozen in Space Type + the 2D studios (pick one); `filmGrayscale` is no longer UI-reachable from any studio (renderer still applies the stored value); Scene3D's transparent-background alpha loss is pre-existing.

## Scene3D — clay sculpting and shape merging — LANDED 2026-08-04

~30 commits on main (`e6b5392d0`..`26fbec850`, interleaved with unrelated work). Spec: [2026-08-04-scene3d-sculpt-and-merge-design.md](superpowers/specs/2026-08-04-scene3d-sculpt-and-merge-design.md) · Plan: [2026-08-04-scene3d-sculpt-and-merge.md](superpowers/plans/2026-08-04-scene3d-sculpt-and-merge.md).

**Sculpting itself now works: drag on a mesh and it deforms under the cursor.** All four phases are complete — the mesh substrate, a voxel module powering Remesh, sculpt-mode brushes, and merge.

**The architecture, in one line:** a new `mesh` **PrimitiveKind** whose geometry comes from stored vertices instead of a factory. Because `buildGeometry` is `geometryFor(...)` → `applyModifiers(...)`, a mesh primitive inherits all six modifiers, every material type (including shaderFill and surface relief), the facet shading variant, motion tracks, grouping, outlines, the three render passes, rebake and export — with no per-feature work.

**Storage.** A vertex-buffer **codec** (`lib/scene3d/mesh.ts`) small enough to live inline in the scene document: quantise to uint16 → per-component delta vs the previous vertex → zigzag → varint → deflate → base64. The delta stage is load-bearing, not an optimisation: measured on a 52k-vertex sphere, naive quantise-and-deflate is 917KB of base64 versus 186KB with delta — roughly 5x across every density measured. Measured cost is ~136KB per sculpt at the 20k-vertex default. Flat geometry is nearly free — a remeshed box is 6KB — so hard-surface work carries almost no storage cost while curved organic shapes carry all of it. An **async decode cache** — `DecompressionStream` has no synchronous form but `geometryFor` is synchronous, so decode happens off the render path with a placeholder shown on a miss, mirroring how the `text` primitive already handles its async font load.

**The voxel module.** mesh → triangle grid → signed distance field → surface nets → mesh, signed by **exterior flood fill** rather than winding numbers. One module powers three features: Remesh, Merge, and the sculpt brush's ray picking.

**Open surfaces are refused, not mangled.** A plane, a ring or an open-ended cylinder has no inside; Remesh detects that and offers a Solidify (thickness) step instead of producing garbage.

**Sculpt mode.** Seven brushes — draw, smooth, inflate, flatten, grab, pinch, crease — with mirror and radial symmetry and per-stroke undo. Strokes mutate a live working buffer and only write the document on Apply/Exit. The camera orbits, pans and zooms freely while sculpting, locking only for a live stroke or while the cursor is over the mesh; a brush cursor ring shows the brush's size on the surface; Remesh is reachable from inside the sculpt panel itself, so a stretched region can be re-tessellated without leaving; and material, transform and motion all stay editable throughout.

**Merge.** Union / subtract / intersect through the distance field, with a Blend slider that gives a fillet at the join. The result is already a clean uniform mesh, so it can be sculpted immediately with no remesh step.

A **"To mesh"** action freezes a primitive's current geometry (modifiers baked in) into a mesh object. A **cloner budget clamp**: the vertex budget previously throttled subdivision only, never the cloner. A 40k-vertex mesh at grid mode's 5×5×5 = 125 copies reaches 5 million vertices and hangs the tab. The clamp is now surfaced in the panel, never silent.

**Rough edges, honestly:** a Remesh at the default resolution takes about 2 seconds of synchronous main-thread work (behind a spinner); at the 128 maximum it is ~10 seconds — a Web Worker is the obvious next lever. Merging softens sharp edges at grid resolution — merging a box into a box will not give a crisp corner, a deliberate trade for a sculptable result. Masking, dynamic topology, and exact mesh CSG were all explicitly out of scope.

**Status:** all four phases complete, user-confirmed working in the app.

## Multi-LoRA generation — 2 slots → 4 — LANDED 2026-08-02

Commits `d2a32c2ea` → `ebaea43e3`. Spec: [2026-08-02-multi-lora-slots-design.md](superpowers/specs/2026-08-02-multi-lora-slots-design.md) · Plan: [2026-08-02-multi-lora-slots.md](superpowers/plans/2026-08-02-multi-lora-slots.md).

`FluxMultiLoRARemoteNode` already existed and already worked — the cap was ours, not the model's: `lucataco/flux-dev-multi-lora` takes `hf_loras`/`lora_scales` as unbounded arrays. Now four slots with tapered defaults (0.9/0.8/0.7/0.6) and progressive disclosure, so a fresh node still reads as the two-slot node it replaced. **Live-verified:** a 3-LoRA run logged three `Downloading LoRA weights` lines and three load timings, with each scale still paired to its own ref after the cache-defence reversal.

**The bug the plan caused, and the review caught.** `widgets_values` is positional and `realignWidgetValues` pads by *length*, not name. Declaring the six new inputs mid-schema shifted every later value in any previously-saved workflow: `aspect_ratio` → `lora_c`, `guidance` (3.5) → `scale_c` whose max is 1.5 (ComfyUI then rejects the run), `"randomize"` → `lora_d_url` (revealing slot D holding junk), seed lost. **New inputs must be appended, never inserted** — now guarded by a Python test that reads `define_schema()` and a TS test that round-trips an old 13-value array.

**Two UI gates that made the feature narrower than the node.** The gallery hardcoded `lora_a`/`lora_b`, so picking into C or D wrote to a `lora_url` widget this node doesn't have — a house-style pick was a silent no-op, and a local pick left a stale slot URL overriding the filename shown. And slot A is character-only while the reveal rule demanded *every* earlier slot be filled, so a style-only user filled B and C never unlocked — capped at one LoRA. Reveal now keys off the immediately preceding slot, and the gallery has switchable Characters / Your Styles / House Library tabs on every slot. Trigger-word routing had to move with it: it branched on the *slot's* kind, which is wrong once any slot can browse any library.

**Slots can be emptied again** (`41d22b1f3`). There was no way to unpick a LoRA: the raw combo carrying `[None]` is never rendered (excluded from the inspector, replaced by the launcher card in the node body) and the gallery had no None entry — so a slot filled by mistake billed on every run and only deleting the node escaped it. A × on the filled picker card now resets all four pieces of a slot: picker → `[None]`, URL override → `''`, scale → its **schema** default (read from `widgetDefs`, not hardcoded), and the slot's style block deleted. Verified against deliberately poisoned values — `scale_b` 1.35 → 0.8, a stale `lora_b_url` override cleared. *Deliberate asymmetry:* a cleared character's trigger is left in the prompt box, because that text is visible and editable; style blocks are hidden, which is why those must go automatically.

**Per-slot style blocks — the last collision, closed** (`0b21c2451`). Every style pick used to write one `data.properties.aesthetic`, so a second style overwrote the first. The *weights* were never affected — both adapters always loaded — but the first style's trigger word and taste-profile prose never reached the prompt, so it ran under-steered. Each slot now owns `aesthetic_a`…`aesthetic_d`; `composeLoraStyle()` in [loraStyleBlocks.ts](../frontend/app/lib/graph/loraStyleBlocks.ts) concatenates the node-level `aesthetic` (still NodeInspector's manual field, and the legacy key) followed by each slot in order. A one-time migration moves a stale `aesthetic` into `aesthetic_b` — before this, slot B was the only slot that could receive a style — guarded on "no slot key set yet", so it never double-fires. **Browser-verified through the real gallery:** Ultra_Pencil into B and Metallic_Mirage into C wrote two distinct keys, and the composed output carries both trigger words.

## Style duplication — one training run, many taste profiles — LANDED 2026-08-02

Commit `abb99dced`. Spec: [2026-08-02-style-duplication-design.md](../frontend/docs/superpowers/specs/2026-08-02-style-duplication-design.md).

**A trained style carried exactly one taste profile, for no structural reason.** The profile is sidecar text prepended to the prompt — nothing about it is in the weights. Wanting a second aesthetic over the same training set had no expression in the UI, and publishing a second house style against one trained model was silently swallowed by an upsert keyed on `replicateModel`.

**Duplicate copies the SIDECAR, not the weights** — ~1 KB against ~344 MB. It works because `GET /api/loras-local` already derived one entry per base name from *either* the `.safetensors` or the `.json`: sidecar-only entries were an existing supported shape (that is how the deployed server lists LoRAs whose weights live only on Replicate). So a copy appears in the gallery and the Style Publisher with no further wiring. Rejected alternatives: copying the weights (byte-identical waste) and a `profiles: []` array inside one sidecar (truest model, but changes the shape read by the GET loop, the publisher's per-filename draft map, and the `lora` filename stored on canvas nodes).

**`trained_on` is the load-bearing field.** `/api/dataset-match` resolves a LoRA's training folder from it alone, so a copy matches the *same* `input/lora_dataset_*` folder and the Fable "rewrite the profile from the training images" flow works on it. Verified live: original and copy both resolve to `lora_dataset_1780550961478`, 16 images.

**`id` replaces `replicateModel` as the house-style uniqueness key.** It already was one in practice — the publisher derives it as `kebab(name)` and thumbnails are written to `public/house-styles/<id>/`. Existing ids are unique, so this is a no-op for every published style. `findIdCollision` is unchanged and is now the only uniqueness rule.

**Findings worth keeping:**
- **"Sidecar-only" was the wrong delete guard on its own.** Refusing to delete when a `.safetensors` is present is correct locally and *inverted* on the deployed server, where **no** LoRA has weights on disk — the guard would have green-lit deleting a real trained style's provenance. Delete now also requires a `duplicate_of` marker, so only files this feature created are removable.
- **The PATCH gate was already a latent bug.** Requiring weights to exist meant sidecar-only LoRAs were listed but uneditable on the deployed server. Duplication forced the fix rather than causing it.
- **A nested route would have 404'd.** `/api/loras-local` is an *exact*-match entry in `comfyui-proxy.ts`'s `NITRO_API_PATHS`, so `/api/loras-local/duplicate` falls through to ComfyUI. Path matching there is method-agnostic, so duplicate/delete ride the same path as GET/PATCH and need no allowlist edit.
- **A compile-check that greps for error strings passes vacuously on a 404.** The first pass "verified" three `.vue` files that had returned `Not Found` — 9 bytes each. The Vite dev path needs the `@fs` prefix and an absolute path; a byte count is the cheap tell.

**Unverified:** a rendered image through a duplicate (never sent one to Replicate), and the gallery's Duplicate/Delete button click-through. Everything else is verified live end-to-end against the dev server.

## Scene3D SVG import — LANDED 2026-08-01

Commits `ece01d0af`..`f278dd2f7` (13). Spec: [2026-07-31-scene3d-svg-import-design.md](superpowers/specs/2026-07-31-scene3d-svg-import-design.md) · Plan: [2026-07-31-scene3d-svg-import.md](superpowers/plans/2026-07-31-scene3d-svg-import.md).

**The first time a vector reaches a Sailor studio as *geometry* rather than as a picture.** Vector Type Studio could already write SVG; nothing had ever read it. Drop or paste an SVG into 3D Studio and each path becomes real extruded geometry, one object per path, held in a group — which is why [grouping](#scene3d-grouping--landed-2026-07-29) was built first.

**An imported path is a new `svgPath` PRIMITIVE, not a new object kind.** Slotting in beside `text` means it inherits all eight material types, every modifier, motion, the Size row, the gizmo, duplicate and grouping for free, and reuses `extrudeShapes()` unchanged.

**Two libraries, each where it is strongest.** The import half **reuses the Compositor's existing paper.js pipeline** — `svgToLeafPaths`, extracted from `useVectorSvg.ts` so both consumers share it — which already handled `expandShapes` (rect/circle/polygon → real paths) and `applyMatrix` (transforms baked). The render half converts a stored `d` to `THREE.Shape[]` via three's `SVGLoader`, which resolves holes by fill-rule. That split also decides testability: paper is browser-only (E2E), `SVGLoader` needs only `DOMParser` (vitest under happy-dom) — and the render half is where the bugs live.

**Stroke-only paths are outlined into fills** with paper boolean ops — a rectangle per segment united with a disc at every join and cap, which is *exact* for the round joins Lucide, Feather and Heroicons all specify. Without it the most likely paste, an icon, imports as nothing at all. (`SVGLoader.pointsToStroke` returns a `BufferGeometry` of triangles, not a `Shape`, so it cannot feed the extruder — the spec's first draft was wrong about this.)

Above 40 paths, import asks: separate objects, or one merged object whose `d` concatenates every subpath.

**Verification:** 132 unit tests, 4 E2E against a live server, zero typecheck errors. Nine deliberate broken controls were each confirmed to turn a test red — a disabled Y flip, the pre-fix arc transform, a pass-through `outlineStrokes`, a removed `flatten`, deleted join/cap discs, a non-accumulating name scope, hard-coded `parseFailed`, `geoKeyFor` reverted to stringifying content, and a hard-coded `nonzero` fill-rule.

**Findings worth keeping:**
- **Arcs were never flipped.** The hand-rolled Y flip walked curves moving `v0..v3`, but `SVGLoader` emits an `EllipseCurve` for `A` commands, whose geometry lives in `aX`/`aY`/angles/`aClockwise`. Any logo with a rounded corner — routine Illustrator output — would have had arcs stranded at +Y while lines went to −Y: torn, self-crossing extrusions, no error. Fixed by pushing the flip into the SVG itself (`<g transform="scale(1,-1)">`) and deleting the hand-rolled transform entirely.
- **`fillRule` was captured, typed, threaded — then dropped at the seam.** Each half was individually correct; the field simply never crossed. Every import was forced to `nonzero`, so a Figma `evenodd` donut imported as a solid blob. Found only by the final whole-feature review.
- **Flattening curves was load-bearing, not cosmetic.** `expandShapes` gives a `<circle>` four anchors, so an anchors-only stroke outline turns a circle into a rounded square — and the area is only ~10% off, so a naive assertion would have passed it.
- **The E2E's own stroke assertion was vacuous at first.** The Size row renders `scale * (baseSize[i] || 1)`, so a *zero*-extent axis displays `1` — a degenerate object reads *larger* than a correct one. Caught mid-sabotage; replaced with a thickness assertion.

- **A multi-path logo imported as a pile** — fixed same day in `f278dd2f7`. `extrudeShapes` recentres every geometry on its own bounding box (correct, and shared with `text`/`shape`), while `buildSvgObjects` placed every child at `[0,0,0]`. The two combined to stack every path on one point: two squares authored 12 units apart measured **0** apart. It was first written up here as "arrangement renders correctly, only the gizmos stack" — that was wrong, and only measuring it showed so. `SvgLeafPath` now carries each path's own `cx`/`cy` (recomputed after stroke outlining, since an outline is fatter than its source) and the object is positioned at `[cx, -cy, 0]`; the Y negation is because the stored `d` stays Y-down while `pathToShapes` flips at build.
- **The E2E could not see it:** test 1 asserted a child *count*, not an arrangement. It now asserts the two children have different Position X.

## Scene3D grouping — LANDED 2026-07-29

Commits `004494585`..`710f94241` (18). Spec: [2026-07-29-scene3d-grouping-design.md](superpowers/specs/2026-07-29-scene3d-grouping-design.md) · Plan: [2026-07-29-scene3d-grouping.md](superpowers/plans/2026-07-29-scene3d-grouping.md).

**The first object hierarchy in any Sailor studio.** Every `SceneObject` may carry a `parentId`, and a new geometry-less `group` kind holds them, so several objects transform and animate as one unit. Built as the prerequisite for SVG import (a logo imports as one object per path, which needs something to hold the paths together) but it stands alone — two spheres and a light are groupable.

**`doc.objects` stays FLAT; hierarchy is a reference, not nesting.** This is the decision the design rests on. Eight modules iterate that array and `objects.<id>.motion.*` agent paths assume a flat id space; nested `children` would have forced all of them to recurse. The engine turns `parentId` into a real three.js parent/child edge, so the scene graph composes transforms and there is **no matrix maths on the render path**. Group motion is therefore free — a group is an object, so animating it moves its children.

New pure module `lib/scene3d/hierarchy.ts` owns every hierarchy operation (`orderParentsFirst`, `sanitizeHierarchy`, `worldMatrixOf`, `rebaseMany`, `groupObjects`, `ungroupObject`, `ungroupMany`, `cloneSubtree`), engine-free so it is testable without a WebGL context. Also landed: ordered multi-selection with a `selectedId` computed shim, a pivot-based gizmo for multi-drags, Cmd+G/Cmd+Shift+G, a recursive object-list tree, subtree delete/duplicate, and transform + material fan-out across a selection.

**Verification:** 84 unit tests, 2 E2E against a live server, zero typecheck errors. Every assertion was demonstrated able to fail before being believed — a subtraction rebase, disabled cycle-breaking, reversed rebase ordering, naive freed-ids concatenation, an unseeded clone-numbering scope, and a disabled ungroup rebase each turned the relevant test red.

**Findings worth keeping:**
- The plan's own group placement was wrong: putting a group at world-identity rotation requires a **shear** under a rotated, non-uniformly-scaled parent, and `Matrix4.decompose` silently drops shear. Children drifted 0.4378 units. Keeping the group's local basis at exactly identity makes recomposition lossless (8.9e-16).
- `cloneObject`'s constructor ternary was exhaustive over `primitive | glb | light`; adding `GroupObject` made **duplicating a group fabricate a light**. It hid inside the typecheck baseline for five tasks. Now guarded by a `never`-typed exhaustiveness check.
- Every blocking item in the final review was a module no task had opened, still assuming a flat list: opacity traversed whole subtrees (with insertion-order-dependent winners, giving the same document opposite bugs either side of a save), motion templates double-wrote to groups and their children, and `retryGlb` dropped `parentId`.

**Known gap:** the multi-select gizmo *drag* path has no runtime verification — synthetic pointer events do not drive `TransformControls`.

## Vector Type — seven animations, three of them random (landed 2026-07-29)

Commits `0713fec7d`, `241caba3e`, `f7b5103ae`, `1092f8910`, `31d93b92a`, `3b11eec06`, plus
two track presets that needed no engine at all. Plan:
[2026-07-28-vector-type-animations.md](superpowers/plans/2026-07-28-vector-type-animations.md).

**Two were free.** The studio's guarantee is `f(cfg, t) → paths`, so every declared slider
already animates: an **extrude light sweep** is one `appearance.<id>.angle` track (the block
shadow's ink centroid really orbits — 69.7 × 72.1 px of centroid travel over the turn, against a
0.0000 ink-XOR broken control), and **misregistration** is two opposed depth-1 extrude plates
with `distance` animated (plate separation, measured on isolated plates, is exactly
`2 × distance` at every sample). The plan's route to misregistration —
per-layer `glyph.dx` — *does not exist and cannot*: `frame.transforms[i]` is resolved once per
glyph and the whole appearance stack paints under it. Both shipped as one-click track presets.

**Three are seeded randomness**, which is the interesting part, because this studio's promise
is that the preview, the PNG bake, the video bake and the SVG export draw the same frame at the
same `t`. None of them rolls a die. Time enters as a **quantised bucket** and the value is a
pure hash of `(unit, seed, channel, bucket)`:

- **Blink** — letters *or whole words* drop out and come back on a beat. Word grouping is
  computed once per frame from the shaped run (`words.ts`), because glyph indices and character
  indices disagree the moment a ligature forms. A unit is lit at phase 0 by construction, so a
  beat edge can never fall inside a dark window — the one instant two clocks could disagree on.
- **Random per-glyph axis scatter** (the user's own idea) — every letter at its own position on
  one variable axis, settling or wandering. On Roboto Flex's real 13-axis file, `wght` deltas of
  +190 / −176 / +76 / −188 at t=0 collapsing to exactly 0 when settled.
- **Grade flicker** — an axis preset on `GRAD`, weight *without reflow*. Pen positions, advances
  and run width are bit-identical across the whole cycle while up to **23.6 %** of the ink's own
  union changes; a `wght` loop of the same shape moves the run width 3385.2 → 3326.2, the control.

**Draw-on** is the fourth new effect and the one that had to stay real vector: letters draw
themselves via genuine `stroke-dasharray` / `stroke-dashoffset` on the same `<path>` that holds
the letterform — no clip, no mask, no outlining a partly-drawn shape. It needed a per-glyph
arc-length table (`pathLength.ts`, quadratic-aware because every TrueType font is), and its own
`glyphStackLeaf` so a staggered draw-on reads *its own* glyph's clock rather than the run's.

**Colour motion tracks** closed a gap that had blocked a whole family. `MotionTrack.from`/`to`
are numbers, so there was no path from a track to a fill — which is why the KineticType migration
dropped `color-cycle`. A track is now a colour track iff it carries `fromColor`/`toColor`;
`lib/studio/track.ts` gained **one additive export**, `trackProgress` (the eased 0..1 `trackValue`
already computed internally), and `trackValue` is one line over it. Mixing is OKLab by default —
sRGB's red→blue midpoint lands *below both endpoints* in lightness, which reads as the animation
dying in the middle — with OKLCH for hue rotations.

**Verification (Task 8).** Every effect measured on real rasterised pixels (resvg over the
studio's own SVG export) with a broken control beside each claim and an ink-XOR metric carried
next to every count, because a centroid or a pixel tally is blind to geometry. Determinism holds
end to end: the same frame twice is byte-identical, a JSON round-tripped config renders the same
bytes, canvas and SVG agree exactly on colour, alpha and dash at every sampled `t`, and the two
bake clocks (`i/fps` and `(i/N)·duration`) are float-equal on all 120 frames of a 4 s / 30 fps
clip. All of it survives an arc and a stagger together — 30 distinct frames out of 30 with every
effect on at once. The three seeded channels are uncorrelated on 420 glyph-frames (blink×scatter
−0.0002, blink×flicker −0.0660, scatter×flicker −0.0387; the same channel against itself reads
1.0000). The shared engine is untouched: `trackValue` is **bit-identical to its pre-change self
over 200,000 random samples**.

**Open, honestly:**
- Live *playback* timing was never measured. The Browser pane throttles rAF to zero, so the
  studio's continuous clock cannot be driven there; every timing claim above is headless. What
  *was* driven by hand in the running app: the Motion tab, the blink and scatter sliders (whose
  sub-controls appear as the amount is raised), the Colour Cycle tile lighting up once the fill
  has saturation, and the colour popover — a typed hex reaches the preview as 9,530 pixels of
  exactly that value.
- `trackValue` diverges from its old self in exactly one unreachable case: endpoints whose
  *difference* overflows to Infinity (`|to − from| > 1.8e308`) now return `NaN`.
- The extrude presets remain the only stack-motion presets; nothing yet drives a stroke's
  `width` or an extrude's `taper` from a preset.

## Web Embed Export — LANDED 2026-07-28

First **non-pixel, non-video** export: a Shader Studio piece exports as one self-contained
`.html` file that renders **live** in a browser — shipping the renderer plus a config blob
instead of frames. Resolution-independent, kilobytes of code (17.6 KB adapter bundle), real
transparency available per-surface, and a path to scroll/pointer reactivity later.

Architecture is the factory pattern again: `lib/embed/contract.ts` declares one contract
(`mount` / `setTime(t01)` / `setSize` / `destroy`), `surfaces.ts` is a one-line-per-surface
registry, and the Shader adapter calls the studio's **own** `composePasses` and `applyMotion`
rather than reimplementing them — one renderer of record, no second render surface to drift.
`vite.embed.config.ts` builds each adapter to a standalone IIFE; `bundle.ts` assembles config
+ inlined poster + adapter JS + an ES5 clock loop into a single downloadable file.

**Delivery is download-only.** Sailor is local-first (no deploy config; `127.0.0.1`), so a
published URL is meaningless to anyone else and blocked as mixed content inside HTTPS pages.
Figma Slides is a documented **non-goal** — it cannot embed arbitrary URLs (not even YouTube)
and does not support video transparency; see the spec for the evidence.

Tests: 27 Playwright across four suites (shader contract / export / parity, plus gradient), 49
unit. The parity gate is layered adapter↔studio, export↔adapter, plus a corruption test proving
the comparison can fail — because every export carries a poster fallback, so a dead render path
still *looks* right.

**Gradient Studio is the second surface (2026-07-28).** The point of doing it was to test
whether the contract generalises to a surface it was *not* designed against. It does:
`contract.ts`, `bundle.ts` and `export.ts` were untouched, and the adapter is ~25 functional
lines. The strongest evidence is a behavioural divergence the contract absorbed silently —
Shader applies motion *in the adapter*, Gradient's `render()` applies it *internally*, so its
adapter must deliberately not. Two opposite placements of the same concern, one unchanged
contract.

Caveat worth keeping: both surfaces are the same species — a class owning its own canvas and GL
context, exposing `render(cfg, w, h, t) → HTMLCanvasElement`, which is exactly the shape the
contract was designed around. N=2 of one species is strong evidence for WebGL renderers and weak
evidence in general. **Vector Type** (SVG, no canvas) and **Scene3D** (async asset inflation, a
three.js scene graph) are the surfaces that would actually falsify it.

Recurring tax for every future surface: motion helpers must live in a Vue-free module or they
are unreachable from an embed bundle. `motionConfigFor` had to be duplicated because its natural
home (`frameSource.ts`) transitively imports Vue via a module-level `ref(0)`.

Bundle sizes: `shader.js` 18.6 KB, `gradient.js` 66.5 KB. Gradient is larger because it compiles
its entire renderer — a 727-line monolithic GLSL source — into the bundle, whereas Shader's
per-effect logic lives as *data* (GLSL inside `EffectDef`s) run by a thin generic compositor.
That is an argument for the data-driven shape whenever a surface has a plugin axis.

Spec: [specs/2026-07-28-web-embed-export-design.md](superpowers/specs/2026-07-28-web-embed-export-design.md) ·
Plan: [plans/2026-07-28-web-embed-export.md](superpowers/plans/2026-07-28-web-embed-export.md)

## Space Type is the third embeddable surface — LANDED 2026-08-03

A Space Type piece now exports as a self-contained `.html` that renders live, **with its real
typeface inlined**. 44 Playwright tests pass across the five embed suites.

`contract.ts`, `bundle.ts` and `export.ts` are **still unchanged** across all three surfaces —
including one needing async font loading, because `mount()` was already async for asset inflation.
Space Type is also the first surface with `caps.alpha` genuinely `true`, so the transparency
plumbing finally has a consumer.

**Getting there exposed a layering violation worth knowing about.** The bundle carried 22 network
references — including live `fonts.googleapis.com` URLs — because `lib/spacetype`'s effects reach
sideways into app *data* modules (`~/data/google-fonts` → `~/data/variable-fonts`) and into
`shaderfx/catalog`'s fetcher. Both had the same shape: a module mixing a network fetcher with a
pure sync reader of a module-level cache. Split each (`lib/font/resolveFamily.ts`,
`lib/shaderfx/catalogStore.ts`); the render path only needs the reader.

**No embed bundle had ever been scanned by `externalRefs`** — the gate only ran on final HTML,
which is why this reached a built artifact unnoticed. `embed-build-output.unit.spec.ts` now scans
every bundle with the real function, plus an allowlist of exact inert literals (three.js's XML
namespace, typeface-JSON licence strings) each carrying a written reason.

> **Limitation, verified not assumed.** The bundle still contains three.js's `FileLoader` and
> `ImageBitmapLoader` with live `fetch(` sites. Nothing invokes them and every asset is inlined,
> but a *static* scan cannot prove a bundled loader is never called. The definitive check is a
> runtime one: load an export in Playwright with network interception, assert zero requests.

**Size — largely addressed 2026-08-04 (`c66eecf5b`, `3c200075a`).** Exports now ship **one bundle
per effect** rather than all 25: a Space Type export went from **2.16 MB to 1.11 MB**, median
per-effect bundle 801 KB against the old 1.85 MB monolith. `export.ts` changed by one line — the
bundle-name decision lives in `surfaces.ts`, which is app-side and never bundled — so
`contract.ts` and `bundle.ts` remain untouched across all four surfaces.

The adapter became a `createSpaceTypeEmbedSurface(effects)` factory, with the app-side default
export marked `/* @__PURE__ */` so Rollup can prove it dead and drop the 25-effect registry from
every per-effect build. `bundleNameFor` validates `effectId` against the live effect array, which
closes path traversal as a side effect rather than by pattern-matching for `..`.

**Both follow-ups are now done.**

`8ed79e404` — `boost.ts` vendored three typeface JSON tables, but `getFont()` has exactly one
caller hardcoded to `FONT_NAMES[0]` (Helvetiker), so Optimer and Gentilis were **dead data
everywhere**, not just in embeds. Removing two imports cut `spacetype-boost.js` from 1.64 MB to
881 KB (−46%), in line with the 801 KB median. Note `boostEffect` has no direct unit coverage —
this was verified against the built artifact.

`66116b011` + `141282eb4` — **font subsetting**, via `POST /sailor/font_subset` using `fontTools`
(already installed at 4.63.0, so no new dependency). The font went **317 KB → 30 KB (−90%)**, and
a whole export **1265 KB → 882 KB (−30%)**. The font is now 4.5% of an export rather than a third.

> **The charset is a product decision, not an optimisation.** It subsets to the characters used
> **union the full basic Latin range** (U+0020–U+007E). Used-only would be ~10 KB smaller but would
> forbid an export from ever rendering a character it wasn't built with — closing the door on the
> reactive, data-driven embeds this feature is meant to grow into. Accented characters *in the
> piece's own text* survive (the union includes used chars), so "Café" keeps its é; only characters
> absent from both the text and basic Latin are dropped. `layout_features=["*"]` keeps kerning and
> ligatures, because a subset that renders *differently* is a wrong export rather than a small one.

Two guarantees also hardened along the way: `tests/embed-network.spec.ts` (`ae7224e4a`) loads real
exports with request interception and asserts **zero** network requests — proven against a runtime
`fetch` whose URL is assembled from fragments so the static scan is demonstrably blind to it. And
`build:embed` now skips when sources are unchanged (`2004a8085`), 26s → 0.115s, on a content hash
rather than mtimes.

**Remaining size lever:** named imports, ~20–30%; the three.js renderer core is irreducible at
~460 KB.

Superseded note — the original size analysis: `spacetype.js` was 1.85 MB (529 KB gzip) against gradient's 66 KB and
shader's 18 KB. Measured, not guessed: a single-effect probe bundle is 793 KB, so per-effect
bundles would be a 2.3× win, not 10×. The bigger lever is that **32 files use
`import * as THREE from 'three'` and none use named imports**, which defeats tree-shaking —
`AudioLoader` and `CubeTextureLoader` are in a bundle that only draws text. Measure that ceiling
before committing to 25 bundles (which would also force the first-ever change to `export.ts`).

Two gotchas worth keeping: `document.fonts.check()` is **unreliable** — it returns `true` for a
fake family; use `[...document.fonts].some(f => f.family === x && f.status === 'loaded')`. And
`exportEmbedHtml`'s `transparent` (the page background) is a different thing from
`config.opts.alpha` (the engine's) — setting only the latter ships a "transparent" export on an
opaque black page.

Plan: [plans/2026-08-03-spacetype-embed-adapter.md](superpowers/plans/2026-08-03-spacetype-embed-adapter.md) ·
[plans/2026-08-03-embed-bundle-network-leak.md](superpowers/plans/2026-08-03-embed-bundle-network-leak.md)

## Transparent Video Export — LANDED 2026-07-28

Motion exports can now keep their transparency. The alpha always survived the whole pipeline —
frames render client-side to RGBA PNGs and upload intact — and was discarded at the last step
only because h264/yuv420p cannot carry it. `comfy_extras/nodes_timeline.py` now branches to
`libvpx-vp9` / `yuva420p` / `.webm` when the caller passes `alpha: true`; the h264 default is
byte-identical to before (proven by running the pre-refactor encoder on the same frames).

Six duplicated frontend POST sites collapsed into `lib/engine/encodeVideo.ts`'s `encodeFrames()`,
which derives the file extension from the **server's response** rather than the request — so a
server-side downgrade can never produce a `.mp4`-named WebM. Space Type has a **Transparent
background** toggle, enabled only when a full-pixel scan finds real transparency, and it says
plainly that WebM excludes Safari.

Verified end to end on a real export: `codec vp9 · pix_fmt yuva420p · alpha min 0 · max 255`.

> **Gotcha that will cost you an hour.** Verifying VP9 alpha with the obvious probe gives a
> **false negative**: PyAV auto-selects ffmpeg's native `vp9` decoder, which does not merge
> WebM's `BlockAdditional` alpha side-channel, so a correct file decodes fully opaque. Force the
> `libvpx-vp9` decoder. The working alpha-aware helper is in `tests-unit/sailor_encode_alpha_test.py`.

Only three surfaces render with alpha at all — **Space Type, Compositor, Scene3D**. Shader and
Gradient were measured opaque during the embed work. The toggle is wired for Space Type; the
other two are follow-ups.

Known unknown: `auto-alt-ref` never engaged in this libvpx build even across a 60-frame sweep, so
omitting it is unproven rather than confirmed. First thing to check if alpha ever vanishes on a
long clip.

Spec: [specs/2026-07-28-transparent-video-export-design.md](superpowers/specs/2026-07-28-transparent-video-export-design.md) ·
Plan: [plans/2026-07-28-transparent-video-export.md](superpowers/plans/2026-07-28-transparent-video-export.md)

> ## Shader as Fill — status, corrected twice on 2026-07-26
>
> This entry was first written as "LANDED", which was **wrong**: a whole-branch review found the effect
> catalog was never preloaded outside the studio modals, so `getEffectSync` returned `null` and a saved
> shader fill silently rendered its input fill forever on node cards, in the Compositor, and on Scene3D
> (a plain white mesh there). The branch's own E2E spec had recorded both symptoms and filed them as
> unexplained.
>
> **Those are fixed** (`7a176a282`, `d987aa349`, `fc26ccf15`) and **Julien has since confirmed the feature
> working in the real app** — the first human click-through, and the evidence that was missing when the
> "NOT LANDED" block went up. Three review rounds each returned "not ready" and each found real defects;
> the third round's findings were all closed.
>
> Three factual corrections that stand regardless: derived keys are `fill.shader.params.<paramId>`, **not**
> `.p.` (that address pointed at a phantom object and was a real bug); the `uFillAnchor` convention spans
> **14** effect shaders, not ~28; and the grep cited below proves there is one render *function*, which is
> not the same as proving `bake: true` reaches every export path — that was separately wired afterwards.
>
> Known gaps still open, deliberate: shader fills inside per-copy fill **lists** degrade to a flat swatch
> (`fillAtlasTexture` has no `'shader'` case — affects `shutter`/`coil`); corner-pinned shapes with frame
> anchor are not pixel-correct (a projective warp is not an affine `CanvasPattern` transform); Scene3D
> treats `frame` anchor as `object` and is agent-invisible; Space Type exposes no agent/motion vocabulary
> for fills, since its fills are a single serialised `fillList` control.
>
> Ledger with every finding from every round: `.superpowers/sdd/progress.md`.

**Shader as Fill — LANDED 2026-07-26, user-confirmed** (`docs/superpowers/specs/2026-07-26-shader-as-fill-design.md`, Tasks 0–10 plus three review rounds and three fix waves). A shader stops being a full-frame layer and becomes a `FillType`: `FILL_TYPES` gained `'shader'` (recursive, depth-1 enforced), backed by one module, `lib/shaderfill/`, that is the *only* place in the product turning a shader fill into pixels (`resolveField`) — a readback bridge over the existing `shaderFx` WebGL2 singleton, batched by descriptor (not by consumer) so ten shapes sharing one field cost one render. Reaches all four surfaces that can host a fill — Space Type, Shape Studio (reuses Space Type's `fillTexture()` with 3 small schema/propagation fixes, not literally zero), every frame primitive (Compositor), and Scene3D (object-anchor only; the reusable unit there is the field module, not `Fill` itself, since Scene3D never touches `FILL_TYPES`). Object anchor is free; frame anchor cost a `uFillAnchor` convention across ~28 Space Type effect shaders. Authoring uses a new pattern — **declare the frame, derive the contents** (`fill.shader.effectId/anchor/speed` frozen and Collection-bindable, `fill.shader.p.<paramId>` derived per-effect from the live catalog) — the first place the control schema meets genuinely dynamic (63-effect) vocabulary, and the main architectural output of this act beyond the feature itself.

Task 10 closed the act: fixed a real correctness bug where `LIVE_FIELD_CEILING` (4 live fields/frame, protecting *interactive* framerate) was also being applied to bake/export requests, silently freezing the 5th-and-beyond shader-fill descriptor at t=0 on any export — fixed at `beginFieldFrame` so every surface inherits it, proven live (not just unit-tested) via a 6-field bake harness at `/dev/shaderfill-bench`'s `window.__benchBakeCeilingProof()`: all 6 fields advance under `bake:true`, only the first 4 advance under `bake:false` (control). Also wired `bake: true` through the Compositor's export paths (motion bake, static Render, Harmonize, Frame download/publish, `bakeOverlay`) — Space Type had this from an earlier task, Compositor didn't. Bake parity is structural, confirmed by grep: every bake path funnels through the same `resolveField` (`grep -rn "shaderFx.render" frontend/app` turns up only Shader Studio's own surfaces and `lib/texturefx/stylize.ts`).

**Vector Type Studio — LANDED 2026-07-27** (commits `003ac333a`..`7423d4fad`, 11 commits, +15,076/−4,065 across 161 files; `docs/superpowers/specs/2026-07-27-vector-type-studio-design.md`). Act 2's first surface: text → variable-font outlines (fontkit) → animated as real 2D geometry, baked to PNG through the existing cascade, and exported as SVG — **Sailor's first vector output**. It is stateless (`f(cfg, t) → paths`) like Gradient, not rebuild-on-change like Shape, so it arrived fully animatable on day one, including per-glyph stagger (seeded-stable order; a travelling weight wave proven by test). Roboto Flex's 13 axes — `XOPQ` (stroke thickness), `GRAD` (grade), `YTAS` (ascender height), among others — are now animatable design parameters. Fourth factory proof: one `ControlSpec[]` declaration again generated inspector, agent vocabulary, motion, and sweeps together. `app/lib/vector/svg.ts` (`VectorShape`/`shapesToSVG`) was built studio-agnostic, so Shape Studio can become its second consumer.

It replaced three retiring surfaces: Kinetic Slates (−781), the KineticType node with a 74-preset migration (−1,527, 17 mapped honestly / 9 partial / 48 dropped with a written reason each), and the Font Playground widget (−730, removed outright — 0/289 saved and 0/91 backup projects referenced it). **Surface count, stated honestly:** counted consistently, the net change is **−2** either way. Narrowly — type-*authoring* surfaces only — it is six→four: Space Type, Kinetic Type, Kinetic Slates, Font Playground, Text on Path and Text Mask become Vector Type, Space Type, Text on Path and Text Mask. Broadly, counting everything that lets a user pick a font, it is eight→six, because Scene3D text and Compositor text layers exist throughout and the design doc excluded them as "different jobs". (The earlier "six→five" figure was wrong — it paired the narrow before-count with the broad after-count.)

Open, not softened: a migrated KineticType node no longer executes on the ComfyUI backend (it was a real node with IMAGE/MASK outputs; Vector Type is frontend-only — graphs piping kinetic frames into a backend node lose that input at Run time, though baked frames and timeline playback still work; needs a release note), and its migrated MASK output wire dangles unconnected. No fallback exists if `google/fonts` renames a path upstream (the design doc's "static cut, axes disabled" mitigation is unimplemented). No node consumes SVG output — it only leaves the product by download. Parity gaps vs. the retired Font Playground remain: 10 curated families rather than the full Google Fonts catalog, no kerning off-switch, no word-level 3-D transform. `lib/gsap-kinetic.ts` and `kinetic-presets.ts`'s `build()` closures are now orphaned (the preset catalog is still live for Compositor metadata) — a separate cleanup. The in-studio agent tuner is wired and guard-tested but not yet runtime-verified against a live model.

**Vector Type — motion preset gallery — LANDED 2026-07-27** (commits `173249a1c`..`7a5f251cc`, 11 tasks + 1 added mid-flight; `docs/superpowers/plans/2026-07-27-vector-type-motion-presets.md`). A Jitter-style gallery of live-animated tiles in the Motion tab: Appear, Fade, Slide ×4, Mask ↑↓, Grow, Shrink, Blur, Blur & Slide — all 12 proven working in a browser, each with a discriminating metric. Mostly **reuse**: the Compositor's `MotionPresetPicker`/`PresetThumb`/`evaluate.ts` were already consumer-agnostic and moved to a neutral home. New capability was blur (absent from the canvas engine entirely — now in `UnitState`, `ctx.filter`, and `feGaussianBlur`) and a **variable-axis section shown first**: Weight In, Weight Wave, Width Breathe, Grade Pulse, Optical Drift, each a fraction of the loaded font's own range, disabled-with-reason on fonts lacking the axis. Grade Pulse's no-reflow property is measured and proven — shaped advances identical to the unit (0.000% change) while ink swings +19.5%, against a `wght` control that moves advances +14.1%. Presets compose with hand-authored axis tracks (offsets add, scale/opacity multiply); the studio's seeded stagger wins over the engine's.

Three things worth remembering from it. Putting blur into the *shared* engine tables silently added three un-renderable tiles to the **Compositor's** picker — fixed by making the catalog declare what each preset requires, derived by probing what it actually returns, which also caught a fourth un-gated consumer in the timeline's clip inspector. Canvas filter radius is in **device px and ignores the CTM**, so it needs a `pixelRatio` multiply or the node card blurs ~5× harder than the bake. And SVG `stdDeviation` **equals** canvas blur radius — the CSS spec defines the parameter as the standard deviation — verified at RMS 0.000 against a σ-halved control that diffs 12.55%.

Open: `MotionClipInspector`'s timeline path and the mask-through-the-real-SVG-button case were verified at function level only, never through the live button. Gallery cost is unmeasured on a visible window (11 outline tiles ran 12–16 ms/tick headless, which is why outline thumbnails are axis-section-only).

## Compositor — depth of field, and the first local model (landed 2026-07-29)

The first slice of **local inference**: `POST /api/depth/estimate` runs Depth Anything
V2 in-process via transformers.js and caches greyscale depth maps by content hash. No
API call, no per-preview bill. Measured on a 4094² portrait: **3.6 s one-time pipeline
load, 1.1 s inference, 38 ms on a cache hit**; maps are capped at 1024 px on the long
edge because they drive a blur radius, not detail.

That depth drives a **depth-of-field post effect on image layers** — focus, sharp band,
aperture, blade count and rotation, highlight threshold and boost. The blade polygon
*is* the iris, so six blades give hexagonal bokeh and under three a circle.

This also gives the Compositor its **first GPU post stage**. The existing chain is
Canvas 2D and correctly so, but a variable-radius shaped blur is ~700 samples/px —
the wrong machine, not an optimisation problem. `gpuPost.ts` is a small WebGL2 runner
whose output re-enters the 2D chain; DOF is its first inhabitant, and fog, distance
grading and every "by distance" variant of the existing 63 effects want the same stage.

`DofEffect` is routed by `GPU_TYPES`, deliberately disjoint from `CHAIN_TYPES`, so
`applyEffectChain` can never silently skip a type it cannot render. It sits **first** in
the order (`dof → adjust → duotone → bloom → vignette → grain`) because defocus happens
at the lens — putting it last would blur the grain.

**The factory paid out again.** The agent surface needed no code: `sanitizeEffect` is
already driven by `POST_EFFECT_DEFAULTS`/`POST_FX_PARAM_CLAMP`, so declaring the type
made DOF agent-drivable for free. Only the prose hint changed.

**Two bugs only real-GL verification could catch**, both of which produced *plausible*
output. (1) Missing `UNPACK_FLIP_Y_WEBGL`: every result was vertically flipped, and
because colour and depth flipped together the depth stayed correctly aligned — mean abs
diff 23.95 upright vs 3.07 flipped. (2) At 32 taps, samples land ~5 px apart, so each
bokeh disc rendered as a scatter of dots; fixed with a deterministic per-pixel rotation
of the tap spiral (hash of `gl_FragCoord`, stable across frames so bakes don't shimmer)
plus 48 taps. Face local contrast now 0.477 original / 0.472 focused / 0.195 defocused.

Open: **occlusion bleed is mitigated, not solved** — taps are weighted by whether their
own CoC reaches the centre, which softens the dark halo on foreground edges, but the
pixels behind a blurred foreground object were never captured. A correct fix needs layer
separation. Residual sampling speckle at 48 taps. **Not yet driven end-to-end in the
real Compositor UI** — the pass, the panel and the routing are each verified
independently, but nobody has added DOF to a live layer and watched it blur.

## Scene3D — surface relief (landed 2026-07-28)

Scene3D materials had exactly one texture slot, so a brick photo on a cube read as a
sticker. Three producers — a procedural shader effect, an uploaded image, and an AI
tile — now funnel through **one grayscale height field** bound to THREE's `bumpMap`,
which derives the perturbed normal in the fragment shader. No Sobel pass, no
normalisation, no tangent handling. Controls: **Depth · Contrast · Tiling**, plus a
separate `normalImage` slot for real baked tangent-space normal maps. Also landed: a
**Phong** material type, and film grain as the first of the stylised post passes.

**The one thing to know: bump renders the height field's *local gradient*, not its
range.** Every failure in this feature traced to that. Measured across all 63 catalog
effects, the original default scored 5.42 against a catalog median of 6.0 and rendered
identically to no relief; it was swapped for one at 36.8. A flatness guard now warns
below 8 rather than silently doing nothing.

Two design errors worth remembering. The AI path ran its tile through a **depth** model
to dodge baked-in lighting — correct diagnosis, wrong tool, because depth reports scene
*distance* and a flat material sample is all one distance (gradient 3.3, invisible). It
now uses the colour tile the route already generated and was throwing away, which also
halved the cost per generation. And `contrast` was wired to the rebuild key alongside
`invert` — correct for a toggle, wrong for a *slider*, costing 51 material rebuilds per
drag until the final review caught it.

Open: the paid AI generation path has never been run live; Space Type shares
`PostSettings` and now carries pass fields its own UI does not expose.

## Canvas — the node capsule (landed 2026-07-27)

Canvas nodes have a collapsed resting state: a 260px capsule (icon, title, one-line
read-out, run button) that grows into the full card on click. Size now encodes
importance instead of every node carrying equal weight.

- **Read-out** resolves error > running > declared rule > silence. Studios derive theirs
  from `ControlSpec.summary` (one opt-in field beside `agent`/`animatable`); Comfy nodes
  declare widget names in `lib/canvas/capsuleMeta.ts`. Undeclared types show their name
  and nothing else, so coverage lands incrementally.
- **Tiers**: always / after-run / never / manual, all 28 vue-flow types classified.
  **v1 ships `comfy` only** — the tier table and the `{from:'controls'}` path are tested
  groundwork with no consumer yet, and the manual toggle for studios does not exist.
- **Transition**: real height animation (0.36s in / 0.22s out, `cubic-bezier(0.32,0,0.12,1)`)
  plus a card-only fade. Deliberately no width, scale or capsule-opacity change — each
  contradicted "same object opening". Height is what makes ports and wires travel.
- **Persistence**: `collapsed` (true only) and `hasRun` via `lib/canvas/persistCapsule.ts`.
  `runningSince` is deliberately excluded — a saved wall clock reloads as a forever-ticking
  counter.

Modules: `lib/canvas/{elapsed,capsuleReadout,capsuleMeta,nodeIcon,persistCapsule}.ts`,
`components/vue-canvas/NodeCapsule.vue`. 5 unit specs + 2 Playwright specs.

**Vector Type — fills — LANDED 2026-07-28** (commits `0cdc83e5a`..`29a308a94`, 10 tasks; `docs/superpowers/plans/2026-07-27-vector-type-fills.md`). The studio's flat `#rrggbb` becomes the product's full `Paint` vocabulary — all nine `FILL_TYPES` (solid, gradient, ombre, grid, noise, checkerboard, stripes, qr, shader), reusing `lib/spacetype/fillTile.ts` and `lib/compositor/paint.ts` rather than a second model. All nine proven end-to-end (canvas, PNG bake, SVG through the real Export button). The 2D paint resolver moved out of `useCompositorLayers` into `lib/paint/resolve.ts` so a second studio could use it.

**Three fill anchors, not two.** Space Type has `object | frame`; type needed the middle term. `glyph` gives every letter its own ramp (all ≈ midpoint), `word` spans the run (235→22 red across six letters), `frame` pins to the canvas (183→73). Under motion a letter's colour is byte-identical at t=0 and t=1 under `glyph` and changes completely under `word`/`frame` — the fill rides the letter, or the letter slides across it.

**Six of nine export as genuine vector**, and the product says so. Solid and both gradient forms emit real `<linearGradient>`/`<radialGradient>`; grid, stripes, checkerboard and qr emit real `<pattern>` geometry — every one at **0.0000%** against the canvas, with broken controls diffing 95–100%. Ombre, noise and shader cannot be vector (per-pixel dithers and a WebGL fragment render have no geometry to recover) and embed an honest raster. `exportTier(paint)` derives the tier by calling **the same function the exporter calls**, so the UI claim cannot drift from the bytes — verified 9/9 by clicking Export and inspecting the file.

Findings worth keeping. An untransformed wrapper `<g>` does **not** pin an SVG paint server — `fill` is inherited; the inverse `gradientTransform` is what cancels the glyph's own transform (the plan said otherwise and a pixel diff disproved it). `objectBoundingBox` needs aspect correction at oblique angles (46.3% disagreement, exact at 0°/90°). Angled stripes tile exactly, because the canvas's per-pixel dot product is an orthonormal basis change. And raster embed scale must be **kind-derived** — a dither at 2× measured 82–91% different, because its raster grid *is* the artwork.

Open: the live Space Type 3D render could not be verified in the browser pane (scene builds, no GL error, readback black — believed environmental, not claimed working). No non-Chrome renderer was checked. `useVectorSvg.ts` (the Compositor's own SVG writer) still collapses rich fills to a flat colour silently — the anti-pattern this work corrected in Vector Type, still live there.

**Vector Type — appearance stack — LANDED 2026-07-28** (commits `00d307f0b`..`7953f8c4b`, 10 tasks; `docs/superpowers/plans/2026-07-28-vector-type-appearance.md`). Multiple fills and multiple strokes as an ordered, Illustrator-style stack, plus **extrude**. Each layer carries a **stable id**, its own `Paint`, anchor, opacity, blend and enabled flag. Array order is paint order, so **a stroke below a fill** is now expressible — measured at 56,350 px of visible fill against 0 px under the old fixed order, where the stroke swallowed the letterform.

**Extrude is real editable vector, not 3D and not a raster** — the same glyph path drawn N times at translated offsets behind the face (`depth`/`angle`/`distance`/`taper`), optionally unioned via paper.js into one solid body. Depth grows ink 11,804 → 61,683 px while the face stays *exactly* 11,092 at every depth. Worst realistic case 3.1 ms/frame, bounded at 2,400 copies with the drop reported rather than silently capped. The union costs ~1.3 ms per copy — 575× drawing — so it is gated to bake and export, proven three independent ways (import graph, sync-vs-async, input type); a memo on the union's own input took a 120-frame bake from 111.5 s to **1.12 s**.

**Stable ids were chosen over positional paths**, and the choice paid: a motion track survives a drag reorder still animating the same layer (cyan 0 → 38,785 px), while the same track written positionally reads 5,741 px at both times — **silently dead**. A Collection binding to a deleted layer bakes byte-identical to no-override rather than hitting a wrong layer. `lib/studio/listRemap.ts` + `idPath.ts` were extracted in the process, ending a copy-paste of the remap logic that Shader Studio had inlined into its `.vue`.

Also: **stroke was already there and merely invisible** — its colour control was `when`-gated behind `strokeWidth`, which defaults to 0. The stack fixes that structurally; a new stroke layer paints 7,055 px immediately without touching a slider.

Open: **a pre-existing paint-box clipping bug**, exposed by canvas-vs-SVG diffing and deliberately left unfixed. `resolvePaint` returns a `no-repeat` pattern, so a `Fill`-form gradient loses 68% of an extrude's ink at the `glyph` anchor, 50% at `word`, and 47% of a 20px gradient stroke. The correct answer differs per fill type (SVG pads gradients but tiles grid/stripes), the line is in `lib/paint/resolve.ts` shared with the Compositor, and the tempting local fix would break canvas/SVG colour parity. Recipe in the task report. Also open: `VectorShape.stroke` is `string | null`, so a gradient *stroke* still flattens to a colour in SVG; and Shader Studio's post-refactor behaviour is verified at module and test level only — ComfyUI was not running, so no live pixel.

**Vector Type — stroked extrude silhouette — LANDED 2026-07-28** (commits `bc75c2d30`..`c445d03cf`, 4 tasks; `docs/superpowers/plans/2026-07-28-extrude-silhouette-stroke.md`). An extrude layer can carry its own stroke: **one outline around the whole extruded body**, not an outline per offset copy. Verified by a seam metric — 0.00% of the silhouette's stroked ink lies inside the body, against 56–83% for a deliberately per-copy control, and 4 strokes against 32.

**The architecture is the interesting part.** A silhouette needs the paper.js union, which costs ~1.3 ms per copy — 575× the cost of drawing one. Rather than reopen the wall that keeps a draw frame off paper.js, the live path **reads** a paper-free body cache and never **triggers** a union; a cold frame draws unstroked and the stroke appears once the body lands, the same posture `resolveField` takes for shader fields. That wall is still load-bearing: adding a bare `import 'paper'` to the new cache module turns the existing import-graph guarantee test red. A rapid drag of 120 real slider events in 129 ms produced **0 unions during the burst and exactly 1 after**, against a control where one union is a 103 ms long task.

`solid` ships as a **stack row**, not a `ControlSpec` — the schema has no boolean kind, and faking one as a `select` would have shipped a toggle that forgets itself on reload. `StudioLayerStack` was extended with one `row-extra` scoped slot rather than forked; Gradient's and Shader's rows are byte-identical.

Open: on an **animated axis**, pausing or scrubbing does not bring the silhouette back — `previewTime` is in neither union trigger, so no body is scheduled for the paused frame. Two task reports claimed otherwise and the final verification pass disproved them. Deliberately unfixed: the one-line watcher would spend that 103 ms block precisely at the moment the user pauses. **Deliverables are unaffected** — SVG and PNG at the same `t` are correctly fused and stroked.

**Vector Type — skew and arc — LANDED 2026-07-28** (commits `f9cd8097b`..`50318329b`, 6 tasks; `docs/superpowers/plans/2026-07-28-vector-type-skew-arc.md`). A whole-run shear, and glyphs placed along a curve with each rotated to the tangent. **Both stay exactly-correct vector** — a shear is affine and rigid placement is affine, so both are legal SVG transforms. 21/21 verification items pass, with canvas-vs-SVG at 0.0000% and deliberately broken controls at 68–100%.

**Arc deliberately does not use paper.js.** It has exactly the right API, but arc placement runs every frame and the guarantee that a draw frame cannot reach paper is load-bearing. A cumulative-chord table plus a binary-search inversion gives spacing 1,600× more even than the naive `t`-uniform mapping `utils/textOnPath.ts` uses (0.0227% spread vs 36.30% on a wave), for ~15 lines and no dependency.

**Rotation broke four downstream assumptions, each measured before it was fixed.** The `glyph` fill anchor diverged canvas-vs-SVG by 76.7% — and *neither* renderer was right, SVG's box being the browser's own second derivation; both now replay the canvas's placed-ink box. The axis-aligned clip window was sliced per letter and, independently of arc, **could not fully open** (22.6% of ink lost at `amount: 0`); it became a generic `VectorWindow` with an optional rotation. The taper pivot lived in **four** places, not the three the handoff predicted. And motion `dx`/`dy` moved in output space rather than the glyph's frame — now local, dropping mask spread across arc angles from 17.0 to 0.4 points, with `rotate === 0` branching so straight runs stay bit-identical.

Open: negative arc past ~−150° collapses the word into its own centre. Proven to be *correct* type-on-path geometry — the placements are exact mirrors — but the slider range and its hint over-promise on the negative side; an Illustrator-style flip is a design decision, not a patch. Skew also carries a ~0.016px rounding residual at the default export precision, converging to exactly 0 at precision 6.

## Agent layer

Loop shape is right (perceive → plan → invertible commands → ghost preview → Keep/Dismiss) plus visual self-review and Direction Loop. **Reach is the gap:** 4 agent surfaces (canvas, compositor, smartLayout, texture) vs ~22 creative surfaces; 3 of 8 studios expose descriptors, plus a 4th (Vector Type) wired but with its agent tuner unverified live. LLM tiers: haiku→patch / sonnet→plan / opus→campaign; Fable for style profiles.

## Known debt

- **Export:** 4 independent paths; JSZip ×2; ~40 ad-hoc `a.download`; deliverables shelf re-packages, never renders. (Act 3)
- **Motion:** 6 parallel motion modules wired through 3 registries + DOM CustomEvents; only one preset↔keyframe bridge. (Act 1 absorbs numeric tracks; sequencing models stay per-surface)
- **Agent-invisible depth:** Scene3D is the largest surface with zero agent access. (Act 3, or free via factory retrofit)
- **Texture/Shape have bakers but no motion path.**
- **Bindability markup gate:** a control missing its `<BindableRow>` wrapper is sweepable in principle but has no UI affordance.
- **The studio row's real pitch is 40px, not 28px.** `StudioSection`'s body is still `space-y-3`, a 12px gap sized for the old 62px two-line controls. It can't tighten until the sweep removes them, so the honest saving today is 74 → 40 per setting.
- **`StudioRow`'s `#body` slot is unreachable.** Its docblock promises complex kinds render the row as a header and expand a body beneath it, but the registry supplies only the value side and nothing can pass a body per kind. The expandable-row mechanism the spec assigns to `spring`/`xy`/`curve`/`path`/`gradientStops`/`fillList` is documented but has no route — same defect class as the unreachable `bindable !== false` it shipped alongside.
- **Both adapters' labelled branches have never executed.** All 23 `StudioSelect` and all 33 `StudioSwitch` call sites are bare, so both take their pre-rebuild escape branch 100% of the time. Their `StudioRow` paths run for the first time during the sweep.
- **Nested `#section-` slot names use the leaf title, not the path**, so `Canvas/Shadow` and `Text/Shadow` would both claim `#section-Shadow`. No surface nests yet, so it is unreachable today.
- **Nested children always render after all of a parent's own controls**, regardless of declaration order. Correct, but undocumented in `sections.ts`, whose docblock only promises sibling ordering.
- **`RowText` writes per keystroke** — one undo entry per character. Parity with Space Type's existing binding rather than a regression; the real fix is commit batching.
- **Migrated KineticType nodes lost backend execution.** The retired node was a real ComfyUI node (IMAGE/MASK outputs); Vector Type Studio is frontend-only. Graphs that piped kinetic frames into a downstream backend node lose that input at Run time — baked frames and timeline playback are unaffected. Needs a release note. The migrated MASK output wire also dangles unconnected on these nodes.
- **No fallback if `google/fonts` renames a path upstream** for Vector Type Studio's variable-TTF proxy — the family just fails to load. The design's "static cut, axes disabled and labelled" mitigation was never implemented.
- **No SVG-consuming node exists.** Vector Type's SVG export only leaves the product by download.
- ~~**Paint-box clipping in `resolvePaint`.**~~ **FIXED 2026-07-28** (`9c83a9e1f`). A `Fill` paint now spreads outside its own box when the ink reaches — extrude copies and stroke outsets. 42/42 cases reach SVG parity (losses of 65/47/42/21% → 0%); the Compositor is byte-identical across 48 cases because the default preserves the old behaviour exactly. Residual: per-pixel *colour* outside the box is approximate for `stripes`/`checkerboard`/`grid` (a box-sized tile leaves a phase seam) — the same disagreement those three already show inside the box. Gradients are exact.
- **Negative arc past ~−150° collapses the word.** Geometrically correct (exact mirror placements) but the slider range and hint over-promise; wants an Illustrator-style flip.
- **Gradient strokes flatten in SVG.** `VectorShape.stroke` is `string | null` — it needs a paint-server slot like `fill` has.
- **Paused frames lose the extrude silhouette on an animated axis.** `previewTime` is in neither union trigger, so scrubbing shows the un-fused stack. A config nudge restores it instantly, proving the mechanism. Unfixed by choice — the obvious watcher costs a 103 ms block at the pause. Exports are correct.
- **`useVectorSvg.ts` still degrades silently.** The Compositor's SVG writer collapses every rich fill to a flat representative colour via `paintPrimaryColor` and says nothing — the exact anti-pattern Vector Type's export-tier declaration was built to avoid. Same fix would port.
- **Space Type's live 3D render is unverified** after the `fillTileBox` rounding change. Its fill textures provably never route through that function, and `paintTileBox` (its only exposure) is verified correct — but the on-screen 3D readback could not be captured in the browser pane.
- **`MotionClipInspector`'s timeline path is unverified** for the new preset capability gating — checked at function level only, never driven through the live timeline UI.
- **Gallery cost is unmeasured on a visible window.** 11 outline thumbnails ran 12–16 ms/tick in a hidden pane, which is why `VectorTypeThumb` is used for the axis section only and `PresetThumb` elsewhere.
- **`lib/gsap-kinetic.ts` and `kinetic-presets.ts`'s `build()` closures are orphaned** by the KineticType retirement (the preset catalog itself is still live, read by the Compositor for metadata) — an uncompleted cleanup.
