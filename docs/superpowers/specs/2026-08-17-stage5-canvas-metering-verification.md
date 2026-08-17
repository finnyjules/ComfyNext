# Stage 5 — canvas metering + tenant isolation: verification record + operator checklist

**Plain summary:** running a graph on the canvas now checks and charges your wallet in hosted mode (credits are put on hold up front, charged when the run succeeds, given back if it fails), and each signed-in user can only see their own runs, images, and queue. The engine's side doors are closed: alias URLs, filename tricks, the gate-resume endpoint, the file-listing oracles, WebSocket connections, and cross-tenant file overwrites were each found and shut during four adversarial review rounds. Local mode is byte-identical — no checks, no charges, no filtering, verified live throughout.

## What the stage built (17 commits, base b807971f2 → a27b45dd7; final whole-branch review: READY)

- **Durable run ownership** (`graph_runs` in Neon): every hosted graph submission records who ran it, what it cost, which hold backs it, which engine ran it, and — at settlement — which output files it produced. Survives restarts (the old in-memory spike store is deleted).
- **Hold-based metering everywhere**: the Stage-4 "no-hold parallel-preflight" leak is closed for provider routes AND graphs. Holds settle on confirmed success, release on failure/timeout, and a sweep releases anything stuck open past 2h. Voice-clone holds span the async job and release on terminal failure.
- **Model-aware graph pricing**: 72 provider node classes priced (was 9), with the Generate image/video/FilmShot/Upscale/EnhanceDetail nodes priced by their selected model. Unpriced provider nodes refuse the whole graph (fail closed). Coverage guards fail the suite if a new Python node class appears unpriced.
- **The `/prompt` interception**: hosted POST /prompt is metered in the proxy middleware — hold before forward, ComfyUI's response passed through verbatim, `prompt_id` and comfy.org credentials stripped from forwarded bodies. Direct-execution and all five mini-apps are covered with zero client changes; no stale client can bypass.
- **Tenant gates**: `/history`, `/view`, `/queue` (GET filtered, non-GET 403), `/interrupt` (targeted, own-run only) — including every alias spelling (`/api/*`, `/comfyui/*`, dot-segments), annotated-filename escapes, and `blake3:` forms. Hosted raw proxy is deny-by-default with an audited allowlist; `/gate` and `/internal` are 403; `/object_info` is scrubbed of all upload-widget file listings (both schema shapes, `default` field included).
- **Ownership-scoped uploads**: hosted overwrite requires owning the file (new `input_uploads` registry, first-owner-wins, engine-response-name aware); parse-for-inspection multipart handling that five verified header-smuggling spellings cannot defeat; 100MiB cap; engine-root resolution fails closed on cwd drift with a hosted boot assert.
- **Hosted client**: direct execution and the Vue canvas are forced on; no engine iframe is ever mounted; health checks go same-origin; `comfyOrigin` is hard-'' in hosted (code property, not deploy convention).
- **Credits everywhere money shows**: node badges, cost-confirm dialog, run bar, and post-run status bar all quote credits in hosted, with the five model-priced classes quoting the exact figure the server debits (veo-3.1: quotes 481, charges 481 — was quoting ~60).
- **WS upgrades authenticated** on hosted dev servers (401 unauthenticated, live-proven); local untouched.

**Money bugs caught by review before launch:** graph pricing at 1cr for a $3.20 video (62 unpriced classes); hold leaks on thrown forwards; runs shipping uncharged when the ownership insert failed; a no-wallet 500 re-regression; client-chosen `prompt_id` letting an attacker overwrite a victim's output records; 3 rows priced off a misread badge sweep.

## VERIFIED automated (2026-08-17, hosted worktree at a27b45dd7 on :3100)

