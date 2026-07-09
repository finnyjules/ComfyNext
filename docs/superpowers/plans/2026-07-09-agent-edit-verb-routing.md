# Agent Edit-Verb Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route natural edit phrasings ("remove the car", "make the shirt red", "change the text") to the three new edit-action nodes, plus a checked-in verb→node coverage matrix and a guard test per `docs/superpowers/specs/2026-07-09-agent-edit-verb-routing-design.md`.

**Architecture:** `AGENT_CAPABILITIES` (frontend/app/lib/agent/capabilities.ts) is the single source of truth: three new `kind:'effect'` entries with `intents[]` phrase lists, plus a MIGRATION of the removal/recolor intents currently owned by EditImageNode. The existing deterministic routing corpus (`tests/unit/agent-capability-routing.unit.spec.ts`) is the behavioral gate — its vocabulary self-test auto-covers new intents, and its paraphrase/collision tables get new rows. A new guard test forces an agent-visibility decision for every edit/enhance catalog entry via a new `AGENT_EXCLUDED` export.

**Tech Stack:** TypeScript data changes + vitest (`cd frontend && npx vitest run <file>`). No runtime logic changes, no Python, no browser work except one agent-plan smoke.

## Global Constraints

- Commit directly to `main`; NEVER create branches; stage ONLY touched files with explicit paths (never `git add -A`). A concurrent session may commit to this repo — re-apply promptly if uncommitted edits vanish.
- `AGENT_CAPABILITIES` stays the single source of truth for verbs — do NOT create a parallel verb registry.
- Routing corrections are migrations: an intent phrase must live on exactly ONE capability (the vocabulary self-test asserts top-3 routing per phrase and will catch duplicates/collisions).
- If a new paraphrase row fails to route, fix it by enriching the target's `intents[]` (or pruning the collider's), never by weakening the assertion or adding boosts — the spec pins "no boost changes".
- The guard test covers ALL `intent: 'edit' | 'enhance'` catalog entries (all domains) — the spec's §4 as amended.

---

### Task 1: Capability entries + intent migration + routing rows

**Files:**
- Modify: `frontend/app/lib/agent/capabilities.ts` (EditImageNode entry ~line 145; new entries after it)
- Modify: `frontend/tests/unit/agent-capability-routing.unit.spec.ts` (PARAPHRASES table ~line 112; collisions table ~line 347)

**Interfaces:**
- Consumes: existing `AgentCapability` shape, `IMG` outputs constant (used by sibling entries in the same file).
- Produces: `RemoveObjectNode`, `TextEditNode`, `RecolorObjectNode` present in `AGENT_CAPABILITIES` — Task 2's guard test and Task 3's doc rely on these three being capability-covered.

- [ ] **Step 1: Add the routing rows first (they are the failing tests)**

In `frontend/tests/unit/agent-capability-routing.unit.spec.ts`, append to the `PARAPHRASES` array:

```typescript
  // Edit-action verbs (RemoveObject / TextEdit / RecolorObject)
  { phrase: 'get that lamppost out of the shot', expect: 'RemoveObjectNode' },
  { phrase: 'erase the tourist from the beach photo', expect: 'RemoveObjectNode' },
  { phrase: 'the sign should say OPEN instead', expect: 'TextEditNode' },
  { phrase: 'fix the spelling on the poster', expect: 'TextEditNode' },
  { phrase: 'change what the label says', expect: 'TextEditNode' },
  { phrase: 'make the sofa emerald green', expect: 'RecolorObjectNode' },
  { phrase: 'give the car a different paint color', expect: 'RecolorObjectNode' },
  { phrase: 'recolour the logo to match our brand', expect: 'RecolorObjectNode' },
```

In the `collisions disambiguate` cases array, CHANGE these two existing rows (object removal now has a dedicated node):

```typescript
    // object removal is its own capability now (was EditImageNode)
    { phrase: 'remove the person from the photo', expect: 'RemoveObjectNode' },
    { phrase: 'erase the car from this picture', expect: 'RemoveObjectNode' },
```

and ADD these guards:

