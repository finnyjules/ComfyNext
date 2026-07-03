# Overnight run — 2026-07-01

Two workstreams you picked: **(1) harden the persistent training queue**, **(2) deep multi-agent bug audit**.

Nothing is committed — all changes are left as reviewable working-tree diffs (your sign-off-pending culture). Say the word and I'll commit with explicit paths to `main`.

---

## 1. Training-queue hardening — DONE ✅

Two real bugs found and fixed with TDD (test written, watched fail, fixed, watched pass).

### Bug A — orphaned Replicate prediction never freed its concurrency slot
`pollLora` / `pollVoice` threw on *any* non-ok HTTP response. `tickQueue` catches poll
errors and deliberately leaves the job in place to "retry next tick." So when a Replicate
training/prediction 404s (expired or deleted), the job was polled **forever**, stuck in
`processing`, permanently occupying one of the 2 concurrency slots — eventually starving the
whole queue.

**Fix** (`server/utils/trainingProviders.ts`): a `404`/`410` (gone) now terminalizes the job
as `failed` so it frees its slot; a transient `5xx` still throws and is retried next tick.

### Bug B — non-atomic registry writes could wipe the durable queue
`writeAll` used a plain `fs.writeFile` (not atomic). A crash mid-write leaves a **torn JSON
file**; `readAll` then silently caught the parse error, returned `[]`, and the next write
clobbered the file with empty/new content — the "durable" queue destroyed by a single bad
write.

**Fix** (`server/utils/trainingQueue.ts`): snapshot the current good file to `.bak`, write to
`.tmp`, then atomic `rename` (rename is atomic on POSIX, so the main file is never torn).
`readAll` now falls back to `.bak` if the main file is missing or corrupt.

### Tests: 19 → 27, all green
- `tests/unit/training-providers.unit.spec.ts` — **new**, 3 tests (404→failed for LoRA + voice; 500 still throws)
- `tests/unit/training-queue.unit.spec.ts` — +3 durability tests (`.bak` recovery, `.bak` retention, no `.tmp` leftovers)
- `tests/unit/training-queue.integration.unit.spec.ts` — **new**, 2 tests (real store + real runner across a simulated **restart**; orphan frees its slot for a queued job)
- Isolated `tsc --strict` on both changed files: clean.

### Known gap left for your review (needs a design call, not a quick fix)
A crash in the window between `provider.start()` succeeding on Replicate and the store
persisting `starting` + `replicateId` leaves the job as `queued` → it gets **started again on
restart → duplicate Replicate training and double charge**. Closing this properly needs a
remote idempotency key (Replicate trainings don't take one cleanly), so I left it flagged
rather than shipping a half-measure.

---

## 2. Deep multi-agent bug audit — DONE ✅

54 agents: 6 finders over the diff + server/security surface, every candidate finding
adversarially verified by 3 independent skeptics (≥2/3 "real" to survive). **16 raised → 10
confirmed, 6 rejected.** Two independent quality signals: the audit re-derived my Bug B
(non-atomic write) from scratch, and it *rejected* "404 pins the job forever" 0/3 because the
skeptics read the code **with my fix already applied**.

### Fixed tonight (TDD, all green) — 6 of the 10

| # | Sev | Bug | Fix |
|---|-----|-----|-----|
| 1 | HIGH | **Cancel resurrected by an in-flight poll** — a poll returning `processing` lands after a concurrent cancel and clobbers `canceled` back to active; canceled trainings could even finalize + download weights | Compare-and-set guard on `store.update` (evaluated in the serialized critical section); runner applies poll patches guarded on `isActive` |
| 2 | HIGH | **Non-atomic registry write wipes the queue** (= my Bug B) | temp+rename + `.bak` fallback (already done in workstream 1) |
| 3 | HIGH | **Duplicate double-billed training on crash** — crash between `start()` and persist leaves job `queued` → re-run on restart | Reserve slot as `starting` *before* `start()`; reap interrupted `starting`-no-id jobs as failed ("please resubmit") instead of re-running |
| 4 | HIGH | **Wired image-layer drag ignores zoom** — layer moves at `scale×` cursor speed, detaches from pointer at any zoom≠100% | Divide the move delta by the live `canvasRect()` (scaled) like the scale/rotate handlers; byte-identical at 100% |
| 8 | MED | **A sidecar containing `null` 500s the whole `/api/loras-local` list** (`JSON.parse('null')` → `null`, then `meta.x` throws) | New tested `parseSidecar()` normalizing null/array/scalar/garbage → `{}`; used in both get + patch routes |
| 6 | MED | **Space-to-pan stuck on blur** — Space held while focus leaves (⌘-tab, clicking the ComfyUI iframe) never gets keyup → pan mode frozen | Reset pan state on window `blur` + `visibilitychange` |
| 10 | LOW | **PATCH `/api/loras-local` 500s on a `null` sidecar** (same root as #8) | fixed by the same `parseSidecar()` |

(#4 and #6 are Vue/visual — code is clearly correct and 100%-zoom-identical, but **please
eyeball them in the Compositor**; I couldn't drive the browser here since another dev server
holds the port.)

### Flagged, NOT changed (your call — architectural / could break the fly.dev deploy)

- **#5 HIGH security — `comfyui-proxy` spoofs `Origin` for every proxied request**, disabling
  ComfyUI's CSRF origin-check. On the public fly.dev deploy, any site the victim visits could
  POST forged workflows/uploads. *Caveat:* pre-existing (not in your diff) and partly inherent
  to a no-auth local-first tool — the proxy at `comfyui-proxy.ts:47` unconditionally sets
  `origin: COMFY_BACKEND`. **Recommended:** gate the middleware behind `import.meta.dev`, or
  reject cross-origin state-changing requests instead of laundering them.
- **#7 MED security — `POST /api/secrets` has no auth/Origin check**; a visited page could
  silently overwrite the stored Replicate token. **Recommended:** same-origin/Referer allowlist
  (or CSRF header forcing a preflight) on the token-writing routes.
- **#9 LOW — LoRA enqueue awaits a slow paid vision call (`generateAesthetic`) between upload
  and enqueue**; if it stalls, the uploaded dataset is orphaned. **Recommended:** enqueue first
  (aesthetic null) then PATCH it on, or wrap the vision call in a bounded timeout.

### Rejected by the skeptic panel (recorded so they're not re-litigated)
404 pins job forever (0/3 — my fix); voice filename desync (0/3); proxy forwards unlisted
`/api/*` (1/3); WS dev-proxy header leak (0/3); voice marked ready on failed preview dl (0/3);
`writeSecretsFile` non-atomic (1/3).

---

## Test tally
Training queue **19 → 34 tests**; `lora-sidecar` **+4**. Full unit suite: **1846 passed, 2
failed** — both failures are the pre-existing `spacetype-palette` ones (documented in memory),
**unrelated to tonight's work. Zero regressions.**

## Files touched (all uncommitted, reviewable)
- `server/utils/trainingQueue.ts`, `trainingRunner.ts`, `trainingProviders.ts` — queue hardening + guards
- `server/utils/loraPrompt.ts` — `parseSidecar()`
- `server/api/loras-local.get.ts`, `loras-local.patch.ts` — use `parseSidecar()`
- `app/components/vue-canvas/CompositorModal.vue` — zoom drag + pan-blur (visual sign-off please)
- `tests/unit/` — `training-providers` (new), `training-queue.integration` (new), plus additions to `training-queue`, `training-runner`, `lora-sidecar`
