# Durable Generations + Cost Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every completed run as a server-side generation record (so assets/names/thumbnails survive ComfyUI restarts and browser wipes), and add a pre-run USD estimate with confirm-above-threshold plus a spend ledger.

**Architecture:** Frontend-driven recording — the Vue layout already orchestrates every run; at `execution_complete` it POSTs one record to a new `/sailor/projects/{uuid}/generations` endpoint, which appends to a per-project `generations.jsonl` AND a global `spend.jsonl` in the same handler. Read paths (Assets panel, Home) flip to durable-first with `/history` as merge/fallback. Cost estimation is extracted into a pure lib reused pre-run (Run button + confirm modal) and post-run (status bar).

**Tech Stack:** Python (ComfyUI comfy_extras module, aiohttp, pytest), Nuxt 4 / Vue 3 / TypeScript frontend.

**Spec:** [2026-06-09-durable-generations-and-cost-tracking-design.md](./2026-06-09-durable-generations-and-cost-tracking-design.md)

**Conventions:**
- Python tests: `.venv/bin/python -m pytest tests-unit/comfy_api_test/projects_storage_test.py -v` from repo root.
- The frontend has NO test runner (per Phase 0 spec). Frontend tasks are verified by the dev server (`cd frontend && npm run dev`) + the manual checks listed in each task. Keep new TS logic in pure lib files so a future runner can cover it.
- Commit after every task. Messages follow the repo's style (`Area: what changed`).

---

### Task 1: Python storage — generation records (append/list with dedup)

**Files:**
- Modify: `comfy_extras/nodes_sailor_projects.py` (pure storage section, after `read_version` ~line 175)
- Test: `tests-unit/comfy_api_test/projects_storage_test.py` (append new section at end)

- [ ] **Step 1: Write the failing tests**

Append to `tests-unit/comfy_api_test/projects_storage_test.py`:

```python
# --------------------------------------------------------------------------- #
# Generation records (durable per-run history)
# --------------------------------------------------------------------------- #

def test_append_and_list_generations_newest_first(root):
    P.ensure_project(root, "p", now=1)
    P.append_generation(root, "p", {"id": "g_1", "promptId": "pr1", "ts": 100, "outputs": []})
    P.append_generation(root, "p", {"id": "g_2", "promptId": "pr2", "ts": 300, "outputs": []})
    P.append_generation(root, "p", {"id": "g_3", "promptId": "pr3", "ts": 200, "outputs": []})
    gens = P.list_generations(root, "p")
    assert [g["id"] for g in gens] == ["g_2", "g_3", "g_1"]


def test_append_generation_dedups_by_prompt_id(root):
    P.ensure_project(root, "p", now=1)
    first = P.append_generation(root, "p", {"id": "g_1", "promptId": "pr1", "ts": 100})
    assert first is not None
    dup = P.append_generation(root, "p", {"id": "g_2", "promptId": "pr1", "ts": 200})
    assert dup is None
    assert len(P.list_generations(root, "p")) == 1


def test_append_generation_fills_id_and_ts(root):
    P.ensure_project(root, "p", now=1)
    stored = P.append_generation(root, "p", {"promptId": "pr1"}, now=555)
    assert stored["id"].startswith("g_")
    assert stored["ts"] == 555


def test_list_generations_missing_file_or_project(root):
    assert P.list_generations(root, "nope") == []
    P.ensure_project(root, "p", now=1)
    assert P.list_generations(root, "p") == []


def test_list_generations_skips_corrupt_lines(root):
    P.ensure_project(root, "p", now=1)
    P.append_generation(root, "p", {"id": "g_1", "promptId": "pr1", "ts": 100})
    with open(P._generations_file(root, "p"), "a", encoding="utf-8") as f:
        f.write("{ not valid json\n")
    P.append_generation(root, "p", {"id": "g_2", "promptId": "pr2", "ts": 200})
    assert [g["id"] for g in P.list_generations(root, "p")] == ["g_2", "g_1"]


def test_append_generation_bad_uuid_raises(root):
    with pytest.raises(ValueError):
        P.append_generation(root, "../evil", {"promptId": "x"})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/projects_storage_test.py -v -k generation`
Expected: 6 FAILED with `AttributeError: ... has no attribute 'append_generation'`

- [ ] **Step 3: Implement the storage functions**

In `comfy_extras/nodes_sailor_projects.py`, extend the top-level imports to:

```python
import json
import os
import shutil
import tempfile
import uuid as uuidlib
```

After `read_version` (end of the pure storage section), add:

```python
def _generations_file(root: str, uuid: str) -> str:
    return os.path.join(_project_dir(root, uuid), "generations.jsonl")


def list_generations(root: str, uuid: str) -> list[dict]:
    """All recorded runs for a project, newest first. Corrupt or truncated
    lines (e.g. a crash mid-append) are skipped, never fatal."""
    if not _is_safe_id(uuid):
        return []
    out: list[dict] = []
    try:
        with open(_generations_file(root, uuid), "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(rec, dict):
                    out.append(rec)
    except OSError:
        return []
    out.sort(key=lambda g: g.get("ts") or 0, reverse=True)
    return out


def append_generation(root: str, uuid: str, record: dict, *, now: int = 0) -> dict | None:
    """Append one run record (JSONL). Dedup by promptId so history backfill is
    idempotent — returns None when that promptId is already recorded."""
    if not _is_safe_id(uuid):
        raise ValueError("invalid project uuid")
    pid = record.get("promptId")
    if pid and any(g.get("promptId") == pid for g in list_generations(root, uuid)):
        return None
    rec = dict(record)
    rec.setdefault("id", f"g_{uuidlib.uuid4().hex[:12]}")
    rec.setdefault("ts", now)
    path = _generations_file(root, uuid)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec) + "\n")
    return rec
```

Note: the route shell at the bottom of the file imports `uuid as _uuidlib` inside the try-block — leave that alone; the new top-level `uuidlib` import is for the pure layer.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/projects_storage_test.py -v`
Expected: all PASS (existing 20 + new 6)

- [ ] **Step 5: Commit**

```bash
git add comfy_extras/nodes_sailor_projects.py tests-unit/comfy_api_test/projects_storage_test.py
git commit -m "Projects: durable per-run generation records (storage layer)"
```

---

### Task 2: Python storage — spend ledger + monthly summary

**Files:**
- Modify: `comfy_extras/nodes_sailor_projects.py` (pure storage section)
- Test: `tests-unit/comfy_api_test/projects_storage_test.py`

- [ ] **Step 1: Write the failing tests**

Append:

```python
# --------------------------------------------------------------------------- #
# Spend ledger
# --------------------------------------------------------------------------- #

# 2026-06-15T00:00:00Z and 2026-05-15T00:00:00Z in ms — fixed so the month
# bucketing test is deterministic.
JUNE_TS = 1781481600000
MAY_TS = 1778803200000