```typescript
    // background removal must not be stolen by object removal
    { phrase: 'remove the background', expect: 'RemoveBackgroundNode', notFirst: 'RemoveObjectNode' },
    { phrase: 'cut out the subject', expect: 'RemoveBackgroundNode' },
    // text EFFECT (typographic art) vs text EDIT (find/replace in a photo)
    { phrase: 'make a text effect for the word SALE', expect: 'TextEffectNode', notFirst: 'TextEditNode' },
    { phrase: 'change the text on the sign', expect: 'TextEditNode', notFirst: 'TextEffectNode' },
    // recolor one object vs restyle the whole image vs generic edit
    { phrase: 'change the color of the shirt', expect: 'RecolorObjectNode', notFirst: 'EditImageNode' },
    { phrase: 'restyle this in the look of that reference', expect: 'RestyleFromImageNode', notFirst: 'RecolorObjectNode' },
    { phrase: 'change her shirt to red', expect: 'EditImageNode' },
```

Note the pre-existing `{ phrase: 'remove the background', expect: 'RemoveBackgroundNode', notFirst: 'EditImageNode' }` row stays — keep both notFirst guards.

WAIT before editing: `'change her shirt to red'` appears in PARAPHRASES already (→ EditImageNode) and `'change the color of the shirt'` must now beat EditImageNode — these two assertions together define the boundary (named-garment edit stays generic; "color of the X" phrasing is recolor). If the matcher can't hold that line after Step 3, the acceptable fallback is: move `'change her shirt to red'` to expect `RecolorObjectNode` in BOTH tables (it is semantically a recolor) and note the deviation in your report — do NOT delete the row.

- [ ] **Step 2: Run the routing spec — verify the new rows fail**

Run: `cd /Users/julien/Documents/GitHub/ComfyNext/frontend && npx vitest run tests/unit/agent-capability-routing.unit.spec.ts`
Expected: FAIL — the new paraphrase/collision rows can't route to node types that aren't in the registry yet.

- [ ] **Step 3: Edit capabilities.ts**

In `frontend/app/lib/agent/capabilities.ts`, REPLACE the EditImageNode entry's intents (currently ending with the removal block and its comment) with:

```typescript
  { nodeType: 'EditImageNode', kind: 'effect', title: 'Edit an image', summary: 'Natural-language image editing (Nano Banana / Flux Kontext) — change, add, remove anything.', inputs: [{ name: 'input_image', type: 'IMAGE' }], outputs: IMG,
    intents: ['edit this image', 'change her shirt', 'make her hair blue', 'change the background', 'edit the photo', 'modify this picture', 'alter the image', 'change the sky', 'make it nighttime', 'tweak this image', 'photoshop this', 'add an object', 'add a hat', 'put glasses on', 'add a logo to the image'] },
    // Removal, recolor and in-image text edits have DEDICATED nodes below
    // (RemoveObjectNode / RecolorObjectNode / TextEditNode) — their verbs
    // moved there; EditImageNode keeps the broad/ambiguous edits.
```

