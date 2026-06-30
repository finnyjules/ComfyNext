# Localized Anatomy Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair botched hands/faces in a generated result by masking only the bad region and regenerating inside it — preserving the rest of the image — exposed both as an agent-proposed fix and a manual result-card button.

**Architecture:** One shared server route (`/api/inpaint/fix-anatomy`) glues the existing SAM-2 segment route to the existing FLUX-Fill route: a point/bbox → tight mask → in-region inpaint with a canned anatomy prompt. The agent's suggest-only review loop proposes a new `fixAnatomy` command (localizing the defect with a VLM bbox); a hand icon on the result card lets the user click the bad hand and run the same route.

**Tech Stack:** Nuxt 4 / Nitro server routes (TypeScript), Replicate (SAM-2 `meta/sam-2`, `black-forest-labs/flux-fill-dev`), Vue 3 SFCs, Vitest for unit tests.

## Global Constraints

- Work on `main`. Do NOT create feature branches.
- Stage only the files each task lists, by explicit path. NEVER `git add -A`.
- No purple/violet accents in UI. Use neutral white-opacity + emerald for run/repair affordances.
- Cost-conscious: agent repair path is capped at 2 FLUX-Fill attempts per defect; default `count: 2`, dev tier only.
- Reuse existing routes/composables; do not duplicate model-input mapping. The new route delegates to `/api/inpaint/segment` and `/api/inpaint/flux-fill`.
- Server utils `requireReplicateToken`, `runReplicate`, `firstOutputUrl`, `fetchAsDataUrl` are auto-imported in `frontend/server/` — do not re-import them in route files.
- Run all commands from `frontend/`. Unit test runner: `npm run test:unit` (vitest).

---

### Task 1: Shared repair helpers (pure, tested)

Pure functions the route depends on: pick the canned prompt by `kind`, and resolve a pixel click point from either an explicit point or a normalized bbox + image dimensions.

**Files:**
- Create: `frontend/server/utils/anatomyRepair.ts`
- Test: `frontend/tests/unit/anatomy-repair.unit.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type AnatomyKind = 'hand' | 'face' | 'limb'`
  - `repairPromptFor(kind: AnatomyKind): string`
  - `pointFromTarget(t: { point?: { xPx: number; yPx: number }; bbox?: [number, number, number, number]; imageW?: number; imageH?: number }): { xPx: number; yPx: number } | null` — returns the click point in pixel space, or `null` if neither a usable point nor a (bbox + dims) is given.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/anatomy-repair.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { repairPromptFor, pointFromTarget } from '../../server/utils/anatomyRepair'

describe('repairPromptFor', () => {
  it('returns a hand-specific prompt for hand', () => {
    expect(repairPromptFor('hand')).toMatch(/five fingers/i)
  })
  it('returns a face-specific prompt for face', () => {
    expect(repairPromptFor('face')).toMatch(/face/i)
  })
  it('falls back to the hand prompt for an unknown kind', () => {
    // @ts-expect-error testing the runtime fallback
    expect(repairPromptFor('nonsense')).toBe(repairPromptFor('hand'))
  })
})

