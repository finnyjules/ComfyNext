# Stage 5: Canvas Metering + Tenant Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Plain summary:** Today, running a graph on the canvas spends the operator's provider money without touching the user's wallet, and any signed-in user can read any other user's run history and images. After this stage: every canvas run is priced up front, the credits are put on hold, the hold is charged when the run succeeds (released if it fails), and each user can only see their own runs and outputs. Local mode stays byte-identical — no checks, no charges, no filtering.

**Goal:** Every graph submission in hosted mode passes through a fail-closed meter (hold → run → settle), and `/history`, `/view`, `/queue`, `/interrupt`, and `/ws` are ownership-scoped per signed-in user.

**Architecture:** Interception happens **server-side in `comfyui-proxy.ts`** — hosted mode swaps the raw `/prompt` proxy for a metered handler, so the direct-execution path AND all five mini-apps are covered with zero client changes and no way for a stale client to bypass. The third surface (the bridge iframe posting to its own `:8188` origin) is closed on the client: hosted mode forces direct execution and never mounts engine iframes. Run ownership is durable (`graph_runs` table in Neon), settlement is hold-based (fixing the Stage-4 no-hold parallel-preflight leak for provider routes too), and the ownership table is what gates `/history`/`/view`.

**Tech Stack:** Nuxt 4 / Nitro (h3), Neon Postgres via the existing `ledgerDb.ts` pg driver, existing `ledger.ts` hold/settle/release, Clerk `@clerk/backend` session verification, Vitest.

## Global Constraints

- **deployMode contract (non-negotiable):** no `NUXT_CLERK_SECRET_KEY` in env ⇒ local mode ⇒ byte-identical pre-Stage-5 behavior. Every hosted branch in this plan is behind `deployMode() === 'hosted'` (server) or `hostedModeEnabled(useRuntimeConfig().public)` (client). Local `:3000` regression check is part of final verification.
- **Secrets:** all hosted keys live ONLY in gitignored `frontend/.env.hosted`. Never print a key into chat, a commit, or a log. Never write keys to `.env`.
- **mlly gotcha:** NO commas in trailing comments on `export const` lines anywhere in `frontend/server/` — mlly's export scanner splits on commas and registers phantom auto-imports that kill every Nitro boot. Use em-dashes.
- **Parallel-session hygiene:** another session has uncommitted changes in `comfy_api_nodes/nodes_replicate.py`, `frontend/app/components/vue-canvas/ComfyNode.vue`, `frontend/app/data/action-catalog.ts`, and others. Stage ONLY your own hunks (`git add -p` / `git apply --cached`), never `git add -A`, never stash. Commit to `main` directly.
- **Run vitest FROM `frontend/`** (`cd frontend && npx vitest run <file>`) — the repo-root vitest is the wrong one. Shell cwd resets between Bash calls.
- **Ledger session contract:** `ledger.ts` owns ONE dedicated pg session; never wrap `getBalance`/`getAvailable` in its mutex; raw writes on the SHARED session go through `ledger.withLock`. New tables in this plan use a **separate** pg session (via `connectLedgerDb`) precisely so they never touch the ledger's session.
- **New `/api/*` prefixes** must be allowlisted in `server/middleware/comfyui-proxy.ts` (`NITRO_API_PATHS`/`NITRO_API_PREFIXES`) or they proxy to ComfyUI. (This plan adds no new `/api` routes, but touches that file — keep the lists intact.)
- **Response-shape invariant:** the metered `/prompt` handler must return ComfyUI's response body **verbatim** (`{prompt_id, number, node_errors}` on 200; the `{error, node_errors}` body with its original status on 4xx) — `useDirectExecution.ts` and five mini-apps parse that exact shape.
- **Fail-closed money rules (from Stage 4, still binding):** unpriced ⇒ refuse with 500, never underprice; refusals must cost nothing; hosted job without a string userId fails visibly; `MeterRefusalError` (with `static __h3_error__ = true`) is the refusal type so Nitro doesn't sanitize 402 bodies.
- **Eager-module-const gotcha:** never compute a module-top-level const from another module's exported const in a way that depends on import order — build lookup maps lazily inside functions.

## Current-state map (verified 2026-08-17, for implementer context)

- `server/api/meter/prompt.post.ts` — the Surface-B spike; **dead code, nothing calls it**. Its pure core `server/utils/meterPrompt.ts` (price → preflight → forward → register → settle) and `server/utils/settleWatcher.ts` (history-poll settlement, live-verified status semantics) are reused by this plan. `server/utils/meterStore.ts` (in-memory pending map) is replaced by the durable `graph_runs` table and deleted.
- Submission surfaces: (1) bridge iframe → ComfyUI's own `queuePrompt` against `comfyOrigin` directly — never touches Nuxt; (2) `useDirectExecution.ts:397` `$fetch('/prompt')` same-origin → raw proxy; (3) five mini-apps (`ProductShotApp.vue:44`, `FaceSwapApp.vue:113`, `AutoSubtitleApp.vue:85`, `KaraokeMakerApp.vue:57`, `LoraTrainerSurface.vue:1144`) `fetch('/prompt')` same-origin → raw proxy.
- `server/middleware/comfyui-proxy.ts` raw-proxies `PROXY_PREFIXES` (from `authGuard.ts`) to `127.0.0.1:{8188|8189+N}` via `resolveWorkerTarget(path)` (`?comfyWorker=N`).
- `/history` (list) merges a **global unscoped disk cache** shared by every user; `/history/[promptId]` and `/view` serve anything to anyone signed in.
- `priceGraph` (`server/utils/priceBook.ts:58`) prices only 9 flat classes; `comfy_api_nodes/nodes_replicate.py` defines **62** `IO.ComfyNode` provider classes. `GenerateImageNode` carries its model as `inputs.model` = a catalog id whose USD price lives in `frontend/app/data/image-models.ts` (`pricePerImage`).
- `ledger.ts` already has `hold(userId, estimate, idempotencyKey)` / `settle(holdId, actual, reason)` / `release(holdId)` with idempotent replay; `wallets.reserved_credits` backs `getAvailable`.
- Dev `/ws` proxy = inline module in `nuxt.config.ts:52-134` (dev-only, unauthenticated). No production WS path exists (deferred rider — see end).

---

### Task 1: Durable run ownership — `graph_runs` table + `graphRuns.ts`

**Files:**
- Modify: `frontend/server/db/schema.sql` (append table)
- Create: `frontend/server/utils/graphRuns.ts`
- Test: `frontend/tests/unit/graph-runs.unit.spec.ts`

**Interfaces:**
- Consumes: `connectLedgerDb(connectionString)` from `server/utils/ledgerDb.ts`.
- Produces (used by Tasks 4–6):
  - `outputKey(o: {filename: string; subfolder?: string; type?: string}): string` — `` `${type || 'output'}:${o.subfolder || ''}:${o.filename}` ``
  - `createGraphRun(r: {promptId: string; userId: string; credits: number; holdId: number | null}): Promise<void>`
  - `resolveGraphRun(promptId: string, state: 'settled' | 'voided', outputs?: string[]): Promise<void>`
  - `ownsPrompt(userId: string, promptId: string): Promise<boolean>`
  - `ownedPromptIds(userId: string): Promise<Set<string>>`
  - `ownedOutputKeys(userId: string): Promise<Set<string>>`
  - `pendingRuns(userId: string): Promise<{promptId: string; holdId: number | null; credits: number}[]>`
  - `__setGraphRunsDbForTests(db: {query: Function} | null): void`

- [ ] **Step 1: Append the table to `schema.sql`**

```sql
-- Graph-run ownership + settlement state (Stage 5). One row per metered
-- canvas submission; `outputs` holds outputKey strings ("type:subfolder:filename")
-- recorded at settlement so /view can gate by ownership.
CREATE TABLE IF NOT EXISTS graph_runs (
  prompt_id  text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id),
  credits    integer NOT NULL CHECK (credits >= 0),
  hold_id    bigint,
  state      text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'settled', 'voided')),
  outputs    jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS graph_runs_user ON graph_runs (user_id, created_at DESC);
```

- [ ] **Step 2: Write the failing test**

Follow the fake-db pattern from `tests/unit/ledger-core.unit.spec.ts` — a `query` spy returning canned rows. Cover: `createGraphRun` inserts with state `pending`; `resolveGraphRun` updates state and outputs; `ownsPrompt` true/false; `ownedOutputKeys` flattens jsonb arrays from multiple rows into one Set; `outputKey` defaults type to `output` and subfolder to empty; `pendingRuns` selects only `state = 'pending'` rows for that user.

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  outputKey, createGraphRun, resolveGraphRun, ownsPrompt,
  ownedPromptIds, ownedOutputKeys, pendingRuns, __setGraphRunsDbForTests,
} from '../../server/utils/graphRuns'