(Removed vs today: `'change the color of'`, `'photoshop out'`, and the whole removal block `'remove an object'`, `'remove the person'`, `'remove the car'`, `'remove the object'`, `'erase the object'`, `'get rid of the object'` — plus its old comment. Place the new comment ABOVE the next entry, adjusting to the file's comment style.)

Then ADD, directly after the EditImageNode entry:

```typescript
  { nodeType: 'RemoveObjectNode', kind: 'effect', title: 'Remove an object', summary: 'Erase a described object and seamlessly fill the hole from the scene (Nano Banana 2).', inputs: [{ name: 'image', type: 'IMAGE' }], outputs: IMG,
    intents: ['remove an object', 'remove the person', 'remove the car', 'remove the object', 'erase the object', 'get rid of the object', 'delete the object', 'remove the thing in the background', 'erase him from the picture', 'take out the object', 'photoshop out', 'remove the lamppost', 'clean up the distractions', 'erase the tourist'] },
  { nodeType: 'TextEditNode', kind: 'effect', title: 'Edit text in an image', summary: 'Find and replace rendered text inside the image, matching the original typography (Nano Banana 2).', inputs: [{ name: 'image', type: 'IMAGE' }], outputs: IMG,
    intents: ['change the text', 'replace the text', 'edit the text in the image', 'make it say', 'fix the typo', 'fix the spelling', 'change the sign to say', 'change the words', 'rewrite the label', 'change the headline text', 'replace the word', 'update the text on the poster', 'the sign should say'] },
  { nodeType: 'RecolorObjectNode', kind: 'effect', title: 'Recolor an object', summary: "Change one object's colour while keeping its material, texture and lighting (Nano Banana 2).", inputs: [{ name: 'image', type: 'IMAGE' }], outputs: IMG,
    intents: ['change the color of', 'recolor the object', 'recolour it', 'make the shirt red', 'change the car to blue', 'make it a different color', 'a different paint color', 'turn the dress green', 'make the sofa green', 'swap the color', 'recolor to the brand color', 'colorway', 'recolour the logo'] },
```

- [ ] **Step 4: Run the routing spec to green — iterate on VOCABULARY only**

Run: `cd /Users/julien/Documents/GitHub/ComfyNext/frontend && npx vitest run tests/unit/agent-capability-routing.unit.spec.ts`

Iterate until green. Expected friction and the sanctioned fixes:
- Vocabulary self-test collision (an intent of cap A surfaces cap B in top-3): make the phrase more specific or move it to the capability it actually describes. Never assert-weaken.
- A paraphrase not routing: add ONE more intent phrase to the target capturing the missing vocabulary (e.g. if 'get that lamppost out of the shot' misses, 'remove the lamppost' is already there — try 'out of the shot').
- The `'change her shirt to red'` boundary: see Step 1's fallback rule.
Expected final: PASS, all suites in the file.

- [ ] **Step 5: Run the adjacent agent suites (routing data feeds them)**

Run: `cd /Users/julien/Documents/GitHub/ComfyNext/frontend && npx vitest run tests/unit/agent-capability-routing.unit.spec.ts tests/unit/agent-canvas-surface.unit.spec.ts tests/unit/agent-plan.unit.spec.ts tests/unit/agent-fastlane.unit.spec.ts`
Expected: PASS (fastlane/plan specs may reference capability counts or specific types — if a count assertion breaks, update the count only).

- [ ] **Step 6: Commit**

```bash
cd /Users/julien/Documents/GitHub/ComfyNext
git add frontend/app/lib/agent/capabilities.ts frontend/tests/unit/agent-capability-routing.unit.spec.ts
git commit -m "feat(agent): route edit verbs to RemoveObject/TextEdit/RecolorObject — intents migrated from EditImageNode"
```

---

### Task 2: Coverage guard test + AGENT_EXCLUDED

**Files:**
- Modify: `frontend/app/lib/agent/capabilities.ts` (new `AGENT_EXCLUDED` export near `capabilityNodeTypes`)
- Test (create): `frontend/tests/unit/agent-coverage-guard.unit.spec.ts`

**Interfaces:**
- Consumes: `ACTION_CATALOG` from `~/data/action-catalog`; `AGENT_CAPABILITIES` from Task 1's file.
- Produces: `export const AGENT_EXCLUDED: Record<string, string>` — Task 3's doc cites it.

- [ ] **Step 1: Write the failing guard test**

Create `frontend/tests/unit/agent-coverage-guard.unit.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { ACTION_CATALOG } from '~/data/action-catalog'
import { AGENT_CAPABILITIES, AGENT_EXCLUDED } from '~/lib/agent/capabilities'

/**
 * Coverage guard: every node surfaced in the Actions panel as an edit/enhance
 * use-case must have an explicit agent story — either an AGENT_CAPABILITIES
 * entry (with intents, so verbs route to it) or an AGENT_EXCLUDED entry with
 * a human-readable reason. Adding a panel node without deciding its agent
 * visibility fails here instead of silently rotting.
 * Companion doc: docs/agent/edit-verb-coverage.md
 */

const capTypes = new Set(AGENT_CAPABILITIES.map(c => c.nodeType))

describe('agent coverage guard', () => {
  const relevant = Object.entries(ACTION_CATALOG)
    .filter(([, e]) => e.intent === 'edit' || e.intent === 'enhance')

  it('covers a non-trivial set (sanity: filter is not vacuous)', () => {
    expect(relevant.length).toBeGreaterThan(10)
  })

  for (const [nodeType, entry] of Object.entries(ACTION_CATALOG)) {
    if (entry.intent !== 'edit' && entry.intent !== 'enhance') continue
    it(`${nodeType} ("${entry.useCase}") has an agent-visibility decision`, () => {
      const covered = capTypes.has(nodeType) || nodeType in AGENT_EXCLUDED
      expect(covered,
        `${nodeType} is in the Actions panel but has no agent story. ` +
        `Either add an AGENT_CAPABILITIES entry with intents (app/lib/agent/capabilities.ts) ` +
        `or add it to AGENT_EXCLUDED with a reason.`).toBe(true)
    })
  }

  it('AGENT_EXCLUDED entries carry a reason and are not ALSO capabilities', () => {
    for (const [nodeType, reason] of Object.entries(AGENT_EXCLUDED)) {
      expect(reason.trim().length, `${nodeType} exclusion needs a reason`).toBeGreaterThan(10)
      expect(capTypes.has(nodeType), `${nodeType} is both excluded and a capability — pick one`).toBe(false)
    }
  })
})
```

- [ ] **Step 2: Run it — collect the real failure list**

Run: `cd /Users/julien/Documents/GitHub/ComfyNext/frontend && npx vitest run tests/unit/agent-coverage-guard.unit.spec.ts`
Expected: FAIL — first on the missing `AGENT_EXCLUDED` export, then (after Step 3's stub) on each uncovered node. Record the exact uncovered list in your report.

- [ ] **Step 3: Add AGENT_EXCLUDED and triage every failure**

In `frontend/app/lib/agent/capabilities.ts`, next to `capabilityNodeTypes` (~line 61), add:

```typescript
/** Actions-panel nodes deliberately NOT agent-plannable, with the reason.
 *  The coverage guard (tests/unit/agent-coverage-guard.unit.spec.ts) forces
 *  every edit/enhance catalog entry to appear here or in AGENT_CAPABILITIES —
 *  an explicit decision either way. */
export const AGENT_EXCLUDED: Record<string, string> = {
}
```

Then triage each guard failure, one line each. Decision rule per node:
- If the agent could sensibly place it from a phrase AND it has a capability-worthy use-case → prefer adding a real `AGENT_CAPABILITIES` entry (rare — most edit nodes that deserve one already have one).
- Otherwise → `AGENT_EXCLUDED` with an honest reason. Expected candidates (verify against the actual failure list, do not copy blindly): `LayerizeGraphicNode` (niche multi-output flow the agent can't wire meaningfully), `SplitPhotoLayersNode` (same), `CloneSingingVoiceNode` (needs paired audio inputs the agent can't stage), `ImprovePromptNode` (utility, not a canvas deliverable), `LipsyncNode`/`LipSyncNode` if uncovered (needs staged audio+video pair). Write the reason you can defend, not these verbatim.

- [ ] **Step 4: Run the guard to green**

Run: `cd /Users/julien/Documents/GitHub/ComfyNext/frontend && npx vitest run tests/unit/agent-coverage-guard.unit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/ComfyNext
git add frontend/app/lib/agent/capabilities.ts frontend/tests/unit/agent-coverage-guard.unit.spec.ts
git commit -m "test(agent): coverage guard — every edit/enhance panel node needs an agent story"
```

---

### Task 3: Coverage matrix doc

**Files:**
- Create: `docs/agent/edit-verb-coverage.md`

**Interfaces:**
- Consumes: Task 1's capability entries, Task 2's `AGENT_EXCLUDED` (cite actual contents, not guesses).

- [ ] **Step 1: Write the doc**

Create `docs/agent/edit-verb-coverage.md` with this content, then CORRECT the two ⚙ marks against the real registry state (read capabilities.ts / AGENT_EXCLUDED at HEAD — the table below was drafted before Tasks 1–2 landed):

```markdown
# Edit-verb coverage matrix

How common image-edit requests map to nodes, and whether the canvas agent can
route a phrase to them. **Maintenance:** verbs live in `AGENT_CAPABILITIES`
intents (`frontend/app/lib/agent/capabilities.ts`); agent visibility is
enforced by `tests/unit/agent-coverage-guard.unit.spec.ts`. This doc is the
human map, not a registry — update it when the registry changes.

## Tier 1 — universal edits

| Verb | Example phrase | Node | Agent-visible | Interactive surface |
| --- | --- | --- | --- | --- |
| Remove object | "remove the lamppost" | RemoveObjectNode | ✓ | Edit menu → one-click remove (InpaintModal) |
| Remove background | "cut out the subject" | RemoveBackgroundNode | ✓ | Edit menu → Remove BG; Frame layer → Cut out subject |
| Upscale | "make this 4k" | UpscaleImageNode | ✓ | Edit menu → Upscale |
| Enhance detail | "sharpen this up" | EnhanceDetailNode | ✓ | Edit menu → Enhance Detail |
| Expand / outpaint | "zoom out, show more" | OutpaintImageNode | ✓ | — |
| Restyle | "make it look like this reference" | RestyleFromImageNode / RestyleWithLoRANode | ✓ | — |
| Generic edit | "add a hat" | EditImageNode | ✓ | Edit menu → Edit (Nano Banana) |

## Tier 2 — common, commerce-leaning

| Verb | Example phrase | Node | Agent-visible | Interactive surface |
| --- | --- | --- | --- | --- |
| Relight | "golden hour lighting" | RelightNode | ✓ | Edit menu → Relight |
| Reframe / new angle | "show it from the side" | RotateCameraNode (+ LensReframe) | ✓ | Edit menu → Reframe |
| Harmonize composite | "make the pasted object fit" | BlendSceneNode | ✓ | Frame layer → Harmonize into scene (modal-only pipeline, richer than the node) |
| Text edit | "change the sign to say OPEN" | TextEditNode | ✓ | Edit menu → Edit text… popover |
| Recolor object | "make the shirt brand-blue" | RecolorObjectNode | ✓ | Edit menu → Recolor… (brand-kit swatches) |
| Face fix / restore | "fix the faces" / "restore this old photo" | FixFacesNode / RestorePhotoNode | ✓ | — |
| Product scene swap | "put my product in a kitchen" | SwapProductNode / SwapBackgroundNode / ProductShotNode | ⚙ verify | — |

## Tier 3 & gaps

| Verb | Node | Status |
| --- | --- | --- |
| Pose change | PoseMannequin | ⚙ verify agent visibility |
| Person swap | PersonSwap | ⚙ verify agent visibility |
| Expression change ("make her smile") | — | **GAP** |
| Shadow / reflection generation | BlendSceneNode (partial) | **GAP** (procedural cast-shadow layer is an unbuilt stretch task) |
| Material swap ("make it chrome") | — | **GAP** |
| Colorize B&W | — | **GAP** (ImageColorize raw node exists; no capability) |
| Perspective correction | — | **GAP** |
| Age / hairstyle | — | GAP, deliberately off-roadmap |

## Candidates for the next slice (ranked by the 2026-07-08 tier analysis)

1. Expression change — consumer-heavy, nano-banana-2 instruction edit, same
   minimal-node pattern as RemoveObjectNode.
2. Material swap — strong for product design; same pattern.
3. Shadow generation — pairs with Swap Background; procedural version is
   already specced as the cast-shadow stretch task.
4. Colorize B&W — cheap to add (existing models), clear verb.
```

For every ⚙ mark: check whether the node is in `AGENT_CAPABILITIES` or `AGENT_EXCLUDED` at HEAD and replace ⚙ with ✓ or "✗ (excluded: <reason>)" accordingly. No ⚙ may survive into the commit.

- [ ] **Step 2: Commit**

```bash
cd /Users/julien/Documents/GitHub/ComfyNext
git add docs/agent/edit-verb-coverage.md
git commit -m "docs(agent): edit-verb coverage matrix — verbs, nodes, gaps, next-slice candidates"
```

---

### Task 4: Verification

**Files:** none new.

- [ ] **Step 1: Full unit sweep of the touched area**

Run: `cd /Users/julien/Documents/GitHub/ComfyNext/frontend && npx vitest run tests/unit/agent-capability-routing.unit.spec.ts tests/unit/agent-coverage-guard.unit.spec.ts tests/unit/action-catalog.unit.spec.ts tests/unit/agent-plan.unit.spec.ts tests/unit/agent-canvas-surface.unit.spec.ts tests/unit/agent-fastlane.unit.spec.ts`
Expected: all PASS.

- [ ] **Step 2: Live agent-plan smoke (one LLM call, cents not dollars)**

With the dev preview running and an image artifact on a canvas: open the agent and ask "remove the traffic cone from this photo". Verify the produced PLAN places a `RemoveObjectNode` (inspect the plan/ghost before Keep — do NOT run it; running is paid and user-owned). If the fast-lane places it directly (single-node plan), that also passes — check the placed node's type. Screenshot the plan/placement.

- [ ] **Step 3: Report**

No commit — report results (including the exact AGENT_EXCLUDED list and any intent-vocabulary adjustments made during Task 1 Step 4) for the final review.