@pytest.fixture
def ledger(tmp_path):
    return P.spend_file(str(tmp_path))


def test_spend_file_layout(tmp_path):
    assert P.spend_file(str(tmp_path)).endswith(os.path.join("sailor", "spend.jsonl"))


def test_append_spend_skips_free_runs(ledger):
    P.append_spend(ledger, {"ts": JUNE_TS, "projectUuid": "p", "usd": 0, "credits": None})
    P.append_spend(ledger, {"ts": JUNE_TS, "projectUuid": "p", "usd": None, "credits": 0})
    assert not os.path.exists(ledger)


def test_spend_summary_months_and_projects(ledger):
    P.append_spend(ledger, {"ts": JUNE_TS, "projectUuid": "a", "promptId": "1", "usd": 0.04, "credits": None})
    P.append_spend(ledger, {"ts": JUNE_TS, "projectUuid": "a", "promptId": "2", "usd": 6.0, "credits": None})
    P.append_spend(ledger, {"ts": JUNE_TS, "projectUuid": "b", "promptId": "3", "usd": None, "credits": 120})
    P.append_spend(ledger, {"ts": MAY_TS, "projectUuid": "a", "promptId": "4", "usd": 1.0, "credits": None})
    s = P.spend_summary(ledger, now_ms=JUNE_TS)
    assert s["month"]["usd"] == pytest.approx(6.04)
    assert s["month"]["credits"] == 120
    assert s["total"]["usd"] == pytest.approx(7.04)
    by = {p["uuid"]: p for p in s["byProject"]}
    assert by["a"]["usd"] == pytest.approx(7.04)
    assert by["b"]["credits"] == 120


def test_spend_summary_empty_and_corrupt(ledger):
    s = P.spend_summary(ledger, now_ms=JUNE_TS)
    assert s == {"month": {"usd": 0, "credits": 0}, "total": {"usd": 0, "credits": 0}, "byProject": []}
    os.makedirs(os.path.dirname(ledger), exist_ok=True)
    with open(ledger, "w", encoding="utf-8") as f:
        f.write("garbage\n")
    P.append_spend(ledger, {"ts": JUNE_TS, "projectUuid": "a", "usd": 1.0})
    assert P.spend_summary(ledger, now_ms=JUNE_TS)["total"]["usd"] == pytest.approx(1.0)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/projects_storage_test.py -v -k spend`
Expected: FAILED with `AttributeError: ... no attribute 'spend_file'`

- [ ] **Step 3: Implement**

Add `import datetime` to the top-level imports. After `append_generation`, add:

```python
def spend_file(user_dir: str) -> str:
    """Global spend ledger — NOT under projects/, so deleting a project keeps
    its historical spend (the ledger stays accurate)."""
    return os.path.join(user_dir, "sailor", "spend.jsonl")


def append_spend(path: str, entry: dict) -> None:
    """Append one ledger line. Free runs (no usd, no credits) are not logged."""
    usd = entry.get("usd") or 0
    credits = entry.get("credits") or 0
    if usd <= 0 and credits <= 0:
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def _month_key(ts_ms: int) -> str:
    dt = datetime.datetime.fromtimestamp((ts_ms or 0) / 1000, datetime.timezone.utc)
    return dt.strftime("%Y-%m")


def spend_summary(path: str, *, now_ms: int) -> dict:
    """Totals for the current UTC calendar month, all time, and per project."""
    month = {"usd": 0, "credits": 0}
    total = {"usd": 0, "credits": 0}
    by_project: dict[str, dict] = {}
    cur = _month_key(now_ms)
    try:
        with open(path, "r", encoding="utf-8") as f:
            lines = f.readlines()
    except OSError:
        lines = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(e, dict):
            continue
        usd = float(e.get("usd") or 0)
        credits = e.get("credits") or 0
        total["usd"] += usd
        total["credits"] += credits
        if _month_key(e.get("ts") or 0) == cur:
            month["usd"] += usd
            month["credits"] += credits
        pu = e.get("projectUuid") or "unknown"
        bp = by_project.setdefault(pu, {"uuid": pu, "usd": 0, "credits": 0})
        bp["usd"] += usd
        bp["credits"] += credits
    ranked = sorted(by_project.values(), key=lambda d: -d["usd"])
    return {"month": month, "total": total, "byProject": ranked}
```

- [ ] **Step 4: Run all tests**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/projects_storage_test.py -v`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add comfy_extras/nodes_sailor_projects.py tests-unit/comfy_api_test/projects_storage_test.py
git commit -m "Projects: global spend ledger + monthly summary (storage layer)"
```

---

### Task 3: aiohttp routes for generations + spend summary

**Files:**
- Modify: `comfy_extras/nodes_sailor_projects.py` (route shell, inside the existing `try:` block, after `_versions_get_route`)

- [ ] **Step 1: Add the routes**

Inside the existing `try:` block, after `_versions_get_route` (~line 256), add:

```python
    @PromptServer.instance.routes.post("/sailor/projects/{uuid}/generations")
    async def _generations_post_route(request):
        uid = request.match_info["uuid"]
        try:
            body = await request.json()
        except Exception as e:
            return web.json_response({"error": f"bad json: {e}"}, status=400)
        now = _now_ms()
        record = dict(body.get("generation") or {})
        record.setdefault("id", f"g_{_uuidlib.uuid4().hex[:12]}")
        record.setdefault("ts", now)
        try:
            ensure_project(_root(), uid, name=body.get("projectName") or "Untitled project", now=now)
            stored = append_generation(_root(), uid, record, now=now)
        except ValueError as e:
            return web.json_response({"error": str(e)}, status=400)
        if stored is None:  # promptId already recorded (backfill re-post)
            return web.json_response({"id": record["id"], "deduped": True})
        append_spend(spend_file(folder_paths.get_user_directory()), {
            "ts": stored.get("ts"),
            "projectUuid": uid,
            "promptId": stored.get("promptId"),
            "usd": stored.get("usd"),
            "credits": stored.get("credits"),
        })
        project = read_project(_root(), uid)
        if project:
            project["updatedAt"] = now
            write_project(_root(), project)
        return web.json_response({"id": stored["id"]})

    @PromptServer.instance.routes.get("/sailor/projects/{uuid}/generations")
    async def _generations_list_route(request):
        return web.json_response({"generations": list_generations(_root(), request.match_info["uuid"])})

    @PromptServer.instance.routes.get("/sailor/spend/summary")
    async def _spend_summary_route(_request):
        path = spend_file(folder_paths.get_user_directory())
        return web.json_response(spend_summary(path, now_ms=_now_ms()))
