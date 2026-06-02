# Phase 0 — durable project persistence — implementation spec

Companion to [2026-06-02-creative-studio-project-takes-design.md](./2026-06-02-creative-studio-project-takes-design.md).
This is the file-by-file plan for the foundation: promoting the implicit
`projectUuid` grouping into a durable, server-persisted **Project** entity that
survives tab close and frontend reload — the substrate Versions and Takes
persist into.

## Goal & non-goals

**Goal:** a project you can close and reopen with its graph, canvas state and
chosen takes intact, listed on Home from a durable source.

**Non-goals (Phase 0):** version *branching UI*, takes *UI* (Phase 1),
collaboration, cross-device sync. Phase 0 only makes the data durable and adds
one implicit "current version" per project.

## Where it plugs into today's code

| Concern | Today | After Phase 0 |
|---|---|---|
| Active graph | `sessionStorage comfynext:workflows` ([default.vue](../../frontend/app/layouts/default.vue)) | unchanged (hot cache) + flushed into a Project version on save |
| Project identity | `workflow.extra.projectUuid` stamped per run | promoted to a durable `Project.uuid` |
| Project name | `localStorage comfynext:project-names` | moved into `Project.name` (server) |
| Home list | `/history` grouped by UUID ([useRecentProjects.ts](../../frontend/app/composables/useRecentProjects.ts:58)) | `/comfynext/projects`, fall back to history for un-migrated |
| Tabs | `comfynext:tabs` w/ `projectUuid` ([useTabs.ts](../../frontend/app/composables/useTabs.ts)) | tab carries `projectUuid` → loads the Project |

The key leverage: **`projectUuid` already exists on every tab and every run**, so
there is no new identity to assign — only durable storage to attach to it.

## Storage

Server-side JSON under the ComfyUI user dir (consistent with the existing
`/comfynext/assets` precedent — survives frontend-only reloads, shareable later):

```
user/comfynext/projects/<uuid>/project.json     # Project metadata + version index
user/comfynext/projects/<uuid>/versions/<vid>.json   # one ProjectVersion each
user/comfynext/projects/<uuid>/cover.webp       # optional thumbnail
```

Splitting versions into their own files keeps `project.json` small (the Home
list only needs metadata) and makes a version an append, not a rewrite.

## On-disk schema

```jsonc
// project.json
{
  "uuid": "…",                  // == workflow.extra.projectUuid
  "name": "Untitled project",
  "cover": "cover.webp",        // relative; resolved via /view or a project route
  "createdAt": 1733100000000,
  "updatedAt": 1733100000000,
  "currentVersionId": "v_…",
  "versionIndex": [             // newest last; full bodies live in versions/
    { "id": "v_…", "name": "v1", "createdAt": 1733100000000, "parentId": null }
  ]
}

// versions/<vid>.json  (ProjectVersion — see design doc for the TS type)
{
  "id": "v_…",
  "name": "v1",
  "createdAt": 1733100000000,
  "parentId": null,
  "workflow": { /* full LiteGraph serialization, existing format */ },
  "activeTakes": { "<nodeId>": "<takeId>" },   // populated once Phase 1 lands
  "cover": null
}
```

## Endpoints

Implement as a ComfyUI custom-node route (the open decision in the design doc
leans this way for consistency with `/comfynext/assets`). All JSON.

| Route | Verb | Body / Query | Returns |
|---|---|---|---|
| `/comfynext/projects` | GET | — | `[{uuid,name,cover,updatedAt}]` (index only) |
| `/comfynext/projects/{uuid}` | GET | — | full `Project` + `currentVersion` body |
| `/comfynext/projects/{uuid}` | PUT | `{name?, cover?}` | updated metadata |
| `/comfynext/projects/{uuid}` | DELETE | — | `{ok:true}` |
| `/comfynext/projects/{uuid}/versions` | POST | `ProjectVersion` (no id) | `{id}` (assigns id, updates index + currentVersionId) |
| `/comfynext/projects/{uuid}/versions/{vid}` | GET | — | full `ProjectVersion` |

Writes are atomic (temp file + rename). Concurrent saves from two tabs of the
same project: last-write-wins on `project.json`, but versions are append-only so
no version is lost.

## Frontend

**New composable — `useProjects.ts`:**
```typescript
function listProjects(): Promise<ProjectMeta[]>
function loadProject(uuid): Promise<Project>            // + current version body
function saveVersion(uuid, version): Promise<{id}>      // snapshot the whole project
function renameProject(uuid, name): Promise<void>
function deleteProject(uuid): Promise<void>
function ensureProject(uuid, seed): Promise<Project>    // create-on-first-save
```

**Snapshot trigger (Phase 0 = implicit single version):**
- On a debounced "project dirty" signal (graph/canvas change) and on tab
  blur/beforeunload, call `saveVersion` with the current serialized workflow
  (reuse `convertToLiteGraph` from [useVueNodes.ts](../../frontend/app/composables/useVueNodes.ts)).
  Phase 0 keeps a single rolling "current" version; Phase 2 turns the explicit
  "Save version" button into named snapshots.

**Home — `useRecentProjects.ts`:** swap the primary source to `listProjects()`;
keep the `/history` path as a fallback so pre-migration work still appears.

**Tabs — `useTabs.ts` / `default.vue`:** opening a tab with a known
`projectUuid` calls `loadProject` and hydrates the canvas from the current
version instead of (or before) the sessionStorage hot cache.

## Migration (gentle, lazy)

No big-bang migration. The first time a project is saved:
1. `ensureProject(projectUuid, seed)` creates `project.json` if absent, seeded
   from the current graph + name (from the `comfynext:project-names` cache).
2. Optionally back-fill one version per past `/history` promptId for that UUID
   so the timeline isn't empty — best-effort, skipped on error.

Un-migrated projects keep showing via the `/history` fallback until first save,
so nothing disappears and there's no flag-day.

## Test plan

- **Server**: unit-test the storage layer (create/list/get/delete, version
  append updates index + currentVersionId, atomic write) with a temp user dir.
  These are pure-ish and fit the existing `tests-unit/` pytest setup.
- **Frontend**: once a TS test runner exists, unit-test `useProjects` request
  shaping + the migration/seed logic with a mocked fetch. Until then, a
  Playwright smoke test: create → run → reload → project reappears with state.

## Files

**New**
- `frontend/app/composables/useProjects.ts`
- `custom_nodes/comfynext_bridge/…/projects.py` (or wherever `/comfynext/assets` lives) — the routes + storage layer
- `tests-unit/…/projects_storage_test.py`

**Modified**
- `frontend/app/composables/useRecentProjects.ts` — source from `/comfynext/projects`, history fallback
- `frontend/app/composables/useTabs.ts`, `frontend/app/layouts/default.vue` — load project on tab open, snapshot hooks
- (Phase 1 hook) version `activeTakes` is filled once takes land

## Sequencing within Phase 0

1. Server storage + endpoints + tests (no UI yet) — verify with curl.
2. `useProjects.ts` + wire Home to list from it (fallback intact).
3. Snapshot-on-save + load-on-open in tabs.
4. Lazy migration + history back-fill.

Each step ships independently; after step 2 the app already reads durable
projects on Home, after step 3 state survives reload.