const query = vi.fn()
beforeEach(() => { query.mockReset(); __setGraphRunsDbForTests({ query }) })

describe('outputKey', () => {
  it('defaults type=output, subfolder empty', () => {
    expect(outputKey({ filename: 'a.png' })).toBe('output::a.png')
    expect(outputKey({ filename: 'a.png', subfolder: 's', type: 'temp' })).toBe('temp:s:a.png')
  })
})

describe('graphRuns', () => {
  it('createGraphRun inserts a pending row', async () => {
    query.mockResolvedValue({ rows: [] })
    await createGraphRun({ promptId: 'p1', userId: 'u1', credits: 7, holdId: 42 })
    const [sql, params] = query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO graph_runs/i)
    expect(params).toEqual(['p1', 'u1', 7, 42])
  })

  it('resolveGraphRun records state and outputs', async () => {
    query.mockResolvedValue({ rows: [] })
    await resolveGraphRun('p1', 'settled', ['output::a.png'])
    const [sql, params] = query.mock.calls[0]
    expect(sql).toMatch(/UPDATE graph_runs/i)
    expect(params[0]).toBe('settled')
    expect(JSON.parse(params[1])).toEqual(['output::a.png'])
    expect(params[2]).toBe('p1')
  })

  it('ownsPrompt is true only when a row matches both ids', async () => {
    query.mockResolvedValueOnce({ rows: [{ ok: 1 }] })
    expect(await ownsPrompt('u1', 'p1')).toBe(true)
    query.mockResolvedValueOnce({ rows: [] })
    expect(await ownsPrompt('u1', 'p2')).toBe(false)
  })

  it('ownedOutputKeys unions outputs across rows', async () => {
    query.mockResolvedValue({ rows: [{ outputs: ['output::a.png'] }, { outputs: ['output::b.png', 'temp::c.png'] }] })
    const keys = await ownedOutputKeys('u1')
    expect(keys).toEqual(new Set(['output::a.png', 'output::b.png', 'temp::c.png']))
  })

  it('pendingRuns returns only pending rows for the user', async () => {
    query.mockResolvedValue({ rows: [{ prompt_id: 'p1', hold_id: 42, credits: 7 }] })
    const runs = await pendingRuns('u1')
    expect(runs).toEqual([{ promptId: 'p1', holdId: 42, credits: 7 }])
    expect(query.mock.calls[0][0]).toMatch(/state = 'pending'/)
  })
})
```

- [ ] **Step 3: Run to verify it fails** — `cd frontend && npx vitest run tests/unit/graph-runs.unit.spec.ts` → FAIL (module not found).

- [ ] **Step 4: Implement `server/utils/graphRuns.ts`**

```ts
/**
 * Durable prompt_id → owner registry for metered canvas runs (Stage 5).
 * Replaces the in-memory meterStore so ownership and settlement state
 * survive a server restart. Uses its OWN pg session (connectLedgerDb) —
 * never the ledger's shared session, so no withLock coupling.
 */
import { connectLedgerDb, type LedgerDbHandle } from './ledgerDb'

type DbLike = { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }

let dbOverride: DbLike | null = null
let shared: LedgerDbHandle | null = null

export function __setGraphRunsDbForTests(db: DbLike | null): void { dbOverride = db }

function db(): DbLike {
  if (dbOverride) return dbOverride
  if (!shared) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('graphRuns: DATABASE_URL not set — hosted mode requires it')
    shared = connectLedgerDb(url)
  }
  return shared
}

export function outputKey(o: { filename: string; subfolder?: string; type?: string }): string {
  return `${o.type || 'output'}:${o.subfolder || ''}:${o.filename}`
}

export async function createGraphRun(r: { promptId: string; userId: string; credits: number; holdId: number | null }): Promise<void> {
  await db().query(
    `INSERT INTO graph_runs (prompt_id, user_id, credits, hold_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (prompt_id) DO NOTHING`,
    [r.promptId, r.userId, r.credits, r.holdId])
}

export async function resolveGraphRun(promptId: string, state: 'settled' | 'voided', outputs: string[] = []): Promise<void> {
  await db().query(
    `UPDATE graph_runs SET state = $1, outputs = $2::jsonb WHERE prompt_id = $3`,
    [state, JSON.stringify(outputs), promptId])
}

export async function ownsPrompt(userId: string, promptId: string): Promise<boolean> {
  const { rows } = await db().query(
    `SELECT 1 AS ok FROM graph_runs WHERE user_id = $1 AND prompt_id = $2`, [userId, promptId])
  return rows.length > 0
}

export async function ownedPromptIds(userId: string): Promise<Set<string>> {
  const { rows } = await db().query(
    `SELECT prompt_id FROM graph_runs WHERE user_id = $1`, [userId])
  return new Set(rows.map(r => String(r.prompt_id)))
}

export async function ownedOutputKeys(userId: string): Promise<Set<string>> {
  const { rows } = await db().query(
    `SELECT outputs FROM graph_runs WHERE user_id = $1`, [userId])
  const out = new Set<string>()
  for (const r of rows) for (const k of (r.outputs ?? [])) out.add(String(k))
  return out
}

