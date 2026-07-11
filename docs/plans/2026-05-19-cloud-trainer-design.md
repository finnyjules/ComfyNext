# Cloud LoRA Trainer + Flux LoRA Inference Node

## Context

Sailor now has a working local LoRA trainer surface (Apple Silicon M3 Pro: estimated 8–16 hours per Flux LoRA, painfully slow). The goal of this work is two-fold:

1. **Replace Krea Pro ($35/mo) for this user's personal workflow.** Most of Krea's tools (face swap, bg remove, upscale, video, audio) are already in Sailor. The missing piece is fast Flux LoRA training and Flux+LoRA inference.
2. **Set up the architecture for distribution later.** This is built BYOK from day one so a future packaged release of Sailor lets each user bring their own Replicate token. No central billing problem to solve.

The plan adds two features that close the loop end-to-end:

- **Cloud trainer**: an option in the existing Train LoRA surface to run training on Replicate instead of locally. ~$2–5 per Flux LoRA, ~20–40 min wall time.
- **Flux + LoRA inference node**: a new API node that runs Flux Dev with a user-trained LoRA. ~$0.03–0.05 per image, ~10–20 seconds each.

Together these let the user train a LoRA and immediately use it without ever loading a 24 GB unet locally.

## Approach

**BYOK Replicate via a Nuxt server-side proxy.** Three layers:

1. **Browser (Vue)** — UI only. Never sees the API token.
2. **Nuxt server (Nitro routes)** — holds the token, proxies to Replicate. This is the same pattern as the existing [comfyui-proxy.ts](frontend/server/middleware/comfyui-proxy.ts) middleware.
3. **Replicate** — the actual training + inference.

