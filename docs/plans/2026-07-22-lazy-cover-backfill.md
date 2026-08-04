# Lazy Cover Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** All-Projects cards that show "No preview" (projects saved before cover stamping shipped) lazily derive their preview from the saved doc when scrolled into view, and stamp it server-side so the next load is free. 37 existing projects gain previews immediately.

**Architecture:** Read-side companion to the save-side `stampProjectCover`. A pure lib (`coverBackfill.ts`: eligibility predicate + tiny concurrency queue, unit-tested) plus a thin composable (`useCoverBackfill.ts`: one shared IntersectionObserver, session-wide attempted-set, fetch `versions/current` → `extractCoverImages` → write images into the shared `useRecentProjects` state → fire-and-forget `setProjectCover`). `AllProjectsView.vue` wires each card via a template function-ref. Home row benefits automatically (shared state).

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, Vitest (`tests/unit/*.unit.spec.ts`, node env). Reuses `extractCoverImages` (`frontend/app/lib/projectCover.ts`), `useProjects().loadVersion/setProjectCover`, `useRecentProjects`. No backend changes.

## Global Constraints

- No backend/Python changes; frontend commands run from `/Users/julien/Documents/GitHub/Sailor/frontend`.
- Typecheck baseline ~328 pre-existing errors — vitest gates only, plus dev-server compile check via `curl -s -o /dev/null -w "%{http_code}" 'http://127.0.0.1:3000/'` (always 127.0.0.1, never localhost).
- PARALLEL SESSIONS are committing to this repo. Stage ONLY the files each task names, never `git add -A`, never stash. Commit directly to `main`.
- Never fetch for a card that already has images; attempt each uuid at most once per session; max 3 concurrent version fetches.
- History-fingerprint ids (comma-joined class types, see `useRecentProjects.ts` `setProjectName`) are NOT server uuids — never fetched.
- An empty extraction stamps nothing (no `setProjectCover([])` — stale-cover clearing is a separate task).
- `RecentProject.images` shape (`{ filename; subfolder; type }[]`) unchanged; no template changes beyond the ref hook.

---

### Task 1: Pure lib `coverBackfill.ts` + unit tests

**Files:**
- Create: `frontend/app/lib/coverBackfill.ts`
- Test: `frontend/tests/unit/cover-backfill.unit.spec.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces (Task 2 relies on these exact signatures):
  - `isBackfillCandidate(p: { workflowId?: string | null; images?: unknown[] | null }): boolean`
  - `createTaskQueue(maxConcurrent: number): { push(task: () => Promise<void>): void; readonly activeCount: number; readonly pendingCount: number }`

- [ ] **Step 1: Write the failing tests**

```typescript
// frontend/tests/unit/cover-backfill.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { isBackfillCandidate, createTaskQueue } from '~/lib/coverBackfill'

describe('isBackfillCandidate', () => {
  it('accepts a uuid card with no images', () => {
    expect(isBackfillCandidate({ workflowId: 'abc-123', images: [] })).toBe(true)
    expect(isBackfillCandidate({ workflowId: 'abc-123', images: null })).toBe(true)
  })
  it('rejects cards that already have images', () => {
    expect(isBackfillCandidate({ workflowId: 'abc-123', images: [{}] })).toBe(false)
  })
  it('rejects history-fingerprint ids and missing ids', () => {
    expect(isBackfillCandidate({ workflowId: 'KSampler,VAEDecode', images: [] })).toBe(false)
    expect(isBackfillCandidate({ workflowId: '', images: [] })).toBe(false)
    expect(isBackfillCandidate({ workflowId: null, images: [] })).toBe(false)
  })
})

