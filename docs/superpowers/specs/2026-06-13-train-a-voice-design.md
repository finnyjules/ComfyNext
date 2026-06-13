# Train a Voice (MiniMax voice cloning)

**Date:** 2026-06-13
**Status:** Approved design, pending implementation plan
**Builds on:** [Voice preview gallery](2026-06-13-voice-preview-gallery-design.md) — the
Generate-speech voice gallery this feature feeds into.

## Problem

Users can pick from 17 MiniMax *system* voices in the Generate speech node, but
can't use **their own** voice. Replicate's `minimax/voice-cloning` clones a voice
from a short audio sample and returns a `voice_id` usable with MiniMax
speech-02-hd. We want to expose this as **"Train a voice"** in the Train tab —
consistent with the existing *Train a style* / *Train a character* flows — and have
the resulting voice appear in the Generate-speech voice gallery for reuse.

## The model

`minimax/voice-cloning` (Replicate, runs as a normal **prediction**, not the
trainings API):

- **Inputs:** `voice_file` (required — MP3/M4A/WAV URL, 10s–5min, <20MB),
  `model` (enum: speech-2.6-turbo/hd, speech-02-turbo/hd; default speech-02-turbo),
  `accuracy` (0–1, default 0.7), `need_noise_reduction` (bool), `need_volume_normalization` (bool).
- **Outputs:** `voice_id` (string, account-scoped + stable), `preview` (audio URI —
  the cloned voice speaking a sample), `model` (string).

A cloned voice is trained **for a specific TTS model**. Generate speech calls
`minimax/speech-02-hd`, so v1 **locks the clone model to `speech-02-hd`** (and does
not expose it) — every cloned voice then works in Generate speech with no model
mismatch.

## Decisions (settled during brainstorming)

1. **Lives in the Train tab** as a third kind (Style / Character / **Voice**),
   mirroring the existing trainers. Voice does NOT reuse the LoRA dataset/caption/
   hyperparameter machinery — it's a single prediction, so it gets its own lean
   sub-surface.
2. **Consumed via the existing Generate-speech voice gallery** (not a separate
   panel). Cloned voices appear under a **"Your voices"** filter.
3. **Audio input: file upload only** (v1). In-browser recording is out of scope.
4. **Model locked to speech-02-hd**, hidden from the form.
5. **Gallery filter pills are source-based:** All · Default voices · Your voices.

## Architecture

Two backend surfaces are involved, exactly as the LoRA trainer uses them:
- **Nitro server** (`frontend/server/api/`) — runs the cloud job + owns the voices
  store + lists voices. Mirrors `frontend/server/api/cloud-train/*` and
  `/api/loras-local`.
- **ComfyUI Python** (`comfy_api_nodes/`) — only needs to *read* the store so the
  `voice_id` combo's options include cloned ids (for run-time validation).

```
Train tab (LoraTrainerSurface kind picker: Style | Character | Voice)
   └─ kind == 'voice' ─► VoiceTrainerSurface.vue (lean form: name + audio + advanced)
                              │ POST /api/voice-clone/upload   (store sample → url)
                              │ POST /api/voice-clone/start     (Replicate predictions)
                              │ GET  /api/voice-clone/status    (poll → on success:
                              │        download preview, write models/voices/<id>.{json,mp3})
                              ▼
                         voices store: models/voices/<voice_id>.json + .mp3
                              │
        ┌─────────────────────┴───────────────────────────┐
        ▼ (Nitro reads)                                     ▼ (Python reads)
   GET /api/voices-local ──► VoiceGalleryModal          GenerateSpeechNode.define_schema
   { voices:[{id,name,model,previewUrl,createdAt}] }     voice_id options =
        │                                                 _MINIMAX_VOICES + cloned ids
        ▼
   Generate speech voice gallery: "Your voices" filter,
   pick → writes cloned voice_id into the node widget
```

### Components & changes