- Hosted probes 11/11: direct routes, `/api/*` + `/comfyui/*` aliases, `/comfyui/internal/files/output`, unauthed WS upgrade → all 401.
- Local :3000 regression 4/4: `{"mode":"local"}` wallet, unfiltered history (21.5MB), unscrubbed object_info (1.9MB), ComfyUI's native error shape through the raw proxy.
- Stage-5 unit family: 21 files / 413 tests, twice, identical counts. Full-suite failures are all in parallel-session dirty areas or pre-existing (5 flagged files spot-checked as predating this stage).
- Full evidence: `.superpowers/sdd/stage5-task-8-probes.md`; final review: `.superpowers/sdd/stage5-final-review.md`.

## Julien's 3-minute checklist (server left running on :3100)

1. **The metered dog:** open :3100, sign in, run a canvas generation on **flux-schnell** (cheapest) → wallet pill drops by **2** (1 model + 1 base render); the image appears normally. This is the same action that silently spent operator money last week — it now debits your wallet.
2. **The quote matches the charge:** put a Generate video node on the canvas, pick **veo-3.1** — badge reads `~481 cr`, and Run's confirm dialog says the same number. (Cancel unless you want to spend it.)
3. **The 402 (free):** ask Claude to admin-debit your wallet to ~1cr, then try any generation → clean insufficient-credits error naming required vs available; wallet restored after; check nothing appeared in the ComfyUI log.
4. **Tenant wall (optional, needs 2nd account):** sign in as another user in an incognito window → its history/canvas shows none of your runs; pasting one of your `/view?filename=...` URLs → 404.

## Fix before hosted launch

1. ~~Quote-low badges~~ → **task chip spawned**: EditImageNode / Clarity / Seedance2 Python `price_badge` bumps (3 lines + ComfyUI restart). The only remaining quote-LOW surfaces.

## Deploy preconditions (hosted)

- Never expose :8188 publicly (fly.toml already pulled it); never set `NUXT_PUBLIC_COMFY_ORIGIN` on hosted deploys (client hard-''s it anyway — defense in depth).
- Launch with an **empty engine input/ directory** (or backfill `input_uploads`) — pre-existing files are unclaimed and nobody can overwrite them.
- Set `SAILOR_ENGINE_ROOT` if the process won't launch from `frontend/` (else the marker walk-up resolves it; unresolvable → overwrites fail closed + boot error).
- Production WS proxying does not exist yet — lands with the hosting decision (Fly/Railway/Hetzner; `fly.toml` `cdg` → US region then). The Task-7 auth covers dev-style boots only.

## Risk register / riders (carried, priority-ordered)

1. Watcher timeout (30min) voids still-queued runs → uncharged + owner loses /view for that run; bounded to one run's credits. Revisit when long video models land.
2. `LoadImageOutput` + shared dirs: the engine itself can read any output file into a new graph (HTTP gates can't stop it) — needs per-tenant dirs (Stage 6). Same root cause: `/view` `type=input`/`temp` reads ungated, `/api/image-fetch` writes bypass the ownership registry (server-named files, unclaimed).
3. Hosted product gaps by design until Stage 6: file pickers list nothing (scrubbed), `/comfyui/settings` + `/userdata` 403 (SettingsModal shows raw failure), bridge-backed account popup dead, `ensureInputFilename` falls back silently on an overwrite refusal.
4. WS broadcast `status` frames leak queue depth across users (cosmetic); authenticated `/ws` positive-path probe owed at deployment (hardcoded-loopback URL divergence from auth.ts noted); `socket.destroyed` guard nice-to-have.
5. Pricing refinements: per-unit costs (video seconds, speech chars) priced at one unit; `confidence: 'estimate'` rows join the pre-launch invoice sweep (FilmShot 160→75 repricing explicitly flagged for it); USD-denominated confirm threshold; breakdown rows omit the 1cr base row.
6. Full triage table (21 minors: 4 done, 5 dropped, 12 riding): `.superpowers/sdd/stage5-final-review.md`.

## Teardown

Hosted :3100 (pid in `lsof -nP -iTCP:3100`): kill via open-file discovery — `for p in $(lsof -nP | awk '/sailor-meter-verify/ {print $2}' | sort -u); do kill $p; done` — then `git worktree remove --force /private/tmp/claude-501/sailor-meter-verify` when done with the checklist.