describe('createTaskQueue', () => {
  function deferred() {
    let resolve!: () => void, reject!: (e: unknown) => void
    const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }

  it('never runs more than maxConcurrent tasks at once and drains all', async () => {
    const queue = createTaskQueue(2)
    const gates = [deferred(), deferred(), deferred(), deferred()]
    const started: number[] = []
    gates.forEach((g, i) => queue.push(() => { started.push(i); return g.promise }))
    await Promise.resolve()
    expect(started).toEqual([0, 1])          // FIFO, capped at 2
    expect(queue.activeCount).toBe(2)
    expect(queue.pendingCount).toBe(2)
    gates[0].resolve()
    await Promise.resolve(); await Promise.resolve()
    expect(started).toEqual([0, 1, 2])       // slot freed → next starts
    gates[1].resolve(); gates[2].resolve(); gates[3].resolve()
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(started).toEqual([0, 1, 2, 3])
    expect(queue.activeCount).toBe(0)
    expect(queue.pendingCount).toBe(0)
  })

  it('keeps draining after a task rejects', async () => {
    const queue = createTaskQueue(1)
    const started: number[] = []
    const gate = deferred()
    queue.push(() => { started.push(0); return Promise.reject(new Error('boom')) })
    queue.push(() => { started.push(1); return gate.promise })
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(started).toEqual([0, 1])
    gate.resolve()
    await Promise.resolve(); await Promise.resolve()
    expect(queue.activeCount).toBe(0)
  })

  it('also survives a task that throws synchronously', async () => {
    const queue = createTaskQueue(1)
    const started: number[] = []
    queue.push(() => { started.push(0); throw new Error('sync boom') })
    queue.push(() => { started.push(1); return Promise.resolve() })
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(started).toEqual([0, 1])
    expect(queue.activeCount).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/cover-backfill.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/coverBackfill`.

- [ ] **Step 3: Write the implementation**

```typescript
// frontend/app/lib/coverBackfill.ts
/**
 * coverBackfill — pure logic for the lazy cover backfill (read-side companion
 * to stampProjectCover in default.vue). Projects saved before cover stamping
 * shipped show "No preview" until re-opened; the grid closes that gap by
 * fetching the saved doc for blank cards as they scroll into view. This
 * module holds the testable parts: which cards qualify, and a small
 * concurrency gate so scrolling a 200-card grid can't burst version fetches.
 */

/** A card qualifies when it has no images and its id is a real server uuid —
 *  history-fingerprint cards (comma-joined class types, pre-uuid runs) have
 *  no durable doc to fetch. */
export function isBackfillCandidate(p: { workflowId?: string | null; images?: unknown[] | null }): boolean {
  if (!p.workflowId || p.workflowId.includes(',')) return false
  return !p.images || p.images.length === 0
}

/** Minimal FIFO task queue: at most `maxConcurrent` tasks in flight; a task
 *  settling (resolve, reject, or synchronous throw) frees its slot. */
export function createTaskQueue(maxConcurrent: number) {
  const pending: (() => Promise<void>)[] = []
  let active = 0
  function pump() {
    while (active < maxConcurrent && pending.length) {
      const task = pending.shift()!
      active++
      Promise.resolve().then(task).catch(() => {}).finally(() => {
        active--
        pump()
      })
    }
  }
  return {
    push(task: () => Promise<void>) {
      pending.push(task)
      pump()
    },
    get activeCount() { return active },
    get pendingCount() { return pending.length },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/cover-backfill.unit.spec.ts`
Expected: PASS (6 tests). If the microtask-tick counts in the concurrency assertions prove brittle, prefer replacing bare `await Promise.resolve()` chains with a `await new Promise((r) => setTimeout(r, 0))` macrotask flush — do not weaken the assertions themselves.

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/coverBackfill.ts frontend/tests/unit/cover-backfill.unit.spec.ts
git commit -m "feat(previews): coverBackfill lib — eligibility predicate + bounded task queue

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `useCoverBackfill` composable + grid wiring

**Files:**
- Create: `frontend/app/composables/useCoverBackfill.ts`
- Modify: `frontend/app/composables/useRecentProjects.ts` (add one mutator beside `setProjectName`, export it)
- Modify: `frontend/app/components/AllProjectsView.vue` (composable use + card ref hook)

**Interfaces:**
- Consumes: `isBackfillCandidate` / `createTaskQueue` (Task 1); `extractCoverImages(doc)` from `~/lib/projectCover`; `useProjects().loadVersion(uuid, 'current')` (resolves `ProjectVersion | null` with `.workflow`) and `setProjectCover(uuid, cover)`; `RecentProject` type.
- Produces: `useCoverBackfill(): { observeCard(el: Element | null | undefined, project: RecentProject): void; disconnect(): void; backfill(project: RecentProject): Promise<void> }`; `useRecentProjects().applyBackfilledImages(workflowId: string, images: RecentProject['images']): void`.

- [ ] **Step 1: Add the write-through mutator to `useRecentProjects.ts`**

Directly below the `setProjectName` function body, add:

```typescript
  // Write-through for the lazy cover backfill (useCoverBackfill): update the
  // blank card in BOTH shared lists so the grid and the Home row repaint.
  // Guarded to blank cards only — a race with a real fetch never downgrades
  // generation thumbnails to doc-derived ones.
  function applyBackfilledImages(workflowId: string, images: RecentProject['images']) {
    for (const list of [recentProjects.value, allProjects.value]) {
      const project = list.find((p) => p.workflowId === workflowId)
      if (project && project.images.length === 0) project.images = images
    }
  }
```

Add `applyBackfilledImages` to the composable's return object (after `setProjectName`).

- [ ] **Step 2: Create `useCoverBackfill.ts`**

```typescript
// frontend/app/composables/useCoverBackfill.ts
/**
 * useCoverBackfill — lazily derive preview images for legacy "No preview"
 * cards. Projects saved before cover stamping shipped (stampProjectCover in
 * layouts/default.vue) only gain a cover on their next open+save; this
 * composable closes the gap from the read side: when a blank card scrolls
 * into view, fetch the project's current version doc, extract preview images
 * (studio bakes / Frame composites — see ~/lib/projectCover), paint them into
 * the shared card state, and stamp the cover server-side so the next grid
 * load needs no doc fetch.
 */
import { isBackfillCandidate, createTaskQueue } from '~/lib/coverBackfill'
import { extractCoverImages } from '~/lib/projectCover'
import type { RecentProject } from '~/composables/useRecentProjects'

// Module scope on purpose: a uuid is attempted once per session no matter how
// often its card re-mounts, and one queue bounds fetches across all views.
const attempted = new Set<string>()
const queue = createTaskQueue(3)

export function useCoverBackfill() {
  let observer: IntersectionObserver | null = null
  const cardProjects = new WeakMap<Element, RecentProject>()

  async function backfill(project: RecentProject): Promise<void> {
    if (!isBackfillCandidate(project) || attempted.has(project.workflowId)) return
    attempted.add(project.workflowId)
    const { loadVersion, setProjectCover } = useProjects()
    const version = await loadVersion(project.workflowId, 'current')
    if (!version?.workflow) return
    const cover = extractCoverImages(version.workflow)
    if (!cover.length) return
    useRecentProjects().applyBackfilledImages(project.workflowId, cover)
    // Stamp server-side (fire-and-forget — setProjectCover swallows errors)
    // so future loads read the cover straight off the project index.
    setProjectCover(project.workflowId, cover)
  }

  function ensureObserver(): IntersectionObserver | null {
    if (observer || typeof IntersectionObserver === 'undefined') return observer
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        observer!.unobserve(entry.target)
        const project = cardProjects.get(entry.target)
        if (project) queue.push(() => backfill(project))
      }
    }, { rootMargin: '200px' })
    return observer
  }

  /** Template function-ref hook: watch a card element until it first becomes
   *  visible, then queue its backfill. No-op for ineligible/attempted cards
   *  and on the server. */
  function observeCard(el: Element | null | undefined, project: RecentProject): void {
    if (!el || !isBackfillCandidate(project) || attempted.has(project.workflowId)) return
    const obs = ensureObserver()
    if (!obs) return
    cardProjects.set(el, project)
    obs.observe(el)
  }

  function disconnect(): void {
    observer?.disconnect()
    observer = null
  }

  return { observeCard, disconnect, backfill }
}
```

- [ ] **Step 3: Wire the grid in `AllProjectsView.vue`**

In the `<script setup>` block, after the existing composable calls (`const { tabs, openTab, setActiveTab } = useTabs()`), add:

```typescript
const { observeCard, disconnect } = useCoverBackfill()
onBeforeUnmount(disconnect)
```

In the template, on the card root element (`<div v-for="project in filtered" :key="project.workflowId" class="cursor-pointer group" @click="openProject(project)">`), add the ref hook attribute:

```html
        :ref="(el) => observeCard(el as unknown as Element | null, project)"
```

(Function refs receive `Element | ComponentPublicInstance | null`; this element is a plain div, and `observeCard` ignores null. No other template changes.)

- [ ] **Step 4: Verify**

Run: `cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/cover-backfill.unit.spec.ts tests/unit/project-cover.unit.spec.ts`
Expected: PASS (16 tests).
Then compile check (only if a dev server responds): `curl -s -o /dev/null -w "%{http_code}" 'http://127.0.0.1:3000/'` → `200`. If no server is running, note the skip — do NOT start one.

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/composables/useCoverBackfill.ts frontend/app/composables/useRecentProjects.ts frontend/app/components/AllProjectsView.vue
git commit -m "feat(previews): lazy cover backfill — blank cards derive + stamp covers on first view

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Live verification (controller-run)

**Files:** none.

- [ ] **Step 1:** Confirm servers respond (127.0.0.1:3000 and :8188). Baseline: count projects with non-null cover via `/sailor/projects`.
- [ ] **Step 2:** Open All Projects in the browser, scroll through the grid, and watch previously-blank cards paint (≈37 candidates identified in pre-scan). Confirm via network/API that `PUT /sailor/projects/{uuid}` cover stamps landed (non-null cover count increased) and that reloading the page shows the same cards WITHOUT re-fetching version docs (covers now come from the project index).
- [ ] **Step 3:** Confirm no fetch storm: scrolling triggers at most 3 concurrent `versions/current` requests.
- [ ] **Step 4:** Regression: `npx vitest run tests/unit/cover-backfill.unit.spec.ts tests/unit/project-cover.unit.spec.ts tests/unit/project-doc-recency.unit.spec.ts`.

---

## Self-review notes

- Spec coverage: visible-only fetching (IntersectionObserver, Task 2) ✓; concurrency throttle (queue, Tasks 1-2) ✓; never fetch cards with images + attempted-once (predicate + set) ✓; legacy bare-workflow tolerance (delegated to `extractCoverImages`, already tested) ✓; stamp for next load ✓; unit tests for new pure logic ✓; parallel-session staging rules in every commit step ✓.
- Type consistency: `isBackfillCandidate`/`createTaskQueue` signatures identical in Tasks 1 and 2; `applyBackfilledImages(workflowId, images)` defined and consumed identically; `loadVersion(uuid, 'current')` matches `useProjects.ts`.
- `globalThis.Map` hazard: not applicable — no file touched here imports the lucide `Map` icon (only `default.vue` does); `WeakMap`/`Set` are unshadowed.
