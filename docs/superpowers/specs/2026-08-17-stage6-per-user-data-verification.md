# Stage 6 — per-user data: verification record + operator checklist

**Plain summary:** every user now owns their stuff. Saved projects, brand kits, moodboards, templates, characters, trained LoRAs, cloned voices, uploads, outputs — each has an owner, each list shows only yours, and no user can read or mutate another's, whether through a normal route or a hand-crafted graph. The file pickers (empty since Stage 5) show your own uploads again, and all of it now lives on the persistent volume so it survives a redeploy. Local mode is byte-identical throughout — no ownership, no filtering, exactly as before. Per-user *engine settings* are the one deferred piece (safe, and covered below).

## What the stage built (18 code commits, base 98df47d04; final whole-branch review: READY after a 4-finding fix wave)

- **One ownership registry** (`resource_owners` in Neon): kind + resource-id → user. Consumed uniformly by 8+ stores. The rule everywhere: a record with **no** owner row is curated/global — readable by all, mutable by none (no silent first-touch claiming). A user-created record is claimed at creation.
- **The two live P0s closed**: `/sailor/projects*` (anyone could read/overwrite/delete any project) and `/api/training-queue` (anyone could cancel/delete any job) are now ownership-gated with 404-not-403 (no existence disclosure). The install-wide `/sailor/spend/summary` is operator-only (403).
- **The full `/sailor` engine-route sweep**: the review found 35 routes across five engine modules (not the 10 first scouted). Each is classified data-gate / capability-proxy / refuse, deny-by-default, with a coverage guard that fails the build on a new unclassified route.
- **cloud-train direct path** owner-bound (was: poll anyone's training + download their weights).
- **Per-user JSON + models stores**: brand kits, moodboards, templates, fonts, characters, LoRAs, voices — list-filtered, mutation-guarded, delete-releasing. Curated LoRAs/house styles stay globally visible (Decision 3); user-trained artifacts are owner-claimed at the training-finalize write.
- **Engine file isolation (the crux — 4 review rounds)**: a hand-crafted graph cannot reference another tenant's files. `validateGraphFileRefs` walks a checked-in map of **every** file-reading node (per-file readers via `get_annotated_filepath`, plus per-folder readers like the dataset loaders) and refuses (403, before any credit hold) any input/output the caller doesn't own — annotation-, subfolder-, traversal-, encoding-, and prefix-sibling-safe. Outputs land in `output/u_<hash>/` via a per-class output-field injection that also neutralizes `../` traversal. Three coverage guards grep the live engine (read primitives, output writers, `/sailor` routes) and fail on drift — so a new node can't silently reopen a hole.
- **File pickers refilled**: `/object_info` now lists the caller's own uploads (was scrubbed empty); `/internal/files/output` serves the caller's own outputs.
- **Durability**: `SAILOR_DATA_DIR=/data/sailor` relocates the JSON stores onto the volume; `start.sh` seed-then-symlinks `models/` and `input/`+`output/` onto `/data` (copy-gated so curated content is never lost).
- **Header spoof strip**: the engine identity header (`comfy-user`) is stripped from every inbound request and set only by the proxy — a pure security win, live regardless of the settings feature.

**Cross-tenant bugs caught by review before any deploy:** 35-vs-10 `/sailor` route undercount; `asset_import` arbitrary-host-file read (+ a single-segment `/app` bypass of the first fix); 11+ unflagged file-reading graph nodes (then a whole class of folder-readers the first fix missed); `SaveImageDataSetToFolder` `../..` write escape; a duplicate-LoRA reading another tenant's private runnable model; **trained LoRAs/characters never claimed** (unowned = visible-to-all + runnable); moodboard refs laundering a cross-tenant read.

## VERIFIED automated (2026-08-17, hosted worktree at 26a69d6c6 on :3100 — pre-final-fix; re-probe after 792f37ed0)

- Hosted unauthenticated probes → 401 on every new Stage-6 surface: `/sailor/projects`, `/api/training-queue`, `/comfyui/settings`, `/comfyui/userdata`, brand-kits/moodboards/loras/characters/voices, and the `/api/sailor` + `/comfyui/sailor` aliases. (Bare `/userdata`/`/settings` 404 — never routed in any mode, no leak.)
- Local :3000 regression: `{"mode":"local"}` wallet; all data routes serve unfiltered 200; `/sailor/projects` + `/comfyui/settings` 200 (not 403) — byte-identical to pre-Stage-6.
- Stage-6 unit family: 18 files / 398 tests, twice, identical counts.
- Evidence: `.superpowers/sdd/stage6-task-9-probes.md`; final review: `.superpowers/sdd/stage6-final-review.md`.

## Julien's checklist (hosted server on :3100)

1. **It's yours and it persists:** sign in, create a brand kit + a moodboard, save a project. Restart the server (redeploy sim). They're still there, still only yours.
2. **Nobody else sees it:** a second account's lists show none of your records; probing your project's uuid → 404.
3. **The pickers came back:** upload an image → it appears in a LoadImage node's picker (empty since Stage 5), and a graph using it runs. Hand-edit a graph to reference a filename you don't own → clean 403 refusal, nothing charged.
4. **Settings caveat (expected):** engine settings don't persist per-account yet (see below) — the panel still opens and works, it just doesn't save server-side. Your saved *projects* do persist (that's Sailor's own store).

## Deferred — genuinely beta-acceptable, not security holes

- **Per-user engine settings (Task 8b).** ComfyUI's `--multi-user` won't accept a Clerk id as-is (it mints its own uuids and requires registration), so per-user `/settings` + `/userdata` need a clerk-id→engine-id mapping layer. Shipped OFF (`SAILOR_ENGINE_MULTI_USER` unset) so hosted stays byte-identical and the routes keep 403ing (no leak). The SettingsModal degrades cleanly to defaults; local-only settings persist client-side; saved work is covered by Sailor's own per-user project store. Fine for a 5-user beta; land 8b before scaling.

## Deploy preconditions (hosted) — MUST do before first real users

1. **Empty stores, or a one-time ownership backfill.** A fresh volume is empty → correct. But the projects extension ships `comfynext→sailor` volume migrations, so if the deploy volume already holds projects/LoRAs/etc., those records are ownerless → invisible + 404 to their own authors. Launch with empty `/data` stores, or backfill `resource_owners` for pre-existing content first.
2. Everything from the Stage-5 deploy list still stands: never expose `:8188`; never set `NUXT_PUBLIC_COMFY_ORIGIN`; production WS auth; `SAILOR_ENGINE_ROOT` if not launching from `frontend/`; Clerk prod-instance switch + webhook.
3. Keep `SAILOR_ENGINE_MULTI_USER` unset until Task 8b lands.

## R2 / object storage — DECISION: deferred post-beta

The Fly volume + `SAILOR_DATA_DIR` + per-user subfolders covers a 5-user beta. R2 (durable object storage) buys: durability beyond one volume, egress offload for media, and multi-machine scaling — all launch-scale concerns, not beta ones. Revisit with real egress numbers after the beta. When it lands, the write path is already funnelled (per-user subfolders + the `storeDir`/upload registry), so it's a storage-driver swap, not a re-architecture.

## Riders (carried, triaged)

- **FIX-BEFORE-LAUNCH:** the empty-store/backfill precondition (#1 above); the Stage-5 deploy list.
- **FIX in the pre-launch hardening wave (one-liners, launch-inert only under the empty-store precondition):** `moodboards/refs.post` doesn't ownership-check the *destination* flat name (a guessable caller-chosen slug can integrity-overwrite a victim's `mb_<slug>_<i>` refs); `moodboards/images.post` lets a tenant write into a *curated* folder (violates mutate-by-none); trained-artifact `recordOwner` has no retry on a DB blip (WARN-logged — needs a backfill sweep); `secrets.ts` still hardcodes `.data` instead of `storeDir` (hosted-inert since BYOK is refused).
- **RIDE (post-beta / with 8b):** Task 8b registration mapping; `/view` `type=temp` + `[temp]`-annotation 403s; `ensureInputFilename` silent-fallback UX; `SaveTrainingDataset`→`LoadTrainingDataset` round-trip refused until per-user input/output writes exist; `_live_preview` fixed-prefix write; render-template embeds all fonts (not owner-scoped); `listOwned` N+1 query; object_info refill lists names without a live-dir cross-check; voice/character restart-edge lands curated; trained-output flat namespace (first-owner-wins, fail-closed on collision) — add a per-user prefix when convenient.
- **DROP:** per-user spend UI (later product feature reading the ledger); the Stage-5 badge chip.

## Teardown

Hosted :3100: kill by open-file discovery — `for p in $(lsof -nP | awk '/sailor-meter-verify/ {print $2}' | sort -u); do kill $p; done` — then `git worktree remove --force /private/tmp/claude-501/sailor-meter-verify` when done.