**1. Train tab — kind card + delegation.**
`frontend/app/components/LoraTrainerSurface.vue`: extend the `trainingKind` union to
`'style' | 'character' | 'voice'` and add a third **Voice** card to the "What are you
training?" picker. When `trainingKind === 'voice'`, render `<VoiceTrainerSurface/>`
in place of the LoRA dataset/hyperparameter body. The style/character code paths are
left intact — voice is a clean branch, not a retrofit of the LoRA form.

**2. Voice trainer surface — new lean component.**
`frontend/app/components/VoiceTrainerSurface.vue`:
- **Name** (required, sanitized for display).
- **Audio dropzone**: accepts MP3/M4A/WAV; validates client-side **before upload** —
  extension/MIME, size <20MB, duration 10s–5min (decoded via an `<audio>`/`AudioContext`
  metadata read). Shows a small inline player to confirm the sample.
- **Advanced** (collapsed): `need_noise_reduction`, `need_volume_normalization`
  toggles, `accuracy` slider (0–1, default 0.7).
- **Clone voice** button → runs the job; a progress card reuses the cloud-job state
  machine (`starting | processing | succeeded | failed`) like the LoRA cloud path,
  surfacing Replicate errors on failure and a "Use it in Generate speech" success state.

**3. Nitro cloud-job routes — new, mirroring `cloud-train/`.**
`frontend/server/api/voice-clone/`:
- `upload.post.ts` — accept the audio file and return a **Replicate-fetchable URL**.
  Reuse the LoRA trainer's existing upload/storage mechanism (`cloud-train/upload`):
  whatever that does to hand Replicate a public dataset URL, do the same for the audio
  sample. The plan resolves the exact storage call after reading that route.
- `start.post.ts` — POST `https://api.replicate.com/v1/models/minimax/voice-cloning/predictions`
  with `{ voice_file: url, model: 'speech-02-hd', accuracy, need_noise_reduction,
  need_volume_normalization }`; return `predictionId`.
- `status.get.ts` — poll `https://api.replicate.com/v1/predictions/{id}`; on
  `succeeded`: download `output.preview` to `models/voices/<voice_id>.mp3` and write
  `models/voices/<voice_id>.json`; return the saved voice. On `failed`: return the
  error. Token resolution matches the existing routes.

**4. Voices store.**
New dir `models/voices/` (parallel to `models/loras/`). Per cloned voice:
- `<voice_id>.json`: `{ voice_id, name, model: "speech-02-hd", provider: "replicate",
  prediction_id, created }` (ISO timestamp).
- `<voice_id>.mp3`: the downloaded preview clip.
The filename id IS the MiniMax `voice_id` (stable, reusable). Sanitize for path safety.

**5. Listing + preview-serving endpoints — new, mirroring loras-local + lora-cover.**
- `frontend/server/api/voices-local.get.ts` → `{ voices: [{ id, name, model,
  previewUrl: "/api/voice-preview-file?id=<id>", createdAt }] }` by scanning
  `models/voices/*.json`.
- `frontend/server/api/voice-preview-file.get.ts` → streams `models/voices/<id>.mp3`
  with `audio/mpeg` (path-guarded to that dir).

**6. Gallery integration — extend the existing modal + catalog.**
- `frontend/app/lib/voiceCatalog.ts`: add a `source: 'default' | 'cloned'` field to
  `VoiceMeta`; system voices are `'default'`. Add `mergeClonedVoices(cloned)` so the
  gallery can fold fetched cloned voices into the list — cloned entries get
  `label = name`, `sampleUrl = previewUrl`, `source = 'cloned'`, `category = 'Cloned'`.
  `voicesForOptions` keeps working for the node's option ids; cloned ids resolve via
  the merged metadata.
- `frontend/app/components/vue-canvas/VoiceGalleryModal.vue`: on open, `GET
  /api/voices-local` and merge results. **Filter pills become source-based:**
  `All · Default voices · Your voices` (with counts); gender drops to a per-card tag.
  "Your voices" always shows; when empty it renders an empty state — *"No cloned
  voices yet — Train a voice in the Train tab."* Cloned cards get a subtle "yours"
  treatment. Selecting a cloned voice writes its `voice_id` into the node widget,
  identical to a system voice.

