# fal.ai Provider Integration for Shot Director — Design Spec

**Date:** 2026-07-02
**Status:** Approved (design), pending implementation plan
**Related:** [[project_shot_director]], [[project_character_library]], [[project_accounts_credits_billing]]

## Goal

Move Seedance 2.0 generation entirely to **fal.ai**, behind a reusable **provider abstraction** on the video-model layer, so that:

1. Photoreal-face cast references work (fal's Seedance deployment accepts them; Replicate's rejects with E005 at the input layer — proven empirically 2026-07-02: identical photoreal portrait, Replicate rejects in ~8s, fal runs ~200–290s and produces a clean identity-locked clip).
2. Other models (Veo, Kling, …) can be pointed at fal later by setting one field, without touching the dispatch core.

## Background / empirical findings (this session)

- Replicate `bytedance/seedance-2.0` runs a strict face filter; **every** photoreal reference variant (raw portrait, Ideogram sheet, Seedream portrait, baked-mesh portrait, 3-view sheet, grid/mesh overlays) → E005. The "biometric-breaking" blog tricks target the laxer Dreamina/Jimeng consumer apps, not Replicate's API.
- **fal.ai's Seedance accepts the same photoreal faces** — 2-for-2 across two distinct scenes (café, train station), identity holds including ¾-profile; the 16:9 station clip also followed the prompt fully.
- The filter is therefore Replicate's wrapper, not ByteDance-universal.

### Verified fal facts

- **App namespace:** `bytedance/seedance-2.0` (NOT `fal-ai/bytedance/...` — that no-ops in ~0.06s and 404s on result fetch).
- **Mode endpoints (functions under the app):**
  - `reference-to-video` — refs in `image_urls` (array, ≤9), tagged `@Image1`/`@Image2`/… in the prompt. Also `video_urls`/`audio_urls`.
  - `image-to-video` — first frame `image_url` (required), last frame `end_image_url` (optional).
  - `text-to-video` — prompt only.
- **Common input:** `prompt` (required), `resolution` (`480p`/`720p`/`1080p`/`4k`, default `720p`), `duration` (`auto` or `4`–`15`, string), `aspect_ratio` (`auto`/`21:9`/`16:9`/`4:3`/`1:1`/`3:4`/`9:16`), `generate_audio` (bool, default true), `bitrate_mode` (`standard`/`high`).
- **`seed` is OUTPUT-only** — fal Seedance has no seed input. Passing one is at best ignored.
- **Auth:** `Authorization: Key <id:secret>`.
- **Queue protocol:** `POST queue.fal.run/{app}/{fn}` → `{request_id, status}`; poll `GET queue.fal.run/{app}/requests/{rid}/status`; fetch `GET queue.fal.run/{app}/requests/{rid}` → `{"video": {"url": ...}, "seed": ...}`. Instant "COMPLETED" with `inference_time ≈ 0.06s` = wrong function path (no-op), not success.
- **Refs:** data URIs work in `image_urls` (proven with a 124 KB data-URI ref) — so our existing `/view?filename=…` → data-URI resolution path serves fal with no upload/CORS step.

## Decisions (locked)

- **Replace, not add:** all Seedance goes through fal; Replicate-Seedance is retired.
- **General provider seam:** build a reusable `provider` axis, not a Seedance-only special case.
- **Drop `seed` for fal specs.** "New take" becomes a plain re-run (fal is nondeterministic per call).
- **`seedance-2.0-fast`:** move to fal if a fal fast endpoint exists at build time; else keep on Replicate or drop (build-time check, not assumed).

## Architecture: the provider seam

Today `VideoModelSpec` carries a single `replicate_slug`, and `FilmShotNode.execute` calls one hardcoded `_run_prediction` (Replicate). We introduce a **`provider`** field and a per-provider endpoint descriptor; `execute` dispatches on it.

```
VideoModelSpec:
  id, label, brand, modes, build_input, price, …   (unchanged)
  provider: 'replicate' | 'fal'                     (NEW, default 'replicate')
  replicate_slug: str | None                        (used when provider='replicate')
  fal_app: str | None                               (NEW, e.g. 'bytedance/seedance-2.0')
  fal_fn_by_mode: dict | None                       (NEW, mode → function name)
```

`fal_fn_by_mode` maps the shot mode to the fal function:
`{'reference': 'reference-to-video', 'firstLast': 'image-to-video', 't2v': 'text-to-video'}`.

## Component units

### Python

**`comfy_api_nodes/fal_refs.py`** (new; sibling to `replicate_refs.py`)
- `_get_fal_token() -> str` — reads `FAL_KEY` (then `NUXT_FAL_TOKEN`) from env, else `frontend/.env`. Mirrors `replicate_refs._get_token`. Raises a clear message if absent.
- `async run_fal_prediction(app: str, fn: str, input_dict: dict, *, poll_deadline_sec) -> dict` — submits to `queue.fal.run/{app}/{fn}`, polls `.../requests/{rid}/status` until terminal (`COMPLETED`/`ERROR`/`FAILED`), returns the result dict from `.../requests/{rid}`. Treats `COMPLETED` with `inference_time < ~1s` and an unfetchable result as a routing error (guards against silent no-ops). Retries 429s like the Replicate runner.
- `first_fal_video_url(result: dict) -> str` — returns `result["video"]["url"]`; raises on missing.