describe('pointFromTarget', () => {
  it('passes an explicit pixel point straight through', () => {
    expect(pointFromTarget({ point: { xPx: 120, yPx: 340 } })).toEqual({ xPx: 120, yPx: 340 })
  })
  it('maps a normalized bbox centre to pixel space', () => {
    // bbox [x,y,w,h] = [0.4,0.5,0.2,0.1] on a 1000x800 image → centre (0.5,0.55) → (500,440)
    expect(pointFromTarget({ bbox: [0.4, 0.5, 0.2, 0.1], imageW: 1000, imageH: 800 }))
      .toEqual({ xPx: 500, yPx: 440 })
  })
  it('returns null when a bbox is given without dimensions', () => {
    expect(pointFromTarget({ bbox: [0.4, 0.5, 0.2, 0.1] })).toBeNull()
  })
  it('returns null when nothing usable is given', () => {
    expect(pointFromTarget({})).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- anatomy-repair`
Expected: FAIL — cannot resolve `../../server/utils/anatomyRepair`.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/server/utils/anatomyRepair.ts
/**
 * Pure helpers for the localized anatomy-repair route. Kept free of any Nitro /
 * Replicate dependency so they unit-test directly.
 */
export type AnatomyKind = 'hand' | 'face' | 'limb'

const PROMPTS: Record<AnatomyKind, string> = {
  hand: 'a natural human hand, five fingers, anatomically correct, matching the image\'s existing style, skin tone and lighting',
  face: 'a clean, natural human face, correct eyes and features, matching the image\'s existing style and lighting',
  limb: 'a natural, anatomically-correct limb matching the image\'s existing style and lighting',
}

/** The canned in-region prompt for a given defect kind. Unknown → hand. */
export function repairPromptFor(kind: AnatomyKind): string {
  return PROMPTS[kind] ?? PROMPTS.hand
}

export interface RepairTarget {
  point?: { xPx: number; yPx: number }
  bbox?: [number, number, number, number]
  imageW?: number
  imageH?: number
}

/** Resolve a pixel click point from an explicit point, or from a normalized
 *  bbox centre scaled by the image dimensions. Null if neither is usable. */
export function pointFromTarget(t: RepairTarget): { xPx: number; yPx: number } | null {
  if (t.point && Number.isFinite(t.point.xPx) && Number.isFinite(t.point.yPx)) {
    return { xPx: Math.round(t.point.xPx), yPx: Math.round(t.point.yPx) }
  }
  if (t.bbox && Number.isFinite(t.imageW) && Number.isFinite(t.imageH)) {
    const [x, y, w, h] = t.bbox
    return {
      xPx: Math.round((x + w / 2) * (t.imageW as number)),
      yPx: Math.round((y + h / 2) * (t.imageH as number)),
    }
  }
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- anatomy-repair`
Expected: PASS (all 7 assertions).

- [ ] **Step 5: Commit**

```bash
git add frontend/server/utils/anatomyRepair.ts frontend/tests/unit/anatomy-repair.unit.spec.ts
git commit -m "feat(agent): pure helpers for localized anatomy repair"
```

---

### Task 2: The `/api/inpaint/fix-anatomy` route (shared core)

Thin glue: resolve a point (Task 1) → call the existing segment route for a mask → call the existing flux-fill route for the in-region repair. No new model mapping.

**Files:**
- Create: `frontend/server/api/inpaint/fix-anatomy.post.ts`

**Interfaces:**
- Consumes: `repairPromptFor`, `pointFromTarget`, `AnatomyKind` from Task 1; the live routes `/api/inpaint/segment` (`{ image, xPx, yPx }` → `{ mask }`) and `/api/inpaint/flux-fill` (`{ image, mask, prompt, tier, count, seed }` → `{ images }`).
- Produces: `POST /api/inpaint/fix-anatomy` accepting body `{ image, point?, bbox?, imageW?, imageH?, kind?, count?, seed? }` → `{ images: string[], mask: string }`. On unresolvable target → `400`. On empty SAM mask → `409 { reason }`.

- [ ] **Step 1: Write the implementation**

```ts
// frontend/server/api/inpaint/fix-anatomy.post.ts
/**
 * POST /api/inpaint/fix-anatomy
 *
 * Localized anatomy repair (hands/faces/limbs). Masks ONLY the bad region with
 * SAM-2, then regenerates inside the mask with FLUX-Fill and a canned anatomy
 * prompt — the rest of the image is preserved by construction. Glue over the
 * existing /api/inpaint/segment and /api/inpaint/flux-fill routes.
 *
 * Body:
 *   image   string                    data URL or http URL of the source image
 *   point   { xPx, yPx }              click point in source pixel space, OR
 *   bbox    [x,y,w,h] (normalized)    + imageW + imageH to derive the point
 *   kind    'hand' | 'face' | 'limb'  selects the canned prompt (default 'hand')
 *   count   number                    variations (default 2, max 4)
 *   seed    number                    optional base seed (reproducible retries)
 *
 * Returns { images: string[], mask: string }. 400 if the target can't be
 * resolved; 409 { reason } if SAM can't isolate a region (caller falls back).
 */
import { pointFromTarget, repairPromptFor, type AnatomyKind } from '../../utils/anatomyRepair'

interface Body {
  image?: string
  point?: { xPx: number; yPx: number }
  bbox?: [number, number, number, number]
  imageW?: number
  imageH?: number
  kind?: AnatomyKind
  count?: number
  seed?: number
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event)
  if (!body?.image) throw createError({ statusCode: 400, message: 'image is required' })

  const pt = pointFromTarget(body)
  if (!pt) throw createError({ statusCode: 400, message: 'a point, or a bbox with imageW/imageH, is required' })

  // 1) Mask just the clicked region (SAM-2). Reuses the existing route.
  let mask: string
  try {
    const seg = await $fetch<{ mask: string }>('/api/inpaint/segment', {
      method: 'POST',
      body: { image: body.image, xPx: pt.xPx, yPx: pt.yPx },
    })
    mask = seg.mask
  } catch {
    throw createError({ statusCode: 409, message: 'Could not isolate the region', data: { reason: 'segment-failed' } })
  }
  if (!mask) throw createError({ statusCode: 409, message: 'Could not isolate the region', data: { reason: 'empty-mask' } })

  // 2) Repair inside the mask only (FLUX-Fill dev). Reuses the existing route.
  const kind: AnatomyKind = body.kind ?? 'hand'
  const count = Math.max(1, Math.min(4, Math.round(body.count ?? 2)))
  const fill = await $fetch<{ images: string[] }>('/api/inpaint/flux-fill', {
    method: 'POST',
    body: { image: body.image, mask, prompt: repairPromptFor(kind), tier: 'dev', count, seed: body.seed },
  })

  return { images: fill.images, mask }
})
```

- [ ] **Step 2: Smoke-test the route against a real image**

Start the dev server if not running: `npm run dev` (needs `REPLICATE_API_TOKEN` set, same as the other inpaint routes). Then, from another shell, post a known result image with a point over a hand:

```bash
curl -s -X POST http://localhost:3000/api/inpaint/fix-anatomy \
  -H 'Content-Type: application/json' \
  -d '{"image":"<data-url-or-http-url>","point":{"xPx":420,"yPx":760},"kind":"hand","count":1}' \
  | head -c 200
```

Expected: JSON beginning `{"images":["data:image/png;base64,...` and a `"mask"` field. (A 409 means SAM didn't isolate the region — try a point more centered on the hand.)

- [ ] **Step 3: Commit**

```bash
git add frontend/server/api/inpaint/fix-anatomy.post.ts
git commit -m "feat(agent): /api/inpaint/fix-anatomy — SAM mask + flux-fill in-region repair"
```

---

### Task 3: Register the `fixAnatomy` agent command

Add the op to the canvas surface so it appears in the result-review schema enum, make `applyCanvasCommand` treat it as a graph no-op (it edits the image out-of-band, not the graph), and steer the reviewer to prefer it for anatomy defects.

**Files:**
- Modify: `frontend/app/lib/agent/surfaces/canvas.ts` (ops list ~67-73; `applyCanvasCommand` ~172)
- Modify: `frontend/app/lib/agent/protocol.ts` (`buildResultReviewPrompt` instruction string ~159)
- Test: `frontend/tests/unit/agent-canvas-surface.unit.spec.ts` (existing file — add cases)

**Interfaces:**
- Consumes: `describeCanvas`, `applyCanvasCommand` from `surfaces/canvas.ts`; `buildReviewSchema` from `protocol.ts`.
- Produces: `'fixAnatomy'` present in `describeCanvas(snap).commands.map(s => s.op)`; `applyCanvasCommand(snap, { op: 'fixAnatomy', ... })` returns `{ ok: true }` with the snapshot unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// add to frontend/tests/unit/agent-canvas-surface.unit.spec.ts
import { describeCanvas, applyCanvasCommand } from '../../app/lib/agent/surfaces/canvas'

describe('fixAnatomy command', () => {
  const snap = { nodes: [], edges: [] }

  it('is exposed as a result-review command op', () => {
    const ops = describeCanvas(snap).commands.map(c => c.op)
    expect(ops).toContain('fixAnatomy')
  })

  it('is a no-op on the graph snapshot (image is edited out-of-band)', () => {
    const r = applyCanvasCommand(snap, {
      op: 'fixAnatomy',
      target: 'node-1',
      args: { kind: 'hand', bbox: [0.4, 0.5, 0.2, 0.1], note: 'left hand has six fingers' },
    })
    expect(r.ok).toBe(true)
    expect(r.template.nodes).toEqual(snap.nodes)
    expect(r.template.edges).toEqual(snap.edges)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- agent-canvas-surface`
Expected: FAIL — `ops` does not contain `'fixAnatomy'`.

- [ ] **Step 3: Add the op to the canvas ops list**

In `frontend/app/lib/agent/surfaces/canvas.ts`, add this CommandSpec to the ops array (after the `restore` entry around line 73):

```ts
  { op: 'fixAnatomy', hint: 'Repair botched ANATOMY in the generated RESULT image IN PLACE, without touching the rest of the image — the right fix for mangled hands/faces/limbs. target = the result node id. args: { kind: "hand" | "face" | "limb", bbox: [x, y, w, h] (the defect\'s location as fractions 0..1 of the image — x,y = top-left corner, w,h = size), note: a short description of what is wrong (e.g. "left hand has six fingers") }. PREFER this over a re-roll or a full-image edit for any hand/face/limb defect, because it regenerates ONLY the masked region. Only fall back to a seed re-roll if you cannot localize the defect with a bbox.' },
```

- [ ] **Step 4: Make `applyCanvasCommand` pass it through**

In `applyCanvasCommand` (around line 172), add a branch that returns the snapshot unchanged for `fixAnatomy` (it carries no graph mutation). Place it alongside the other op branches:

```ts
  if (cmd.op === 'fixAnatomy') {
    // Out-of-band image repair — no graph edit. Pass the snapshot through so the
    // review loop's probe stays valid.
    return { ok: true, template: input, undo: snapshot() }
  }
```

(Match the exact `CommandResult` shape the other branches return in this file — `ok`, `template`, `undo`. If neighbouring branches use `clone(input)`, mirror that.)

- [ ] **Step 5: Steer the reviewer prompt**

In `frontend/app/lib/agent/protocol.ts`, in `buildResultReviewPrompt` (the long instruction string ~line 159), replace the anatomy-fix guidance so `fixAnatomy` is the primary remedy. Change the sentence that currently reads:

```
For ANATOMY or content defects, the best fixes are: (a) RE-ROLL — setWidget the generating node's "seed" to a different number (a fresh roll often just doesn't have the defect); or (b) add an EditImageNode wired from the result with a precise corrective instruction (e.g. "fix the left hand to have five normal fingers", "repair the distorted face") — and for faces specifically a FixFaces node also helps.
```

to:

```
For BOTCHED ANATOMY (mangled hands/faces/limbs — the most common defect), the best fix is `fixAnatomy`: give the defect\'s kind ("hand"/"face"/"limb"), a tight bbox [x,y,w,h] in 0..1 fractions locating it, and a short note of what is wrong. It repairs ONLY that region and leaves the rest of the image untouched. Use it for EVERY hand/face/limb defect you can point to. Only if you cannot localize the defect, fall back to a RE-ROLL — setWidget the generating node\'s "seed" to a different number.
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test:unit -- agent-canvas-surface`
Expected: PASS (both new cases + the existing suite).

- [ ] **Step 7: Commit**

```bash
git add frontend/app/lib/agent/surfaces/canvas.ts frontend/app/lib/agent/protocol.ts frontend/tests/unit/agent-canvas-surface.unit.spec.ts
git commit -m "feat(agent): register fixAnatomy command + steer reviewer to localized repair"
```

---

### Task 4: Execute `fixAnatomy` as a repair proposal in `useCanvasAgent`

When the reviewer returns a `fixAnatomy` fix, build a Keep/Dismiss card whose acceptance calls a new repair callback (injected by the canvas) rather than mutating the graph.

**Files:**
- Modify: `frontend/app/composables/useCanvasAgent.ts` (the `AgentOptions` interface ~line 24-40, `buildChange`, and the accept/apply path)

**Interfaces:**
- Consumes: `applyCanvasCommand` passthrough for `fixAnatomy` (Task 3); the result-review loop in `runReview` (~line 214).
- Produces: a new option callback on the composable's options object:
  `repairAnatomy?: (target: string, spec: { kind: 'hand' | 'face' | 'limb'; bbox: [number, number, number, number]; note: string }) => Promise<void>` — the canvas implements this in Task 5. `useCanvasAgent` invokes it when a kept change has `op === 'fixAnatomy'`.

- [ ] **Step 1: Add the callback to the options interface**

In `useCanvasAgent.ts`, add to the options interface (near `preview`, `run`, `runOutputImage` ~line 28-34):

```ts
  /** Repair botched anatomy in a result image in-region (SAM mask + flux-fill).
   *  Implemented by the canvas; called when a `fixAnatomy` review fix is kept. */
  repairAnatomy?: (
    target: string,
    spec: { kind: 'hand' | 'face' | 'limb'; bbox: [number, number, number, number]; note: string },
  ) => Promise<void>
```

- [ ] **Step 2: Build a repair card for `fixAnatomy` fixes**

The review loop (`runReview`, ~line 234) calls `buildChange(probe, cmd, …)` for each fix. Ensure `buildChange` produces a valid `ProposedChange` for `op === 'fixAnatomy'` — labelled from `args.note` (e.g. "Fix the left hand"), marked `fromReview = true`, and carrying the raw `cmd` so the accept path can read its args. Locate `buildChange` in this file and add, at its top, a branch:

```ts
    if (cmd.op === 'fixAnatomy') {
      const a = (cmd.args ?? {}) as { kind?: string; note?: string }
      return {
        command: cmd,
        op: 'fixAnatomy',
        label: a.note ? `Repair: ${a.note}` : 'Repair anatomy',
        kind: 'repair',
        // no graph diff — applyCanvasCommand is a no-op for this op
      } as ProposedChange
    }
```

(Adapt the returned object to this file's actual `ProposedChange` shape — copy the required fields from a neighbouring `buildChange` return. The essential additions are `op: 'fixAnatomy'` and carrying `command: cmd`.)

- [ ] **Step 3: Route a kept `fixAnatomy` to the repair callback**

Find where a kept change is applied to the real graph (the accept / "Keep & apply" path that calls `applyCanvasCommand` or `opts.apply`). Add, before the normal graph-apply, a guard so `fixAnatomy` changes call the repair callback instead:

```ts
    for (const ch of acceptedChanges) {
      if (ch.command?.op === 'fixAnatomy' && opts.repairAnatomy) {
        const a = (ch.command.args ?? {}) as { kind?: 'hand' | 'face' | 'limb'; bbox?: [number, number, number, number]; note?: string }
        if (a.bbox) {
          await opts.repairAnatomy(ch.command.target as string, {
            kind: a.kind ?? 'hand',
            bbox: a.bbox,
            note: a.note ?? '',
          })
        }
        continue // skip graph application for this change
      }
      // …existing graph-apply for other ops…
    }
```

(Match the real variable names and loop in this file. The key behaviour: `fixAnatomy` changes are diverted to `opts.repairAnatomy` and excluded from graph application.)

- [ ] **Step 4: Typecheck**

Run: `npx vue-tsc --noEmit -p . 2>&1 | grep -iE "useCanvasAgent|fixAnatomy" || echo "no related type errors"`
Expected: `no related type errors` (or a clean run). Fix any `ProposedChange`/options mismatches by aligning to the file's real types.

- [ ] **Step 5: Run the existing agent suite to confirm no regression**

Run: `npm run test:unit -- agent`
Expected: PASS (all agent specs green).

- [ ] **Step 6: Commit**

```bash
git add frontend/app/composables/useCanvasAgent.ts
git commit -m "feat(agent): keep+execute fixAnatomy review fixes via repair callback"
```

---

### Task 5: Wire `repairAnatomy` in the canvas (route call + verify/retry + write-back)

Implement the callback `useCanvasAgent` expects: fetch the target's result image + dimensions, call `/api/inpaint/fix-anatomy`, auto-pick/verify with a bounded retry, and write the repaired image back as the node's result.

**Files:**
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue` (where `useCanvasAgent(...)` is constructed with its options — near `agentPreview` ~line 547)

**Interfaces:**
- Consumes: `useCanvasAgent`'s `repairAnatomy` option (Task 4); `/api/inpaint/fix-anatomy` (Task 2); the existing helper that reads a node's output image (the same source `opts.runOutputImage` uses).
- Produces: passes a `repairAnatomy` implementation into `useCanvasAgent({ … })`.

- [ ] **Step 1: Implement and pass the callback**

In `VueNodeCanvas.vue`, where `useCanvasAgent` is instantiated, add the `repairAnatomy` option:

```ts
  repairAnatomy: async (target, spec) => {
    // 1) Current result image for the node + its natural dimensions.
    const image = await runOutputImage([target])      // same source the review loop uses
    if (!image) return
    const dims = await imageDims(image)               // { w, h } — load into an Image, read naturalWidth/Height
    const MAX_ATTEMPTS = 2                             // cost cap (global constraint)
    let seed = Math.floor(Math.random() * 2_000_000_000)
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const res = await $fetch<{ images: string[] }>('/api/inpaint/fix-anatomy', {
        method: 'POST',
        body: { image, bbox: spec.bbox, imageW: dims.w, imageH: dims.h, kind: spec.kind, count: 2, seed },
      }).catch(() => null)
      if (!res?.images?.length) break                 // 409/err → give up, leave original
      // Auto-pick: ask the review model which variation actually fixed the region.
      const picked = await pickRepairedVariation(res.images, spec)  // returns a url, or null if none look fixed
      if (picked) { await writeResultImage(target, picked); return }
      seed += 1                                        // retry with a fresh roll
    }
  },
```

Implement the three small local helpers if not already present:
- `imageDims(dataUrl)` — load into `new Image()`, resolve `{ w: img.naturalWidth, h: img.naturalHeight }`.
- `writeResultImage(nodeId, url)` — set the node's result image (reuse the exact path the inpaint accept flow already uses to push a new image onto a result node; see `InpaintModal`'s accept → result write).
- `pickRepairedVariation(urls, spec)` — POST each variation to `/api/agent-review` with a terse prompt ("Does this image show a correct {kind} (five fingers, natural anatomy)? Answer yes/no.") and return the first `yes`; return `null` if none pass. Keep it dev-tier/Haiku-class and short to stay cheap. If wiring a per-variation vision check is too heavy for this pass, fall back to returning `urls[0]` and note it — but prefer the verify so a re-botched hand isn't silently accepted.

- [ ] **Step 2: Manual verification (required — visual change)**

Per the project rule, do not ship this on unit tests alone. With `npm run dev` running and ComfyUI up:
1. Generate an image with a visibly botched hand (the GTA pizza prompt reliably produces them).
2. Trigger the run→look→fix review (Keep & Run, or on-demand Critique on the result node).
3. Confirm the reviewer proposes a **"Repair: …"** card (not a re-roll) for the hand.
4. Keep it. Confirm a corrected result appears, the hand now reads as a normal five-finger hand, and the face/background/pizza are unchanged outside the masked region.
5. Screenshot before/after for sign-off.

Use the preview tooling (preview_screenshot / preview_console_logs) to capture proof and check for errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/vue-canvas/VueNodeCanvas.vue
git commit -m "feat(agent): canvas repairAnatomy — route call, verify/retry, write-back"
```

---

### Task 6: Manual "Fix hands" button on the result card

A hand icon on the result-card toolbar lets the user click the bad hand and run the same route, then pick from the variations — independent of the agent.

**Files:**
- Modify: `frontend/app/components/vue-canvas/ArtifactImageNode.vue` (the toolbar with eraser/brush/download/lock/refresh)

**Interfaces:**
- Consumes: `/api/inpaint/fix-anatomy` (Task 2); the existing click-to-segment + variation-picker UX in `InpaintModal.vue` for reference.
- Produces: no exported interface — a self-contained UI affordance on the result card.

- [ ] **Step 1: Add the toolbar icon**

In `ArtifactImageNode.vue`, add a hand icon button beside the existing eraser/brush/lock icons. Use a lucide hand icon already available in the project (e.g. `Hand`), emerald-on-hover to match run/repair affordances (no purple). Clicking it enters a "tap the bad hand" mode (a one-shot pointer capture over the image).

- [ ] **Step 2: Run the repair on click**

On the user's click over the image, compute the click point in the image's natural pixel space (account for the displayed scale — `clientX/Y` minus the image's bounding rect, divided by the render scale), then:

```ts
  const res = await $fetch<{ images: string[] }>('/api/inpaint/fix-anatomy', {
    method: 'POST',
    body: { image: currentImageDataUrl, point: { xPx, yPx }, kind: 'hand', count: 2 },
  })
  // Show res.images in the existing 2-up variation picker; on pick, write it back
  // as the node's result (same write path as InpaintModal accept).
```

Reuse `InpaintModal`'s variation-preview pattern (hover-to-preview, click-to-accept) rather than inventing new picker UI.

- [ ] **Step 3: Manual verification (required — visual change)**

With the app running:
1. On a result with a botched hand, click the new hand icon, then click the hand.
2. Confirm two repair variations appear, picking one writes it back, and only the hand region changed.
3. Confirm a 409 (SAM miss) surfaces a gentle toast ("Couldn't isolate the hand — try clicking right on it") rather than a hard error.
4. Screenshot for sign-off.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/vue-canvas/ArtifactImageNode.vue
git commit -m "feat(canvas): manual Fix-hands button on the result card"
```

---

## Self-Review

**Spec coverage:**
- Shared repair route (SAM mask + flux-fill, canned prompts, 409 on junk) → Tasks 1–2. ✓
- Agent path: VLM bbox in review, `fixAnatomy` op preferred over re-roll, suggest-only, verify + bounded retry, auto-pick → Tasks 3–5. ✓
- Manual button: hand icon, click-to-segment, 2-variation pick → Task 6. ✓
- Deferred items (depth/mesh refiner, hybrid detector, multi-hand) → not built, documented in spec. ✓
- Error handling (409 fallback, no-bbox → re-roll, retry cap) → Tasks 2, 3 (prompt), 4–5. ✓

**Known scope trims (carried from spec, intentional):**
- Junk-mask detection is "SAM returned no/empty mask" only; the spec's "covers most of the frame" coverage check is deferred (would need server-side mask decoding). Documented here so it isn't mistaken for full coverage.
- `pickRepairedVariation` vision verify is the intended path; Task 5 Step 1 allows a documented `urls[0]` fallback if the per-variation check proves too heavy in this pass.

**Placeholder scan:** No TBD/TODO; every code step shows real code. UI tasks (5–6) end in manual visual verification per the project's "verify visuals with screenshots" rule rather than fabricated unit tests — this is deliberate, not a gap.

**Type consistency:** `AnatomyKind` ('hand'|'face'|'limb'), `repairPromptFor`, `pointFromTarget` defined in Task 1 and consumed unchanged in Tasks 2, 4, 5. The route body shape ({ image, point?, bbox?, imageW?, imageH?, kind?, count?, seed? }) is consistent across Tasks 2, 5, 6. `repairAnatomy(target, { kind, bbox, note })` signature matches between Task 4 (definition) and Task 5 (implementation).
