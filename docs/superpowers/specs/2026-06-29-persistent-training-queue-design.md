# Persistent, Queueable Cloud Training

**Date:** 2026-06-29
**Status:** Design — pending review

## Problem

Cloud training (style/character LoRA and voice cloning) is aborted whenever the
browser window closes. The training *itself* runs on Replicate's servers and is
unaffected — but the local bookkeeping that finalizes it (download the
`.safetensors`/voice file, write the sidecar JSON) runs entirely as a
**client-side polling loop** in the browser:

- LoRA: `pollCloudJob()` in `frontend/app/components/LoraTrainerSurface.vue:1370`
- Voice: the `for (;;)` loop in `frontend/app/components/VoiceTrainerSurface.vue:109`

Close the tab → the loop stops → the finished result is never downloaded and the
job is orphaned. There is no server-side record that a training was ever started,
so it cannot be resumed. The user needs to train many styles and wants to **queue
trainings** and have them **complete even when the window is closed**.

## Constraints & Decisions

- **Concurrency:** limited parallel — a configurable max (default **2**) run on
  Replicate at once; the rest wait in the queue.
- **Scope:** both LoRA (style/character) **and** voice cloning share one queue +
  job system.
- **Monitoring:** a persistent, always-reachable **Training queue panel** that
  rehydrates from the server on app load.
- **Notifications:** auto-finalize silently (the core fix) **plus** an in-app
  toast + count badge on transitions.
- **Poller home:** the **Nitro/Nuxt server** owns the durable queue + poller.
  This is where all the Replicate code and the `NUXT_REPLICATE_TOKEN` already
  live. It reconciles on every server startup.
- **Output location:** unchanged — `models/loras/<name>.safetensors` + sidecar
  `.json` for LoRA; `models/voices/<id>.{json,mp3}` for voice. Existing
  style/character/voice pickers keep working with no changes.

### Physical constraint (explicitly accepted)

Finalization (downloading the finished file) can only happen on the user's
machine while it is powered on. **No design can finalize a job while the laptop
is off.** The guarantee this design makes instead:

> Nothing is ever lost. Every job's Replicate ID is persisted. On the next server
> startup, all in-flight jobs are polled, any that finished while away are
> finalized, and queued jobs resume starting.

Close the laptop overnight → launch the app next morning → finished trainings
download automatically and queued ones begin.

## Architecture (Approach A: server-side queue in Nitro)

The browser becomes a pure **viewer** of job state. All starting, polling, and
finalizing moves server-side.

```
Browser (LoraTrainerSurface / VoiceTrainerSurface)
  1. zip dataset / read audio        (existing, client-side)
  2. POST /api/cloud-train/upload    -> Replicate Files API -> datasetUrl  (existing)
  3. POST /api/cloud-train/aesthetic -> aesthetic string                   (existing, LoRA only)
  4. POST /api/training-queue        -> enqueue job { datasetUrl, params, ... }
        |
        v
Nitro server (persists across browser close)
  - Job registry  (JSON file on disk)
  - Queue runner  (Nitro startup plugin; setInterval ~5s)
        - start queued jobs while running < maxConcurrency
        - poll in-flight jobs against Replicate (fresh each tick)
        - finalize succeeded jobs (download + sidecar), record failures
        - reconcile on startup from the registry
        |
        v
  models/loras/*.safetensors + .json   |   models/voices/*.{json,mp3}
```

## Components

### 1. Job registry — `frontend/server/utils/trainingQueue.ts`

Durable store backed by a JSON file at `models/.training-jobs.json` (resolved via
`path.resolve(process.cwd(), '..', 'models', '.training-jobs.json')`, matching the
existing output-path convention). Single Node process, so writes are serialized
through an in-module promise chain to avoid interleaved read-modify-write.

Job record:

```ts
interface TrainingJob {
  id: string                 // local uuid, panel key
  kind: 'lora' | 'voice'
  status: 'queued' | 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled'
  outputName: string         // sanitized; final filename stem
  displayName: string        // what the user typed, for the panel
  // --- enqueue-time inputs (everything the runner needs to start headlessly) ---
  datasetUrl: string         // Replicate Files URL from /upload (LoRA) or audio URL (voice)
  params: Record<string, unknown>  // family, steps, learningRate, loraRank, batchSize, seed (LoRA); model/params (voice)
  trigger?: string | null
  aesthetic?: string | null  // generated client-side at enqueue (LoRA); stored so finalize is headless
  loraKind?: 'style' | 'character'
  // --- runtime ---
  replicateId?: string | null  // training/prediction id once started
  destination?: string | null  // owner/model for LoRA
  progressPct: number
  logsTail?: string
  error?: string | null
  localFilename?: string | null
  createdAt: string
  updatedAt: string
}
```

Exports: `listJobs()`, `getJob(id)`, `addJob(partial)`, `updateJob(id, patch)`,
`removeJob(id)`. All persist immediately.

### 2. Finalizer — `frontend/server/utils/cloudTrainFinalize.ts` (+ voice equivalent)

Extract the download-and-sidecar logic currently inline in
`frontend/server/api/cloud-train/status.get.ts:33-158` (`downloadAndPlace` +
sidecar write) into a reusable `finalizeLoraTraining(job, replicateTraining)`.
Reads aesthetic/trigger/kind from the **job record**, not from live client query
params. A sibling `finalizeVoiceClone(job, prediction)` mirrors
`frontend/server/api/voice-clone/status.get.ts`.

Idempotent: if the target file already exists, return success without
re-downloading (preserves current behavior).

