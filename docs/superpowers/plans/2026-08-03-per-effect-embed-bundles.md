# Per-effect embed bundles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut a Space Type export from 1.85 MB to roughly 800 KB by shipping only the effect it uses, instead of all 25.

**Architecture:** Emit one bundle per Space Type effect (`spacetype-<effectId>.js`) via a virtual Vite entry, and have `export.ts` fetch the right one. The bundle-name decision lives in `surfaces.ts` — which is app-side, never bundled — so `export.ts` changes by one line and stays generic.

## The measurements this is based on

| | raw | gzip |
|---|---|---|
| shader.js | 18.6 KB | 6 KB |
| gradient.js | 66.6 KB | 21 KB |
| spacetype.js (all 25 effects) | 1.85 MB | 529 KB |
| **single-effect probe (measured)** | **793 KB** | **205 KB** |
| three.js floor, named imports only | 460 KB | 115 KB |

A full export today is 2.16 MB (bundle + 296 KB font + poster). Per-effect takes that to ~1.1 MB.

529 KB gzipped of JavaScript for one decorative element is too heavy for a live page, and JS parse
is main-thread work that video decode is not. That is the case for doing this.

**Named imports are a secondary lever** (~20–30% on top, since the three.js renderer core is
irreducible at ~460 KB) and **font subsetting is third** — it only becomes the dominant cost after
this lands. Not in scope here.

## Global Constraints

- **`export.ts`, `bundle.ts` and `contract.ts` have survived three surfaces unchanged.** That is real evidence the contract generalises. `export.ts` will change here — make it **additive and generic** (derive a bundle name), never Space-Type-specific. If you find yourself writing `if (kind === 'spacetype')` inside `export.ts`, stop: that logic belongs in `surfaces.ts`.
- **The network-ref gate must stay green for every bundle.** `embed-build-output.unit.spec.ts` scans built bundles with the real `externalRefs`; it cost real work to get clean.
- Unit tests: `frontend/tests/unit/**/*.unit.spec.ts`, `cd frontend && npx vitest run`.
- Browser tests: `frontend/tests/*.spec.ts`, Playwright, `PW_BASE_URL=http://127.0.0.1:3000`. Always `127.0.0.1`, never `localhost` (IPv6 → HTTP 426).
- Baseline: **6 unit failures** on main (`agent-capability-routing`, `gradientfx-frame-source`, `spacetype-palette`). Add none.
- TypeScript typecheck has ~328 pre-existing errors — not a gate.
- Git: main-direct, explicit paths only. A parallel session shares this checkout with ~100 dirty files. Never `git add -A` or `git stash`; never stage `frontend/pnpm-lock.yaml`.

---

### Task 1: Emit one bundle per effect

**Files:**
- Modify: `frontend/vite.embed.config.ts`
- Modify: `frontend/package.json` (`build:embed`)
- Modify: `frontend/tests/unit/embed-build-output.unit.spec.ts`

Keep emitting `spacetype.js` for now so nothing breaks mid-flight; Task 2 removes it.

- [ ] **Step 1: Generate the per-effect entries virtually**

25 entry files on disk would be noise. Use a Vite virtual-module plugin so `SAILOR_EMBED_SURFACE=spacetype:<effectId>` builds an entry that imports **only** that effect plus the adapter, and emits `spacetype-<effectId>.js`.

The current entry (`entry-spacetype.ts`) assigns `globalThis.__SAILOR_SURFACE__`. The per-effect entry must do the same — the runtime in `bundle.ts` reads exactly that global, and it must not change.

**The adapter currently resolves an effect by id from `effects/index.ts`, which imports all 25.** That import is what makes the bundle big, so a per-effect build must not reach it. Read `surfaces/spacetype.ts` and work out the smallest change that lets it accept a single pre-supplied effect instead of looking one up. Prefer passing the effect in over adding a build-time conditional inside the adapter. Explain what you chose.

Keep the unknown-`effectId` throw working — a silently substituted effect is a wrong export that looks right.

- [ ] **Step 2: Wire `build:embed`**

It must emit `shader.js`, `gradient.js`, and one `spacetype-<id>.js` per effect. Derive the effect list from the same source of truth the app uses (`effects/index.ts`), not a hardcoded list — a hardcoded list silently goes stale when an effect is added.