```

- [ ] **Step 2: Restart ComfyUI and verify with curl**

ComfyUI must be restarted to pick up the module (`cd /Users/julien/Documents/GitHub/Sailor && .venv/bin/python main.py --listen 127.0.0.1 --port 8188`, or ask the user to restart their running instance).

```bash
curl -s -X POST http://127.0.0.1:8188/sailor/projects/curltest-uuid/generations \
  -H 'Content-Type: application/json' \
  -d '{"projectName":"Curl Test","generation":{"promptId":"pr_x","outputs":[{"kind":"image","filename":"a.png","subfolder":"","type":"output"}],"usd":0.04,"nodes":["FluxProRemoteNode"]}}'
# Expected: {"id": "g_..."}
curl -s -X POST http://127.0.0.1:8188/sailor/projects/curltest-uuid/generations \
  -H 'Content-Type: application/json' -d '{"generation":{"promptId":"pr_x"}}'
# Expected: {"id": "...", "deduped": true}
curl -s http://127.0.0.1:8188/sailor/projects/curltest-uuid/generations
# Expected: {"generations": [{...one record...}]}
curl -s http://127.0.0.1:8188/sailor/spend/summary
# Expected: {"month": {"usd": 0.04, ...}, "total": {...}, "byProject": [{"uuid": "curltest-uuid", ...}]}
```

Clean up the test project: `curl -s -X DELETE http://127.0.0.1:8188/sailor/projects/curltest-uuid` (spend line intentionally remains).

- [ ] **Step 3: Commit**

```bash
git add comfy_extras/nodes_sailor_projects.py
git commit -m "Projects: generations + spend summary routes"
```

---

### Task 4: `lib/costEstimate.ts` + refactor the post-run estimator

**Files:**
- Create: `frontend/app/lib/costEstimate.ts`
- Modify: `frontend/app/layouts/default.vue:1391-1430` (`estimateReplicateUsd`)

- [ ] **Step 1: Create the pure estimation lib**

`frontend/app/lib/costEstimate.ts`:

```typescript
/**
 * costEstimate — pure USD estimation from node price badges.
 *
 * Replicate BYOK nodes (class names end in "RemoteNode", see
 * comfy_api_nodes/nodes_replicate.py) declare a price_badge whose expr is
 * either a static JSON literal (`{"type":"usd","usd":0.04,...}`) or a dynamic
 * JSONata expression. Static parses exactly; dynamic contributes its first
 * numeric "usd" value as a floor and marks the whole estimate approximate.
 * Used pre-run (Run button + confirm guard) and post-run (status bar tally).
 */

export interface BadgeCost { usd: number; approximate: boolean }

export function parseBadgeUsd(expr: string | null | undefined): BadgeCost | null {
  if (!expr) return null
  const s = String(expr).trim()
  try {
    const parsed = JSON.parse(s)
    if (typeof parsed?.usd === 'number') {
      return { usd: parsed.usd, approximate: !!parsed?.format?.approximate }
    }
  } catch { /* not a JSON literal — fall through to the JSONata floor */ }
  const match = s.match(/"usd"\s*:\s*([0-9]+\.?[0-9]*)/)
  if (match) return { usd: parseFloat(match[1]!), approximate: true }
  return null
}

export interface EstimateInputNode {
  id: string
  type: string
  title?: string
  badgeExpr?: string | null
}
export interface CostBreakdownItem { id: string; label: string; usd: number }
export interface CostEstimate { usd: number; approximate: boolean; breakdown: CostBreakdownItem[] }

/** Sum USD across the BYOK Replicate nodes in the list. Null when none are priced. */
export function estimateUsdForNodes(nodes: EstimateInputNode[]): CostEstimate | null {
  let usd = 0
  let approximate = false
  const breakdown: CostBreakdownItem[] = []
  for (const n of nodes) {
    if (!n.type?.endsWith('RemoteNode')) continue
    const cost = parseBadgeUsd(n.badgeExpr)
    if (!cost) continue
    usd += cost.usd
    approximate = approximate || cost.approximate
    breakdown.push({ id: n.id, label: n.title || n.type, usd: cost.usd })
  }
  return breakdown.length ? { usd, approximate, breakdown } : null
}

/** Adapt Vue Flow canvas nodes (ComfyNode data shape) to estimate input.
 *  Disabled nodes (mode 2) are excluded — they don't run. */
export function vueNodesToEstimateInput(nodes: any[]): EstimateInputNode[] {
  return (nodes || [])
    .filter((n: any) => ((n?.data?.mode ?? 0) !== 2))
    .map((n: any) => ({
      id: String(n.id),
      type: String(n?.data?.type || ''),
      title: n?.data?.title,
      badgeExpr: n?.data?.priceBadge?.expr ?? null,
    }))
}
```

- [ ] **Step 2: Refactor `estimateReplicateUsd` in default.vue to use it**

Add to the imports in `frontend/app/layouts/default.vue` (script setup top, near the `projectDoc` import):

```typescript
import { estimateUsdForNodes, vueNodesToEstimateInput, type CostEstimate } from '~/lib/costEstimate'
```

Replace the body of `estimateReplicateUsd` (lines 1395-1430) with:

```typescript
function estimateReplicateUsd(): { usd: number; approximate: boolean } | null {
  const nodes = vueCanvasRef.value?.getNodes?.() || []
  const ran = nodes.filter((n: any) => executedNodeIds.has(String(n.id)))
  const est = estimateUsdForNodes(vueNodesToEstimateInput(ran))
  return est ? { usd: est.usd, approximate: est.approximate } : null
}
```

Keep the explanatory comment block above the function (lines 1391-1394) — update its second line to say the tally now lives in `lib/costEstimate.ts`.

- [ ] **Step 3: Verify**

With `cd frontend && npm run dev` running and a project containing a priced Replicate node (e.g. Generate Image / Flux): run it; after completion the status bar must still show `· ~$0.04` exactly as before the refactor. No console errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/lib/costEstimate.ts frontend/app/layouts/default.vue
git commit -m "Cost: extract price-badge estimation into lib/costEstimate"
```

---

### Task 5: `lib/generations.ts` — output extraction shared by record + read paths

**Files:**
- Create: `frontend/app/lib/generations.ts`
- Modify: `frontend/app/composables/useProjectGenerations.ts` (use the shared helpers; no behavior change yet)

- [ ] **Step 1: Create the lib**

`frontend/app/lib/generations.ts`:

```typescript
/**
 * generations — shared shapes + parsing for durable generation records.
 *
 * One generation record = one completed run (see the design doc). The same
 * output-extraction logic serves three callers: recording at
 * execution_complete (bridge `executed` payloads), reading records back, and
 * parsing legacy /history entries for merge + backfill.
 */

export type GenKind = 'image' | 'video' | 'audio'

export interface GenOutput { kind: GenKind; filename: string; subfolder: string; type: string }

export interface GenerationRecord {
  id?: string
  promptId: string
  ts: number
  canvasId?: string | null
  outputs: GenOutput[]
  usd?: number | null
  usdApproximate?: boolean
  credits?: number | null
  nodes?: string[]
}