**Weights-URL freshness:** the runner fetches a fresh `GET /v1/trainings/{id}`
each tick, so `output`/`weights` URLs are current at finalize time even after a
long away period. If a delivery URL has expired between poll and download, the
finalizer re-fetches the training record once to obtain a fresh URL before
failing. (Risk noted below.)

### 3. Queue runner — `frontend/server/plugins/trainingQueue.ts`

Nitro startup plugin. Starts a `setInterval` (~5s) tick loop. Guarded by a
module-level singleton flag so Nitro HMR in dev doesn't spawn duplicate loops.

Each tick (operating over `listJobs()`):

1. **Start:** for `queued` jobs, while `count(status in {starting, processing}) <
   maxConcurrency`, run the start sequence (the logic in
   `frontend/server/api/cloud-train/start.post.ts` for LoRA; voice-clone start for
   voice), store `replicateId` + `destination`, set status `starting`.
2. **Poll:** for `starting`/`processing` jobs, `GET` the Replicate
   training/prediction, update `status`, `progressPct`, `logsTail`.
3. **Finalize:** on `succeeded`, call the finalizer; on success set `succeeded` +
   `localFilename`; on download error set `failed` + `error`. On Replicate
   `failed`/`canceled`, record it.

`maxConcurrency` from `runtimeConfig.trainingMaxConcurrency`
(env `NUXT_TRAINING_MAX_CONCURRENCY`, default **2**).

**Reconcile on startup is automatic:** because the loop reads the persisted
registry, a freshly booted server immediately resumes polling in-flight jobs and
starting queued ones. No separate reconcile path needed.

### 4. API endpoints — `frontend/server/api/training-queue/`

- `POST /api/training-queue` — enqueue. Body carries `kind`, `datasetUrl`,
  `outputName`, `displayName`, `params`, `trigger`, `aesthetic`, `loraKind`.
  Returns the created job. (Browser has already done upload + aesthetic.)
- `GET /api/training-queue` — list all jobs (panel + on-load rehydrate).
- `POST /api/training-queue/[id]/cancel` — remove a `queued` job, or cancel the
  Replicate training/prediction (`POST /v1/trainings/{id}/cancel`) if running,
  then mark `canceled`.

The existing `/upload` and `/aesthetic` routes are unchanged. The `/start` and
`/status` route logic is absorbed into the runner + finalizer; the routes may
remain temporarily for safety but the panel no longer drives them.

### 5. Frontend

**LoraTrainerSurface.vue / VoiceTrainerSurface.vue**
- "Start training" → **"Add to queue"**: zip + upload + (LoRA) generate aesthetic
  + `POST /api/training-queue`, then reset the surface for the next style. The
  client-side `pollCloudJob` / `for(;;)` loops are removed.

**New `TrainingQueuePanel.vue`**
- A persistently reachable panel (header button → drawer/list). Polls
  `GET /api/training-queue` every few seconds **while open**; hydrates on app
  load. Renders each job: name, kind, status, progress, error, and a cancel
  action. A count badge on the trigger button reflects active jobs and surfaces
  completions.
- On a job transitioning to `succeeded`/`failed` (diffed against the previous
  poll), fire an in-app toast.

## Data Flow Summary

1. User configures a style, clicks **Add to queue** → dataset uploaded to
   Replicate, aesthetic generated, job persisted as `queued`. Surface resets.
2. User can queue more, or close the tab / laptop.
3. Runner starts up to `maxConcurrency` jobs, polls them, finalizes on success —
   independent of the browser.
4. Whenever the user opens the app, the panel shows live state hydrated from the
   server; finished styles are already in `models/loras/`.

## Error Handling

- **Start failure** (Replicate rejects): job → `failed` with the error message;
  does not block the rest of the queue; a slot frees for the next `queued` job.
- **Download failure:** job → `failed` with the download error (current
  behavior, now server-side).
- **Network blips during poll:** swallowed; the job stays in its current status
  and retries next tick (matches current client loop).
- **Expired weights URL after long away period:** finalizer re-fetches the
  training record once for a fresh URL before failing.
- **Server crash mid-job:** registry is on disk; next startup resumes.

## Testing

- **Registry unit tests:** add/update/remove/list round-trip through the JSON
  file; serialized writes don't corrupt under concurrent calls.
- **Finalizer unit tests:** direct `.safetensors` vs `.tar` extraction; sidecar
  contents; idempotent no-op when file exists. (Mock `fetch` + a tmp dir.)
- **Runner unit tests:** concurrency cap honored (N running max); queued→starting
  transition; succeeded→finalize; failed/canceled handling. (Mock Replicate +
  registry.)
- **Manual / in-app:** queue 3 styles with maxConcurrency=2, confirm 2 start and
  1 waits; close the browser tab, reopen, confirm the panel rehydrates and all
  finish; stop and restart the Nitro server mid-training, confirm reconcile.

## Risks / Open Items

- **Nitro must be running for finalize.** Accepted constraint; reconcile-on-boot
  is the mitigation. If the user later wants polling while only ComfyUI is up,
  Approach C (Python backend) is the documented upgrade path.
- **Replicate weights-URL retention** over very long away periods — mitigated by
  fresh training-record fetch; if a download URL is permanently gone, the trained
  model still exists at `destination` and could be re-derived (future hardening).
- **HMR duplicate intervals in dev** — guarded by a module singleton.
- **Panel placement** — exact home in the app shell (header button + drawer) to
  be finalized during implementation; must be reachable from anywhere.