**7. Backend combo validation (ComfyUI Python).**
`comfy_api_nodes/nodes_replicate.py`: a helper `_list_cloned_voice_ids()` scans
`models/voices/*.json` (resolved via `folder_paths`/models root). Both
`GenerateSpeechNode` and `MiniMaxSpeechRemoteNode` set `voice_id` options =
`_MINIMAX_VOICES + _list_cloned_voice_ids()`. Read fresh on each `define_schema`
(i.e. per `/object_info`), so a newly cloned voice becomes a valid combo value after
the frontend refetches object_info. The `execute` path is unchanged — `voice_id` is
already passed straight through to the API.

## Data flow

1. Train tab → Voice → upload sample + name → **Clone voice**.
2. Nitro: upload → start prediction → poll → on success download preview + write
   `models/voices/<voice_id>.{json,mp3}`.
3. Generate speech node → open voice gallery → "Your voices" → the cloned voice (with
   preview) → pick → `voice_id` written to the node.
4. Run: ComfyUI validates `voice_id` against options (now incl. cloned ids) →
   `execute` passes it to `minimax/speech-02-hd`.

## Error handling

- **Invalid sample:** client blocks upload with a specific message (wrong format,
  >20MB, <10s or >5min). Nothing is sent to Replicate.
- **Clone job failure:** the progress card shows the Replicate error; nothing is
  written to the store.
- **Missing/!ok preview clip:** the voice is still listed + selectable; its gallery
  card shows preview-disabled (same degradation as a system voice with no sample).
- **Unknown cloned id at run time** (store edited out from under a saved graph): the
  combo options no longer include it → ComfyUI validation error surfaced as usual;
  the user re-picks a voice.

## Testing

- **Unit (vitest):** voices-store sidecar parse → `voices-local` shape;
  `voiceCatalog.mergeClonedVoices` (label/sampleUrl/source/category mapping + cloned
  id resolution); client-side audio validation (format/size/duration boundaries).
- **Manual / preview:** clone a real ~15s sample end-to-end → confirm it writes the
  store, appears under "Your voices" with a working preview, is selectable, and
  Generate speech produces audio in that voice. (In-browser interactive step runs in
  the user's real browser — the Claude preview browser is gated; see the voice-preview
  spec.)

## Out of scope (v1, YAGNI)

- In-browser mic recording.
- Exposing turbo / speech-2.6 models (until Generate speech offers a model choice).
- A standalone Voice-library browse panel (the Generate-speech gallery is the
  consumption point).
- Editing / renaming / deleting cloned voices in-app (manage via the store for now).

## Files touched

| File | Change |
| --- | --- |
| `frontend/app/components/LoraTrainerSurface.vue` | add Voice kind card + delegate to VoiceTrainerSurface |
| `frontend/app/components/VoiceTrainerSurface.vue` | new — lean clone form + progress |
| `frontend/server/api/voice-clone/upload.post.ts` | new — store sample, return url |
| `frontend/server/api/voice-clone/start.post.ts` | new — start Replicate prediction |
| `frontend/server/api/voice-clone/status.get.ts` | new — poll + persist on success |
| `frontend/server/api/voices-local.get.ts` | new — list cloned voices |
| `frontend/server/api/voice-preview-file.get.ts` | new — stream a preview clip |
| `frontend/app/lib/voiceCatalog.ts` | add source field + mergeClonedVoices |
| `frontend/app/components/vue-canvas/VoiceGalleryModal.vue` | fetch + merge cloned; source filter pills |
| `comfy_api_nodes/nodes_replicate.py` | `_list_cloned_voice_ids()` + append to voice_id options |
| `frontend/tests/unit/voiceCatalog.unit.spec.ts` | extend — cloned merge cases |
| `frontend/tests/unit/voiceClone*.unit.spec.ts` | new — audio validation + store parse |