export function classifyOutput(filename: string): GenKind {
  const f = (filename || '').toLowerCase()
  if (/\.(mp4|webm|mov|avi|mkv|m4v)$/.test(f)) return 'video'
  if (/\.(mp3|wav|flac|ogg|m4a|aac)$/.test(f)) return 'audio'
  return 'image'
}

/** Final saved files from one node's output dict (a bridge `executed` payload
 *  or one entry of a /history `outputs` map). Live-preview temp frames are
 *  skipped — only `type: 'output'` files persist on disk. */
export function extractOutputFiles(output: any): GenOutput[] {
  const out: GenOutput[] = []
  for (const key of ['images', 'gifs', 'audio', 'video']) {
    const arr = output?.[key]
    if (!Array.isArray(arr)) continue
    for (const f of arr) {
      if (!f?.filename || f.type !== 'output') continue
      out.push({ kind: classifyOutput(f.filename), filename: f.filename, subfolder: f.subfolder || '', type: f.type })
    }
  }
  return out
}

/** Parse one completed /history entry into a generation record + the project
 *  uuid it was stamped with (null when the run predates uuid stamping). */
export function historyEntryToRecord(promptId: string, entry: any): { record: GenerationRecord; projectUuid: string | null } | null {
  if (!entry?.status?.completed) return null
  const startMsg = (entry.status?.messages ?? []).find((m: any) => m[0] === 'execution_start')
  const ts = startMsg?.[1]?.timestamp ?? 0
  const prompt = entry.prompt ?? []
  const nodes = prompt[2] ?? {}
  const workflow = prompt[3]?.extra_pnginfo?.workflow ?? {}
  const projectUuid = workflow.extra?.projectUuid || null
  const outputs: GenOutput[] = []
  for (const nodeOut of Object.values(entry.outputs ?? {})) outputs.push(...extractOutputFiles(nodeOut))
  if (!outputs.length) return null
  const classTypes = [...new Set(Object.values(nodes).map((n: any) => n.class_type || ''))].filter(Boolean) as string[]
  return {
    record: { promptId, ts, canvasId: null, outputs, usd: null, usdApproximate: false, credits: null, nodes: classTypes },
    projectUuid,
  }
}
```

- [ ] **Step 2: Use it in useProjectGenerations (pure refactor)**

In `frontend/app/composables/useProjectGenerations.ts`:
- Add `import { classifyOutput, extractOutputFiles } from '~/lib/generations'` at the top.
- Delete the local `classify` function (lines 29-34).
- Replace the inner output-collection loop (lines 84-104, the `const assets: GenAsset[] = []` block) with:

```typescript
        const assets: GenAsset[] = []
        for (const nodeOut of Object.values(e.outputs ?? {})) {
          for (const o of extractOutputFiles(nodeOut)) {
            assets.push({ ...o, promptId, timestamp })
          }
        }
