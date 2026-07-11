# Critique Fix Chips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-review paid renders and surface the reviewer's fixes as clickable pastel chips ("Fix hands · ~$0.12") in the artifact's next-steps strip.

**Architecture:** Reuse the run→look→fix pipeline end to end (Approach A). A new `auto` mode on `runReview` publishes built `fromReview` changes to the strip composable as chips instead of agent-bar cards; a chip click applies its single change through the existing preview→commit seam. The trigger is a window event from the artifact's fresh-take watcher, gated (paid producer, once per take, 3s debounce) in `CanvasPromptBar`, which owns the agent composable.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, vitest (`cd frontend && npm run test:unit`).

**Spec:** `docs/superpowers/specs/2026-07-02-critique-fix-chips-design.md`

## Global Constraints

- Work directly on `main`; NO feature branches. `git add` only exact paths; NEVER `git add -A`.
- **Pastel = AI**: fix chips use the translucent `gen-pastel` gradient with dark text (the Edit… button idiom). No amber, no purple.
- Auto-review must NEVER auto-run or auto-bill a fix; chip click lands the EditImageNode configured, focused, un-run.
- Auto-review failures are silent (console only) — no toasts from a background process.
- Unit-suite baseline: 3 pre-existing failures in gradientfx-mesh / spacetype-palette / video-model-adapt suites (parallel WIP) — ignore them; nothing new may fail.
- `VueNodeCanvas.vue` may carry foreign uncommitted hunks from parallel sessions. This plan doesn't touch that file, but if a task unexpectedly must: snapshot `git diff` first, reverse-apply before committing, re-apply after (see the artifact-generator-actions session pattern).

---

### Task 1: Pure helpers — `paidProducerFor` + review-schema labels

**Files:**
- Modify: `frontend/app/lib/artifact/nextSteps.ts` (append)
- Modify: `frontend/app/lib/agent/protocol.ts:99-124` (`buildReviewSchema`), `:165-172` (`parseReviewResponse`)
- Test: `frontend/tests/unit/critique-fix-chips.unit.spec.ts` (new)

**Interfaces:**
- Produces: `paidProducerFor(nodeId: string, nodes: {id: string; data?: {priceBadge?: unknown}}[], edges: {source: string; target: string}[]): boolean`; `parseReviewResponse` return gains `fixLabels: string[]` (aligned 1:1 with `fixes` — `decodeCommandList` never drops items).
- Consumed by: Task 3 (labels), Task 4 (`paidProducerFor`).

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/tests/unit/critique-fix-chips.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { paidProducerFor } from '~/lib/artifact/nextSteps'
import { parseReviewResponse } from '~/lib/agent/protocol'

describe('paidProducerFor', () => {
  const paid = { id: 'g1', data: { priceBadge: { expr: '0.03' } } }
  const free = { id: 'g2', data: {} }
  const artifact = { id: 'a1', data: {} }
  it('true when a direct upstream source carries a price badge', () => {
    expect(paidProducerFor('a1', [paid, artifact], [{ source: 'g1', target: 'a1' }])).toBe(true)
  })
  it('false for a free producer', () => {
    expect(paidProducerFor('a1', [free, artifact], [{ source: 'g2', target: 'a1' }])).toBe(false)
  })
  it('false with no upstream at all (uploaded image)', () => {
    expect(paidProducerFor('a1', [artifact], [])).toBe(false)
  })
  it('true when ANY of several inputs is paid', () => {
    expect(paidProducerFor('a1', [paid, free, artifact], [
      { source: 'g2', target: 'a1' }, { source: 'g1', target: 'a1' },
    ])).toBe(true)
  })
})