The token comes from `runtimeConfig.replicateToken` (env var `NUXT_REPLICATE_TOKEN` for the user's own setup; a settings UI input later for distribution).

For the inference node, the same proxy pattern doesn't apply — Comfy nodes call out from the Python backend, not the Nuxt server. The node reads the token from environment in the same way [nodes_anthropic.py](comfy_api_nodes/nodes_anthropic.py) does for Anthropic.

## Why Replicate (not RunPod / Modal / BFL)

- **Friendliest for end users.** One token, no concept of pods/templates/credits. Critical for distribution.
- **Trainer already exists.** `ostris/flux-dev-lora-trainer` and SDXL equivalents are battle-tested, output standard `.safetensors`.
- **Inference + LoRA already exists.** Models like `black-forest-labs/flux-dev-lora` and `lucataco/flux-dev-lora` accept a `.safetensors` URL as input — exactly the loop we need.
- **No infrastructure.** No Docker image, no CUDA versions, no cold-start tuning.
- **Trade-off accepted:** fewer hyperparameter knobs than the local trainer. Steps / LR / rank / batch / seed map cleanly. Exotic knobs (optimizer choice, bypass mode, loss function) just don't exist on Replicate and hide in cloud mode.

BFL's official Flux API is closed inference only — no custom LoRAs — so it can't be used for this even though the BFL nodes already exist in the repo.

## User flow

**Training:**

1. In the Train LoRA surface, click the new **Compute** toggle: `Local | Cloud`.
2. Cloud mode shows a narrowed hyperparameter form (the ~5 knobs Replicate accepts) and hides the Advanced disclosure.
3. User uploads images, edits captions (auto-caption still works — runs through local Claude before upload).
4. Click "Start training (cloud)".
5. Frontend zips images + captions client-side, POSTs the zip to `/api/cloud-train/upload`.
6. Server uploads zip to Replicate's files API, gets a URL, POSTs to Replicate's trainings API with hyperparams + zip URL, returns the training ID.
7. Frontend polls `/api/cloud-train/status?id=...` every 3 seconds, shows a progress bar.
8. On completion: server downloads the `.safetensors` from Replicate's CDN, saves to `models/loras/<output_name>.safetensors`. Frontend shows both the local filename and the Replicate URL (for sharing/backup).

**Inference:**

The user adds the new `FluxLoRA (Replicate)` node to a workflow. Inputs: prompt, lora URL (or local filename — the node resolves to the URL Replicate gave us at training time), width, height, steps, guidance, seed. Output: image.

The trained LoRA's Replicate URL is stored alongside the local file (e.g. in `models/loras/<output_name>.json` sidecar) so the user can reference "the LoRA I just trained" by filename in workflows without thinking about URLs.

## Architecture

```
LoraTrainerSurface.vue
  └─ Compute toggle: Local | Cloud
        │
        ▼ Cloud branch
  ┌─────────────────────────────────────────────────┐
  │ Browser                                         │
  │   1. Zip images + captions (JSZip)              │
  │   2. POST blob → /api/cloud-train/upload        │
  │   3. POST hyperparams → /api/cloud-train/start  │
  │   4. Poll /api/cloud-train/status?id=...        │
  └─────────────────────────────────────────────────┘
        │
        ▼
  ┌─────────────────────────────────────────────────┐
  │ Nuxt server (token lives here only)             │
  │   /api/cloud-train/upload   → Replicate Files   │
  │   /api/cloud-train/start    → Replicate Trainings│
  │   /api/cloud-train/status   → Replicate Polling │
  │   On done: stream .safetensors → models/loras/  │
  │            write <name>.json sidecar (replicate │
  │            URL + metadata)                       │
  └─────────────────────────────────────────────────┘

FluxLoRA-Replicate node (Python, used in workflows)
  ┌─────────────────────────────────────────────────┐
  │ Reads REPLICATE_API_TOKEN from env              │
  │ Accepts: prompt, lora (combo of local filenames │
  │   in models/loras/), w, h, steps, cfg, seed     │
  │ Resolves lora → URL via sidecar JSON            │
  │ POSTs prediction to black-forest-labs/flux-dev- │
  │   lora, polls, downloads image, returns tensor  │
  └─────────────────────────────────────────────────┘
```

## Phasing

**Phase 1 — Cloud trainer (this branch, ~1 day)**

- New Nuxt server routes under `frontend/server/api/cloud-train/`:
  - `upload.post.ts` — accept FormData zip, forward to Replicate files API
  - `start.post.ts` — accept JSON hyperparams + file URL, kick off Replicate training
  - `status.get.ts` — poll Replicate, on completion fetch the `.safetensors` and write to `models/loras/` + sidecar JSON
- New env var: `NUXT_REPLICATE_TOKEN` in `frontend/nuxt.config.ts` runtimeConfig
- Update [LoraTrainerSurface.vue](frontend/app/components/LoraTrainerSurface.vue):
  - Compute toggle (Local / Cloud)
  - When Cloud: narrow form, hide Advanced, replace local submit with the new flow
  - Same caption + image grid (no changes to dataset UX)
  - Result section adds the Replicate URL alongside the local filename
- Use `jszip` (already common in Nuxt projects, or `client-zip` for streaming) to build the zip in browser

**Phase 2 — Flux+LoRA inference node (~half day)**

- New file `comfy_api_nodes/nodes_replicate.py` following the existing API-node pattern
- `FluxLoRARemoteNode` class:
  - Inputs: prompt (str), lora (combo from `folder_paths.get_filename_list("loras")` + `[None]`), width, height, num_inference_steps, guidance_scale, seed
  - Resolves the selected LoRA filename to its Replicate URL via the sidecar JSON written at training time
  - Falls back to a `lora_url` string input for LoRAs trained elsewhere
  - Uses `replicate` Python SDK or raw `requests` to call `black-forest-labs/flux-dev-lora`
- Read `REPLICATE_API_TOKEN` from env at node execute time (same shape as the existing Anthropic node)

**Phase 3 — Polish for distribution (later, ~half day)**

- Settings UI for the Replicate token (persisted to localStorage; mirrored to a server route that writes a local config file so the Python node can read it)
- Pre-flight: ping `/v1/account` on Replicate to verify token before any training
- Cost estimator: show `~$3–5` next to the Start training button when in Cloud mode, based on selected hyperparameters
- Better error messages for common failures (insufficient credits, model down, dataset zip rejected)

## Critical files

**New:**
- [frontend/server/api/cloud-train/upload.post.ts](frontend/server/api/cloud-train/upload.post.ts)
- [frontend/server/api/cloud-train/start.post.ts](frontend/server/api/cloud-train/start.post.ts)
- [frontend/server/api/cloud-train/status.get.ts](frontend/server/api/cloud-train/status.get.ts)
- [comfy_api_nodes/nodes_replicate.py](comfy_api_nodes/nodes_replicate.py) — Phase 2

**Modify:**
- [frontend/app/components/LoraTrainerSurface.vue](frontend/app/components/LoraTrainerSurface.vue) — compute toggle, cloud branch
- [frontend/nuxt.config.ts](frontend/nuxt.config.ts) — `runtimeConfig.replicateToken: process.env.NUXT_REPLICATE_TOKEN`
- [frontend/package.json](frontend/package.json) — add `client-zip` (≤2 KB, streaming) or `jszip`

**Read-only references:**
- [frontend/server/middleware/comfyui-proxy.ts](frontend/server/middleware/comfyui-proxy.ts) — Nitro proxy pattern to copy
- [comfy_api_nodes/nodes_anthropic.py](comfy_api_nodes/nodes_anthropic.py) — API-node env-token pattern to copy

## Replicate model targets

- **Training (SDXL):** `replicate/lora-training` or `ostris/sdxl-lora-trainer`. Input: `input_images` zip URL, `trigger_word`, `train_steps`, `learning_rate`, `lora_lr`, `seed`. Output: trained `.safetensors`.
- **Training (Flux):** `ostris/flux-dev-lora-trainer`. Input: `input_images` zip URL, `trigger_word`, `steps`, `learning_rate`, `lora_rank`, `batch_size`, `resolution`, `autocaption`, `seed`. Output: `.tar` containing `lora.safetensors`.
- **Inference (Flux + LoRA):** `black-forest-labs/flux-dev-lora`. Input: `prompt`, `hf_lora` (URL to safetensors), `lora_scale`, `width`, `height`, `num_inference_steps`, `guidance_scale`, `seed`. Output: image URL.

Confirm exact input schemas via `GET https://api.replicate.com/v1/models/<owner>/<name>` before wiring.

## Dataset format (for the zip)

Replicate's Flux trainer expects the zip to contain image files + matching `.txt` caption files (same convention as kohya). Example:

```
dataset.zip
  ├─ 00001.png
  ├─ 00001.txt        ("a photo of ohwx person, looking left")
  ├─ 00002.png
  ├─ 00002.txt
  ...
```

The frontend builds this from the in-memory `images` array (file blob + edited caption per tile). No server hop for dataset assembly — it goes browser → Nuxt proxy → Replicate.

## Sidecar JSON

When the cloud trainer finishes, we write `<name>.json` next to the `.safetensors` in `models/loras/`:

```json
{
  "name": "my_lora_v1",
  "base_model": "flux-dev",
  "trigger_word": "ohwx",
  "trained_on": "2026-05-19T...",
  "provider": "replicate",
  "replicate_training_id": "...",
  "replicate_url": "https://replicate.delivery/.../lora.safetensors",
  "hyperparameters": { "steps": 500, "lora_rank": 16, ... }
}
```

The Flux+LoRA inference node reads this to translate "selected LoRA filename" into the URL Replicate needs.

## What this is NOT

- Not a multi-provider abstraction. Replicate only in V1; add others later if needed.
- Not a hosted SaaS. Sailor stays self-hosted; users bring their own Replicate token.
- Not a cancellation/resume system. If the user closes the tab mid-training, the Replicate job keeps running on its own; the next time they open the surface we can offer "you have a training in progress, resume polling?" but that's Phase 3.
- Not a Replicate-only future. The cloud trainer abstraction is intentionally thin so adding fal.ai / RunPod later is a swap, not a rewrite.

## Effort estimate

- **Phase 1 (cloud trainer):** ~6–10 hours. Most of it is Replicate API quirks + zip building + result download flow.
- **Phase 2 (inference node):** ~3–5 hours. Straightforward API-node clone.
- **Phase 3 (polish):** open-ended, but pre-distribution sweep is ~3–5 hours.

Total to get off Krea: ~2 working days of focused effort.

## Verification

1. Set `NUXT_REPLICATE_TOKEN` in your shell, start the Nuxt dev server.
2. In the Train LoRA surface, flip Compute → Cloud.
3. Upload 5–10 images, type a caption per image (skip auto-caption for the smoke test).
4. Set steps=200, rank=16 (cheap test run, ~$1).
5. Hit Start. Watch the progress bar move through Replicate's lifecycle (queued → starting → processing → succeeded).
6. On done: confirm `models/loras/<name>.safetensors` exists locally + sidecar JSON is written + the surface shows the Replicate CDN URL.
7. Phase 2: open a new workflow, add the `FluxLoRA (Replicate)` node, pick the LoRA just trained from the dropdown, prompt "a photo of <trigger_word> standing in a forest", run. Confirm an image comes back in ~15 seconds and it shows the LoRA's identity.
8. End-to-end cost check: see ~$2–5 spent on your Replicate account dashboard, no surprises.
9. Cancel Krea, watch the savings start.
