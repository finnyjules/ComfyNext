# Stage 6: Per-User Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Plain summary:** today, everything a user creates — saved projects, brand kits, moodboards, templates, characters, trained LoRAs, cloned voices, settings — sits in shared files that every signed-in hosted user can see, and most of it isn't even on the persistent disk, so it would vanish on redeploy. After this stage: every record has an owner, every list shows only yours, every mutation checks ownership, the canvas file pickers come back to life showing only your files, a graph can no longer read another tenant's files through the engine, settings persist per-user, and all of it lives on storage that survives a deploy. Local mode is byte-identical throughout.

**Goal:** every user-created record is owner-scoped in hosted mode (list-filtered, mutation-guarded, engine-enforced) and stored durably; the Stage-5 hosted product gaps (empty pickers, 403'd settings, silent overwrite fallbacks) are resolved.

**Architecture:** one central `resource_owners` Postgres table (kind + resource id → user id) covers every store uniformly — including the ones whose files are written engine-side where Nitro can't add JSON fields. File stores stay files (matching repo culture) but resolve their base directory through a `SAILOR_DATA_DIR` env so hosted points them at the Fly volume. Engine-side isolation reuses Stage 5's chokepoints: the metered `/prompt` handler gains graph file-reference validation + output `filename_prefix` injection; the object_info scrubber refills upload combos with the caller's own files; ComfyUI's built-in multi-user mode (`--multi-user` + `comfy-user` header, already in core) serves per-user settings/userdata with the proxy overwriting the header spoof-proof.

**Tech Stack:** existing pieces only — Nitro/h3, `connectLedgerDb` pg driver, `resource_owners` alongside `graph_runs`/`input_uploads`, ComfyUI's `UserManager` multi-user support, `enginePath.ts` decision table, `engineGate.ts` handlers, `meterGraphRun.ts` chokepoint.

## Global Constraints

- **deployMode contract:** no `NUXT_CLERK_SECRET_KEY` ⇒ local mode ⇒ byte-identical pre-Stage-6 behavior. Every ownership filter/guard/record sits behind `deployMode() === 'hosted'`. Local `:3000` regression is part of final verification.
- **Secrets:** hosted keys ONLY in gitignored `frontend/.env.hosted`; never print values. Neon schema applies via the DIRECT `DATABASE_URL`.
- **mlly gotcha:** NO commas in trailing comments on `export const` lines under `frontend/server/` — em-dashes only.
- **Parallel-session hygiene:** other sessions hold uncommitted edits (check `git status` before every commit). Stage ONLY your own files/hunks; never `git add -A`; never stash; commit to main.
- **Run vitest FROM `frontend/`.** Shell cwd resets between Bash calls.
- **Ledger session contract:** `resource_owners` uses its OWN pg session via `connectLedgerDb` (the `graphRuns.ts`/`inputUploads.ts` pattern) — never `getSharedLedgerDb`, no `ledger.withLock` coupling.
- **Fail closed:** in hosted mode, a store/route that cannot determine ownership refuses rather than serving; unknown file references in graphs refuse the graph; a missing `SAILOR_DATA_DIR` target directory is created, not silently redirected.
- **The allowlist lesson (Stage 5, 4 review rounds):** every proxy allowlist entry needs a handler-level audit of what it reads/writes; detect request fields by parsing, never regex; canonicalize before comparing; adversarial RED-first tests for every gate.
- **Header spoof rule:** any identity header forwarded to the engine (`comfy-user`) must be STRIPPED from the client request and SET by the proxy — client-supplied values never pass through, in any mode.
- **Ownership of pre-existing records:** hosted launches with EMPTY stores (fresh volume). A record with no `resource_owners` row is treated as **curated/global: visible to all, mutable by none** (that's how operator-seeded house content works). First-touch auto-claiming is forbidden.

## Decisions taken in this plan (flag to Julien if any look wrong)

1. **R2 is DEFERRED post-beta.** The Fly volume + `SAILOR_DATA_DIR` covers a 5-user beta; object storage is a launch-scale refinement. Task 9 writes the decision record.
2. **`/sailor/spend/summary` is operator data** → 403 in hosted (it aggregates the whole install's spend). Per-user spend UI is a later product feature reading the ledger, not this endpoint.
3. **Curated LoRAs/house styles stay global** (unowned = global-read-only rule above); user-trained LoRAs/voices/characters are owner-scoped.
4. **BYOK secrets stay local-only** (hosted already refuses client-pasted keys); the shared `sailor-secrets.json` moves under `SAILOR_DATA_DIR` but gains no per-user model this stage.

## Current-state map (verified 2026-08-17; scout report has file:line for everything)

- **P0 live gaps (authenticated-but-not-authorized):** `/sailor/projects*` raw-allowed in hosted (`enginePath.ts` `HOSTED_RAW_ALLOW` includes `/sailor`) — any signed-in user lists/reads/writes/deletes any project (`comfy_extras/nodes_sailor_projects.py:456-565` checks only path traversal) and reads install-wide `/sailor/spend/summary`. `GET /api/training-queue` returns every user's jobs; cancel/delete take no ownership check (jobs already carry `userId` — `trainingQueue.ts:52`).
- **Unowned stores:** brand kits (`server/brand-kits/*.json`), moodboards (`server/moodboards/*.json` + images in engine `input/`), templates (`server/templates/layouts/`), template fonts (`server/templates/fonts/user/`), characters (repo-root `models/characters/*.json`), LoRAs (`models/loras/*` + sidecars), voices (`models/voices/*`), secrets (`frontend/.data/sailor-secrets.json`). None have owner fields.
- **Durability gap:** fly.toml mounts `/data`; `start.sh` redirects only ComfyUI's `output/input/temp/user` there. `models/` and everything under `frontend/server/{brand-kits,moodboards,templates}` + `frontend/.data` are ephemeral container disk — lost on redeploy.
- **Engine mechanics:** `filename_prefix` with a `/` creates output subfolders (`folder_paths.py:453-456`, containment-checked); `/upload/image` honors a `subfolder` field; `LoadImage`'s combo list is a FLAT `os.listdir` (subfoldered inputs invisible) — so inputs stay flat + registry-tracked, outputs get per-user subfolders. `LoadImageOutput` uses `remote: {route: "/internal/files/output"}` (403 in hosted today) and its execute reads ANY output file — the engine-side cross-tenant read (Stage 5 rider I1).
- **Stage-5 pieces to reuse:** `input_uploads` table + `canonicalUploadKey`/`recordUpload`/`uploadOwner` (`inputUploads.ts`), `graph_runs` + `ownedOutputKeys`/`outputKey` (`graphRuns.ts`), `hostedEngineDecision` (`enginePath.ts:160-215`), `scrubObjectInfo`/`UPLOAD_FLAG_KEYS` (`engineGate.ts:133,183-197`), `meterGraphSubmit`/`handleMeteredPrompt` (`meterGraphRun.ts`), `event.context.userId` from auth middleware.
- **Settings:** ComfyUI already supports per-user settings/userdata via `--multi-user` + `comfy-user` header (`app/user_manager.py:47-70`); without the flag every request resolves to `"default"`. `SettingsModal.vue` needs zero changes — only the proxy must stop 403ing `/settings` + `/userdata` and inject the header.

---

### Task 1: Foundations — `resource_owners` table, `resourceOwners.ts`, `dataDir.ts`

**Files:**
- Modify: `frontend/server/db/schema.sql`
- Create: `frontend/server/utils/resourceOwners.ts`, `frontend/server/utils/dataDir.ts`
- Test: `frontend/tests/unit/resource-owners.unit.spec.ts`, `frontend/tests/unit/data-dir.unit.spec.ts`

**Interfaces (consumed by every later task):**
- `recordOwner(kind: string, resourceId: string, userId: string): Promise<void>` — first-owner-wins upsert (`ON CONFLICT DO NOTHING`).
- `ownerOf(kind: string, resourceId: string): Promise<string | null>`
- `ownedIds(kind: string, userId: string): Promise<Set<string>>`
- `releaseOwner(kind: string, resourceId: string): Promise<void>` — used on delete.
- `hostedCanRead(owner: string | null, userId: string): boolean` — true when `owner === null` (curated/global) or `owner === userId`.
- `hostedCanMutate(owner: string | null, userId: string): boolean` — true ONLY when `owner === userId` (unowned = read-only).
- `storeDir(name: 'brand-kits' | 'moodboards' | 'templates-layouts' | 'templates-fonts-user' | 'data'): string` — `SAILOR_DATA_DIR` set ⇒ `$SAILOR_DATA_DIR/<name>` (mkdir-on-first-use), else the store's EXACT current path (byte-identical local).
- `__setResourceOwnersDbForTests(db)`, and `RESOURCE_KINDS` const: `'project' | 'brand-kit' | 'moodboard' | 'template' | 'template-font' | 'character' | 'lora' | 'voice'`.

- [ ] **Step 1: Schema.** Append to `frontend/server/db/schema.sql`:

```sql
-- Central ownership registry for user-created resources (Stage 6). One row
-- per owned record; kinds are the RESOURCE_KINDS list in resourceOwners.ts.
-- A record with NO row here is curated/global content: readable by all,
-- mutable by none. First-owner-wins (ON CONFLICT DO NOTHING at write time).
CREATE TABLE IF NOT EXISTS resource_owners (
  kind        text NOT NULL,
  resource_id text NOT NULL,
  user_id     text NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, resource_id)
);

CREATE INDEX IF NOT EXISTS resource_owners_user ON resource_owners (user_id, kind);
```

- [ ] **Step 2: Failing tests.** `resource-owners.unit.spec.ts` (fake-db `query` spy, pattern from `tests/unit/graph-runs.unit.spec.ts`): recordOwner inserts with ON CONFLICT DO NOTHING and params `[kind, id, userId]`; ownerOf returns the row's user_id or null; ownedIds returns a Set; releaseOwner deletes by (kind, id); `hostedCanRead(null, 'u1')` true / `('u2','u1')` false / `('u1','u1')` true; `hostedCanMutate(null, 'u1')` **false** (unowned is read-only — the anti-first-touch rule), `('u1','u1')` true. `data-dir.unit.spec.ts`: with env unset, `storeDir('brand-kits')` equals `join(process.cwd(), 'server', 'brand-kits')` (and each other store's current literal path — copy them from the routes: moodboards `server/moodboards`, templates-layouts `server/templates/layouts`, templates-fonts-user `server/templates/fonts/user`, data `.data`); with env set (use a temp dir), returns `$SAILOR_DATA_DIR/<name>` and creates it.
- [ ] **Step 3: Run RED**, implement both utils (own lazy `connectLedgerDb` session + `__set...ForTests` seam, exactly the `graphRuns.ts` shape; `dataDir.ts` is pure node:path/fs, `mkdirSync {recursive:true}` on the env-set branch only), run GREEN.
- [ ] **Step 4: Apply schema to Neon** (the Stage-5 node/pg one-liner against the DIRECT `DATABASE_URL` from `.env.hosted`; verify `to_regclass('resource_owners')`). **Step 5: Commit** — `feat(stage6): resource_owners registry + SAILOR_DATA_DIR store resolution`.

---

### Task 2: P0 — tenant-gate `/sailor` projects (and kill the spend leak)

**Files:**
- Modify: `frontend/server/utils/enginePath.ts` (remove `/sailor` from `HOSTED_RAW_ALLOW`; add decision branch), `frontend/server/utils/engineGate.ts` (handler), `frontend/server/middleware/comfyui-proxy.ts` (wire the new decision kind)
- Test: `frontend/tests/unit/sailor-projects-gate.unit.spec.ts`, extend `frontend/tests/unit/engine-path-alias.unit.spec.ts`

**Interfaces:** consumes Task 1's `recordOwner`/`ownerOf`/`ownedIds`/`releaseOwner`/`hostedCanRead`/`hostedCanMutate` with kind `'project'`; `resolveWorkerTarget`; `event.context.userId`.

- [ ] **Step 1: Failing adversarial tests FIRST.** In `sailor-projects-gate.unit.spec.ts`, drive the REAL handler (the `engine-upload-ownership.unit.spec.ts` harness pattern — real middleware/handler, faked fetch + faked owners db):
  - hosted `GET /sailor/projects` returns ONLY caller-owned entries (upstream returns 3 projects, caller owns 1 → 1 back; an unowned project is NOT listed — projects are personal, the curated/global read rule does NOT apply to the list, assert that explicitly);
  - hosted `GET /sailor/projects/<other-uuid>` → 404 (not 403 — don't confirm existence); owned uuid → passes through verbatim;
  - hosted `PUT /sailor/projects/<new-uuid>` → forwarded AND `recordOwner('project', uuid, caller)` called; `PUT` on an existing OTHER-owned uuid → 404, upstream never touched;
  - `DELETE` owned → forwarded + `releaseOwner` called; other-owned → 404;
  - `POST /sailor/projects/<uuid>/versions` + `/generations` (and GET variants) → same ownership rule keyed on the path uuid;
  - hosted `GET /sailor/spend/summary` → 403 (operator data);
  - alias forms (`/api/sailor/projects`, `/comfyui/sailor/projects`) hit the same gate (extend `engine-path-alias.unit.spec.ts`: `/sailor` no longer proxies raw — flip the existing allowlist assertion, with a comment citing this task);
  - LOCAL: everything raw-proxies exactly as today (byte-identity block).
- [ ] **Step 2: Run RED.** **Step 3: Implement.** In `enginePath.ts`: delete `'/sailor'` from `HOSTED_RAW_ALLOW`; add before the allowlist check:

```ts
  // Stage 6: the durable-projects extension trusts its path uuid with zero
  // identity — ownership is enforced HERE, in the proxy layer, against the
  // resource_owners registry. Spend summary aggregates the whole install
  // and is operator data.
  if (match(p, '/sailor/spend')) return { kind: 'forbid', message: 'Spend summary is operator data in hosted mode' }
  if (match(p, '/sailor')) return { kind: 'sailorProjects' }
```

In `engineGate.ts`, `handleHostedSailor(event)`: parse the normalized path; `GET /sailor/projects` (list) → fetch upstream, filter entries to `ownedIds('project', userId)` (find the uuid field by reading `nodes_sailor_projects.py:100-116`'s list shape first — likely `{projects:[{uuid|id,...}]}`); uuid routes → `ownerOf('project', uuid)`; on `hostedCanMutate` false for writes / owner mismatch for reads → 404 `createError`; new-uuid `PUT` (ownerOf null) → forward, and on upstream 2xx `recordOwner`; `DELETE` on owned → forward, on 2xx `releaseOwner`. Forward via `fetch` to `resolveWorkerTarget` origin with method/body/content-type preserved (read the existing `handleHostedUpload` forward for the body-buffer pattern) and return status+body verbatim. Wire `sailorProjects` in `comfyui-proxy.ts` next to the other hosted kinds.
- [ ] **Step 4: GREEN + local smoke** (boot local dev server: `/sailor/projects` still serves — it's the projects panel's backbone). **Step 5: Commit** — `fix(stage6): tenant-gate /sailor projects — closes cross-tenant project read/write + spend leak`.

---

### Task 2b: P0 — gate the remaining `/sailor` engine routes (found in review)

**Context:** the scout + Task 2 only saw `/sailor/projects*` + `/sailor/spend`. The whole-branch review found **35** `/sailor` routes across `comfy_extras/nodes_timeline.py`, `_lora_training.py`, `_model_downloads.py`, `nodes_compositor.py`. Task 2 flipped `/sailor` off `HOSTED_RAW_ALLOW` and gated projects — but its fallback branch (`match(p,'/sailor') => {kind:'proxy'}`, `enginePath.ts`) still raw-proxies every OTHER `/sailor` route to the shared engine for any signed-in tenant. Several leak/mutate cross-tenant data. Not exploitable today (nothing deployed) but a hard pre-deploy blocker.

**Files:**
- Modify: `frontend/server/utils/enginePath.ts` (replace the `/sailor` proxy fallback with per-route decisions), `frontend/server/utils/engineGate.ts` (data-route handlers), `frontend/server/db/schema.sql` (assets are a new owned kind — reuse `resource_owners` with kind `'timeline-asset'`; add `'timeline-asset'` to `RESOURCE_KINDS` in `resourceOwners.ts`)
- Test: `frontend/tests/unit/sailor-routes-gate.unit.spec.ts`, extend `engine-path-alias.unit.spec.ts`
- Read-only: the four Python modules above (a parallel session may hold them — never modify)

**Interfaces:** Task 1 (`resource_owners` + helpers), Stage-5 `ownedInputFilenames`/`ownedOutputKeys` (`inputUploads.ts`/`graphRuns.ts`), `canonicalUploadKey`, `outputKey`, `annotatedFilepath`, `forwardSailor` (the Task-2 forward helper — reuse it).

- [ ] **Step 1: Disposition table (verify each against its handler).** Read every non-project `/sailor` route's handler and classify. The plan's proposed disposition — CONFIRM or correct each by reading the code:
  - **Per-user DATA — gate (filter reads to owned, ownership-check deletes/mutations):** `GET /sailor/input_listing` (filter to `ownedInputFilenames`), `GET /sailor/output_listing` (filter to owned outputs via `ownedOutputKeys`), `DELETE /sailor/input_file` + `DELETE /sailor/output_file` (ownership-check the named file → 404 unowned, engine never touched), `GET /sailor/input_thumbnail` (owned-input check), `GET /sailor/assets` (filter to `ownedIds('timeline-asset', user)` — record shape is `user/timeline_assets.json`, no owner field today → the registry IS the owner), `POST /sailor/asset_import` (record `timeline-asset` ownership on 2xx from the returned asset_id), `DELETE /sailor/assets/{asset_id}` (ownership-check + releaseOwner), `GET /sailor/asset_thumbnails` + `GET /sailor/asset_waveform` (owned-asset check).
  - **Stateless capability/shared catalog — proxy in hosted (safe):** `GET /sailor/shader_effects`, `GET /sailor/shader_effects/assets/{name}`, `GET /sailor/space_defaults`, `GET /sailor/space_thumbnails`, `GET /sailor/space_thumbnail/{effect_id}`, `POST /sailor/spacetype_encode`, `POST /sailor/font_subset`, `GET /sailor/models/status`. Put these on a NEW explicit `HOSTED_SAILOR_PROXY` allowlist (deny-by-default — the Stage-5 lesson: allowlist entries need a handler audit, cite it).
  - **Compute/write that spends or mutates shared state — REFUSE (403) this stage (fail closed; per-user versions are later work):** `POST /sailor/render_timeline` + `render_timeline_stream` + `POST /sailor/timeline/render_frame` (write to shared output/temp, could be metered later), `POST /sailor/motion/cleanup_frames`, `POST /sailor/lora/clear_dataset` + `POST /sailor/lora/save_captions` (mutate a shared training dataset dir), `GET /sailor/models/download` (writes to operator model disk), `POST /sailor/space_default/{effect_id}` + `POST /sailor/space_thumbnail/{effect_id}` (write shared space presets — operator/dev content). Each 403 with a message naming why. If reading a handler shows one of these is actually stateless + safe, move it to the proxy allowlist and note it in the report.
  - Anything not in the enumerated 35 (a route added since) → deny-by-default 403 (the fallback becomes refuse, never proxy).

- [ ] **Step 2: Adversarial tests RED FIRST.** For the data routes: another tenant's file absent from listings; DELETE of another's file → 404, engine never touched; asset list filtered; asset DELETE of another's → 404; asset_import records ownership. For capability routes: proxied in hosted (assert they reach the forward). For refuse routes: 403 in hosted, engine never touched. Aliases (`/api/sailor/...`, `/comfyui/sailor/...`) hit the same decisions. LOCAL byte-identical raw proxy for ALL of them. Add a **coverage guard** (Stage-5 style): grep the four Python modules for `routes.(get|post|put|delete)("/sailor` and assert every route string is classified in exactly one bucket (data-gate / proxy-allow / refuse / projects-from-Task-2) — so a newly-added `/sailor` route fails the suite instead of silently proxying.

- [ ] **Step 3: RED → implement.** Replace the `/sailor` proxy fallback in `enginePath.ts` with the bucket decisions (`sailorData`/`proxy`/`forbid`). New handlers in `engineGate.ts` reuse `forwardSailor` + the Stage-5 owned-file helpers. Apply the `timeline-asset` schema/kind. **Step 4: GREEN + local smoke** (timeline asset panel, input/output pickers still work locally). **Step 5: Commit** — `fix(stage6): gate the remaining /sailor engine routes — files, assets, refuse compute/write`.

### Task 3: P0 — training-queue ownership

**Files:**
- Modify: `frontend/server/api/training-queue/index.get.ts`, `frontend/server/api/training-queue/[id]/cancel.post.ts`, `frontend/server/api/training-queue/[id]/index.delete.ts`
- Test: `frontend/tests/unit/training-queue-ownership.unit.spec.ts`

**Interfaces:** jobs already persist `userId` (`trainingQueue.ts:52`) — no new table. `deployMode`, `event.context.userId`.

- [ ] **Step 1: Failing tests** (drive real handlers, faked queue store): hosted list returns only `job.userId === caller` (a job with NO userId — pre-Stage-4 legacy — is returned to NOBODY in hosted, assert it); hosted cancel/delete of another user's job → 404 and the queue mutation function is NEVER called; own job → proceeds; LOCAL: unfiltered list + ungated cancel/delete, byte-identical.
- [ ] **Step 2: RED → implement.** Each route gains a small hosted branch (filter, or ownership check before mutating). Keep handlers thin; export nothing new.
- [ ] **Step 3: GREEN**, plus re-run `tests/unit/training-meter.unit.spec.ts` (same subsystem). **Step 4: Commit** — `fix(stage6): training queue is per-user in hosted mode`.

---

### Task 3b: cloud-train ownership (legacy direct-training path — found in review)

**Context:** `cloud-train/start.post.ts` + `status.get.ts` are a legacy direct-training path still wired to the frontend (`LoraTrainerSurface.vue`, `useCharacterStudio.ts`, `useSheetGeneration.ts`, `stressFlow.ts`), separate from `training-queue`. `start` IS metered (`preflightMeter`, charges the right wallet) but records no durable owner; `status.get.ts` polls a raw Replicate training id with ZERO ownership check and downloads the trained weights to shared disk — any signed-in hosted user can poll anyone's training and pull their LoRA. Same class as the voice-clone gap Stage 5 closed. Plan-scouting miss (not in the P0 map). Not exploitable today (nothing deployed) but a pre-deploy blocker.

**Files:**
- Modify: `frontend/server/api/cloud-train/start.post.ts` (record owner), `frontend/server/api/cloud-train/status.get.ts` (gate by owner)
- Test: `frontend/tests/unit/cloud-train-ownership.unit.spec.ts`

**Interfaces:** Task 1 `recordOwner`/`ownerOf` with kind `'cloud-training'`; the resource id is the Replicate training id (`start` returns it; `status` takes it as the query param). `event.context.userId`, `deployMode`. Mirror `voiceCloneOwners`'s owner-binding intent but DURABLE via `resource_owners` (no in-memory map — this is exactly what durable ownership buys).

- [ ] **Step 1: Failing tests** (drive real handlers, faked Replicate fetch + faked owners db): hosted `start` on 2xx records `recordOwner('cloud-training', <trainingId>, caller)` — read start.post.ts to find where the training id becomes known (after the Replicate create call succeeds); hosted `status` for a training id owned by ANOTHER user → 404, Replicate never polled, no weights downloaded; own id → proceeds; an id with NO owner row (legacy/pre-Task-3b) in hosted → 404 (fail closed — no owner, no access); local byte-identical (both routes unchanged, no registry calls).
- [ ] **Step 2: RED → implement.** `start`: after the training create succeeds and the id is known, `if (deployMode()==='hosted' && userId) await recordOwner('cloud-training', id, userId)` (the metering already established userId in context — use `event.context.userId`). `status`: at the top of the hosted branch, `const owner = await ownerOf('cloud-training', id); if (owner !== event.context.userId) throw createError({statusCode:404,...})` BEFORE any Replicate poll/download. Keep handlers thin.
- [ ] **Step 3: GREEN** + re-run `tests/unit/training-meter.unit.spec.ts` and the Task-3 `training-queue-ownership` spec (sibling subsystem). **Step 4: Commit** — `fix(stage6): cloud-train direct path is per-user in hosted mode`.

### Task 4: App JSON stores per-user — brand kits, moodboards, templates, template fonts

**Files:**
- Create: `frontend/server/utils/ownedJsonStore.ts`
- Modify: `frontend/server/api/brand-kits/{index.get,\[id\].put,\[id\].delete}.ts`; `frontend/server/api/moodboards/{index.get,\[id\].put,\[id\].delete,images.post,images.get,refs.post}.ts`; `frontend/server/api/templates/{index.get,\[id\].get,\[id\].put}.ts`; `frontend/server/api/template-fonts/{index.get,index.post,\[slug\].delete,file/\[name\].get}.ts`; `frontend/server/templates/fonts-store.ts`
- Test: `frontend/tests/unit/owned-json-store.unit.spec.ts`

**Interfaces:**
- Consumes Task 1 everything.
- Produces `ownedJsonStore.ts`:

```ts
/**
 * Shared owner-scoping for the flat JSON file stores (Stage 6). The files
 * stay files — ownership lives in resource_owners, keyed by the record id
 * (the filename stem). Local mode: no filtering, no registry writes, and
 * storeDir() returns the store's historical path — byte-identical.
 */
export interface OwnedStoreOpts { kind: string, dir: string }

// List: local → all records. Hosted → records the caller owns PLUS records
// with no owner row (curated/global), per the plan's ownership rule.
export async function listOwned<T>(opts: OwnedStoreOpts, userId: string | null, readAll: () => Promise<Array<{ id: string, record: T }>>): Promise<T[]>

// Guard a mutation (upsert/delete) on `id`. Local → always allowed.
// Hosted → allowed iff hostedCanMutate(ownerOf(kind, id), userId); a brand
// NEW id (no owner row AND no file on disk — caller passes `exists`) is
// allowed and gets recordOwner'd by claimNew.
export async function guardMutation(opts: OwnedStoreOpts, userId: string | null, id: string, exists: boolean): Promise<void>  // throws 404 createError when refused
export async function claimNew(opts: OwnedStoreOpts, userId: string | null, id: string): Promise<void>    // recordOwner in hosted, no-op local
export async function releaseRecord(opts: OwnedStoreOpts, id: string): Promise<void>                      // releaseOwner in hosted, no-op local
```

- [ ] **Step 1: Failing tests** for `ownedJsonStore.ts` with faked owners + a temp dir: hosted list = own + unowned, never other-owned; guardMutation refuses other-owned AND unowned-but-existing (curated read-only) with 404; allows new id and own id; local passes everything untouched and never queries the registry (assert zero db calls).
- [ ] **Step 2: RED → implement the util → GREEN.**
- [ ] **Step 3: Convert the four stores.** Brand kits in full (the template for the rest):

```ts
// index.get.ts
import { listOwned } from '../../utils/ownedJsonStore'
import { storeDir } from '../../utils/dataDir'
const OPTS = { kind: 'brand-kit', dir: storeDir('brand-kits') }
export default defineEventHandler(async (event) => {
  const kits = await listOwned(OPTS, event.context.userId ?? null, readAllKits) // readAllKits = the existing readdir/parse loop, extracted, id = filename stem
  kits.sort((a, b) => String(a.name).localeCompare(String(b.name)))
  return { kits }
})
```

`[id].put.ts`: before writing — `const exists = existsSync(join(OPTS.dir, id + '.json')); await guardMutation(OPTS, userId, id, exists); ...write...; if (!exists) await claimNew(OPTS, userId, id)`. `[id].delete.ts`: `guardMutation` then delete then `releaseRecord`. Apply the same three-call pattern to moodboards (`kind: 'moodboard'`), templates (`kind: 'template'` — note `[id].get.ts` needs a READ guard: `hostedCanRead` via `ownerOf`, 404 otherwise), and template fonts (`kind: 'template-font'`, id = slug; `fonts-store.ts`'s manifest read stays shared but `index.get.ts` filters entries by the same rule, `file/[name].get.ts` read-guards). Every touched route swaps its hardcoded dir for `storeDir(...)`. Moodboard extras: `images.post.ts` + `refs.post.ts` record engine-input ownership for every file they write (`recordUpload(userId, canonicalUploadKey('input', folder, name))` from `inputUploads.ts` — hosted only), and `images.get.ts` read-guards by moodboard ownership.
- [ ] **Step 4: GREEN + local smoke** (boot local: brand kit list/create/delete, moodboard create + image upload, template open, font upload — all unchanged). **Step 5: Commit** — `feat(stage6): brand kits, moodboards, templates, fonts are per-user + volume-relocatable`.

---

### Task 5: models/ stores per-user — characters, LoRAs, voices

**Files:**
- Modify: `frontend/server/api/characters-local.{get,post,patch}.ts` (+ `characters-local/absorb.post.ts`), `frontend/server/api/loras-local.{get,post,patch,delete}.ts`, `frontend/server/api/lora-cover.{get,post}.ts`, `frontend/server/api/voices-local.get.ts`, `frontend/server/api/voice-preview-file.get.ts`, `frontend/server/api/voice-clone/status.get.ts`, `start.sh`
- Test: `frontend/tests/unit/models-store-ownership.unit.spec.ts`

**Interfaces:** Task 1 helpers with kinds `'character'`/`'lora'`/`'voice'`; ids = filename stems (character slug, lora base name, voice_id). `voiceCloneOwners.ts`'s in-memory binding already knows the voice's owner at creation — the status poller that writes the sidecar (`voice-clone/status.get.ts:107-135`) is where `recordOwner('voice', voice_id, owner)` happens (durable ownership at last — its own doc comment asks for exactly this; update that comment).

- [ ] **Step 1: Failing tests** (real handlers, faked owners + temp models dirs): hosted character/LoRA/voice lists = own + unowned (curated LoRAs stay visible to all — this is where the unowned-is-global rule earns its keep); mutations on other-owned → 404 with the file untouched; creates claim ownership; LoRA delete composes BOTH rules (existing "duplicate-only" deletability logic AND ownership — read `loras-local.delete.ts:14-56` first and assert the composed behavior: own duplicate deletable, other's duplicate 404, own non-duplicate still refused by the existing rule); voice sidecar write records the binding's owner, and an unknown-owner clone (restart case) records NOTHING (assert — never guess an owner); local byte-identical (zero registry calls).
- [ ] **Step 2: RED → implement.** Same guard/claim/release pattern as Task 4 (these routes have bespoke read/write code — insert the guards, don't restructure). `lora-cover.post.ts` mutates a LoRA's cover → guard by `'lora'` ownership.
- [ ] **Step 3: `start.sh` durability.** Read `start.sh`; add `models/` persistence for hosted: symlink or bind the repo `models/` dirs used by these stores (`models/characters`, `models/loras`, `models/voices`, `models/.training-jobs.json`) onto `/data/models/...` when `/data` exists (mkdir + `ln -sfn` at boot, before ComfyUI starts; local machines without `/data` unchanged). Comment WHY (ephemeral container disk).
- [ ] **Step 4: GREEN + local smoke** (LoRA gallery, character roster, voice gallery all render as before). **Step 5: Commit** — `feat(stage6): characters, LoRAs, voices are per-user + survive redeploys`.

---

### Task 6: Engine input serving — refill the pickers, own the direct writers

**Files:**
- Modify: `frontend/server/utils/engineGate.ts` (scrub → refill), `frontend/server/utils/inputUploads.ts` (owned-listing query), `frontend/server/api/lipsync/speech.post.ts`
- Test: extend `frontend/tests/unit/engine-object-info-upload.unit.spec.ts`

**Interfaces:**
- New in `inputUploads.ts`: `ownedInputFilenames(userId: string): Promise<string[]>` — file_keys with kind prefix `input::` (flat, no subfolder) owned by the user, returned as bare filenames sorted.
- `scrubObjectInfo(catalog, ownedFilenames: string[])` — signature grows: instead of emptying upload-flag combos, REPLACE the file list with `ownedFilenames` (both widget shapes — the `[[files],{image_upload}]` legacy form and the `["COMBO",{options,…}]` v2 form; `default` becomes the first owned filename or `''`). All non-file data stays byte-identical.

- [ ] **Step 1: Failing tests**: refilled catalog lists exactly the caller's files in both widget shapes (fixtures exist from Stage 5 — extend them); another user's filenames absent; empty ownership → empty list (today's behavior); `default` blanked or first-owned; the audio `default`-leak fixture (AudioWaveform/Happiness.mp3) now shows the OWNED file only. Filter correctness: `ownedInputFilenames` SQL selects `user_id = $1 AND file_key LIKE 'input::%'` and strips the prefix (unit-test the string handling; subfoldered keys `input:sub:x` are EXCLUDED — flat only, matching LoadImage's flat listing).
- [ ] **Step 2: RED → implement** (`handleHostedObjectInfo` fetches ownership once per request and passes it through; keep the response streaming/size behavior as-is). **Step 3: `lipsync/speech.post.ts`** — its direct `input/` write gains `recordUpload(userId, canonicalUploadKey('input', '', filename))` in hosted (moodboard writers were done in Task 4). Grep for any other direct `input/` writer added since the scout (`grep -rn "join(.*'input'" server/ | grep -v test`) and treat identically.
- [ ] **Step 4: GREEN + a hosted-shaped integration check**: with a fake session-context harness (existing pattern), upload a file through the gate then fetch object_info — the filename appears in LoadImage's combo. **Step 5: Commit** — `feat(stage6): file pickers list the caller's own uploads; direct input writers record ownership`.

---

### Task 7: Engine enforcement — graph file-reference validation + per-user output subfolders + LoadImageOutput

**Files:**
- Modify: `frontend/server/utils/meterGraphRun.ts`, `frontend/server/utils/enginePath.ts` + `frontend/server/utils/engineGate.ts` (LoadImageOutput listing), `frontend/server/utils/graphRuns.ts` (owned-outputs listing helper if missing)
- Test: `frontend/tests/unit/graph-file-refs.unit.spec.ts`, extend `frontend/tests/unit/meter-graph-run.unit.spec.ts`

**Interfaces:**
- `validateGraphFileRefs(prompt, ctx: { uploadFlagged: Set<string> /* "ClassType.inputName" */, ownsInput(name: string): Promise<boolean>, ownsOutput(annotated: string): Promise<boolean> })` — pure-ish, exported. Refuses (throws `MeterRefusalError` 403) any upload-flagged input value, or any `LoadImageOutput.image` value, that the caller doesn't own. Values may carry ` [output]`/` [input]`/` [temp]` annotations — reuse `annotatedFilepath` from `engineGate.ts`; `[output]`-annotated → check against `graph_runs` output keys; input/temp/unannotated → `input_uploads` via `canonicalUploadKey`. Unknown-shaped value on a flagged input → refuse (fail closed).
- The upload-flag map comes from the SAME object_info the scrubber reads — build it lazily per process (`Map` cached ~60s) from the live engine's catalog: every `(classType, inputName)` whose spec carries an `UPLOAD_FLAG_KEYS` key, plus the hardcoded pair `LoadImageOutput.image` (its widget is remote-routed, not upload-flagged — cite `nodes.py:1951-1959`).
- `filename_prefix` injection: in `handleMeteredPrompt`'s forward path, for every node whose class_type is in the SaveImage family (reuse/extend `OUTPUT_CLASS_TYPES` — it lives in `priceBook.ts`; export it or mirror deliberately with a parity assertion), set `inputs.filename_prefix = 'u_' + shortUserHash + '/' + (existing prefix or 'ComfyUI')`, where `shortUserHash = sha256(userId).slice(0,12)` (exported helper — deterministic, no PII in paths). Strip any client-supplied `../` in the existing prefix first (containment paranoia; the engine also checks).
- LoadImageOutput listing: `enginePath.ts` gains, BEFORE the `/internal` forbid: `GET /internal/files/output` → `{kind: 'outputListing'}`; `engineGate.ts` handler returns the caller's owned output files from `graph_runs` in the same JSON shape the engine's route returns (read the engine's handler for the shape — it's in ComfyUI's `app/` internal-routes module; match it exactly so the widget renders).

- [ ] **Step 1: Failing adversarial tests**: a graph referencing another user's input file → 403, engine never touched, hold released if taken (order the validation BEFORE the hold — assert no hold call at all); own file → passes; `victim.png [output]` in a LoadImage → checked against outputs, refused when unowned; LoadImageOutput with another's output → 403; with own output → passes; SaveImage prefix injection: forwarded body carries `u_<hash>/ComfyUI` (and preserves a custom prefix as suffix); a client-supplied `u_othershash/evil` prefix is REPLACED not prepended-to (assert the forwarded prefix starts with the CALLER's hash exactly once); zero-file graphs unaffected; local mode: `meterGraphSubmit` untouched (it only runs hosted — assert via the middleware gate as before).
- [ ] **Step 2: RED → implement** (validation wired into `meterGraphSubmit` between the 401/shape checks and the pricing — refusals must cost nothing; injection in the forward-body construction next to the existing `prompt_id` strip). **Step 3: Output-listing handler + decision branch** (+ flip the `/internal` assertions in `engine-path-alias.unit.spec.ts` for exactly this one GET, everything else under `/internal` stays forbidden). **Step 4: Confirm the settle/harvest path**: outputs now land in `output/<u_hash>/...` — `outputKey` already carries subfolder; extend one `meter-graph-run` settle test's history fixture with the subfoldered shape and assert `/view` gating still matches end-to-end (`viewGateDecision` + `ownedOutputKeys`).
- [ ] **Step 5: GREEN across the meter family** (meter-graph-run, graph-file-refs, engine-path-alias, engine-gate, view-route-gate). **Step 6: Commit** — `feat(stage6): graphs can only reference caller-owned files; outputs land in per-user subfolders`.

---

### Task 7b: complete the engine file-surface audit (validator coverage + output-node coverage) — found in review

**Context:** Task 7's review found its validator model was too narrow. `validateGraphFileRefs` only inspects object_info UPLOAD-FLAGGED inputs + hardcoded `LoadImageOutput.image`, but the engine has 11+ nodes that read files by UNFLAGGED plain-string / JSON-embedded / dict-valued inputs through `folder_paths.get_annotated_filepath` (which does a bare join with NO containment). Several decode the file into an IMAGE/VIDEO the attacker saves to their own `u_<hash>/` folder and views — a laundered cross-tenant read that prices at base-render so `priceGraph` never blocks it. Separately, `OUTPUT_CLASS_TYPES` misses Sailor's PRIMARY export nodes (`Image`/`Video`/`Audio` + `SaveAnimatedWEBP`/`SaveGLB`/`Preview3D`), so their outputs skip subfolder injection and land in the shared root. Both are pre-deploy blockers (not exploitable until deployed). Same class of gap as Task 2b (scout under-enumerated a broad engine surface).

**Files:**
- Modify: `frontend/server/utils/meterGraphRun.ts` (validator coverage map + injection set), `frontend/server/utils/priceBook.ts` (OUTPUT_CLASS_TYPES) OR a new `frontend/server/utils/engineFileSurface.ts` holding both checked-in maps
- Test: `frontend/tests/unit/engine-file-surface.unit.spec.ts` (coverage guards), extend `graph-file-refs.unit.spec.ts` + `metered-prompt-forward.unit.spec.ts`
- Read-only: nodes.py + every `comfy_extras/*.py` + `custom_nodes/**` node that reads or writes engine files (parallel sessions may hold these — never modify)

**Step 1: Audit the engine's file-READ surface (mechanical, like Task 3's 72-class sweep).** Enumerate every registered node whose execute reads from `input/`/`output/`/`temp/`:
```
grep -rnE "get_annotated_filepath|get_input_directory|get_output_directory|folder_paths\.(get_)?(input|output|temp)" comfy_extras/ nodes.py custom_nodes/ | grep -v test
```
For EACH hit, read the node's `INPUT_TYPES` + execute to find which input(s) carry the filename (String, a combo, a JSON blob field like `params`/`motion_params`/`edit_state` with an embedded `rendered[]`/frame list, or a dict like Load3D's `image`). Build a checked-in map `GRAPH_FILE_READERS: Record<classType, FileInputSpec[]>` where each spec says HOW to extract the referenced filename(s) from that input's value: `{ input, shape: 'string' | 'json-path', jsonPath?: string, semantics: 'input' | 'output' | 'either' }`. The review named these to start (verify each + find any it missed): LoadLatent, Load3D, Scene3DStudio, PoseMannequin, Compositor, KineticType, RenderType, TextMask, TextOnPath, Timeline, LUT, LoadImage-family, LoadImageOutput.

**Step 2: Audit the file-WRITE surface.** Enumerate every node writing to the output dir on execute/export:
```
grep -rnE "get_output_directory|get_save_image_path|_export_to_output|save.*output" comfy_extras/ nodes.py custom_nodes/ | grep -v test
```
Build the complete `OUTPUT_CLASS_TYPES` set (Image/Video/Audio/SaveImage/PreviewImage/SaveVideo/SaveAudio/VHS_VideoCombine/SaveAnimatedWEBP/SaveAnimatedPNG/SaveGLB/Preview3D + any found). A save node NOT in the set writes to the shared root — that is the bug.

**Step 3: Coverage guards (MANDATORY, the durable deliverable — Task 2b pattern).** Two tests that grep the engine and FAIL on drift: (a) every node matching the file-READ grep is either in `GRAPH_FILE_READERS` or on an explicit `NON_FILE_READ_EXEMPT` list (with a reason — e.g. the grep matched a dir-creation, not a read); (b) every node matching the file-WRITE grep is in `OUTPUT_CLASS_TYPES` or an explicit exempt list. A newly-added file-reading/writing node fails the suite instead of silently bypassing.

**Step 4: Expand `validateGraphFileRefs`** to walk `GRAPH_FILE_READERS`: for each node in the prompt, for each of its file-input specs, extract the referenced filename(s) per `shape` (string direct; json-path → parse the JSON value, walk to the array/field, collect names), resolve annotation via `annotatedFilepath`, and ownership-check per `semantics` (input → input_uploads; output → graph_runs; either → try both, own-if-either). Unknown/unparseable value on a known file input → refuse (fail closed). Keep the validation-before-hold ordering. Drop the wrong "LoadImageOutput.image is not upload-flagged" comment/test premise (it IS flagged — the map subsumes the hardcode).

**Step 5: Wire the expanded OUTPUT_CLASS_TYPES** into the injection (already reads the set) and confirm the settle/view round-trip test covers an `Image`-class output landing in `u_<hash>/`.

**Step 6: RED-first adversarial tests** — one per newly-covered reader class: a graph with `Load3D.image = "victim [output]"` / `Compositor.motion_params` embedding another tenant's rendered frame / `LoadLatent.latent = "other.latent"` etc. → 403, engine never touched, no hold. Own file → passes. An `Image`-class SaveImage subclass → output subfoldered. Plus the two coverage guards RED against the current (incomplete) maps.

**Step 7:** GREEN across the meter family + the new guards. **Step 8: Commit** — `fix(stage6): complete engine file-read/write ownership coverage — closes graph-laundered cross-tenant reads`.

### Task 7c: write-side containment + per-user output subfolders for the remaining writers (found across Task 7 review rounds)

**Context:** Task 7's `injectOutputSubfolder` only rewrites `filename_prefix`, so save nodes that place files via a DIFFERENT field skip per-user subfoldering — and one skips containment entirely. These are WRITE-integrity gaps (not cross-tenant reads — that objective is met), but a graph writing outside the output root or into the shared root is a real pre-deploy problem.

**The writers (verify each handler before fixing):**
- `SaveImageDataSetToFolder.execute` (`comfy_extras/nodes_dataset.py:237`): `os.path.join(get_output_directory(), folder_name)` with NO `commonpath` containment → `folder_name="../.."` writes OUTSIDE the output root (arbitrary filesystem write as the engine process). MOST SERIOUS.
- `SaveLoRA` (`prefix` field) and other dataset savers (`folder_name`) — write to the shared output root un-subfoldered (collision/exposure between tenants).
- `_live_preview.save_generation_output` — fixed `"generation"` prefix, uncontained (lower severity, preview).

**Files:** Modify `frontend/server/utils/meterGraphRun.ts` (or `engineFileSurface.ts`) — the injection; Test: extend `metered-prompt-forward.unit.spec.ts` + `engine-file-surface.unit.spec.ts`. Read-only: the engine save handlers.

**Step 1: Build `GRAPH_OUTPUT_WRITERS` — a per-class map of WHICH field carries the output path** (`filename_prefix` for the SaveImage family, `prefix` for SaveLoRA, `folder_name` for the dataset savers, etc.), covering every class in the expanded OUTPUT_CLASS_TYPES. This replaces the single hardcoded `filename_prefix` assumption in `injectOutputSubfolder`.
**Step 2: Generalize `injectOutputSubfolder`** to rewrite the RIGHT field per class: prepend `u_<callerHash>/` after stripping any `../`, absolute, or leading-`u_<seg>/` from the client value (the same sanitizeExistingPrefix hardening Task 7 uses for filename_prefix), so EVERY output writer lands under the caller's subtree and a `../..` traversal is neutralized before forwarding.
**Step 3: Coverage guard** — assert every class in OUTPUT_CLASS_TYPES has an entry in `GRAPH_OUTPUT_WRITERS` (which field) so a new save node can't be added without declaring its path field. Extend guard B.
**Step 4: RED-first** — `SaveImageDataSetToFolder {folder_name:"../../etc"}` → forwarded body has `folder_name` rewritten to `u_<hash>/...` (traversal neutralized); SaveLoRA `prefix` subfoldered; every OUTPUT_CLASS_TYPES class's path-field rewritten; local byte-identical.
**Step 5: Fix the cosmetic** `nodes_compositor.py` guard-note label (HTTP-route hit, not schema listing). **Step 6: Commit** — `fix(stage6): per-user output subfolders + traversal containment for all writers`.

### Task 8: Per-user settings + userdata — ComfyUI multi-user behind the proxy

**Files:**
- Modify: `start.sh` (hosted `--multi-user` flag), `frontend/server/utils/enginePath.ts` (+`/settings`, `/userdata` decision), `frontend/server/utils/engineGate.ts` (header-injecting forward), `frontend/server/middleware/comfyui-proxy.ts` (strip inbound `comfy-user` in ALL modes)
- Test: `frontend/tests/unit/settings-userdata-gate.unit.spec.ts`, extend `engine-path-alias.unit.spec.ts`

**Interfaces:** ComfyUI's `UserManager.get_request_user_id` (`app/user_manager.py:59-70`) reads the `comfy-user` header ONLY when the server runs `--multi-user`; without the flag it returns `"default"`. Verify both claims by reading the file before implementing.

- [ ] **Step 1: Failing tests**: hosted `GET/POST /settings*` and `/userdata*` (+ `/v2/userdata`, and alias spellings) → forwarded with `comfy-user: <caller clerk id>` and any CLIENT-SUPPLIED `comfy-user` header dropped (assert the forwarded headers contain exactly the server-set value even when the request carries a spoof); unauthenticated → 401 (middleware already); LOCAL: raw proxy exactly as today AND the inbound `comfy-user` strip applies there too (a local user can't hit multi-user paths anyway — without the flag the header is inert — but strip uniformly; assert byte-identity otherwise).
- [ ] **Step 2: RED → implement.** `enginePath.ts`: add `/settings` + `/userdata` + `/v2/userdata` to `ENGINE_ROUTE_PREFIXES` (they're engine mirror paths — check how the prefix list feeds normalization first) and branch: hosted GET/POST/DELETE on these → `{kind: 'userScoped'}`. `engineGate.ts` `handleHostedUserScoped(event)`: buffer body if present, forward to `resolveWorkerTarget` origin with original method/content-type, headers = originals MINUS `comfy-user` PLUS `comfy-user: event.context.userId`, return status+body verbatim. The middleware strips inbound `comfy-user` before ANY branch (one line, all modes).
- [ ] **Step 3: `start.sh`** — pass `--multi-user` ONLY on the hosted path (read how start.sh distinguishes; if it doesn't, gate on an env like `SAILOR_HOSTED=1` that the hosted deploy sets — document in the file). Local ComfyUI keeps single-user semantics; per-user dirs appear under `user/<clerk-id>/` on the volume in hosted.
- [ ] **Step 4: Live check on the hosted dev worktree**: boot ComfyUI with `--multi-user` + the hosted Nuxt server; with a fake-session harness or curl-with-session if available, `POST /settings/Comfy.Locale` then `GET /settings` for a SECOND user id → doesn't see the first user's write (this is the one leg unit tests can't prove — if no second session is available, verify by curling the engine directly with two different `comfy-user` headers and confirm two files under `user/`). SettingsModal needs zero edits — confirm by grep that it still calls `'/comfyui/settings'`.
- [ ] **Step 5: Commit** — `feat(stage6): per-user engine settings + userdata via --multi-user behind the authed proxy`.

---

### Task 9: Verification, docs, R2 decision record

**Files:**
- Create: `docs/superpowers/specs/2026-08-17-stage6-per-user-data-verification.md` (plain summary + evidence + Julien checklist + riders), R2 decision section inside it
- Modify: `docs/STATE.md`, `.superpowers/sdd/progress.md`, the ⛵ dashboard artifact (FETCH LIVE FIRST — parallel sessions edit it; merge, republish)

- [ ] **Step 1: Refresh the hosted worktree server** on :3100 to HEAD (kill by lsof open-file discovery, checkout, verify fresh pid + port). Boot ComfyUI with the hosted flags where needed.
- [ ] **Step 2: Automated probes** (no session): unauthed 401s on the new surfaces (`/sailor/projects`, `/settings`, `/api/training-queue`); local :3000 regression (brand kits/moodboards/templates/characters/loras/voices/projects/settings all serve unfiltered; `/sailor/spend/summary` still works locally); full Stage-5+6 unit family twice with identical counts (load-check first).
- [ ] **Step 3: Julien checklist** (write into the doc): (1) hosted: create a brand kit + moodboard + save a project, redeploy-simulate (restart server) → still there, still yours-only; (2) second account sees none of it and gets 404 probing your project uuid; (3) upload an image → it appears in LoadImage's picker (was empty since Stage 5), and a graph using it runs; try referencing a file you don't own via a hand-edited graph → clean refusal; (4) change a setting, reload → persists; second account has its own settings.
- [ ] **Step 3b: Deploy precondition (BLOCKER-B from Task-2 review):** hosted must launch with an EMPTY project store, or run a one-time ownership backfill — `nodes_sailor_projects.py` ships `comfynext→sailor` volume migrations, so a populated volume would hold OWNERLESS projects that become invisible + 404 to their own author after Task 2's gate. Record in the verification doc's deploy preconditions.
- [ ] **Step 4: R2 decision record** (inside the verification doc): DEFERRED post-beta — volume + `SAILOR_DATA_DIR` + per-user subfolders cover the 5-user beta; revisit at launch with egress numbers. Note what R2 will eventually buy (durability beyond one volume, egress offload, multi-machine).
- [ ] **Step 5: Riders forward:** `/view` `type=temp` still ungated (unpredictable names, low risk — note it); `ensureInputFilename` silent-fallback UX; per-user spend UI (ledger-backed) as a product feature; BYOK per-user secrets when hosted ever exposes them; house-styles publisher stays dev-only.
- [ ] **Step 6:** Update STATE.md + ledger + dashboard; run the final whole-branch review (fable) over the stage range per SDD; fix wave if needed; commit docs.

## Self-review notes

- Coverage vs the scout map: P0s → Tasks 2–3; unowned stores → 4–5; durability → 1 (`dataDir`) + 4–5 conversions + `start.sh` models symlink; empty pickers → 6; engine-side cross-tenant reads (LoadImageOutput/I1) → 7 (validation, not directory tricks — directories alone can't stop a node that takes arbitrary names); settings/userdata → 8; direct writers → 4 (moodboards) + 6 (lipsync); secrets → relocated in 1/4, per-user model deferred (decision 4); house styles exempt (decision 3); spend summary → 2 (403, decision 2); R2 → 9.
- Type consistency: `RESOURCE_KINDS` strings match every task's usage; `storeDir` names match Task 4's conversions; `canonicalUploadKey('input', '', name)` matches Task 6's `input::`-prefix listing; `outputKey` subfolder flow matches Task 7's injection.
- Every hosted behavior is gated; every task carries a local byte-identity assertion; adversarial RED-first is explicit on the security tasks (2, 6, 7, 8) per the Stage-5 lesson.