```

- The `GenAsset` interface's `kind` field type stays as-is (`'image' | 'video' | 'audio'` is identical to `GenKind`).
- Search the file for any other `classify(` call sites and switch them to `classifyOutput(`. Also run `grep -rn "from '~/composables/useProjectGenerations'" frontend/app` — `AssetsPanel.vue` defines its own local `classify`; leave it (out of scope).

- [ ] **Step 3: Verify**

Dev server: open the Assets panel — same assets render as before the refactor (this is behavior-preserving).

- [ ] **Step 4: Commit**

```bash
git add frontend/app/lib/generations.ts frontend/app/composables/useProjectGenerations.ts
git commit -m "Generations: shared output-extraction lib"
```

---

### Task 6: `useProjects` client — saveGeneration / listGenerations / spendSummary

**Files:**
- Modify: `frontend/app/composables/useProjects.ts`

- [ ] **Step 1: Add the methods**

In `frontend/app/composables/useProjects.ts`, add the import at top:

```typescript
import type { GenerationRecord } from '~/lib/generations'
```

Add before the closing `return`:

```typescript
  /** Record one completed run (also feeds the global spend ledger server-side).
   *  Fire-and-forget safe: failures only warn. */
  async function saveGeneration(
    uuid: string,
    generation: GenerationRecord,
    projectName?: string,
  ): Promise<string | null> {
    try {
      const res = await $fetch<{ id: string }>(
        `/sailor/projects/${encodeURIComponent(uuid)}/generations`,
        { method: 'POST', body: { projectName, generation } },
      )
      return res.id ?? null
    } catch (e) {
      console.warn('[useProjects] saveGeneration failed:', e)
      return null
    }
  }

  async function listGenerations(uuid: string): Promise<GenerationRecord[]> {
    try {
      const res = await $fetch<{ generations: GenerationRecord[] }>(
        `/sailor/projects/${encodeURIComponent(uuid)}/generations`,
      )
      return res.generations ?? []
    } catch (e) {
      console.warn('[useProjects] listGenerations failed:', e)
      return []
    }
  }

  async function fetchSpendSummary(): Promise<SpendSummary | null> {
    try {
      return await $fetch<SpendSummary>('/sailor/spend/summary')
    } catch (e) {
      console.warn('[useProjects] spend summary failed:', e)
      return null
    }
  }
```

Add the interface near the other exported interfaces:

```typescript
export interface SpendSummary {
  month: { usd: number; credits: number }
  total: { usd: number; credits: number }
  byProject: { uuid: string; usd: number; credits: number }[]
}
```

Update the return statement to:

```typescript
  return { listProjects, loadProject, saveVersion, loadVersion, renameProject, deleteProject, saveGeneration, listGenerations, fetchSpendSummary }
```

- [ ] **Step 2: Verify + commit**

Dev server compiles without TS errors.

```bash
git add frontend/app/composables/useProjects.ts
git commit -m "Projects client: saveGeneration / listGenerations / spend summary"
```

---

### Task 7: Record generations at execution_complete

**Files:**
- Modify: `frontend/app/layouts/default.vue` — bridge event handler (`execution_start` ~line 1785, `executed` ~line 1829, `execution_complete` ~line 1838), credits watcher (~line 1438), state block (~line 1387)

- [ ] **Step 1: Add recording state + flush helper**

Next to `const executedNodeIds = new Set<string>()` (line 1389), add:

```typescript
// Output files collected from `executed` events during the current run — the
// durable generation record is assembled from these at execution_complete.
const runOutputs: GenOutput[] = []

// A record waiting for its cost. Replicate-billed runs flush immediately
// (Comfy's balance won't move); credit-billed runs wait for the balance
// watcher's delta (or the deadline timer) so the record carries real credits.
let pendingGen: {
  projectUuid: string
  projectName?: string
  record: GenerationRecord
  flushed: boolean
  timer: ReturnType<typeof setTimeout> | null
} | null = null

function flushPendingGen(creditsDelta?: number | null) {
  if (!pendingGen || pendingGen.flushed) return
  pendingGen.flushed = true
  if (pendingGen.timer) clearTimeout(pendingGen.timer)
  if (typeof creditsDelta === 'number' && creditsDelta > 0) pendingGen.record.credits = creditsDelta
  useProjects().saveGeneration(pendingGen.projectUuid, pendingGen.record, pendingGen.projectName)
  pendingGen = null
}
```

Add the type import next to the costEstimate import from Task 4:

```typescript
import type { GenOutput, GenerationRecord } from '~/lib/generations'
import { extractOutputFiles } from '~/lib/generations'
```

- [ ] **Step 2: Collect outputs + reset per run**

In the `execution_start` branch (after `executedNodeIds.clear()` line 1804) add:

```typescript
    runOutputs.length = 0
    flushPendingGen() // a previous run still waiting on credits records as-is
```

In the `executed` branch (line 1829, first statement inside) add:

```typescript
    if (event.data.output) runOutputs.push(...extractOutputFiles(event.data.output))
```

- [ ] **Step 3: Build + post the record at execution_complete**

In the `execution_complete` branch: directly after `const wasSilent = currentRunSilent.value` / `currentRunSilent.value = false` (lines 1853-1854), insert:

```typescript
    // Durable generation record — silent/live runs count too (they spend real
    // money). Fire-and-forget; never blocks the UI path.
    const runProjectUuid = projectTabs.find((t) => t.id === tabId)?.projectUuid || null
    const replicateEstimate = validatedRun ? estimateReplicateUsd() : null
    if (runProjectUuid && validatedRun && (runOutputs.length || replicateEstimate)) {
      const runDoc = savedWorkflows[tabId]
      const vueNodes = vueCanvasRef.value?.getNodes?.() || []
      const ranTypes = [...executedNodeIds]
        .map((id) => vueNodes.find((n: any) => n.id === id)?.data?.type)
        .filter(Boolean) as string[]
      pendingGen = {
        projectUuid: runProjectUuid,
        projectName: projectTabs.find((t) => t.id === tabId)?.label,
        record: {
          promptId: prompt_id || `local_${Date.now().toString(36)}`,
          ts: Date.now(),
          canvasId: isProjectDoc(runDoc) ? runDoc.activeCanvasId : null,
          outputs: [...runOutputs],
          usd: replicateEstimate?.usd ?? null,
          usdApproximate: replicateEstimate?.approximate ?? false,
          credits: null,
          nodes: [...new Set(ranTypes)],
        },
        flushed: false,
        timer: null,
      }
      if (replicateEstimate) {
        flushPendingGen()
      } else {
        pendingGen.timer = setTimeout(() => flushPendingGen(), 9000)
      }
    }
    runOutputs.length = 0
```

Then in the success branch below (line 1861), replace `const replicate = estimateReplicateUsd()` with `const replicate = replicateEstimate` (one estimate per run, computed once above).

- [ ] **Step 4: Feed the credits delta into the pending record**

In the credits watcher (line 1438-1449), after `lastRunResult.value = { ...result, cost: delta }` add:

```typescript
    flushPendingGen(delta)
```

- [ ] **Step 5: Verify**

Dev server + ComfyUI running. Run a priced Replicate workflow in a project tab. Then:

```bash
curl -s "http://127.0.0.1:8188/sailor/projects/<the project uuid>/generations" | python3 -m json.tool
```

Expected: one record with the run's `promptId`, the output image(s), `usd` ≈ the badge price, `nodes` listing the Replicate class. Run it again → two records. `curl -s http://127.0.0.1:8188/sailor/spend/summary` shows the accumulated USD. (Find the uuid via `curl -s http://127.0.0.1:8188/sailor/projects`.)

- [ ] **Step 6: Commit**

```bash
git add frontend/app/layouts/default.vue
git commit -m "Runs: record every completed run as a durable generation + spend entry"
```

---

### Task 8: Pre-run estimate, confirm modal, threshold setting

**Files:**
- Modify: `frontend/app/layouts/default.vue` — `runVueWorkflow` (line 359), `maybeRunWithTextAutofill` (line 522), `handleRunTextIterator` (line 640), `onMounted`/`onBeforeUnmount` (line 691), Run button template (line 2389), template root (add modal near the credits modal markup)
- Modify: `frontend/app/components/SettingsModal.vue` — `execution` settings array (line 98)

- [ ] **Step 1: Threshold setting**

In `SettingsModal.vue`, append to the `execution` array (line 113, after `Comfy.Validation.Workflows`):

```typescript
    { id: 'Sailor.Cost.ConfirmThresholdUsd', label: 'Confirm runs above (USD)', type: 'text', local: true, description: 'Ask before queueing runs whose estimated cost meets this amount. Default 1. Set 0 to ask for every paid run.' },
```

(`type: 'text'` + `local: true` is the proven combo — the Anthropic API key setting uses it; number inputs don't have a local-save branch.)

In `default.vue`, add near `flushPendingGen` from Task 7:

```typescript
function costConfirmThresholdUsd(): number {
  const raw = useLocalSettings().getLocalSetting('Sailor.Cost.ConfirmThresholdUsd')
  const n = parseFloat(raw ?? '')
  return Number.isFinite(n) && n >= 0 ? n : 1
}
```

- [ ] **Step 2: Confirm modal state + promise**

In `default.vue` script, next to the credits modal state (~line 1454):

```typescript
// Pre-run cost guard — promise-based confirm so runVueWorkflow can await it.
const costConfirm = ref<{ estimate: CostEstimate; iterations: number; resolve: (ok: boolean) => void } | null>(null)
function confirmRunCost(estimate: CostEstimate, iterations = 1): Promise<boolean> {
  return new Promise((resolve) => { costConfirm.value = { estimate, iterations, resolve } })
}
function resolveCostConfirm(ok: boolean) {
  costConfirm.value?.resolve(ok)
  costConfirm.value = null
}
```

- [ ] **Step 3: Guard inside runVueWorkflow**

Change the signature (line 359) to:

```typescript
async function runVueWorkflow(
  targetIds?: string[],
  opts: { rerollScope?: 'self', live?: boolean, skipCostConfirm?: boolean, costConfirmIterations?: number } = {},
): Promise<boolean> {
```

Change every early `return` in the function body (lines 363, 395, 450) to `return false`, and add `return true` as the last statement of the function (after the `requestAnimationFrame` block, line 472).

Insert the guard right after the projectUuid stamping block (line 404), BEFORE `injectLoraStyleIntoPrompt` — the estimate must reflect the exact post-filter workflow, and the confirm must come before any side-effecting prep (compositor overlay uploads):

```typescript
  // Cost guard: estimate the exact set of nodes about to run and confirm
  // expensive runs before queueing. Live-preview runs never prompt.
  if (!opts.skipCostConfirm && !opts.live) {
    const vnodes = vueCanvasRef.value.getNodes?.() || []
    const estInput = (plainWorkflow.nodes as any[])
      .filter((n: any) => (n.mode ?? 0) !== 2)
      .map((wn: any) => {
        const vn = vnodes.find((v: any) => String(v.id) === String(wn.id))
        return {
          id: String(wn.id),
          type: String(wn.type || ''),
          title: vn?.data?.title,
          badgeExpr: vn?.data?.priceBadge?.expr ?? null,
        }
      })
    const single = estimateUsdForNodes(estInput)
    if (single) {
      const iterations = Math.max(1, opts.costConfirmIterations || 1)
      const est: CostEstimate = { ...single, usd: single.usd * iterations }
      if (est.usd >= costConfirmThresholdUsd() && !(await confirmRunCost(est, iterations))) {
        return false
      }
    }
  }
```

- [ ] **Step 4: Batch runs confirm once with a multiplier**

In `maybeRunWithTextAutofill` (line 584-590): the first iteration carries the multiplier; later iterations skip the guard. Replace lines 589-596 with:

```typescript
      const completed = awaitExecutionComplete()
      const queued = await runVueWorkflow(targetIds, {
        ...opts,
        ...(iter === 0
          ? { costConfirmIterations: emptySlots.length }
          : { skipCostConfirm: true }),
      })
      if (queued === false) {
        completed.catch(() => {}) // listener self-cleans on its own timeout
        break
      }
      try {
        await completed
      } catch (err) {
        console.warn('[Text autofill] await execution_complete failed:', err)
        break
      }
```

In `handleRunTextIterator`, replace line 681 (`await runVueWorkflow(expanded)`) with:

```typescript
      const queued = await runVueWorkflow(expanded, i === 0
        ? { costConfirmIterations: entries.length }
        : { skipCostConfirm: true })
      if (queued === false) break // user declined the cost confirm
```

- [ ] **Step 5: Live estimate on the Run button**

Script (near the other run state, e.g. below `costConfirm`):

```typescript
// Rolling estimate for the Run button. Polled (not computed) because the
// canvas nodes live behind a component ref, outside our reactivity graph.
const runEstimate = ref<CostEstimate | null>(null)
let runEstimateTimer: ReturnType<typeof setInterval> | null = null
function updateRunEstimate() {
  if (!vueNodesEnabled.value || activeTab.value?.type !== 'project') {
    runEstimate.value = null
    return
  }
  const nodes = vueCanvasRef.value?.getNodes?.() || []
  runEstimate.value = estimateUsdForNodes(vueNodesToEstimateInput(nodes))
}
```

In the existing `onMounted` (line 691) add `runEstimateTimer = setInterval(updateRunEstimate, 2000)`; in `onBeforeUnmount` (line 700) add `if (runEstimateTimer) clearInterval(runEstimateTimer)`.

Template — Run button (lines 2389-2395) becomes:

```html
          <button
            class="flex items-center gap-1.5 bg-action hover:bg-comfy-blue/80 rounded-lg px-4 py-2 cursor-pointer transition-colors shadow-lg"
            @click="() => runVueWorkflow()"
          >
            <Play class="size-3.5 text-white fill-white" />
            <span class="text-sm font-semibold text-white">Run</span>
            <span v-if="runEstimate" class="text-[11px] font-medium text-white/75 tabular-nums">
              ~${{ runEstimate.usd.toFixed(2) }}
            </span>
          </button>
```

(The `() =>` wrapper also stops the MouseEvent from being passed as `targetIds`.)

- [ ] **Step 6: Confirm modal template**

Add at template root level, next to the credits modal markup (search for `creditsModalOpen` in the template):

```html
        <!-- Pre-run cost confirm -->
        <div
          v-if="costConfirm"
          class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60"
          @click.self="resolveCostConfirm(false)"
        >
          <div class="w-[360px] bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl shadow-2xl p-4">
            <div class="text-sm font-semibold text-white mb-1">
              This run costs ~${{ costConfirm.estimate.usd.toFixed(2) }}
            </div>
            <div v-if="costConfirm.iterations > 1" class="text-[11px] text-white/50 mb-2">
              {{ costConfirm.iterations }} runs × ~${{ (costConfirm.estimate.usd / costConfirm.iterations).toFixed(2) }} each
            </div>
            <div class="max-h-[160px] overflow-y-auto mb-3 space-y-1">
              <div
                v-for="item in costConfirm.estimate.breakdown"
                :key="item.id"
                class="flex items-center justify-between gap-3 text-[11px] text-white/60"
              >
                <span class="truncate">{{ item.label }}</span>
                <span class="tabular-nums shrink-0">${{ item.usd.toFixed(2) }}</span>
              </div>
            </div>
            <div class="flex items-center justify-end gap-2">
              <button
                class="px-3 py-1.5 rounded-lg text-xs text-white/70 hover:bg-white/10 transition-colors cursor-pointer"
                @click="resolveCostConfirm(false)"
              >Cancel</button>
              <button
                class="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-action hover:bg-comfy-blue/80 transition-colors cursor-pointer"
                @click="resolveCostConfirm(true)"
              >Run anyway</button>
            </div>
          </div>
        </div>
```

- [ ] **Step 7: Verify**

Dev server checks:
1. Project with one Flux node ($0.04): Run button shows `~$0.04`; clicking Run queues immediately (below $1 threshold).
2. Add a Veo3 node ($6): button shows `~$6.04`; clicking Run opens the confirm with both line items; Cancel queues nothing (no status-bar activity); Run anyway executes.
3. Settings → Execution → set threshold to `0.01`: now the Flux-only run confirms too. Reset to `1`.
4. A non-priced local workflow shows no `~$` chip and never confirms.

- [ ] **Step 8: Commit**

```bash
git add frontend/app/layouts/default.vue frontend/app/components/SettingsModal.vue
git commit -m "Cost: pre-run estimate on Run + confirm-above-threshold guard"
```

---

### Task 9: Home renames go to the server

**Files:**
- Modify: `frontend/app/composables/useRecentProjects.ts:189-198` (`setProjectName`)

- [ ] **Step 1: Implement**

Replace `setProjectName` with:

```typescript
  function setProjectName(workflowId: string, name: string) {
    const names = getSavedNames()
    names[workflowId] = name
    persistNames(names) // offline fallback — server below is the source of truth
    // History-fingerprint ids (comma-joined class types, pre-uuid projects)
    // must not become junk server projects.
    if (workflowId && !workflowId.includes(',')) {
      useProjects().renameProject(workflowId, name)
    }
    for (const list of [recentProjects.value, allProjects.value]) {
      const project = list.find((p) => p.workflowId === workflowId)
      if (project) project.name = name
    }
  }
```

- [ ] **Step 2: Verify**

Rename a project on Home → `curl -s http://127.0.0.1:8188/sailor/projects` shows the new name. Clear the browser's localStorage for the site, reload Home → the name survives.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/composables/useRecentProjects.ts
git commit -m "Home: project renames persist to the server, not just localStorage"
```

---

### Task 10: Durable-first read paths + lazy history backfill

**Files:**
- Modify: `frontend/app/composables/useProjectGenerations.ts` (durable-first fetch; `GenAsset` gains `usd`)
- Modify: `frontend/app/composables/useRecentProjects.ts` (durable-primary Home list + backfill)

- [ ] **Step 1: useProjectGenerations — durable-first**

Add `usd?: number | null` to the `GenAsset` interface. Add imports:

```typescript
import { extractOutputFiles } from '~/lib/generations'
```

(already imported in Task 5 — extend, don't duplicate). Replace the body of `fetchGenerations` with:

```typescript
  async function fetchGenerations(force = false) {
    if (!force && fetchedOnce && generationsByProject.value.length) return
    loading.value = true
    try {
      const savedNames = getSavedNames()
      const groups = new Map<string, ProjectGenerations>()
      const recordedPromptIds = new Set<string>()

      // 1) Durable records — survive ComfyUI restarts; carry per-run cost.
      const { listProjects, listGenerations } = useProjects()
      const durable = await listProjects()
      await Promise.all(durable.map(async (p) => {
        const gens = await listGenerations(p.uuid)
        const assets: GenAsset[] = []
        for (const g of gens) {
          if (g.promptId) recordedPromptIds.add(g.promptId)
          for (const o of g.outputs || []) {
            if (o.type !== 'output') continue
            assets.push({ ...o, promptId: g.promptId, timestamp: g.ts, usd: g.usd ?? null })
          }
        }
        if (!assets.length) return
        groups.set(p.uuid, {
          workflowId: p.uuid,
          name: p.name || savedNames[p.uuid] || 'Untitled project',
          generations: assets,
          lastTimestamp: assets[0]?.timestamp || p.updatedAt || 0,
        })
      }))

      // 2) Merge runs only the live /history knows about (not yet recorded,
      // or pre-durable projects). History dies on server restart — that's
      // exactly the gap the durable pass above closes.
      try {
        const res = await fetch('/history')
        const data = (await res.json()) as Record<string, any>
        for (const [promptId, entry] of Object.entries(data)) {
          if (recordedPromptIds.has(promptId)) continue
          const parsed = historyEntryToRecord(promptId, entry)
          if (!parsed) continue
          const e = entry as any
          const nodes = (e.prompt ?? [])[2] ?? {}
          const classTypes = [...new Set(Object.values(nodes).map((n: any) => n.class_type || ''))] as string[]
          const workflowId = parsed.projectUuid
            || classTypes.filter(Boolean).sort().join(',')
          let g = groups.get(workflowId)
          if (!g) {
            g = {
              workflowId,
              name: savedNames[workflowId] || deriveProjectName(classTypes),
              generations: [],
              lastTimestamp: parsed.record.ts,
            }
            groups.set(workflowId, g)
          }
          for (const o of parsed.record.outputs) {
            g.generations.push({ ...o, promptId, timestamp: parsed.record.ts, usd: null })
          }
        }
      } catch { /* history unreachable — durable list stands alone */ }

      for (const g of groups.values()) {
        g.generations.sort((a, b) => b.timestamp - a.timestamp)
        g.lastTimestamp = g.generations[0]?.timestamp ?? g.lastTimestamp
      }
      generationsByProject.value = [...groups.values()].sort((a, b) => b.lastTimestamp - a.lastTimestamp)
      fetchedOnce = true
    }
    catch (err) {
      console.error('[useProjectGenerations] fetch failed:', err)
    }
    finally {
      loading.value = false
    }
  }
```

Add `historyEntryToRecord` to the lib import. The old `interface Exec` block and its loop are fully replaced; `deriveProjectName` and `getSavedNames` stay.

- [ ] **Step 2: useRecentProjects — durable primary + backfill**

In `fetchRecentProjects`, the structure inverts: durable projects first, history fills gaps, and unrecorded history runs for known projects get backfilled. Replace the section from `// Overlay durable projects (Phase 0)...` (lines 146-169) AND restructure the function as follows — full new body of `fetchRecentProjects`:

```typescript
  async function fetchRecentProjects() {
    if (fetchedOnce && recentProjects.value.length > 0) return
    loading.value = true
    try {
      const savedNames = getSavedNames()
      const { listProjects, listGenerations, saveGeneration } = useProjects()
      const projects: RecentProject[] = []
      const durableIds = new Set<string>()
      const recordedPromptIds = new Set<string>()

      // 1) Durable projects are the primary list — names + thumbnails from
      // their generation records, which survive ComfyUI restarts.
      const durable = await listProjects()
      await Promise.all(durable.map(async (d) => {
        durableIds.add(d.uuid)
        const gens = await listGenerations(d.uuid)
        const images: { filename: string; subfolder: string; type: string }[] = []
        for (const g of gens) {
          if (g.promptId) recordedPromptIds.add(g.promptId)
          for (const o of g.outputs || []) {
            if (o.kind === 'image' && o.type === 'output' && images.length < 3) images.push(o)
          }
        }
        projects.push({
          workflowId: d.uuid,
          name: d.name || savedNames[d.uuid] || 'Untitled project',
          promptIds: gens.map((g) => g.promptId).filter(Boolean),
          images,
          lastTimestamp: Math.max(d.updatedAt || 0, gens[0]?.ts || 0),
          runCount: gens.length,
        })
      }))

      // 2) /history fallback for pre-durable work + backfill of unrecorded
      // runs into their durable project (idempotent — server dedups).
      try {
        const res = await fetch('/history')
        const data = (await res.json()) as Record<string, any>
        const byFingerprint = new Map<string, RecentProject>()
        for (const [promptId, entry] of Object.entries(data)) {
          const parsed = historyEntryToRecord(promptId, entry)
          if (!parsed) continue
          if (parsed.projectUuid && durableIds.has(parsed.projectUuid)) {
            if (!recordedPromptIds.has(promptId)) {
              // Lazy migration: persist this run before history forgets it.
              saveGeneration(parsed.projectUuid, parsed.record)
            }
            continue // already represented by its durable project card
          }
          const e = entry as any
          const nodes = (e.prompt ?? [])[2] ?? {}
          const classTypes = [...new Set(Object.values(nodes).map((n: any) => n.class_type || ''))] as string[]
          const workflowId = parsed.projectUuid || classTypes.filter(Boolean).sort().join(',')
          let p = byFingerprint.get(workflowId)
          if (!p) {
            p = {
              workflowId,
              name: savedNames[workflowId] || deriveProjectName(classTypes),
              promptIds: [],
              images: [],
              lastTimestamp: parsed.record.ts,
              runCount: 0,
            }
            byFingerprint.set(workflowId, p)
          }
          p.promptIds.push(promptId)
          p.runCount++
          p.lastTimestamp = Math.max(p.lastTimestamp, parsed.record.ts)
          for (const o of parsed.record.outputs) {
            if (o.kind === 'image' && p.images.length < 3) p.images.push(o)
          }
        }
        projects.push(...byFingerprint.values())
      } catch { /* history unreachable — durable list stands */ }

      projects.sort((a, b) => b.lastTimestamp - a.lastTimestamp)
      allProjects.value = projects
      recentProjects.value = projects.slice(0, 10)
      fetchedOnce = true
    }
    catch (err) {
      console.error('[useRecentProjects] Failed to fetch:', err)
    }
    finally {
      loading.value = false
    }
  }
```

Add the import at top: `import { historyEntryToRecord } from '~/lib/generations'`. The old `deriveProjectName`, `getSavedNames`, `persistNames` helpers stay; delete the now-unused `interface Execution` parsing block it replaces.

- [ ] **Step 3: Verify (the headline durability test)**

1. Run a workflow in a project, rename it, note its thumbnails on Home and assets in the Assets panel.
2. Open Home once (triggers backfill of any older runs).
3. **Restart ComfyUI** (kills in-memory `/history`).
4. Reload the frontend: Home still lists the project with name + thumbnails; Assets panel still lists its generations. Old never-saved history-only projects are gone after restart by design (they were already ephemeral before this change).

- [ ] **Step 4: Commit**

```bash
git add frontend/app/composables/useProjectGenerations.ts frontend/app/composables/useRecentProjects.ts
git commit -m "Reads: durable-first Assets + Home with lazy /history backfill"
```

---

### Task 11: Spend visibility — ProjectMenu lines + asset cost label

**Files:**
- Modify: `frontend/app/components/vue-canvas/ProjectMenu.vue`
- Modify: `frontend/app/components/AssetDetailOverlay.vue`

- [ ] **Step 1: ProjectMenu spend lines**

Script — add after the versions block (line 130):

```typescript
// ── Spend (read-only) ───────────────────────────────────────────────────────
const { fetchSpendSummary } = useProjects()
const spend = ref<Awaited<ReturnType<typeof fetchSpendSummary>>>(null)
const projectUsd = computed(() => {
  if (!spend.value || !props.projectId) return 0
  return spend.value.byProject.find((p) => p.uuid === props.projectId)?.usd ?? 0
})
```

Extend the existing `watch(open, ...)` (line 143) to also load spend:

```typescript
watch(open, (o) => {
  confirmDeleteId.value = null
  cancelRename()
  if (o) {
    refresh(props.projectId)
    fetchSpendSummary().then((s) => { spend.value = s })
  }
})
```

Template — after the Versions `</div>` (line 319), before the dropdown's closing `</div>`:

```html
        <!-- Spend -->
        <div
          v-if="spend && (projectUsd > 0 || spend.month.usd > 0)"
          class="border-t border-white/[0.06] px-3.5 py-2 flex items-center justify-between text-[10px] text-white/40 tabular-nums"
        >
          <span>This project · ~${{ projectUsd.toFixed(2) }}</span>
          <span>This month · ~${{ spend.month.usd.toFixed(2) }}</span>
        </div>
```

- [ ] **Step 2: AssetDetailOverlay cost line**

The overlay fetches `/history/{promptId}` on mount (line 50). After `historyData.value` is set inside `onMounted`, resolve the run's durable cost — append inside the same `try` block, right after `historyData.value = data[props.promptId] ?? null`:

```typescript
    // Durable record carries the run's estimated cost (history doesn't).
    const projectUuid = historyData.value?.prompt?.[3]?.extra_pnginfo?.workflow?.extra?.projectUuid
    if (projectUuid) {
      const gens = await useProjects().listGenerations(projectUuid)
      const rec = gens.find((g) => g.promptId === props.promptId)
      if (typeof rec?.usd === 'number' && rec.usd > 0) runUsd.value = rec.usd
    }
```

Declare with the other refs (near line 27):

```typescript
const runUsd = ref<number | null>(null)
```

Template: find the metadata block that renders the timestamp (the computed at line 103, `new Date(timestamp.value).toLocaleString()` — locate its usage in the template) and add directly below that element:

```html
        <div v-if="runUsd" class="text-xs text-white/50 tabular-nums">Cost ~${{ runUsd.toFixed(runUsd >= 1 ? 2 : 3) }}</div>
```

Match the wrapper classes of the sibling metadata rows when inserting (read the surrounding template first; keep their exact class names).

- [ ] **Step 3: Verify**

- ProjectMenu chip → dropdown shows "This project · ~$X" / "This month · ~$Y" matching `curl -s http://127.0.0.1:8188/sailor/spend/summary`.
- Open a generated image from the Assets history page → detail overlay shows the Cost line for a Replicate run.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/vue-canvas/ProjectMenu.vue frontend/app/components/AssetDetailOverlay.vue
git commit -m "Spend visibility: project/month totals in ProjectMenu, cost on asset detail"
```

---

### Task 12: Full verification

- [ ] **Step 1: Python suite**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/projects_storage_test.py -v`
Expected: all PASS.

- [ ] **Step 2: End-to-end smoke (the features' reason to exist)**

With ComfyUI + frontend dev server running:
1. New project → add a priced generator → Run button shows `~$`; run completes; status bar cost unchanged from before.
2. `generations.jsonl` for the project contains the run; `spend.jsonl` has the ledger line.
3. Add a Veo3 node → Run → confirm modal appears with breakdown → Cancel leaves the queue idle → Run anyway executes.
4. Rename the project on Home; restart ComfyUI; reload → name, thumbnails, Assets, and ProjectMenu spend all intact.
5. Settings threshold `0.01` → cheap runs now confirm; clear back to default.

- [ ] **Step 3: Update the design doc status + commit anything outstanding**

If any step deviated from this plan, note it in the design doc's relevant section (one line), then:

```bash
git status   # confirm clean except intentional changes
```

---

## Self-review notes (already applied)

- The post-run status-bar estimate and the new record share ONE `estimateReplicateUsd()` call per run (Task 7 step 3 replaces the call in the success branch).
- Batch loops (text autofill, text iterator) confirm once with `costConfirmIterations` and suppress per-iteration prompts; a declined confirm breaks the loop via `runVueWorkflow`'s new boolean return.
- `setProjectName` guards against comma-joined fingerprint ids becoming junk server projects; the same fingerprint ids never reach `saveGeneration` (backfill only posts when `parsed.projectUuid` is durable).
- Deleting a project keeps its spend lines (ledger accuracy) — covered by the storage split (`spend.jsonl` outside `projects/<uuid>/`).
