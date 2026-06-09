# Durable generations + cost tracking — design

Two features that finish what Phase 0 started
([2026-06-02-phase0-project-persistence-spec.md](./2026-06-02-phase0-project-persistence-spec.md)):

1. **Full asset durability** — every completed run is recorded server-side per
   project, so the Assets panel, Home thumbnails, and project names survive
   ComfyUI restarts (today `/history` is an in-memory dict, `execution.py`
   `PromptQueue.history`) and browser-data wipes.
2. **Cost tracking** — a pre-run USD estimate on the Run controls with a
   confirm-above-threshold guard, plus a per-run spend ledger that powers
   "this project cost $X" / "this month: $Y" and per-generation cost labels.

Decisions made during brainstorming:

- **Frontend-driven recording** (not a server execution hook): the frontend
  already orchestrates every run, receives `executed`/`execution_complete`
  events, and owns the price-badge logic. The server stays a dumb store and the
  fork stays merge-friendly. Accepted trade-off: a run whose browser tab dies
  mid-flight goes unrecorded (the `/history` merge still catches it until
  restart).
- The generation record **is** the spend record — one POST per run feeds both
  features.
- Run guard: estimate always visible; confirm popover only above a threshold
  (default $1, a local setting).

## 1. Storage & server

Extends [comfy_extras/nodes_comfynext_projects.py](../../comfy_extras/nodes_comfynext_projects.py)
(same pure-storage-functions + thin-aiohttp-routes pattern).

```
user/comfynext/projects/<uuid>/generations.jsonl   # one line per completed run
user/comfynext/spend.jsonl                          # global ledger, one line per paid run
```

Generation record (one JSONL line):

```jsonc
{
  "id": "g_<ts36>_<seq>",
  "promptId": "…",            // ComfyUI prompt id — dedup key
  "ts": 1765000000000,
  "canvasId": "cv_…",          // which canvas of the ProjectDoc ran (nullable)
  "outputs": [ { "kind": "image|video|audio", "filename": "x.png", "subfolder": "", "type": "output" } ],
  "usd": 0.04,                 // estimated Replicate spend, null when unknown (e.g. backfill)
  "usdApproximate": true,
  "credits": null,             // Comfy-credits delta when the run used native API nodes
  "nodes": ["FluxProRemoteNode"] // node class types that ran (for display/debug)
}
```

Spend ledger line: `{ "ts", "projectUuid", "promptId", "usd", "credits" }`.

Routes:

| Route | Verb | Behavior |
|---|---|---|
| `/comfynext/projects/{uuid}/generations` | POST | Validate + append to the project's JSONL; skip if `promptId` already recorded (dedup); auto-`ensure_project` like version saves; when `usd` or `credits` > 0 also append the spend line. Returns `{id}` (or `{id, deduped:true}`). |
| `/comfynext/projects/{uuid}/generations` | GET | `{generations: [...]}` newest-first; corrupt lines skipped. |
| `/comfynext/spend/summary` | GET | `{ month: {usd, credits}, total: {usd, credits}, byProject: [{uuid, usd, credits}] }` — current calendar month computed server-side from `spend.jsonl`. |

Appends are small single-line writes (effectively atomic); reads tolerate a
truncated final line. Deleting a project removes its `generations.jsonl` but
**not** its spend lines — the ledger stays historically accurate.

## 2. Recording & migration (frontend)

- [default.vue](../../frontend/app/layouts/default.vue) records on
  `execution_complete`: it already collects per-node outputs and computes
  `estimateReplicateUsd()` / the credits delta for the status bar — the same
  data is POSTed as a generation record. New `useProjects().saveGeneration()`
  wrapper, degrading gracefully like every other call in that composable.
- **Lazy backfill:** when a project opens (or appears on Home) and its durable
  generations list is empty, harvest that uuid's completed runs from the live
  `/history` and POST them with `usd: null`. Best-effort; server dedup makes it
  idempotent.
- **Rename leak fix:** `setProjectName` in
  [useRecentProjects.ts](../../frontend/app/composables/useRecentProjects.ts)
  also calls `renameProject` (server). localStorage stays as offline fallback.

## 3. Read paths flip to durable-first

- [useProjectGenerations.ts](../../frontend/app/composables/useProjectGenerations.ts)
  (Assets panel): primary source = durable endpoint; merge in any `/history`
  runs not yet recorded (by promptId). Output files live in `output/` and
  survive restarts, so `/view` URLs keep working — no cover.webp generation.
- [useRecentProjects.ts](../../frontend/app/composables/useRecentProjects.ts)
  (Home): durable projects are the primary list, thumbnails from their last 3
  image outputs in the generation records; the `/history` grouping remains only
  as fallback for never-saved work.

## 4. Pre-run estimate + confirm

- Extract the badge-tally logic from `estimateReplicateUsd()`
  ([default.vue](../../frontend/app/layouts/default.vue)) into
  `frontend/app/lib/costEstimate.ts`:
  `estimateRunUsd(nodes): { usd, approximate, pricedCount, breakdown: [{label, usd}] }`.
  Static badge JSON parsed exactly; dynamic JSONata badges contribute their
  first numeric `usd` as a floor and mark the estimate approximate. Both the
  pre-run and the existing post-run path use this helper.
- Pre-run, the helper runs over the **filtered to-run node set** (same set
  `useFilteredPrompt` produces — selection/group runs estimate only what runs).
  Multi-iteration text-autofill runs multiply by the iteration count.
- Run controls show `~$X.XX` inline when the estimate > 0.
- **Threshold confirm:** new local setting `costConfirmThreshold` (USD, default
  1, editable in Settings; 0 = always confirm, blank/∞ = never). When the
  estimate ≥ threshold, queueing pauses on a small confirm popover anchored to
  the run control showing the per-node breakdown, Confirm / Cancel. Applies to
  every run entry point that goes through the shared run path.

## 5. Spend visibility

- [ProjectMenu.vue](../../frontend/app/components/vue-canvas/ProjectMenu.vue)
  dropdown gets two quiet read-only lines: "This project · ~$14.20" and
  "This month · ~$52" (from `/comfynext/spend/summary`, fetched on open).
- Asset detail overlay shows the generation's cost when the record has one.
- CanvasStatusBar post-run behavior unchanged.

## Error handling

Everything degrades like Phase 0: missing endpoints or network errors resolve
to empty results with a console warning, never a thrown error in the UI path.
Recording failures never block or fail a run. Backfill failures are silent
(history fallback still renders).

## Testing

- **Python (pytest, tests-unit/):** unit tests for the new storage functions —
  append + dedup by promptId, newest-first listing, corrupt-line tolerance,
  spend append rules (only when usd/credits > 0), month summary math, project
  deletion leaving spend intact. Mirrors the existing project-storage tests.
- **Frontend:** no TS runner exists yet (per Phase 0 spec); manual smoke
  protocol: run a priced workflow → see estimate on Run, confirm popover above
  threshold, record appears in Assets with cost → restart ComfyUI → Assets,
  names, thumbnails, and spend totals all intact.

## Non-goals

- Real spend reconciliation against Replicate's billing API (estimates only).
- Cover image generation (output files + `/view` suffice).
- Multi-user/auth on the ledger.
- Persisting ComfyUI's `/history` itself.