export async function pendingRuns(userId: string): Promise<{ promptId: string; holdId: number | null; credits: number }[]> {
  const { rows } = await db().query(
    `SELECT prompt_id, hold_id, credits FROM graph_runs WHERE user_id = $1 AND state = 'pending'`, [userId])
  return rows.map(r => ({ promptId: String(r.prompt_id), holdId: r.hold_id == null ? null : Number(r.hold_id), credits: Number(r.credits) }))
}
```

Check `ledgerDb.ts`'s actual `LedgerDbHandle` shape first and adapt the import/typing if `connectLedgerDb` needs different call arguments.

- [ ] **Step 5: Run tests to verify they pass**, then apply the schema to Neon:

```bash
cd frontend && DATABASE_URL=$(grep '^DATABASE_URL=' .env.hosted | cut -d= -f2-) node --input-type=module -e "
import pg from 'pg'; import { readFileSync } from 'node:fs';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
await c.query(readFileSync('server/db/schema.sql', 'utf8'));
const { rows } = await c.query(\"SELECT to_regclass('graph_runs') AS t\");
console.log('graph_runs exists:', rows[0].t !== null);
await c.end();
"
```

Expected: `graph_runs exists: true`. (Use the DIRECT `DATABASE_URL`, not the pooled one.)

- [ ] **Step 6: Commit** — `git add frontend/server/db/schema.sql frontend/server/utils/graphRuns.ts frontend/tests/unit/graph-runs.unit.spec.ts && git commit -m "feat(stage5): durable graph_runs ownership registry"`

---

### Task 2: Hold-based provider tickets (fixes the no-hold parallel-preflight leak) + stale-hold sweep

**Files:**
- Modify: `frontend/server/utils/requestMeter.ts` (preflight core + `LedgerLike` + `MeterTicket`)
- Modify: `frontend/server/utils/replicate.ts`, `frontend/server/utils/falRun.ts` (release on failure)
- Create: `frontend/server/utils/holdSweep.ts`, `frontend/server/plugins/holdSweep.ts`
- Test: `frontend/tests/unit/request-meter.unit.spec.ts` (extend), `frontend/tests/unit/hold-sweep.unit.spec.ts`

**Interfaces:**
- Consumes: `ledger.hold(userId, estimate, idempotencyKey)` → `{ok: true, holdId} | {ok: false, reason: 'insufficient'}`; `ledger.settle(holdId, actual, reason)`; `ledger.release(holdId)` (all exist in `ledger.ts`).
- Produces: `MeterTicket` becomes `{ settle(jobId: string): Promise<void>; release(): Promise<void> }`. `LedgerLike` gains `hold`, `settleHold` (maps to `ledger.settle`), `releaseHold` (maps to `ledger.release`). Task 3 uses `ledger.hold`/`settle`/`release` directly, not through this.

- [ ] **Step 1: Extend the failing tests in `request-meter.unit.spec.ts`**

New cases (keep every existing case green — they pin the refusal semantics):
- preflight now calls `hold` (not just `getAvailable`); an `{ok: false}` hold → `MeterRefusalError` 402 whose `data.available` comes from `getAvailable`.
- Two sequential preflights against a fake ledger whose `hold` decrements a live `available` counter: first succeeds, second refuses when the estimate exceeds what remains — THE leak reproduction. (Write this as a broken-control: assert it FAILS against the old debit-only fake by construction — the old code path never called `hold`.)
- `ticket.settle(jobId)` calls `settleHold(holdId, credits, reason)` where reason is `` `provider:${model}` `` and logs loudly when `settled: false` comes back (hold was already released — output shipped uncharged).
- `ticket.release()` calls `releaseHold(holdId)` and swallows+logs errors (release must never crash a failure path).
- Local mode still returns `null` and touches NOTHING (existing test).

```ts
it('parallel preflights cannot overshoot one balance (hold-based)', async () => {
  let reserved = 0
  const available = 10
  __setLedgerForTests({
    getAvailable: async () => available - reserved,
    hold: async (_u: string, estimate: number) => {
      if (estimate > available - reserved) return { ok: false as const, reason: 'insufficient' as const }
      reserved += estimate
      return { ok: true as const, holdId: ++holdSeq }
    },
    settleHold: async () => ({ ok: true, balance: 0, settled: true }),
    releaseHold: async () => {},
    debit: async () => ({ ok: true }),
  })
  await preflightMeterFor('u1', 'black-forest-labs/flux-dev')   // 5cr — ok
  await preflightMeterFor('u1', 'black-forest-labs/flux-dev')   // 5cr — ok, reserved=10
  await expect(preflightMeterFor('u1', 'black-forest-labs/flux-dev'))
    .rejects.toMatchObject({ statusCode: 402 })
})
```

- [ ] **Step 2: Run to verify the new cases fail** — the old preflight never calls `hold`.

- [ ] **Step 3: Implement in `requestMeter.ts`**

```ts
import { randomUUID } from 'node:crypto'

export interface MeterTicket {
  settle(jobId: string): Promise<void>
  release(): Promise<void>
}

export type LedgerLike = {
  getAvailable(userId: string): Promise<number>
  hold(userId: string, estimate: number, idempotencyKey: string): Promise<{ ok: true; holdId: number } | { ok: false; reason: 'insufficient' }>
  settleHold(holdId: number, actual: number, reason: string): Promise<{ ok: true; balance: number; settled: boolean }>
  releaseHold(holdId: number): Promise<void>
  debit(userId: string, amount: number, reason: string, idempotencyKey: string): Promise<{ ok: boolean }>
}
```

`getLedger()` wraps `getLiveLedger()` so `settleHold`/`releaseHold` map onto the real ledger's `settle`/`release` (adapter in `ledgerLive.ts` or inline in `getLedger` — implementer's choice, but the test seam `__setLedgerForTests` takes the `LedgerLike` shape above). In `preflightForUser`:

```ts
  const ledger = getLedger()
  const res = await ledger.hold(userId, credits, `meter:${randomUUID()}`)
  if (!res.ok) {
    const available = await ledger.getAvailable(userId)
    throw new MeterRefusalError('insufficient credits', 402, { required: credits, available })
  }
  const holdId = res.holdId
  return {
    async settle(jobId: string): Promise<void> {
      try {
        const r = await ledger.settleHold(holdId, credits, `provider:${model}`)
        if (!r.settled) console.error('[meter] SETTLE ON RELEASED HOLD — output shipped uncharged', { userId, model, credits, jobId, holdId })
      } catch (e) {
        console.error('[meter] SETTLE FAILED after successful job', { userId, model, credits, jobId, holdId, error: e })
      }
    },
    async release(): Promise<void> {
      try { await ledger.releaseHold(holdId) }
      catch (e) { console.error('[meter] HOLD RELEASE FAILED', { userId, model, holdId, error: e }) }
    },
  }
```

- [ ] **Step 4: Wire `release()` into the chokepoints.** In `replicate.ts` and `falRun.ts`, find every path where a ticket was obtained but the job did NOT confirm success (submit threw, provider returned failure status, polling gave up) and call `await ticket.release()` there. Read each file's flow first; the pattern is `catch (e) { await ticket?.release(); throw e }` plus release on explicit failed-status branches. Also update `chokepoint-meter.unit.spec.ts` and `bypass-route-meter.unit.spec.ts` fakes to the new `LedgerLike` shape, and add one case per chokepoint: submit failure ⇒ `releaseHold` called, no settle. `settleModel`/`anthropicMeter`/`trainingProviders` keep their debit-only paths — leave `debit` in `LedgerLike`.

- [ ] **Step 5: Stale-hold sweep.** `server/utils/holdSweep.ts`:

```ts
/**
 * Releases holds stuck open past a TTL — a crashed process between hold and
 * settle/release would otherwise lock those credits forever. Runs on the
 * ledger's shared session: the SELECT is a read (safe outside the mutex) and
 * release() itself is mutex-protected by the ledgerderivative.
 */
import { getLiveLedger } from './ledgerLive'
import { getSharedLedgerDb } from './ledgerDb'

export const HOLD_TTL_MS = 2 * 60 * 60 * 1000   // 2h — longest legit job ≪ this

export async function sweepStaleHolds(now = new Date()): Promise<number> {
  const db = getSharedLedgerDb()
  const cutoff = new Date(now.getTime() - HOLD_TTL_MS)
  const { rows } = await db.query(
    `SELECT id FROM holds WHERE state = 'open' AND created_at < $1`, [cutoff])
  const ledger = getLiveLedger()
  let released = 0
  for (const r of rows) {
    try { await ledger.release(Number(r.id)); released++ }
    catch (e) { console.error('[holdSweep] release failed', { holdId: r.id, error: e }) }
  }
  if (released > 0) console.warn(`[holdSweep] released ${released} stale hold(s)`)
  return released
}
```

`server/plugins/holdSweep.ts`: hosted-only `setInterval(sweepStaleHolds, 15 * 60_000)` plus one run 60s after boot; guard with `if (deployMode() !== 'hosted') return`. Unit-test `sweepStaleHolds` with injected fakes (module seam `__setSweepDepsForTests` or export a `sweepStaleHoldsWith(deps)` core that the plugin wraps — match the DI style of `settleWatcher.ts`).

- [ ] **Step 6: Run the full meter suite** — `cd frontend && npx vitest run tests/unit/request-meter.unit.spec.ts tests/unit/chokepoint-meter.unit.spec.ts tests/unit/bypass-route-meter.unit.spec.ts tests/unit/hold-sweep.unit.spec.ts tests/unit/training-meter.unit.spec.ts tests/unit/anthropic-meter.unit.spec.ts` → all PASS.

- [ ] **Step 7: Commit** — `feat(stage5): hold-based provider metering + stale-hold sweep — closes the parallel-preflight leak`

---

### Task 3: Graph price book — model-aware, 62-class coverage, fail-closed

**Files:**
- Modify: `frontend/server/utils/priceBook.ts`
- Test: `frontend/tests/unit/price-graph.unit.spec.ts` (new), extend `frontend/tests/unit/meter-prompt.unit.spec.ts` only if it imports `priceGraph` directly
- Read-only reference: `comfy_api_nodes/nodes_replicate.py`, `frontend/app/data/image-models.ts` (do NOT modify — a parallel session owns pending edits in the Python file)

**Interfaces:**
- Produces: `priceGraph(prompt)` keeps its `GraphPrice` return shape but now **throws** `UnpricedGraphError` (exported, carries `classType`) for any provider node class it cannot price. New export `PROVIDER_NODE_EXEMPT: Record<string, string>` (class → reason) for classes that are free by design.

- [ ] **Step 1: Build the class inventory.** Enumerate provider classes mechanically:

```bash
grep -oE 'class [A-Za-z0-9_]+\(IO\.ComfyNode\)' ../comfy_api_nodes/nodes_replicate.py | sed 's/class //;s/(.*//'
```

(62 classes as of this writing.) For each class, read its `execute` body in `nodes_replicate.py` to find the provider slug it dispatches (`replicate_slug`, `fal_slug`, or a hardcoded model string), then price it:
1. Slug already in `MODEL_COSTS` → use that `credits` value.
2. Slug not booked → find the provider's live list price, compute credits with the pricing policy (2× markup ≤ $0.10, 1.5× above, 1cr floor, integer), and add the slug to `MODEL_COSTS` with `confidence: 'estimate'` so the pre-launch re-verification sweep catches it.
3. Model chosen at runtime by a widget (`GenerateImageNode`, and check `GenerateVideoNode`/`EditImageNode`/`UpscaleImageNode` for the same pattern) → price by the widget value (Step 3).
4. Genuinely free (no provider call — verify by reading the execute body, not the name) → add to `PROVIDER_NODE_EXEMPT` with a one-line reason.

Nothing may be left out: the coverage guard in Step 2 fails on any unclassified class.

- [ ] **Step 2: Write the coverage-guard test FIRST (Stage 4's pattern)**

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  priceGraph, UnpricedGraphError, GRAPH_NODE_CREDITS,
  MODEL_PRICED_NODE_CLASSES, PROVIDER_NODE_EXEMPT,
} from '../../server/utils/priceBook'

const PY = readFileSync(join(__dirname, '../../../comfy_api_nodes/nodes_replicate.py'), 'utf8')
const PROVIDER_CLASSES = [...PY.matchAll(/class ([A-Za-z0-9_]+)\(IO\.ComfyNode\)/g)].map(m => m[1])

describe('graph price book coverage', () => {
  it('finds a plausible number of provider classes (grep is not broken)', () => {
    expect(PROVIDER_CLASSES.length).toBeGreaterThan(40)
  })

  it('every provider node class is priced, model-priced, or exempt with a reason', () => {
    const unclassified = PROVIDER_CLASSES.filter(c =>
      !(c in GRAPH_NODE_CREDITS)
      && !MODEL_PRICED_NODE_CLASSES.includes(c)
      && !(c in PROVIDER_NODE_EXEMPT))
    expect(unclassified).toEqual([])
  })

  it('an unknown provider-looking class refuses instead of pricing at base', () => {
    const prompt = {
      '1': { class_type: PROVIDER_CLASSES[0], inputs: {} },
      '2': { class_type: 'SaveImage', inputs: {} },
    }
    // control: the FIRST provider class must price or throw — never fall through silently
    let threw = false; let priced = 0
    try { priced = priceGraph(prompt).credits } catch (e) { threw = e instanceof UnpricedGraphError }
    expect(threw || priced > 1).toBe(true)
  })
})

describe('model-aware pricing', () => {
  it('GenerateImageNode prices by its model widget', () => {
    const cheap = priceGraph({ '1': { class_type: 'GenerateImageNode', inputs: { model: 'flux-schnell' } }, '2': { class_type: 'SaveImage', inputs: {} } })
    const rich = priceGraph({ '1': { class_type: 'GenerateImageNode', inputs: { model: 'flux-2-pro' } }, '2': { class_type: 'SaveImage', inputs: {} } })
    expect(rich.credits).toBeGreaterThan(cheap.credits)
    expect(cheap.credits).toBeGreaterThanOrEqual(2) // base_render 1 + at least 1cr floor for the model
  })

  it('GenerateImageNode with an unknown model REFUSES', () => {
    expect(() => priceGraph({ '1': { class_type: 'GenerateImageNode', inputs: { model: 'not-a-model' } } }))
      .toThrow(UnpricedGraphError)
  })

  it('a model with pricePerImage null REFUSES rather than underpricing', () => {
    // pick an id from image-models.ts with pricePerImage: null at implement time
    expect(() => priceGraph({ '1': { class_type: 'GenerateImageNode', inputs: { model: '<null-price-id>' } } }))
      .toThrow(UnpricedGraphError)
  })
})
```

Adjust the model-id fixtures to real ids from `image-models.ts` while implementing. **Note the exact test-file relative path to the Python file** — verify with `ls` from the test's directory before assuming.

- [ ] **Step 3: Run to verify it fails**, then implement in `priceBook.ts`:

```ts
export class UnpricedGraphError extends Error {
  classType: string
  constructor(classType: string, detail?: string) {
    super(`unpriced graph node refused: ${classType}${detail ? ` (${detail})` : ''}`)
    this.classType = classType
  }
}

// Flat per-class credits — every provider class that always costs the same.
// Derived from each class's execute() slug joined against MODEL_COSTS or a
// live rate card (confidence noted in MODEL_COSTS). Coverage guard in
// price-graph.unit.spec.ts forces this + MODEL_PRICED + EXEMPT to cover
// every IO.ComfyNode class in nodes_replicate.py.
export const GRAPH_NODE_CREDITS: Record<string, number> = {
  // start from PREMIUM_ACTION_CREDITS's 9 rows — keep those values — then
  // add every remaining flat-priced class from the Task-3 Step-1 inventory
}

// Classes whose price depends on a model widget in inputs.
export const MODEL_PRICED_NODE_CLASSES = ['GenerateImageNode']  // + others found in Step 1

// Classes that are free by design — reason string is documentation.
export const PROVIDER_NODE_EXEMPT: Record<string, string> = {}

function imageGenCredits(modelId: unknown): number {
  // Lazy import guard (eager-module-const init-order gotcha): resolve the
  // catalog inside the call, not at module top level.
  const { IMAGE_MODELS } = require('../../app/data/image-models') // adjust to the file's real export — use a static `import` if Nitro bundles it cleanly (verify: the file must stay Vue-free)
  const m = IMAGE_MODELS.find((x: any) => x.id === modelId)
  if (!m) throw new UnpricedGraphError('GenerateImageNode', `unknown model id ${String(modelId)}`)
  if (m.pricePerImage == null) throw new UnpricedGraphError('GenerateImageNode', `model ${m.id} has no listed price`)
  return creditsForUsdServer(m.pricePerImage)
}

// Server copy of the pricing policy (mirror of app/lib/pricing.ts creditsForUsd —
// duplicated on purpose: server/ must not depend on app/lib for money math).
export function creditsForUsdServer(usd: number): number {
  const marked = usd <= 0.10 ? usd * 2 : usd * 1.5
  return Math.max(1, Math.round(marked * 100))
}
```

`priceGraph` gains, inside its node loop:

```ts
    if (MODEL_PRICED_NODE_CLASSES.includes(ct)) {
      breakdown.push({ action: `${ct}:${String((prompt[id] as any)?.inputs?.model ?? '?')}`, credits: graphNodeModelCredits(ct, (prompt[id] as any)?.inputs) })
      continue
    }
    const flat = GRAPH_NODE_CREDITS[ct]
    if (flat) { breakdown.push({ action: ct, credits: flat }); continue }
    if (PROVIDER_CLASS_SET_HAS(ct) && !(ct in PROVIDER_NODE_EXEMPT)) throw new UnpricedGraphError(ct)
```

Where `PROVIDER_CLASS_SET_HAS` needs a runtime list of provider classes. **Do not read the Python file at runtime** — export `PROVIDER_NODE_CLASSES: string[]` as a checked-in literal list in `priceBook.ts`, and add a guard assertion in the spec that the literal equals the grep of the Python file (so drift fails tests, not production). Check the model-widget value semantics for each `MODEL_PRICED` class you add (e.g. `EditImageNode` may carry a full slug, not a catalog id — price via `MODEL_COSTS`/`resolveCredits` for those).

Before importing `image-models.ts` from server code, verify it has no Vue/browser imports (`head -30 app/data/image-models.ts`); if it does, extract the `{id, pricePerImage}` pairs into `server/utils/imageModelPrices.ts` as a literal map with a unit test asserting parity against the TS catalog file (same read-and-compare trick as the Python guard).

Keep `PREMIUM_ACTION_CREDITS` values as the seed rows of `GRAPH_NODE_CREDITS` and delete the old constant (grep for other importers first; `priceGraph` was its only consumer at planning time).

- [ ] **Step 4: Run the suite** — new spec green, plus `meter-prompt.unit.spec.ts` (its fixtures may need class names that still price).

- [ ] **Step 5: Commit** — `feat(stage5): model-aware graph price book with 62-class coverage guard`

---

### Task 4: Metered `/prompt` interception (hosted) — hold → forward → settle, verbatim passthrough

**Files:**
- Create: `frontend/server/utils/meterGraphRun.ts`
- Modify: `frontend/server/middleware/comfyui-proxy.ts` (hosted intercept), `frontend/server/utils/meterPrompt.ts` (delete), `frontend/server/utils/meterStore.ts` (delete), `frontend/server/api/meter/prompt.post.ts` (delete)
- Test: `frontend/tests/unit/meter-graph-run.unit.spec.ts` (new; port the still-relevant invariants from `meter-prompt.unit.spec.ts` + `meter-store.unit.spec.ts`, then delete those two specs)

**Interfaces:**
- Consumes: `priceGraph`/`UnpricedGraphError` (Task 3), `createGraphRun`/`resolveGraphRun`/`outputKey` (Task 1), `getLiveLedger().hold/settle/release`, `settleOnCompletion` (`settleWatcher.ts`, unchanged), `stripForeignComfyOrgCreds` (`spikeAuth.ts`), `resolveWorkerTarget` (`workerRoute.ts`), `MeterRefusalError` (`requestMeter.ts`).
- Produces: `meterGraphSubmit(userId, body, deps): Promise<{status: number; body: any}>` (pure core) and `handleMeteredPrompt(event): Promise<any>` (h3 adapter). `isPromptPath(path: string): boolean`.

- [ ] **Step 1: Write the failing tests** for the pure core (`meter-graph-run.unit.spec.ts`), DI-style like the old `meter-prompt.unit.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { meterGraphSubmit, isPromptPath } from '../../server/utils/meterGraphRun'
import { MeterRefusalError } from '../../server/utils/requestMeter'
import { UnpricedGraphError } from '../../server/utils/priceBook'

function deps(overrides: Partial<any> = {}) {
  return {
    priceGraph: vi.fn(() => ({ credits: 5, version: 'test-v1', breakdown: [] })),
    hold: vi.fn(async () => ({ ok: true as const, holdId: 7 })),
    getAvailable: vi.fn(async () => 3),
    forward: vi.fn(async () => ({ status: 200, body: { prompt_id: 'p1', number: 1, node_errors: {} } })),
    registerRun: vi.fn(async () => {}),
    startSettle: vi.fn(),
    releaseHold: vi.fn(async () => {}),
    ...overrides,
  }
}
const BODY = { prompt: { '1': { class_type: 'SaveImage', inputs: {} } }, client_id: 'c1' }

describe('meterGraphSubmit', () => {
  it('refuses without a user (401)', async () => {
    await expect(meterGraphSubmit(null, BODY, deps())).rejects.toMatchObject({ statusCode: 401 })
  })

  it('holds before forwarding and returns ComfyUI body verbatim', async () => {
    const d = deps()
    const res = await meterGraphSubmit('u1', BODY, d)
    expect(d.hold).toHaveBeenCalledWith('u1', 5)
    expect(d.hold.mock.invocationCallOrder[0]).toBeLessThan(d.forward.mock.invocationCallOrder[0])
    expect(res).toEqual({ status: 200, body: { prompt_id: 'p1', number: 1, node_errors: {} } })
    expect(d.registerRun).toHaveBeenCalledWith({ promptId: 'p1', userId: 'u1', credits: 5, holdId: 7 })
    expect(d.startSettle).toHaveBeenCalledWith({ promptId: 'p1', holdId: 7, credits: 5 })
  })

  it('insufficient hold → 402 carrying required/available, engine never touched', async () => {
    const d = deps({ hold: vi.fn(async () => ({ ok: false as const, reason: 'insufficient' as const })) })
    await expect(meterGraphSubmit('u1', BODY, d)).rejects.toMatchObject({
      statusCode: 402, data: { required: 5, available: 3 },
    })
    expect(d.forward).not.toHaveBeenCalled()
  })

  it('UnpricedGraphError → 500 refusal, engine never touched', async () => {
    const d = deps({ priceGraph: vi.fn(() => { throw new UnpricedGraphError('MysteryNode') }) })
    await expect(meterGraphSubmit('u1', BODY, d)).rejects.toBeInstanceOf(MeterRefusalError)
    expect(d.forward).not.toHaveBeenCalled()
  })

  it('ComfyUI 400 (validation) → hold released, error body passed through verbatim', async () => {
    const errBody = { error: { message: 'bad' }, node_errors: { '1': {} } }
    const d = deps({ forward: vi.fn(async () => ({ status: 400, body: errBody })) })
    const res = await meterGraphSubmit('u1', BODY, d)
    expect(res).toEqual({ status: 400, body: errBody })
    expect(d.releaseHold).toHaveBeenCalledWith(7)
    expect(d.registerRun).not.toHaveBeenCalled()
  })

  it('zero-credit graph skips the hold but still registers ownership', async () => {
    const d = deps({ priceGraph: vi.fn(() => ({ credits: 0, version: 'test-v1', breakdown: [] })) })
    await meterGraphSubmit('u1', BODY, d)
    expect(d.hold).not.toHaveBeenCalled()
    expect(d.registerRun).toHaveBeenCalledWith({ promptId: 'p1', userId: 'u1', credits: 0, holdId: null })
  })
})

describe('isPromptPath', () => {
  it('matches /prompt and /prompt?comfyWorker=2, not /prompted', () => {
    expect(isPromptPath('/prompt')).toBe(true)
    expect(isPromptPath('/prompt?comfyWorker=2')).toBe(true)
    expect(isPromptPath('/prompted')).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**, then implement `meterGraphRun.ts`:

```ts
/**
 * Stage 5: the metered graph submission path. In hosted mode the comfyui-proxy
 * middleware routes POST /prompt here instead of raw-proxying. Invariants:
 * (1) hold BEFORE forward — an underfunded run never reaches the engine;
 * (2) ComfyUI's response body passes through VERBATIM (clients parse
 *     prompt_id / node_errors from the real shape);
 * (3) settlement is watcher-driven: settle the hold + record output filenames
 *     on success, release the hold on error/timeout. Refusals cost nothing.
 */
import type { H3Event } from 'h3'
import { priceGraph, UnpricedGraphError } from './priceBook'
import { MeterRefusalError } from './requestMeter'
import { createGraphRun, resolveGraphRun, outputKey } from './graphRuns'
import { settleOnCompletion } from './settleWatcher'
import { stripForeignComfyOrgCreds } from './spikeAuth'
import { resolveWorkerTarget } from './workerRoute'
import { getLiveLedger } from './ledgerLive'

export function isPromptPath(path: string): boolean {
  return path === '/prompt' || path.startsWith('/prompt?')
}

export interface GraphRunDeps {
  priceGraph: typeof priceGraph
  hold(userId: string, credits: number): Promise<{ ok: true; holdId: number } | { ok: false; reason: 'insufficient' }>
  getAvailable(userId: string): Promise<number>
  forward(body: any): Promise<{ status: number; body: any }>
  registerRun(r: { promptId: string; userId: string; credits: number; holdId: number | null }): Promise<void>
  startSettle(r: { promptId: string; holdId: number | null; credits: number }): void
  releaseHold(holdId: number): Promise<void>
}

export async function meterGraphSubmit(userId: string | null, body: any, deps: GraphRunDeps): Promise<{ status: number; body: any }> {
  if (!userId) throw new MeterRefusalError('Sign in to run graphs', 401)
  if (!body || typeof body.prompt !== 'object' || body.prompt === null) {
    throw new MeterRefusalError('Missing prompt graph', 400)
  }

  let price
  try {
    price = deps.priceGraph(body.prompt)
  } catch (e) {
    if (e instanceof UnpricedGraphError) throw new MeterRefusalError(e.message, 500)
    throw e
  }

  let holdId: number | null = null
  if (price.credits > 0) {
    const res = await deps.hold(userId, price.credits)
    if (!res.ok) {
      const available = await deps.getAvailable(userId)
      throw new MeterRefusalError('Not enough credits', 402, { required: price.credits, available })
    }
    holdId = res.holdId
  }

  const fwd = await deps.forward(body)
  const promptId: string | undefined = fwd.body?.prompt_id
  if (fwd.status !== 200 || !promptId) {
    if (holdId !== null) await deps.releaseHold(holdId)
    return fwd   // verbatim — clients parse node_errors from this exact shape
  }

  await deps.registerRun({ promptId, userId, credits: price.credits, holdId })
  deps.startSettle({ promptId, holdId, credits: price.credits })
  return fwd
}
```

The h3 adapter wires real deps (same file):

```ts
export async function handleMeteredPrompt(event: H3Event): Promise<any> {
  const userId = event.context.userId ?? null
  const body = await readBody(event)
  const { port } = resolveWorkerTarget(event.path)
  const target = `http://127.0.0.1:${port}`
  const ledger = getLiveLedger()

  const result = await meterGraphSubmit(userId, body, {
    priceGraph,
    hold: async (u, credits) => {
      const r = await ledger.hold(u, credits, `graph:${crypto.randomUUID()}`)
      return r.ok ? { ok: true, holdId: r.holdId } : { ok: false, reason: 'insufficient' }
    },
    getAvailable: u => ledger.getAvailable(u),
    forward: async (b) => {
      const safe = { ...b, extra_data: stripForeignComfyOrgCreds(b?.extra_data, null) }
      const res = await fetch(`${target}/prompt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: target },
        body: JSON.stringify(safe),
      })
      return { status: res.status, body: await res.json().catch(() => ({})) }
    },
    registerRun: createGraphRun,
    startSettle: ({ promptId, holdId, credits }) => {
      void settleOnCompletion({
        promptId,
        pollHistory: async (id) => {
          const r = await fetch(`${target}/history/${id}`)
          if (!r.ok) return null
          const hist = await r.json() as Record<string, any>
          return hist[id] ?? null
        },
        onSuccess: (id) => { void settleGraphSuccess(target, id, holdId, credits) },
        onError: (id) => {
          void (async () => {
            if (holdId !== null) await ledger.release(holdId).catch(e => console.error('[graphMeter] release failed', { id, holdId, e }))
            await resolveGraphRun(id, 'voided').catch(() => {})
          })()
        },
      })
    },
    releaseHold: id => ledger.release(id),
  })

  setResponseStatus(event, result.status)
  return result.body
}

async function settleGraphSuccess(target: string, promptId: string, holdId: number | null, credits: number): Promise<void> {
  const outputs: string[] = []
  try {
    const r = await fetch(`${target}/history/${promptId}`)
    if (r.ok) {
      const hist = await r.json() as Record<string, any>
      const nodeOutputs = hist[promptId]?.outputs ?? {}
      for (const node of Object.values(nodeOutputs) as any[]) {
        for (const arr of [node?.images, node?.gifs, node?.videos, node?.audio]) {
          if (!Array.isArray(arr)) continue
          for (const f of arr) if (f?.filename) outputs.push(outputKey(f))
        }
      }
    }
  } catch (e) { console.error('[graphMeter] output harvest failed', { promptId, e }) }

  if (holdId !== null) {
    try {
      const s = await getLiveLedger().settle(holdId, credits, `graph:${promptId}`)
      if (!s.settled) console.error('[graphMeter] SETTLE ON RELEASED HOLD — run shipped uncharged', { promptId, holdId, credits })
    } catch (e) {
      console.error('[graphMeter] SETTLE FAILED after successful run', { promptId, holdId, credits, e })
    }
  }
  await resolveGraphRun(promptId, 'settled', outputs).catch(e => console.error('[graphMeter] resolve failed', { promptId, e }))
}
```

Check `getLiveLedger()`'s real return type for `hold/settle/release` naming and adapt. `crypto.randomUUID()` — import from `node:crypto`.

- [ ] **Step 3: Intercept in `comfyui-proxy.ts`.** Add before the `PROXY_PREFIXES` loop:

```ts
import { deployMode } from '../utils/deployMode'
import { isPromptPath, handleMeteredPrompt } from '../utils/meterGraphRun'
```

```ts
  // Stage 5: hosted graph submissions are METERED — never raw-proxied. Local
  // mode falls through to the raw proxy below, byte-identical to pre-Stage-5.
  if (isPromptPath(path) && event.method === 'POST' && deployMode() === 'hosted') {
    return handleMeteredPrompt(event)
  }
```

- [ ] **Step 4: Delete the dead spike surface.** Remove `server/api/meter/prompt.post.ts`, `server/utils/meterPrompt.ts`, `server/utils/meterStore.ts`, `tests/unit/meter-prompt.unit.spec.ts`, `tests/unit/meter-store.unit.spec.ts`. Grep first: `grep -rn "meterPrompt\|meterStore\|buildLedgerAdapters" server/ tests/` — if `meterWiring.ts`/`mockLedger` are now orphaned too, delete them and their specs; if anything else imports them, leave those files and note why in the commit message.

- [ ] **Step 5: Run** `cd frontend && npx vitest run tests/unit/meter-graph-run.unit.spec.ts` and the whole `tests/unit` meter family; then boot a local dev server and confirm no Nitro resolve warnings (the deleted files must not be referenced anywhere).

- [ ] **Step 6: Commit** — `feat(stage5): hosted /prompt interception — hold, forward verbatim, settle on completion`

---

### Task 5: Ownership gating — `/history`, `/view`, `/queue`, `/interrupt`

**Files:**
- Create: `frontend/server/utils/engineGate.ts`
- Modify: `frontend/server/middleware/comfyui-proxy.ts` (hosted `/queue` + `/interrupt` gates), `frontend/server/routes/history/index.get.ts`, `frontend/server/routes/history/[promptId].get.ts`, `frontend/server/routes/view.get.ts`
- Test: `frontend/tests/unit/engine-gate.unit.spec.ts`

**Interfaces:**
- Consumes: `ownsPrompt`, `ownedPromptIds`, `ownedOutputKeys`, `pendingRuns`, `outputKey` (Task 1); `resolveWorkerTarget`; `deployMode`.
- Produces: pure functions `filterQueuePayload(queue: any, owned: Set<string>): any` and `filterHistoryPayload(hist: Record<string, any>, owned: Set<string>): Record<string, any>`; h3 helpers `handleHostedQueueGet(event)`, `handleHostedInterrupt(event)`.

- [ ] **Step 1: Write the failing tests** for the pure filters:

```ts
import { describe, it, expect } from 'vitest'
import { filterQueuePayload, filterHistoryPayload } from '../../server/utils/engineGate'

// ComfyUI queue entries are tuples: [number, prompt_id, prompt, extra_data, outputs_to_execute]
const q = (id: string) => [1, id, {}, {}, []]

describe('filterQueuePayload', () => {
  it('keeps only owned entries in running and pending', () => {
    const out = filterQueuePayload(
      { queue_running: [q('mine')], queue_pending: [q('mine2'), q('theirs')] },
      new Set(['mine', 'mine2']))
    expect(out.queue_running.map((e: any) => e[1])).toEqual(['mine'])
    expect(out.queue_pending.map((e: any) => e[1])).toEqual(['mine2'])
  })
  it('tolerates missing arrays', () => {
    expect(filterQueuePayload({}, new Set())).toEqual({ queue_running: [], queue_pending: [] })
  })
})

describe('filterHistoryPayload', () => {
  it('drops entries the user does not own', () => {
    const out = filterHistoryPayload({ a: { x: 1 }, b: { x: 2 } }, new Set(['b']))
    expect(Object.keys(out)).toEqual(['b'])
  })
})
```

- [ ] **Step 2: Run to verify failure, implement `engineGate.ts`:**

```ts
/**
 * Hosted tenant gates for shared-engine endpoints. Pure filters + thin h3
 * handlers. Local mode never reaches any of this (comfyui-proxy and the
 * history/view routes call these ONLY under deployMode() === 'hosted').
 */
import type { H3Event } from 'h3'
import { ownedPromptIds, ownsPrompt } from './graphRuns'
import { resolveWorkerTarget } from './workerRoute'

export function filterQueuePayload(queue: any, owned: Set<string>): any {
  const keep = (entries: any[]) => (Array.isArray(entries) ? entries : []).filter(e => owned.has(String(e?.[1])))
  return { ...queue, queue_running: keep(queue?.queue_running), queue_pending: keep(queue?.queue_pending) }
}

export function filterHistoryPayload(hist: Record<string, any>, owned: Set<string>): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [id, entry] of Object.entries(hist ?? {})) if (owned.has(id)) out[id] = entry
  return out
}

export async function handleHostedQueueGet(event: H3Event): Promise<any> {
  const userId = event.context.userId
  if (!userId) throw createError({ statusCode: 401, message: 'Sign in required' })
  const { port } = resolveWorkerTarget(event.path)
  const res = await fetch(`http://127.0.0.1:${port}/queue`)
  if (!res.ok) throw createError({ statusCode: 502, message: 'Engine queue unavailable' })
  return filterQueuePayload(await res.json(), await ownedPromptIds(userId))
}

export async function handleHostedInterrupt(event: H3Event): Promise<any> {
  const userId = event.context.userId
  if (!userId) throw createError({ statusCode: 401, message: 'Sign in required' })
  const { port } = resolveWorkerTarget(event.path)
  const target = `http://127.0.0.1:${port}`
  const qres = await fetch(`${target}/queue`)
  const queue = qres.ok ? await qres.json() : {}
  const running = Array.isArray(queue?.queue_running) ? queue.queue_running : []
  const runningId = running.length ? String(running[0]?.[1]) : null
  if (!runningId || !(await ownsPrompt(userId, runningId))) {
    throw createError({ statusCode: 403, message: 'No interruptible run of yours is active' })
  }
  const res = await fetch(`${target}/interrupt`, { method: 'POST', headers: { origin: target } })
  setResponseStatus(event, res.status)
  return null
}
```

- [ ] **Step 3: Wire the middleware.** In `comfyui-proxy.ts`, next to the Task-4 intercept:

```ts
  if (deployMode() === 'hosted') {
    if ((path === '/queue' || path.startsWith('/queue?')) && event.method === 'GET') return handleHostedQueueGet(event)
    if ((path === '/interrupt' || path.startsWith('/interrupt?')) && event.method === 'POST') return handleHostedInterrupt(event)
  }
```

(POST `/queue` — ComfyUI's clear/delete — stays raw-proxied in local and falls to raw proxy in hosted too; add `if (path === '/queue' && event.method === 'POST' && deployMode() === 'hosted') throw createError({statusCode: 403, message: 'Queue management is per-user in hosted mode'})` so one user cannot clear another's pending runs.)

- [ ] **Step 4: Gate the history routes.** Both routes: add at top

```ts
import { deployMode } from '../../utils/deployMode'
import { ownedPromptIds, ownsPrompt } from '../../utils/graphRuns'
import { filterHistoryPayload } from '../../utils/engineGate'
```

`history/index.get.ts` — hosted branch BEFORE any cache logic (the shared disk cache must be neither read nor written in hosted mode — it is cross-tenant by construction):

```ts
  if (deployMode() === 'hosted') {
    const userId = event.context.userId
    if (!userId) throw createError({ statusCode: 401, message: 'Sign in required' })
    try {
      const res = await fetch(`${COMFY_BACKEND}/history`)
      if (!res.ok) return {}
      return filterHistoryPayload(await res.json() as Record<string, any>, await ownedPromptIds(userId))
    } catch { return {} }
  }
```

(The handler needs `event` — change `defineEventHandler(async () => {` to `defineEventHandler(async (event) => {`.)

`history/[promptId].get.ts` — after extracting `promptId`:

```ts
  if (deployMode() === 'hosted') {
    const userId = event.context.userId
    if (!userId) throw createError({ statusCode: 401, message: 'Sign in required' })
    if (!(await ownsPrompt(userId, promptId))) throw createError({ statusCode: 404, message: 'Not found' })
    // Owned: fall through to the live fetch below, but skip the shared cache fallback in hosted.
  }
```

Then guard the cache-fallback block at the bottom with `if (deployMode() !== 'hosted')`.

- [ ] **Step 5: Gate `/view`.** In `view.get.ts`, after parsing `filename/type/subfolder`:

```ts
  if (deployMode() === 'hosted' && (type === 'output' || !query.type)) {
    const userId = event.context.userId
    if (!userId) throw createError({ statusCode: 401, message: 'Sign in required' })
    const key = outputKey({ filename, subfolder, type: 'output' })
    let owned = await ownedOutputKeys(userId)
    if (!owned.has(key)) {
      // Race window: the client saw the WS 'executed' event a beat before the
      // settle watcher recorded outputs. Harvest this user's pending runs once,
      // then re-check.
      await harvestPendingOutputs(userId)
      owned = await ownedOutputKeys(userId)
      if (!owned.has(key)) throw createError({ statusCode: 404, message: 'Image not found' })
    }
  }
```

`harvestPendingOutputs(userId)` lives in `engineGate.ts`: for each of `pendingRuns(userId)` (cap at 20), fetch `/history/{promptId}` from the main engine; if the entry shows success, run the same output-harvest + settle + `resolveGraphRun` logic as Task 4's `settleGraphSuccess` — **export `settleGraphSuccess(target, promptId, holdId, credits)` from `meterGraphRun.ts` and call it here** so there is exactly one settlement implementation. `type=temp` and `type=input` reads stay ungated in this stage (documented gap — see riders).

- [ ] **Step 6: Run tests + boot check.** `npx vitest run tests/unit/engine-gate.unit.spec.ts` green; boot local dev server, confirm `/history` and `/view` behave exactly as before in local mode (manual curl: `curl -s 127.0.0.1:3000/history | head -c 200`).

- [ ] **Step 7: Commit** — `feat(stage5): tenant gates for history/view/queue/interrupt`

---

### Task 6: Hosted client — force direct execution, drop engine iframes, credit badges

**Files:**
- Modify: `frontend/app/composables/useDirectExecutionEnabled.ts`, `frontend/app/layouts/default.vue`, `frontend/app/components/vue-canvas/ComfyNode.vue` (**parallel session has uncommitted hunks here — stage only your own**)
- Test: `frontend/tests/unit/direct-execution-enabled.unit.spec.ts` (extend or create), snapshot-free assertions only

**Interfaces:**
- Consumes: `hostedModeEnabled(cfg)` (`app/lib/hostedMode.ts`), `creditsForUsd` (`app/lib/pricing.ts`).
- Produces: `directExecutionResolved(stored: string | null, hosted: boolean): boolean` (pure, exported for tests).

- [ ] **Step 1: Failing test** for the pure resolver:

```ts
import { describe, it, expect } from 'vitest'
import { directExecutionResolved } from '../../app/composables/useDirectExecutionEnabled'

describe('directExecutionResolved', () => {
  it('hosted forces ON regardless of the stored setting', () => {
    expect(directExecutionResolved(null, true)).toBe(true)
    expect(directExecutionResolved('false', true)).toBe(true)
  })
  it('local keeps the default-OFF beta behavior', () => {
    expect(directExecutionResolved(null, false)).toBe(false)
    expect(directExecutionResolved('true', false)).toBe(true)
  })
})
```

- [ ] **Step 2: Implement.** In `useDirectExecutionEnabled.ts`:

```ts
export function directExecutionResolved(stored: string | null, hosted: boolean): boolean {
  return hosted || directExecutionDefault(stored)
}
```

Capture the hosted flag once inside the composable body (where Nuxt context exists) into a module-scope `let hostedForced = false`, set it before the first `load()`, and have `load()` use `directExecutionResolved(localStorage.getItem(STORAGE_KEY), hostedForced)`. The storage/custom-event listeners keep calling `load()` — they run outside Nuxt context, which is why the flag is captured, not re-read.

- [ ] **Step 3: `default.vue` hosted seams.** Four edits, each conditional on the existing `hostedShell` const (it is declared at line ~2825; **hoist it above first use if any edit sits earlier in the file**):
  1. **Engine iframes:** add `v-if="!hostedShell"` to the hidden bridge iframe (`#sailor-bridge-iframe`) and the worker-iframe `v-for` block in the template. In hosted there is no reachable engine origin for the browser, and mounting them is the exact hole that let the iframe post to `:8188` unmetered.
  2. **Run flow:** wrap the `withKeyedLock('bridge-run:...')` block (the one calling `sendLoadWorkflow`) in `if (!hostedShell) { ... }`. Hosted always runs direct (step 2 forces it), and `sendLoadWorkflow` awaits a bridge that will never be ready.
  3. **Backend health:** `useBackendHealth(hostedShell ? '' : comfyOrigin, ...)` — an empty origin makes the probe fetch relative `/system_stats`, which the authed proxy serves. Verify `useBackendHealth` builds `` `${origin}/system_stats` `` (it does) so `''` yields a same-origin path.
  4. **canvasReady:** `const canvasReady = computed(() => backendUp.value && (hostedShell || bridgeReady.value))` — there is no bridge to become ready in hosted.
  Also: find the direct-execution `execution_complete` handler in `default.vue` (grep `execution_complete`) and add `if (hostedShell) void refreshHostedWallet()` so the wallet pill drops right after a run settles (settlement lags a poll interval — fire a second refresh on a 3s timeout).
- [ ] **Step 4: Credit badge in `ComfyNode.vue`.** Replace the `priceLabel` computed's return with hosted-aware formatting:

```ts
import { hostedModeEnabled } from '~/lib/hostedMode'
import { creditsForUsd } from '~/lib/pricing'

const hostedBadges = hostedModeEnabled(useRuntimeConfig().public)

const priceLabel = computed(() => {
  const badge = props.data.priceBadge
  if (!badge?.expr) return null
  const numbers = badge.expr.match(/\d+\.\d+/g)
  if (!numbers?.length) return hostedBadges ? '~? cr' : '~$?'
  const prices = numbers.map(Number).filter(n => n > 0 && n < 100)
  if (!prices.length) return hostedBadges ? '~? cr' : '~$?'
  const min = Math.min(...prices)
  if (hostedBadges) return `~${creditsForUsd(min)} cr`
  return min < 0.01 ? '<$0.01' : `~$${min.toFixed(2)}`
})
```

(Client badge stays an estimate — the server's `priceGraph` is authoritative at submit. Divergence is acceptable; undercharging is not, and the server can't undercharge because it never reads this label.)

- [ ] **Step 5: Verify.** `npx vitest run tests/unit/direct-execution-enabled.unit.spec.ts` green. Boot the LOCAL dev server: canvas loads, iframe mounts, a bridge-mode run still works (local regression — `hostedShell` false everywhere). Grep the SSR log for `Failed to resolve component` (the not-auto-imported gotcha).

- [ ] **Step 6: Commit (hunk-scoped!).** `git add -p frontend/app/components/vue-canvas/ComfyNode.vue` selecting ONLY the priceLabel/import hunks; plain `git add` for the other two files. `feat(stage5): hosted canvas = direct-exec only, no engine iframes, credit badges`

---

### Task 7: Authed `/ws` upgrades (hosted dev server)

**Files:**
- Modify: `frontend/nuxt.config.ts` (the inline WS-proxy module)
- Test: live probe in Task 8 (config-eval code has no vitest harness; keep the change small and behind the env check)

**Interfaces:**
- Consumes: `@clerk/backend` `createClerkClient().authenticateRequest` (dynamic import inside the handler — config-eval must not pay for it in local mode).

- [ ] **Step 1: Restructure the upgrade handler.** Inside the `server.on('upgrade', ...)` callback in `nuxt.config.ts`, wrap everything after the `socket.on('error', ...)` guard into `const proceed = () => { ... }` (the worker-port resolution + `http.request` proxying stays byte-identical inside it). Then:

```ts
          // Stage 5: hosted dev servers authenticate the WS upgrade — the
          // session cookie rides on the upgrade request's headers. Local mode
          // (no Clerk key) proceeds exactly as before.
          const clerkKey = process.env.NUXT_CLERK_SECRET_KEY
          if (!clerkKey) { proceed(); return }
          void (async () => {
            try {
              const { createClerkClient } = await import('@clerk/backend')
              const client = createClerkClient({
                secretKey: clerkKey,
                publishableKey: process.env.NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
              })
              const headers = new Headers()
              for (const [k, v] of Object.entries(req.headers)) {
                if (typeof v === 'string') headers.set(k, v)
                else if (Array.isArray(v)) headers.set(k, v.join(', '))
              }
              const state = await client.authenticateRequest(
                new Request(`http://127.0.0.1${req.url}`, { method: 'GET', headers }))
              if (state.toAuth()?.userId) { proceed(); return }
            } catch { /* fall through to reject */ }
            socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
            socket.destroy()
          })()
```

Cache the Clerk client in a module-scope `let` inside the inline module so repeat upgrades don't reconstruct it.

- [ ] **Step 2: Local regression.** Boot the local dev server (no Clerk key): direct-execution WS still connects (Settings → enable Direct execution beta, run something, or just observe `/ws` 101 in the dev log). The auth branch must be dead code in local.

- [ ] **Step 3: Commit** — `feat(stage5): authenticate /ws upgrades on hosted dev servers`

**Known limitation (carried rider, do NOT build here):** production (built Nitro) WS proxying doesn't exist yet on any path — it lands with the hosting/deployment stage (crossws route or platform reverse-proxy, decided with the Fly/Railway/Hetzner choice). Also: WS events are scoped by ComfyUI to the submitting `client_id` for execution events, but broadcast `status` frames (queue depth) reach all connected users — acceptable beta leak, noted in the verification doc.

---

### Task 8: Live verification (hosted worktree) + docs + dashboard

**Files:**
- Create: `docs/superpowers/specs/2026-08-17-stage5-canvas-metering-verification.md`
- Modify: `docs/STATE.md`, `.superpowers/sdd/progress.md`, the ⛵ dashboard artifact (fetch live version first, merge, republish)

- [ ] **Step 1: Refresh the hosted worktree server.** The meter-verify worktree (`/private/tmp/claude-501/sailor-meter-verify`) is at `4bbeef3ad`. Kill its server via lsof open-file discovery (never `pkill -f`), `git -C /private/tmp/claude-501/sailor-meter-verify pull` (fast-forward to the Stage-5 HEAD), re-symlink `node_modules` if the worktree recipe requires, boot with `.env.hosted` sourced, confirm it binds `:3100` (a stale server silently keeping the port has burned two verifications — check `lsof -nP -iTCP:3100` shows the NEW pid).
- [ ] **Step 2: Automated hosted probes (no session needed):**
  - `curl -s -o /dev/null -w '%{http_code}' -X POST 127.0.0.1:3100/prompt -H 'content-type: application/json' -d '{"prompt":{}}'` → `401` (guarded before metering).
  - `curl -s 127.0.0.1:3100/history -H 'accept: application/json'` → `401`.
  - Unauthed WS: `node -e "const s=require('net').connect(3100,'127.0.0.1',()=>{s.write('GET /ws?clientId=x HTTP/1.1\r\nHost: 127.0.0.1:3100\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n')});s.on('data',d=>{console.log(d.toString().split('\r\n')[0]);s.end()})"` → `HTTP/1.1 401 Unauthorized`.
  - Local `:3000` regression: `curl -s 127.0.0.1:3000/api/wallet` → `{"mode":"local"}`; canvas loads; `/history` serves unfiltered as before.
  - Full unit sweep twice (`npx vitest run tests/unit` — check `uptime` load first; rerun any garbage counts).
- [ ] **Step 3: Signed-in checklist (needs Julien, ~3 min — write it into the verification doc):**
  1. Open `:3100`, sign in, run a cheap canvas generation (Generate node on `flux-schnell`) → wallet pill drops by the graph price (base 1 + model credits); Neon shows a `holds` row that settled and a `graph_runs` row with recorded outputs.
  2. Open an incognito/second account (or ask Claude to check via SQL): the other account's `/history` doesn't show the first account's run; fetching the first account's `/view?filename=...` URL → 404.
  3. 402 demo: admin-debit the test wallet to ~1cr, attempt a `flux-2-pro` run → clean insufficient-credits toast naming required/available, no `holds` row left open, engine never ran (check ComfyUI log); restore wallet.
  4. Interrupt: start a run, hit stop → works on your own run.
- [ ] **Step 4: Docs.** Write the verification spec (plain-language summary first — standing rule), listing what was proven, the carried riders (below), and the teardown commands. Update `docs/STATE.md` (Stage 5 section) and `.superpowers/sdd/progress.md`. Fetch the LIVE ⛵ dashboard artifact, merge the Stage-5 row, republish to the same URL.
- [ ] **Step 5: Riders to carry forward (record them in the verification doc):**
  - `/view` `type=input`/`type=temp` reads and `/upload` are not tenant-isolated yet (per-user input subfolders — Stage 6 with per-user data).
  - Production WS proxy — lands with the hosting decision (Fly/Railway/Hetzner; `fly.toml` `cdg` region must become a US region then).
  - WS broadcast `status` frames leak queue depth across users (cosmetic).
  - R2/durable output storage — Stage 6 boundary.
  - Model-price `confidence: 'estimate'` rows from Task 3 join the pre-launch re-verification sweep with the Stage-4 estimates.
  - `GRAPH_NODE_CREDITS` flat prices for video-length-dependent nodes (Kling, Veo3, Seedance) assume the default duration — duration-aware pricing is a refinement with resolution-aware pricing.

## Self-review notes

- Spec coverage: three submission surfaces → surface 1 closed by Task 6 (no iframes + forced direct), surfaces 2+3 by Task 4 (server-side intercept — client-agnostic). Ownership → Tasks 1+5. No-hold leak → Task 2 (provider routes) + Task 4 (graphs, hold-first by construction). WS auth → Task 7 (dev-hosted; production deferred with the hosting decision, stated). Badge fix → Task 6. Pricing gap (62 classes) → Task 3.
- Type consistency: `MeterTicket.release`, `LedgerLike.settleHold/releaseHold` (Task 2) vs Task 4 using `getLiveLedger()`'s native `hold/settle/release` directly — intentional, stated in Task 4 interfaces. `outputKey` format defined once (Task 1) and consumed in Tasks 4–5.
- Local-mode audit: every new behavior sits behind `deployMode() === 'hosted'` (server) / `hostedShell` / `hostedForced` (client); Task 5 Step 6 and Task 8 Step 2 both re-verify local byte-identical behavior.
