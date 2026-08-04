# Embed font subsetting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the inlined font in a Space Type export from ~296 KB to roughly 40–60 KB, without foreclosing text that changes at runtime.

**Architecture:** A ComfyUI-side route subsets the TTF with `fontTools`, which is **already installed** (4.63.0) — no new dependency. The export path calls it after fetching the font and inlines the smaller result.

## The decision this implements

Subsetting to *only* the characters a piece uses would give ~20–40 KB, but the export could then never render a character it wasn't built with — closing the door on the reactive/data-driven embeds that were named as a goal at the outset.

**The chosen compromise: subset to the characters used PLUS the full basic Latin set** (U+0020–U+007E: A–Z, a–z, 0–9, common punctuation). That is ~100 glyphs instead of thousands. Lands around 40–60 KB, and any English text still renders if the text ever becomes dynamic. Only accented and non-Latin characters are lost.

## Context

- The font is currently fetched by `frontend/server/api/scene3d/google-font-file.get.ts`, which proxies Google Fonts with a `curl/8` User-Agent to force TTF rather than woff2, with a 24h in-memory cache.
- The export path (`exportWebEmbed` in `SpaceTypeSurface.vue`) fetches those bytes and inlines them as a `data:` URI via `frontend/app/lib/embed/fontFace.ts`.
- A Space Type export is currently ~1.11 MB, of which 296 KB (~26%) is the font.
- ComfyUI already hosts `/sailor/*` routes for this kind of processing — `/sailor/spacetype_encode` in `comfy_extras/nodes_timeline.py` is the precedent.

## Global Constraints

- **A subsetting failure must never break an export.** Falling back to the full font costs size, not correctness — that is an acceptable degradation, but it must be *logged*, never silent.
- **The exported HTML must still contain zero network references**, verified by both the static gate (`embed-build-output.unit.spec.ts`) and the runtime one (`tests/embed-network.spec.ts`).
- ComfyUI must be restarted for Python changes to take effect; it runs on `127.0.0.1:8188`, frontend on `127.0.0.1:3000`. **Always `127.0.0.1`, never `localhost`** (IPv6 → HTTP 426).
- Python via `.venv/bin/python`.
- Baseline: **6 unit failures** on main (`agent-capability-routing`, `gradientfx-frame-source`, `spacetype-palette`). Add none.
- TypeScript typecheck has ~328 pre-existing errors — not a gate.
- Git: main-direct, explicit paths only. A parallel session shares this checkout with ~100 dirty files. Never `git add -A` or `git stash`; never stage `frontend/pnpm-lock.yaml`.

---

### Task 1: The subsetting route

**Files:**
- Modify: `comfy_extras/nodes_timeline.py` (or a sibling module if that file is already large — say which you chose and why)
- Test: `tests-unit/sailor_font_subset_test.py`

**Interfaces:**
- Produces: `POST /sailor/font_subset` — body `{ "font": "<base64 ttf>", "text": "<the piece's text>" }`, response `{ "font": "<base64 subsetted ttf>", "before": <bytes>, "after": <bytes> }`

- [ ] **Step 1: Write the failing test**

Read a neighbouring test in `tests-unit/` first and match its runner and conventions.

Cover, using a real font file (find one already in the repo — `frontend/public/fonts/` has candidates):
- the subsetted font is **materially smaller** than the input (assert a ratio, not a fixed byte count, so it doesn't rot)
- it still **parses** as a font afterwards (load it back with fontTools)
- every character of the supplied text is present in the output's cmap
- **every basic-Latin character U+0020–U+007E is present**, even ones absent from the text — this is the whole point of the compromise, so it needs a test that would fail if someone "optimised" it later
- a character outside the text and outside basic Latin (e.g. `é` or `→`) is **absent**, proving subsetting actually happened

- [ ] **Step 2: Run it and confirm it fails for the right reason**

`.venv/bin/python -m pytest tests-unit/sailor_font_subset_test.py -v`

- [ ] **Step 3: Implement**

Use `fontTools.subset`. Build the character set as: the unique characters of `text`, unioned with U+0020–U+007E.

Keep layout features that matter for rendering (kerning, ligatures) rather than stripping everything — a subset that renders differently from the original is a wrong export, not a small one. Say in your report which fontTools options you used and why.

Guard the inputs: reject a missing/undecodable `font`, and cap the accepted size so a malformed request cannot exhaust memory.

- [ ] **Step 4: Confirm green and report the real numbers**

Report before/after bytes for a real Google font, and the resulting ratio.

- [ ] **Step 5: Commit**

```bash
git add comfy_extras/nodes_timeline.py tests-unit/sailor_font_subset_test.py
git commit -m "feat(fonts): subset a TTF to its used glyphs plus basic Latin"
```

---

### Task 2: Use it in the export

**Files:**
- Modify: `frontend/app/components/vue-canvas/SpaceTypeSurface.vue` (the `exportWebEmbed` handler)
- Possibly create: a small helper alongside `frontend/app/lib/embed/fontFace.ts`
- Test: extend `frontend/tests/embed-spacetype.spec.ts`

- [ ] **Step 1: Wire the call**

After the export fetches the font bytes, POST them to `/sailor/font_subset` with the piece's text, and inline the result.

**On any failure — network, non-200, malformed response — fall back to the full font and log it.** The export must still work. A silent fallback is not acceptable: the user should be able to find out why their export is 296 KB instead of 50 KB.

Read how `exportWebEmbed` currently obtains the font before changing it, and preserve the existing `font: null` path for system fonts with no fetchable file.

- [ ] **Step 2: Test that the export still renders in the real typeface**

`tests/embed-spacetype.spec.ts` already proves an export renders in its real font rather than a `sans-serif` fallback — that test must still pass with a subsetted font. If it doesn't, the subset is broken, not the test.

Add a size assertion: the exported file must be **materially smaller** than before. Express it as a band with reasoning, not a magic number.

- [ ] **Step 3: Verify the guarantees still hold**

```bash
cd frontend && npm run build:embed
PW_BASE_URL=http://127.0.0.1:3000 npx playwright test tests/embed-network.spec.ts tests/embed-spacetype.spec.ts tests/embed-contract.spec.ts tests/embed-export.spec.ts tests/embed-parity.spec.ts tests/embed-gradient.spec.ts --project=chromium
```

Currently 50 tests across those files. **The runtime network test must stay green** — a subsetted font is still a `data:` URI and must not become a fetch.

Restart ComfyUI first so the Python route is live:
```bash
.venv/bin/python main.py --listen 127.0.0.1 --port 8188
```
Say in your report whether you restarted it.

- [ ] **Step 4: Report the numbers that matter**

Exported file size and the font's share, against the current 1.11 MB / 296 KB (26%) baseline.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/SpaceTypeSurface.vue frontend/tests/embed-spacetype.spec.ts
git commit -m "feat(embed): inline a subsetted font in Space Type exports"
```

---

## Done when

- A Space Type export's font is ~40–60 KB rather than 296 KB
- The export still renders in its real typeface, proven by the existing test
- Basic Latin survives subsetting, proven by a test that would fail if someone narrowed it later
- A subsetting failure degrades to the full font, loudly
- Both the static and runtime network guarantees still hold

## Not in scope

Subsetting for the other surfaces — Shader and Gradient carry no fonts. Named imports (~20–30% of the JS) remain the next size lever after this.