**`comfy_api_nodes/video_models.py`**
- Add `provider`, `fal_app`, `fal_fn_by_mode` to `VideoModelSpec` (frozen dataclass; new fields default so existing specs are untouched).
- Seedance spec: `provider='fal'`, `fal_app='bytedance/seedance-2.0'`, `fal_fn_by_mode={…}`. `_b_seedance_2_0` becomes the **fal builder**: emits `image_urls`/`video_urls`/`audio_urls` (reference) or `image_url`+`end_image_url` (first/last); `duration` as string; `resolution`/`aspect_ratio`/`generate_audio` enums; **no `seed`**. Mode is selected by which refs/image the sheet carries.
- Keep `seedance-2.0-fast` per the build-time decision above.

**`comfy_api_nodes/nodes_replicate.py`**
- `_resolve_local_refs`: extend `_LOCAL_REF_LIST_KEYS` with `image_urls`/`video_urls`/`audio_urls` and `_LOCAL_REF_STR_KEYS` with `image_url`/`end_image_url`, so `/view?filename=…` refs resolve to data URIs for fal too. (Existing Replicate keys stay.)
- `FilmShotNode.execute`: after building `input_dict`, branch on `spec.provider`:
  - `'replicate'` → `_run_prediction(spec.replicate_slug, input_dict, …)` (unchanged).
  - `'fal'` → resolve the fal function from the **actual payload**, not just the sheet's declared mode: if a first/last-frame `image_url` is present → `image-to-video`; else if any `image_urls`/`video_urls`/`audio_urls` are present → `reference-to-video`; else → `text-to-video`. Then `pred = await run_fal_prediction(spec.fal_app, fn, input_dict, …)`, `url = first_fal_video_url(pred)`. (A "reference" sheet with an empty cast and no manual refs correctly falls through to text-to-video.)
  - `__shot_directed` pop, duration-string handling, preset-phrase suppression: unchanged.

### Frontend (`frontend/app/lib/shotdirector/`)

**`profiles.ts` `SEEDANCE_PROFILE`** (the only behavioral change; the seam already exists)
- `refTag` → `atTag` (returns `@Image{n}`/`@Video{n}`/`@Audio{n}`). Because `castClause` and `referenceSentence` already call `profile.refTag()`, the "Characters: Vera @Image1" clause and the "Use @Image1 for …" purpose phrases update automatically — no changes in `cast.ts`/`compile.ts` (only update their now-stale `[Image1]` doc comments).
- `buildInput` → emit `image_urls`/`video_urls`/`audio_urls` (reference mode) or `image_url`+`end_image_url` (first/last); drop `seed` from the emitted input.

**`dispatch.ts`** — model id stays `seedance-2.0` (provider is a Python-side property). The seed widget is still populated in the patch (FilmShotNode schema requires it) but the fal builder ignores it; "New take" reroll still bumps the visible seed for UI feedback, harmless on fal.

### Error handling

- fal accepting faces removes E005, but celebrity/NSFW moderation still applies. The existing "friendly E005 message" chip re-points to fal's error shape → plain-language message ("Seedance declined these inputs — try different references or wording. You weren't charged."). Failed fal runs are free (same as Replicate).

### Config / billing

- `FAL_KEY` (`id:secret`) is a new credential in `frontend/.env` and a new cost center. For the hosted-SaaS plan, fal is a second provider to meter — a dependency noted for [[project_accounts_credits_billing]], not built here.
- Cost parity: fal Seedance ~$0.90 for 720p/5s — same ballpark as Replicate; `price.ts` unchanged unless build-time pricing check says otherwise.

## Testing

- **Python units** (`tests-unit/comfy_api_test/`): fal input shape per mode (image_urls vs image_url/end_image_url, no seed, string duration); `run_fal_prediction` with mocked submit/poll/result (incl. the no-op/routing-error guard); `first_fal_video_url`; `_resolve_local_refs` over the new fal keys; `execute` provider dispatch.
- **Frontend units** (`frontend/tests/unit/`): `SEEDANCE_PROFILE.refTag` → `@Image`; `buildInput` emits `image_urls` and omits `seed`; cast clause renders "Vera @Image1"; reference sentence uses at-tags.
- **Live smoke:** one paid fal cast run through the real Shot Director UI (~$0.90) — cast a character, Generate, verify the clip returns and identity holds.
- **Baselines:** existing typecheck (396) and vitest (3 known unrelated failures) must not regress.

## Out of scope

- Moving other models (Veo/Kling) to fal — the seam supports it; not built now.
- fal file-upload API (data URIs suffice).
- Metering/billing implementation (belongs to accounts/credits work).
- Multi-provider failover (Replicate-as-fallback-for-fal) — not needed; can revisit.

## Rollout / migration notes

- Requires a ComfyUI restart to load the new Python (spec fields + runner).
- `FAL_KEY` must be present in `frontend/.env` before the first fal run.
- Existing saved workflows keep model id `seedance-2.0`; the provider flip is transparent to them.
- `seedance-2.0-fast` stays on Replicate — fal exposes no fast Seedance endpoint (probed 2026-07-02).