A single bundle builds in ~0.57s, so expect ~15s total. `predev` runs this, so it lands on every `npm run dev`. If that proves unpleasant, say so with the measured number rather than optimising speculatively.

- [ ] **Step 3: Extend the gate to every bundle**

`embed-build-output.unit.spec.ts` must scan **all** emitted bundles, not a fixed three. Enumerate `public/embed/*.js`.

Replace the per-surface size ceilings with something that still means something: a ceiling for shader, one for gradient, and one for **any** `spacetype-*` bundle. Set the last from the measured reality with headroom, and comment what it detects (a heavy dependency creeping in — not a size budget).

- [ ] **Step 4: Build, verify, measure**

```bash
cd frontend && npm run build:embed
npx vitest run tests/unit/embed-build-output.unit.spec.ts
```

Report: total build wall-clock, the number of bundles, and the size range across the per-effect bundles (smallest, largest, median). If any is close to the old 1.85 MB, something is still pulling in all 25 — investigate rather than raising the ceiling.

- [ ] **Step 5: Commit**

```bash
git add frontend/vite.embed.config.ts frontend/package.json frontend/tests/unit/embed-build-output.unit.spec.ts frontend/app/lib/embed/
git commit -m "build(embed): emit one bundle per Space Type effect"
```

---

### Task 2: Select the right bundle at export

**Files:**
- Modify: `frontend/app/lib/embed/surfaces.ts`
- Modify: `frontend/app/lib/embed/export.ts` (one line)
- Test: `frontend/tests/unit/embed-registry.unit.spec.ts`

**Interfaces:**
- Produces: `bundleNameFor(kind: string, config: unknown): string`

- [ ] **Step 1: Write the failing test**

`bundleNameFor('shader', cfg)` → `'shader'`; `bundleNameFor('gradient', cfg)` → `'gradient'`; `bundleNameFor('spacetype', { effectId: 'ball', … })` → `'spacetype-ball'`.

Also: an unknown or missing `effectId` must **throw**, not fall back to a generic bundle. A fallback would silently export a piece rendered by the wrong effect — the failure this feature exists to prevent.

Guard against path traversal: an `effectId` of `'../../etc/passwd'` must be rejected. This value reaches a URL.

- [ ] **Step 2: Run it and confirm it fails**

- [ ] **Step 3: Implement**

Put `bundleNameFor` in `surfaces.ts`. It is app-side and never enters a bundle, so it may know that `spacetype` is per-effect without contaminating anything shipped.

In `export.ts`, change only the fetch target:

```ts
const bundle = bundleNameFor(opts.kind, opts.config)
const res = await fetch(`/embed/${bundle}.js`)
```

Update the "missing bundle" error message to name the actual file, so the fix is obvious.

- [ ] **Step 4: Drop the monolith**

Stop emitting `spacetype.js` and remove its ceiling entry. Confirm nothing still references it.

- [ ] **Step 5: Verify end to end**

```bash
cd frontend && npm run build:embed
npx vitest run tests/unit/embed-registry.unit.spec.ts tests/unit/embed-build-output.unit.spec.ts
PW_BASE_URL=http://127.0.0.1:3000 npx playwright test tests/embed-spacetype.spec.ts tests/embed-contract.spec.ts tests/embed-export.spec.ts tests/embed-parity.spec.ts tests/embed-gradient.spec.ts --project=chromium
```

All 44 browser tests must pass. **Report the new exported file size for a real Space Type piece, and the font's share of it** — the two numbers that say whether this worked.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/embed/surfaces.ts frontend/app/lib/embed/export.ts frontend/tests/unit/embed-registry.unit.spec.ts frontend/tests/unit/embed-build-output.unit.spec.ts frontend/vite.embed.config.ts frontend/package.json
git commit -m "feat(embed): export selects the per-effect Space Type bundle"
```

---

## Done when

- One bundle per effect is emitted, and every one passes the network-ref gate
- A real Space Type export is roughly 1.1 MB rather than 2.16 MB
- All 44 embed browser tests pass
- `export.ts`'s change is generic — no surface-specific branching in it

## Deliberately not here

Named imports (~20–30% more, mechanical, across 32 files) and font subsetting (which becomes the
dominant cost once this lands — 296 KB against a ~800 KB bundle). Both are follow-ups.