describe('parseReviewResponse fixLabels', () => {
  it('extracts a label per fix, aligned with fixes', () => {
    const res = parseReviewResponse(JSON.stringify({
      assessment: 'has defects',
      issues: ['left hand is malformed'],
      fixes: [{ op: 'addNode', args: '{}', rationale: 'repair anatomy', label: 'Fix hands' }],
    }))
    expect(res.fixes).toHaveLength(1)
    expect(res.fixLabels).toEqual(['Fix hands'])
  })
  it('missing label yields empty string (caller falls back to rationale)', () => {
    const res = parseReviewResponse(JSON.stringify({
      assessment: '', issues: [], fixes: [{ op: 'setWidget', args: '{}' }],
    }))
    expect(res.fixLabels).toEqual([''])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run tests/unit/critique-fix-chips.unit.spec.ts`
Expected: FAIL — `paidProducerFor` not exported; `fixLabels` undefined.

- [ ] **Step 3: Implement**

Append to `frontend/app/lib/artifact/nextSteps.ts`:

```ts
/** True when any DIRECT upstream source of this node is a paid generator
 *  (carries a price_badge from /object_info). Drives the auto-review gate:
 *  only renders that cost money get a free-of-charge critique pass. */
export function paidProducerFor(
  nodeId: string,
  nodes: { id: string; data?: { priceBadge?: unknown } }[],
  edges: MinimalEdge[],
): boolean {
  const byId = new Map(nodes.map(n => [String(n.id), n]))
  for (const e of edges) {
    if (String(e.target) !== String(nodeId)) continue
    if (byId.get(String(e.source))?.data?.priceBadge) return true
  }
  return false
}
```

In `protocol.ts`, add to the `fixes.items.properties` object in `buildReviewSchema` (after `rationale`):

```ts
            label: { type: 'string', description: 'VERY short imperative chip label for this fix, 2–4 words: "Fix hands", "Clean up text", "Re-roll — wrong subject".' },
```

And in `parseReviewResponse`:

```ts
export function parseReviewResponse(text: string): { assessment: string; issues: string[]; fixes: Command[]; fixRationales: string[]; fixLabels: string[] } {
  let data: { assessment?: unknown; issues?: unknown; fixes?: unknown }
  try { data = JSON.parse(extractJsonObject(text)) } catch { return { assessment: '', issues: [], fixes: [], fixRationales: [], fixLabels: [] } }
  const assessment = typeof data.assessment === 'string' ? data.assessment : ''
  const issues = Array.isArray(data.issues) ? data.issues.filter((s): s is string => typeof s === 'string') : []
  const rawFixes = Array.isArray(data.fixes) ? data.fixes : []
  const { commands: fixes, rationales: fixRationales } = decodeCommandList(rawFixes)
  // decodeCommandList is 1:1 with its input, so labels stay aligned with fixes.
  const fixLabels = rawFixes.map((f) => {
    const l = (f as { label?: unknown } | null)?.label
    return typeof l === 'string' ? l : ''
  })
  return { assessment, issues, fixes, fixRationales, fixLabels }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run tests/unit/critique-fix-chips.unit.spec.ts`
Expected: PASS (6 tests). Then `npm run test:unit` — only the 3 baseline failures.

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/artifact/nextSteps.ts frontend/app/lib/agent/protocol.ts frontend/tests/unit/critique-fix-chips.unit.spec.ts
git commit -m "feat(critique-chips): paidProducerFor gate + per-fix chip labels in review schema"
```

---

### Task 2: Strip fixes channel

**Files:**
- Modify: `frontend/app/composables/useNextStepsStrip.ts`
- Test: `frontend/tests/unit/critique-fix-chips.unit.spec.ts` (append)

**Interfaces:**
- Produces: `interface FixChip { id: number; label: string; hint: string | null; apply: () => void }`; composable gains `fixes: Ref<{ nodeId: string; chips: FixChip[] } | null>`, `announceFixes(nodeId: string, chips: FixChip[])`, `clearFixes(nodeId?: string)`. `announceFreshTake(nodeId)` now also clears that node's stale fixes.
- Consumed by: Task 3 (publishes), Task 4 (renders).

- [ ] **Step 1: Write the failing tests** (append to the Task 1 spec file)

```ts
import { useNextStepsStrip } from '~/composables/useNextStepsStrip'

describe('useNextStepsStrip fixes channel', () => {
  const chip = { id: 0, label: 'Fix hands', hint: '~$0.12', apply: () => {} }
  it('announceFixes publishes; clearFixes(nodeId) clears only that node', () => {
    const s = useNextStepsStrip()
    s.announceFixes('n1', [chip])
    expect(s.fixes.value?.nodeId).toBe('n1')
    s.clearFixes('other') // wrong node — no-op
    expect(s.fixes.value?.nodeId).toBe('n1')
    s.clearFixes('n1')
    expect(s.fixes.value).toBeNull()
  })
  it('a fresh take on the same node clears stale fixes', () => {
    const s = useNextStepsStrip()
    s.announceFixes('n1', [chip])
    s.announceFreshTake('n1')
    expect(s.fixes.value).toBeNull()
  })
  it('a fresh take on ANOTHER node leaves fixes alone', () => {
    const s = useNextStepsStrip()
    s.announceFixes('n1', [chip])
    s.announceFreshTake('n2')
    expect(s.fixes.value?.nodeId).toBe('n1')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run tests/unit/critique-fix-chips.unit.spec.ts`
Expected: FAIL — `fixes`/`announceFixes` undefined.

- [ ] **Step 3: Implement** — full new body of `useNextStepsStrip.ts`:

```ts
// frontend/app/composables/useNextStepsStrip.ts
// Singleton coordination for the post-render "next steps" chip strip: exactly
// one artifact (the most recently rendered) shows it, and any new render or
// dismissal replaces/clears it. Module-scoped refs = shared across components.
// Two channels: `active` (generic suggestion chips, 12s TTL in the component)
// and `fixes` (reviewer-found paid fixes — sticky until clicked/dismissed/stale).
import { ref } from 'vue'

export interface FixChip {
  id: number
  label: string
  hint: string | null
  apply: () => void
}

const active = ref<{ nodeId: string; shownAt: number } | null>(null)
const fixes = ref<{ nodeId: string; chips: FixChip[] } | null>(null)

export function useNextStepsStrip() {
  function announceFreshTake(nodeId: string) {
    active.value = { nodeId, shownAt: Date.now() }
    // A new render invalidates fixes found on the previous one.
    if (fixes.value?.nodeId === nodeId) fixes.value = null
  }
  function announceFixes(nodeId: string, chips: FixChip[]) {
    fixes.value = { nodeId, chips }
  }
  function clearFixes(nodeId?: string) {
    if (!nodeId || fixes.value?.nodeId === nodeId) fixes.value = null
  }
  function dismiss() {
    active.value = null
  }
  return { active, fixes, announceFreshTake, announceFixes, clearFixes, dismiss }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run tests/unit/critique-fix-chips.unit.spec.ts tests/unit/artifact-next-steps.unit.spec.ts`
Expected: PASS — both files (the artifact-next-steps suite proves `active`/`dismiss` behavior didn't regress).

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/composables/useNextStepsStrip.ts frontend/tests/unit/critique-fix-chips.unit.spec.ts
git commit -m "feat(critique-chips): sticky fixes channel on the next-steps strip composable"
```

---

### Task 3: `runReview` auto mode + `applyReviewFix`

**Files:**
- Modify: `frontend/app/composables/useCanvasAgent.ts` — `runReview` (line ~231), `reviewNode`/`reviewLastRun` (~273-284), composable return (~288), imports (top)

**Interfaces:**
- Consumes: `FixChip`, `useNextStepsStrip` (Task 2); `fixLabels` (Task 1); `ACTION_HINTS` from `~/lib/artifact/nextSteps`.
- Produces: `autoReviewNode(nodeId: string, intent: string): Promise<void>` exported from the composable (Task 4's listener calls it). `runReview` signature becomes `(targets: string[], intent: string, mode?: { manual?: boolean; auto?: boolean })`.

- [ ] **Step 1: Add imports** (top of `useCanvasAgent.ts`):

```ts
import { useNextStepsStrip, type FixChip } from '~/composables/useNextStepsStrip'
import { ACTION_HINTS } from '~/lib/artifact/nextSteps'
```

And inside `useCanvasAgent(...)`'s body, near the other composable state:

```ts
  const nextStepsStrip = useNextStepsStrip()
```

- [ ] **Step 2: Rework `runReview`** — replace the current function with:

```ts
  /** Run→look→fix core (suggest-only): look at a run's actual output for `targets`,
   *  and if it falls short of `intent` propose fixes. Manual / Keep & Run mode
   *  surfaces them as Keep/Dismiss cards; `auto` mode (paid-render auto-critique)
   *  publishes them as pastel chips on the artifact's next-steps strip instead —
   *  quiet on success, silent on failure, and never clobbers a pending proposal. */
  async function runReview(targets: string[], intent: string, mode: { manual?: boolean; auto?: boolean } = {}) {
    const { manual = false, auto = false } = mode
    if (busy.value || reviewing.value || !opts.runOutputImage) return
    if (auto && changes.value.length) return // a pending proposal owns the UI — skip this pass
    if (!auto) {
      opts.discard(); opts.tuneRevert?.(); changes.value = []; review.value = null; answer.value = ''; error.value = ''
    }
    reviewing.value = true
    const resultNode = opts.resolveResultNode?.(targets)
    analyzingNodeIds.value = new Set(resultNode ? [resultNode] : targets.map(String))
    try {
      const image = await opts.runOutputImage(targets)
      if (!image) { if (manual) answer.value = 'No result on that node yet — run it first, then critique.'; return }
      const freshNode = opts.resolveResultNode?.(targets)
      if (freshNode) analyzingNodeIds.value = new Set([freshNode])
      const snap = clone(opts.getSnapshot(intent))
      if (!auto) original = snap
      const desc = describeCanvas(snap)
      const res = await $fetch<{ text: string }>('/api/agent-review', {
        method: 'POST',
        body: { apiKey: opts.apiKey(), tier: opts.tier ?? 'plan', prompt: buildResultReviewPrompt(desc, intent), schema: buildReviewSchema(desc.commands), image },
        timeout: 60_000,
      })
      const { assessment, issues: found, fixes, fixRationales, fixLabels } = parseReviewResponse(res.text)
      const built: ProposedChange[] = []
      const builtLabels: string[] = []
      let probe = clone(snap)
      fixes.forEach((cmd, i) => {
        const ch = buildChange(probe, cmd, fixRationales[i] || 'From the visual review')
        if (!ch) return
        ch.fromReview = true
        built.push(ch)
        builtLabels.push(fixLabels[i] || (fixRationales[i] || '').slice(0, 30) || 'Fix issues')
        const r = applyCanvasCommand(probe, cmd)
        if (r.ok) probe = r.template
      })
      if (auto) {
        // Chips only — no bar cards, no "looks right", no review banner.
        const chipNode = String(freshNode ?? resultNode ?? targets[0])
        if (built.length) {
          const chips: FixChip[] = built.map((ch, i) => ({
            id: i,
            label: builtLabels[i]!,
            // Only the Nano-Banana edit has a fixed price; widget/seed fixes vary.
            hint: JSON.stringify(ch.command).includes('EditImageNode') ? ACTION_HINTS['nano-banana'] : null,
            apply: () => applyReviewFix(ch, chipNode),
          }))
          nextStepsStrip.announceFixes(chipNode, chips)
        }
        return
      }
      review.value = { assessment, issues: found }
      if (built.length) { changes.value = built; recompute() }
      else if (!found.length) answer.value = '✓ Looks right — the result matches what you asked.'
    } catch (e) {
      if (manual) error.value = e instanceof Error ? e.message : 'Couldn’t review the result.'
      else if (auto) console.warn('[AutoReview] failed silently:', e)
    } finally { reviewing.value = false; analyzingNodeIds.value = new Set() }
  }
```

- [ ] **Step 3: Add `applyReviewFix` + `autoReviewNode`, update call sites & return**

Directly below `runReview`:

```ts
  /** Chip click: apply exactly ONE review fix through the normal preview→commit
   *  seam. The spliced EditImageNode lands configured + selected, UN-RUN — the
   *  user aims (or just hits its Run) before anything bills. */
  function applyReviewFix(change: ProposedChange, nodeId: string) {
    if (busy.value || reviewing.value) return
    try {
      opts.preview([change.command], false)
      opts.commit()
    } catch (e) {
      console.warn('[AutoReview] fix apply failed:', e)
    } finally {
      nextStepsStrip.clearFixes(nodeId)
    }
  }

  /** Auto: paid render finished → quiet chip-producing review (gated upstream). */
  async function autoReviewNode(nodeId: string, intent: string) {
    await runReview([nodeId], intent || 'this image', { auto: true })
  }
```

Update the two existing call sites to the new signature:

```ts
  async function reviewLastRun() {
    if (!pendingReview) return
    const { targets, intent } = pendingReview
    pendingReview = null // one pass; the user re-arms by Keep & Run-ing a fix
    await runReview(targets, intent)
  }

  /** On-demand: critique ANY result node (its output vs the prompt that made it). */
  async function reviewNode(nodeId: string, intent: string) {
    await runReview([nodeId], intent || 'this image', { manual: true })
  }
```

Add `autoReviewNode` to the composable's return object (line ~288), after `reviewNode`.

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run test:unit`
Expected: only the 3 baseline failures. (This task's behavior is exercised live in Task 5.)

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/composables/useCanvasAgent.ts
git commit -m "feat(critique-chips): auto review mode publishes fix chips; applyReviewFix single-change commit"
```

---

### Task 4: UI wiring — pastel chips, trigger event, gated listener

**Files:**
- Modify: `frontend/app/components/vue-canvas/NextStepsStrip.vue`
- Modify: `frontend/app/components/vue-canvas/ArtifactImageNode.vue` (takes watcher + strip mount)
- Modify: `frontend/app/components/agent/CanvasPromptBar.vue` (listener)

**Interfaces:**
- Consumes: `FixChip`, strip channels (Task 2), `autoReviewNode` (Task 3), `paidProducerFor` (Task 1), `props.vueCanvas.getNodes()/getEdges()/agentNodeIntent()` (already exposed by VueNodeCanvas).
- Produces: window event `sailor:autoReview { nodeId: string, takeId: string }`.

- [ ] **Step 1: NextStepsStrip renders fix chips; timer no longer kills them**

In `NextStepsStrip.vue` script: add `fixChips` prop, split the timer signal from explicit dismissal.

```ts
const props = defineProps<{ canVary: boolean; fixChips?: FixChip[] }>()
```

Add the import: `import type { FixChip } from '~/composables/useNextStepsStrip'`.

Change the emits to add a `timeout` event (timer) distinct from `dismiss` (outside click):

```ts
const emit = defineEmits<{
  (e: 'variations' | 'upscale' | 'animate' | 'more' | 'dismiss' | 'timeout'): void
}>()
```

In `onMounted`, the timer now emits `'timeout'` instead of `'dismiss'`:

```ts
  timer = setTimeout(() => emit('timeout'), 12_000)
```

Template — insert BEFORE the `<span class="text-[9px] …">Next</span>` label (fix chips lead the strip; pastel = AI):

```html
    <button
      v-for="chip in fixChips ?? []"
      :key="chip.id"
      class="ns-chip-fix gen-pastel"
      style="--gen-pastel: linear-gradient(90deg, rgba(255,214,231,.55), rgba(207,232,255,.55), rgba(214,255,224,.55), rgba(255,244,204,.55), rgba(231,214,255,.55), rgba(255,214,231,.55));"
      :title="chip.hint ? `${chip.label} (${chip.hint})` : chip.label"
      @click.stop="chip.apply()"
    >
      <Sparkles class="size-2.5" /> {{ chip.label }}
      <span v-if="chip.hint" class="ns-hint-fix">{{ chip.hint }}</span>
    </button>
```

Add `Sparkles` to the lucide import. Styles (append to the scoped block):

```css
.ns-chip-fix {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  height: 1.25rem;
  padding: 0 0.5rem;
  border-radius: 0.25rem;
  font-size: 10px;
  font-weight: 500;
  color: #171717;
  cursor: pointer;
  transition: filter 0.15s;
}
.ns-chip-fix:hover { filter: brightness(1.08); }
.ns-hint-fix {
  font-size: 8px;
  font-variant-numeric: tabular-nums;
  color: rgb(23 23 23 / 0.55);
}
```

Also make the generic chips conditional so a fixes-only strip doesn't show stale suggestions: wrap the existing `Next` label + three suggestion chips + spacer + More… in `<template v-if="showGeneric">` and add the prop `showGeneric: boolean` to `defineProps` (parent passes whether the generic channel is active for this node). Keep the More… button OUTSIDE the conditional (it's useful in both states).

- [ ] **Step 2: ArtifactImageNode — dispatch the trigger + render both channels**

In the takes watcher (added by the previous feature, search `announceFreshTake`):

```ts
watch(() => props.data.takes?.length ?? 0, (now, before) => {
  if (now > (before ?? 0)) {
    nextSteps.announceFreshTake(props.id)
    // Paid renders get a quiet critique pass; the gate lives in CanvasPromptBar.
    const takeId = props.data.takes?.[props.data.takes.length - 1]?.id
    if (takeId) {
      window.dispatchEvent(new CustomEvent('sailor:autoReview', {
        detail: { nodeId: props.id, takeId: String(takeId) },
      }))
    }
  }
})
```

Update the strip's visibility + bindings (replacing the existing `showNextSteps` computed and `<NextStepsStrip>` mount):

```ts
const showGenericSteps = computed(() => nextSteps.active.value?.nodeId === props.id)
const fixChipsForMe = computed(() => nextSteps.fixes.value?.nodeId === props.id ? nextSteps.fixes.value.chips : [])
const showNextSteps = computed(() => showGenericSteps.value || fixChipsForMe.value.length > 0)
function onStripTimeout() {
  // The 12s timer retires only the generic suggestions; reviewer fixes are
  // sticky (they ARRIVE ~10s late by nature) until clicked/dismissed/stale.
  nextSteps.dismiss()
}
function onStripDismiss() {
  nextSteps.dismiss()
  nextSteps.clearFixes(props.id)
}
```

```html
        <NextStepsStrip
          v-if="showNextSteps && displayedUrl"
          :can-vary="hasUpstream"
          :show-generic="showGenericSteps"
          :fix-chips="fixChipsForMe"
          @variations="runVariations"
          @upscale="spawnUpscale"
          @animate="animateArtifact"
          @more="openEditMenuFromStrip"
          @timeout="onStripTimeout"
          @dismiss="onStripDismiss"
        />
```

Note: the component's internal `pick()` emits `dismiss` after a generic chip click — that behavior stands (acting on a suggestion retires the strip, including fixes: deliberate, the user chose a different path).

- [ ] **Step 3: CanvasPromptBar — the gated listener**

Add imports: `import { paidProducerFor } from '~/lib/artifact/nextSteps'`. Destructure `autoReviewNode` from `useCanvasAgent(...)` (add it after `reviewNode` in the existing destructuring).

Below `onCritiqueNode`:

```ts
// Auto-critique: a fresh take landed on an image artifact. Gate hard —
// paid producer only, once per take, 3s settle so a Variations ×4 burst
// reviews the final state once instead of four times.
const reviewedTakes = new Map<string, string>()
const autoReviewTimers = new Map<string, ReturnType<typeof setTimeout>>()
function onAutoReview(e: Event) {
  const { nodeId, takeId } = (e as CustomEvent).detail || {}
  if (!nodeId || !takeId || !ready.value) return
  const id = String(nodeId)
  if (reviewedTakes.get(id) === String(takeId)) return
  clearTimeout(autoReviewTimers.get(id))
  autoReviewTimers.set(id, setTimeout(() => {
    autoReviewTimers.delete(id)
    const nodes = props.vueCanvas?.getNodes?.() ?? []
    const edges = props.vueCanvas?.getEdges?.() ?? []
    if (!paidProducerFor(id, nodes, edges)) return
    reviewedTakes.set(id, String(takeId))
    autoReviewNode(id, props.vueCanvas?.agentNodeIntent?.(id) ?? '')
  }, 3000))
}
```

Register in the existing `onMounted`/`onBeforeUnmount` pairs:

```ts
  window.addEventListener('sailor:autoReview', onAutoReview)
```
```ts
  window.removeEventListener('sailor:autoReview', onAutoReview)
  for (const t of autoReviewTimers.values()) clearTimeout(t)
```

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run test:unit`
Expected: only the 3 baseline failures.

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/components/vue-canvas/NextStepsStrip.vue frontend/app/components/vue-canvas/ArtifactImageNode.vue frontend/app/components/agent/CanvasPromptBar.vue
git commit -m "feat(critique-chips): pastel fix chips in the strip + gated auto-review trigger"
```

---

### Task 5: Live verification

**Files:** none. Needs the Nuxt dev server + ComfyUI backend + the user's Anthropic key configured in Settings → AI.

- [ ] **Step 1: Free-path checks** (no spend):
  - Local/free render (e.g. a studio bake or BackgroundRemove) → NO `/api/agent-review` request fires (check preview network log). The strip shows only generic chips.
  - Uploaded image → no auto-review.
  - Strip regression: generic chips still appear on fresh takes and still time out at 12s.

- [ ] **Step 2: Paid-path check** — REQUIRES USER GO-AHEAD (one cheap paid render + one vision review call on their key):
  - Run a paid generator with a prompt likely to produce a defect (e.g. a person holding a glass, or text on a sign).
  - After the render: scanning overlay on the artifact → pastel chips appear with labels + `~$0.12` hint where the fix is a Nano-Banana edit.
  - Click a chip → EditImageNode lands spliced after the artifact, selected, corrective prompt set, **not running**; the chip strip's fixes clear.
  - Trigger a new render on the same artifact → stale chips clear immediately.
  - A clean render (simple subject) → review runs, finds nothing, no chips, no toast.

- [ ] **Step 3: Screenshot proof** of the pastel fix chips on an artifact; report spend.

- [ ] **Step 4: Memory + docs** — update the artifact-generator-actions memory (chips now include reviewer fixes; ARPU lever 4 complete) and report honestly anything unverifiable.

## Self-review notes

- Spec coverage: trigger gates (T4 listener), auto mode chips-only (T3), pastel styling (T4), sticky vs 12s timer (T4 timeout/dismiss split), aim-first click (T3 `applyReviewFix`), paid gate helper + labels (T1), strip channel (T2), silent failures (T3 catch), live checks incl. free-path negative (T5).
- Deviation from spec: none of substance; "review-once bookkeeping" lives in CanvasPromptBar (`reviewedTakes`) rather than the composable — same behavior, simpler ownership.
- Type consistency: `FixChip` defined once in useNextStepsStrip (T2), imported by T3/T4; `autoReviewNode(nodeId, intent)` produced T3, called T4; `paidProducerFor(nodeId, nodes, edges)` produced T1, called T4.
