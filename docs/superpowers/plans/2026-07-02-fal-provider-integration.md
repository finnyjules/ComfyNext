# fal.ai Provider Integration for Shot Director — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Seedance 2.0 generation from Replicate to fal.ai behind a reusable `provider` axis on the video-model registry, so photoreal-face cast references work (fal accepts them; Replicate rejects with E005).

**Architecture:** Add `provider`/`fal_app`/`fal_fn_by_mode` fields to the `VideoModel` dataclass and a new `comfy_api_nodes/fal_refs.py` (token reader + queue runner + output extractor). `FilmShotNode.execute` branches on `spec.provider`. The Seedance spec flips to `provider='fal'`; its builder emits fal-shaped input (`image_urls`/`image_url`+`end_image_url`, string duration, no seed). Frontend `SEEDANCE_PROFILE` switches its ref tag to `@Image` and emits fal key names — one profile edit, because `castClause`/`referenceSentence` already route through `profile.refTag()`.

**Tech Stack:** Python (ComfyUI custom nodes, `aiohttp`/`urllib`, pytest), TypeScript (Nuxt 4 / Vue 3, vitest), fal.ai queue REST API.

## Global Constraints

- Work on `main`, commit directly, NO feature branches.
- Stage ONLY the files each task names, with explicit paths — NEVER `git add -A`.
- fal app namespace is `bytedance/seedance-2.0` (two segments); functions are `reference-to-video` / `image-to-video` / `text-to-video`. `fal-ai/bytedance/...` is WRONG (no-ops in ~0.06s).
- fal auth header: `Authorization: Key <id:secret>`.
- fal Seedance input: `prompt` (req), `resolution` ∈ {480p,720p,1080p,4k} default 720p, `duration` STRING ∈ {auto,4..15}, `aspect_ratio` ∈ {auto,21:9,16:9,4:3,1:1,3:4,9:16}, `generate_audio` bool default true. Reference refs = `image_urls[]`; first/last frame = `image_url` + `end_image_url`. **No `seed` input** (output-only).
- fal result shape: `{"video": {"url": ...}, "seed": ...}` (NOT Replicate's list).
- A fal request that "COMPLETED" with `inference_time` under ~1s and an unfetchable result is a routing error, not a success — treat as failure.
- ref tags: fal uses `@Image1`/`@Video1`/`@Audio1` (at-sign), Replicate used `[Image1]`.
- Data URIs are valid in fal `image_urls` — existing `/view?filename=…` → data-URI resolution serves fal unchanged.
- Known baselines that must NOT regress: frontend typecheck 396 errors; vitest 3 known-unrelated failures (spacetype-palette ×2, gradientfx-mesh ×1). Python: existing `tests-unit/comfy_api_test/` suite green.
- Requires a ComfyUI restart to load Python changes (kill + relaunch, per project convention).

---

### Task 1: fal queue client (`fal_refs.py`)

**Files:**
- Create: `comfy_api_nodes/fal_refs.py`
- Test: `tests-unit/comfy_api_test/fal_refs_test.py`

**Interfaces:**
- Consumes: nothing (standalone).
- Produces:
  - `get_fal_token() -> str` — env `FAL_KEY` then `NUXT_FAL_TOKEN`, else parse `frontend/.env`. Raises `RuntimeError` if absent.
  - `async run_fal_prediction(app: str, fn: str, input_dict: dict, *, poll_deadline_sec: int = 900) -> dict` — submit to `queue.fal.run/{app}/{fn}`, poll status, return result dict.
  - `first_fal_video_url(result: dict) -> str` — returns `result["video"]["url"]`; raises `RuntimeError` on missing.

- [ ] **Step 1: Write failing tests**

Create `tests-unit/comfy_api_test/fal_refs_test.py`:

```python
"""Tests for the fal.ai queue client used by FilmShotNode when a video model's
provider is 'fal'. fal uses a two-segment app namespace (bytedance/seedance-2.0)
plus a function (reference-to-video), auth header 'Key <id:secret>', and returns
{"video": {"url": ...}}. A request that completes in <1s with no fetchable result
is a routing no-op, not a success.
"""
import pytest
from comfy_api_nodes import fal_refs


def test_first_fal_video_url_extracts():
    assert fal_refs.first_fal_video_url(
        {"video": {"url": "https://v3b.fal.media/x/video.mp4"}}
    ) == "https://v3b.fal.media/x/video.mp4"


def test_first_fal_video_url_raises_on_missing():
    with pytest.raises(RuntimeError):
        fal_refs.first_fal_video_url({"seed": 1})
    with pytest.raises(RuntimeError):
        fal_refs.first_fal_video_url({"video": {}})


def test_get_fal_token_from_env(monkeypatch):
    monkeypatch.setenv("FAL_KEY", "abc:def")
    fal_refs._TOKEN_CACHE = None
    assert fal_refs.get_fal_token() == "abc:def"


def test_get_fal_token_missing_raises(monkeypatch, tmp_path, chdir_repo_root_missing_env):
    monkeypatch.delenv("FAL_KEY", raising=False)
    monkeypatch.delenv("NUXT_FAL_TOKEN", raising=False)
    fal_refs._TOKEN_CACHE = None
    with pytest.raises(RuntimeError, match="fal"):
        fal_refs.get_fal_token()
```

Add a fixture at the top of the file that points token lookup away from a real `frontend/.env`:

```python
@pytest.fixture
def chdir_repo_root_missing_env(monkeypatch, tmp_path):
    # Make dotenv lookup resolve to an empty dir so no real FAL_KEY leaks in.
    monkeypatch.setattr(fal_refs, "_dotenv_paths", lambda: [str(tmp_path / ".env")])
    yield
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/fal_refs_test.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'comfy_api_nodes.fal_refs'`.

- [ ] **Step 3: Implement `fal_refs.py`**

Create `comfy_api_nodes/fal_refs.py`:

```python
"""Minimal fal.ai queue client for video models whose provider is 'fal'.

Mirrors the shape of replicate_refs.py. fal's queue REST API:
  POST  queue.fal.run/{app}/{fn}            -> {request_id, status, ...}
  GET   queue.fal.run/{app}/requests/{rid}/status
  GET   queue.fal.run/{app}/requests/{rid}  -> result payload

Auth is 'Authorization: Key <id:secret>'. The app namespace is two segments
(e.g. 'bytedance/seedance-2.0'); the function is the trailing segment
(e.g. 'reference-to-video'). Status/result are polled under the APP base
(queue.fal.run/{app}/requests/...), NOT under the function path.
"""
import asyncio
import os
import time

import aiohttp

FAL_QUEUE_BASE = "https://queue.fal.run"
_TOKEN_CACHE: str | None = None


def _dotenv_paths() -> list[str]:
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)
    return [os.path.join(root, "frontend", ".env"), os.path.join(root, ".env")]


def _read_token_from_dotenv() -> str | None:
    for path in _dotenv_paths():
        try:
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    for name in ("FAL_KEY", "NUXT_FAL_TOKEN"):
                        if line.startswith(name + "="):
                            v = line.split("=", 1)[1].strip().strip('"').strip("'")
                            if v:
                                return v
        except OSError:
            continue
    return None


def get_fal_token() -> str:
    global _TOKEN_CACHE
    if _TOKEN_CACHE:
        return _TOKEN_CACHE
    for env_name in ("FAL_KEY", "NUXT_FAL_TOKEN"):
        token = os.environ.get(env_name, "").strip()
        if token:
            _TOKEN_CACHE = token
            return token
    token = _read_token_from_dotenv()
    if token:
        _TOKEN_CACHE = token
        return token
    raise RuntimeError(
        "fal API token not found. Set FAL_KEY (or NUXT_FAL_TOKEN) in your shell, "
        "or add FAL_KEY=<id:secret> to frontend/.env. See https://fal.ai/dashboard/keys"
    )


def first_fal_video_url(result: dict) -> str:
    url = ((result or {}).get("video") or {}).get("url")
    if not url:
        raise RuntimeError(f"fal result had no video url: {result!r}")
    return url


async def run_fal_prediction(
    app: str, fn: str, input_dict: dict, *, poll_deadline_sec: int = 900,
) -> dict:
    token = get_fal_token()
    headers = {"Authorization": f"Key {token}", "Content-Type": "application/json"}
    submit_url = f"{FAL_QUEUE_BASE}/{app}/{fn}"
    app_base = f"{FAL_QUEUE_BASE}/{app}"

    async with aiohttp.ClientSession() as session:
        # Submit.
        for attempt in range(3):
            async with session.post(submit_url, headers=headers, json=input_dict) as r:
                if r.status in (200, 201):
                    submit = await r.json()
                    break
                if r.status == 429 and attempt < 2:
                    await asyncio.sleep(5.5)
                    continue
                raise RuntimeError(f"fal submit HTTP {r.status}: {await r.text()}")
        else:
            raise RuntimeError("fal submit rate-limited; gave up")

        rid = submit["request_id"]
        status_url = f"{app_base}/requests/{rid}/status"
        result_url = f"{app_base}/requests/{rid}"

        deadline = time.time() + poll_deadline_sec
        while time.time() < deadline:
            await asyncio.sleep(2.0)
            async with session.get(status_url, headers=headers) as r:
                if r.status != 200:
                    continue
                status = await r.json()
            state = status.get("status")
            if state in ("IN_QUEUE", "IN_PROGRESS"):
                continue
            if state == "COMPLETED":
                async with session.get(result_url, headers=headers) as r:
                    if r.status != 200:
                        # No-op routing failure: 'completed' but nothing to fetch.
                        raise RuntimeError(
                            f"fal request {rid} completed but result fetch failed "
                            f"(HTTP {r.status}) — likely a bad app/function path "
                            f"({app}/{fn}): {await r.text()}"
                        )
                    return await r.json()
            raise RuntimeError(f"fal request {rid} ended: {status}")

    raise RuntimeError(f"fal request timed out after {poll_deadline_sec}s (id={rid})")
```

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/fal_refs_test.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add comfy_api_nodes/fal_refs.py tests-unit/comfy_api_test/fal_refs_test.py
git commit -m "feat(fal): fal.ai queue client (token, runner, output extractor)"
```

---

### Task 2: `VideoModel` provider fields + fal Seedance builder

**Files:**
- Modify: `comfy_api_nodes/video_models.py` (dataclass ~line 55-65; `_b_seedance_2_0` ~line 251-277; seedance spec entry ~line 460-466)
- Test: `tests-unit/comfy_api_test/video_models_seedance_test.py` (rewrite for fal shape)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `VideoModel` gains `provider: str = "replicate"`, `fal_app: str | None = None`, `fal_fn_by_mode: dict | None = None`.
  - `_b_seedance_2_0(prompt, ar, dur, seed, image, audio, adv) -> dict` now emits fal-shaped input: keys `image_urls`/`video_urls`/`audio_urls` (reference) or `image_url`+`end_image_url` (first/last), `duration` as `str`, `resolution` default `"720p"`, `generate_audio` only when set, NO `seed`, NO `aspect_ratio` when a first-frame image is present.
  - Seedance spec: `provider="fal"`, `fal_app="bytedance/seedance-2.0"`, `fal_fn_by_mode={"reference": "reference-to-video", "firstLast": "image-to-video", "t2v": "text-to-video"}`, `durations=[5, 10, 15]`.

- [ ] **Step 1: Rewrite the Seedance test for the fal shape**

Replace the body of `tests-unit/comfy_api_test/video_models_seedance_test.py` with:

```python
"""Input-shape tests for the Seedance 2.0 builder, now targeting fal.ai.

fal's bytedance/seedance-2.0 takes reference refs in image_urls (array), a
first frame in image_url with optional end_image_url, resolution default 720p,
duration as a STRING, generate_audio, and NO seed input (seed is output-only).
Refs are tagged @Image1 in the prompt (done in the frontend). The Shot Director
forwards these via the FilmShotNode model_options JSON, reaching the builder as
`adv`.
"""
from comfy_api_nodes.video_models import _b_seedance_2_0

DATA_URL = "data:image/png;base64,x"


def test_seedance_plain_t2v_baseline():
    inp = _b_seedance_2_0("a dog", "16:9", 5, 0, None, None, {})
    assert inp["prompt"] == "a dog"
    assert inp["duration"] == "5"          # STRING for fal
    assert inp["resolution"] == "720p"     # fal default
    assert inp["aspect_ratio"] == "16:9"
    assert "seed" not in inp               # fal has no seed input
    assert "generate_audio" not in inp
    # never emit Replicate-shaped keys
    assert "reference_images" not in inp


def test_seedance_forwards_reference_url_arrays():
    adv = {
        "image_urls": [DATA_URL, DATA_URL],
        "video_urls": [DATA_URL],
        "audio_urls": [DATA_URL],
        "resolution": "720p",
        "generate_audio": True,
    }
    inp = _b_seedance_2_0("p", "9:16", 10, 7, None, None, adv)
    assert inp["image_urls"] == [DATA_URL, DATA_URL]
    assert inp["video_urls"] == [DATA_URL]
    assert inp["audio_urls"] == [DATA_URL]
    assert inp["resolution"] == "720p"
    assert inp["generate_audio"] is True
    assert inp["aspect_ratio"] == "9:16"
    assert inp["duration"] == "10"
    assert "seed" not in inp


def test_seedance_first_last_frame_via_adv():
    adv = {"image_url": DATA_URL, "end_image_url": DATA_URL,
           "image_urls": [DATA_URL]}
    inp = _b_seedance_2_0("p", "16:9", 5, 0, None, None, adv)
    assert inp["image_url"] == DATA_URL
    assert inp["end_image_url"] == DATA_URL
    # first-frame image mode: aspect_ratio dropped, refs mutually exclusive
    assert "aspect_ratio" not in inp
    assert "image_urls" not in inp


def test_seedance_wired_first_frame_beats_adv():
    # A wired IMAGE tensor (already a data URL) wins over an adv image_url.
    inp = _b_seedance_2_0("p", "16:9", 5, 0, "data:image/png;base64,WIRED", None,
                          {"image_url": DATA_URL})
    assert inp["image_url"] == "data:image/png;base64,WIRED"
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/video_models_seedance_test.py -v`
Expected: FAIL (builder still emits Replicate shape: `reference_images`, int duration, `resolution=1080p`, `seed`).

- [ ] **Step 3: Add dataclass fields**

In `comfy_api_nodes/video_models.py`, extend the `VideoModel` dataclass (after `default_duration: int = 5`):

```python
@dataclass(frozen=True)
class VideoModel:
    id: str
    label: str
    brand: str
    replicate_slug: str
    aspect_ratios: list[str]
    durations: list[int]
    modes: list[str]              # ['t2v'], ['i2v'], or ['t2v', 'i2v']
    build_input: VideoModelInputBuilder
    default_duration: int = 5
    provider: str = "replicate"                 # 'replicate' | 'fal'
    fal_app: str | None = None                  # e.g. 'bytedance/seedance-2.0'
    fal_fn_by_mode: dict | None = None          # mode -> fal function name
```

- [ ] **Step 4: Rewrite `_b_seedance_2_0` for fal**

Replace `_b_seedance_2_0` (keep the function name — it stays the Seedance builder):

```python
def _b_seedance_2_0(prompt, ar, dur, seed, image, audio, adv):
    # fal.ai bytedance/seedance-2.0 (verified 2026-07-02). References arrive as
    # image_urls/video_urls/audio_urls; first/last frame as image_url/end_image_url.
    # duration is a STRING, resolution defaults to 720p, no seed input. The Shot
    # Director forwards these via model_options (adv). Refs XOR first-frame image.
    inp: dict[str, Any] = {
        "prompt": prompt,
        "duration": str(_dur_or([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15], dur, 5)),
        "resolution": _opt_str(adv, "resolution", "720p"),
    }
    if "generate_audio" in adv:
        inp["generate_audio"] = bool(adv["generate_audio"])
    # First frame: a wired IMAGE tensor (already a data URL) wins over adv.
    first = image or _opt_str(adv, "image_url", "")
    if first:
        inp["image_url"] = first
        if last := _opt_str(adv, "end_image_url", ""):
            inp["end_image_url"] = last
    else:
        inp["aspect_ratio"] = _ar_or(_SEEDANCE_AR, ar, "16:9")
        for key in ("image_urls", "video_urls", "audio_urls"):
            vals = adv.get(key)
            if isinstance(vals, list) and vals:
                inp[key] = vals
    return inp
```

Note: `_dur_or` returns an int from the allowed list; `str(...)` makes it a fal-legal string. `_maybe_set_seed` is intentionally NOT called (fal has no seed input).

- [ ] **Step 5: Flip the Seedance spec to fal**

Change the `seedance-2.0` entry (leave `seedance-2.0-fast` untouched here — Task 4 handles it):

```python
    VideoModel(
        id="seedance-2.0", label="Seedance 2.0", brand="ByteDance",
        replicate_slug="bytedance/seedance-2.0",
        aspect_ratios=["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
        durations=[5, 10, 15], default_duration=5,
        modes=["t2v", "i2v"], build_input=_b_seedance_2_0,
        provider="fal", fal_app="bytedance/seedance-2.0",
        fal_fn_by_mode={
            "reference": "reference-to-video",
            "firstLast": "image-to-video",
            "t2v": "text-to-video",
        },
    ),
```

- [ ] **Step 6: Run to verify pass**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/video_models_seedance_test.py -v`
Expected: PASS (4 tests).

- [ ] **Step 7: Run the refs test (must still pass — shared builder)**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/video_models_refs_test.py tests-unit/comfy_api_test/video_models_kling_test.py -v`
Expected: PASS (unchanged — those test `parse_view_ref` and Kling, untouched here).

- [ ] **Step 8: Commit**

```bash
git add comfy_api_nodes/video_models.py tests-unit/comfy_api_test/video_models_seedance_test.py
git commit -m "feat(fal): VideoModel provider fields + Seedance builder emits fal shape"
```

---

### Task 3: `_resolve_local_refs` fal keys + `execute` provider dispatch

**Files:**
- Modify: `comfy_api_nodes/nodes_replicate.py` (`_LOCAL_REF_LIST_KEYS`/`_LOCAL_REF_STR_KEYS` ~line 2902-2903; `FilmShotNode.execute` ~line 3213-3225; add import of `fal_refs`)
- Test: `tests-unit/comfy_api_test/fal_dispatch_test.py`

**Interfaces:**
- Consumes: `fal_refs.run_fal_prediction`, `fal_refs.first_fal_video_url` (Task 1); `spec.provider`/`spec.fal_app`/`spec.fal_fn_by_mode` (Task 2).
- Produces:
  - `_LOCAL_REF_LIST_KEYS` includes `image_urls`, `video_urls`, `audio_urls`.
  - `_LOCAL_REF_STR_KEYS` includes `image_url`, `end_image_url`.
  - `_fal_fn_for_input(input_dict, fn_by_mode) -> str` — payload-driven fal function selection.

- [ ] **Step 1: Write failing tests**

Create `tests-unit/comfy_api_test/fal_dispatch_test.py`:

```python
"""Tests for fal function selection from the built payload, and that the fal
ref keys resolve local /view references. execute() itself is exercised by the
live smoke (Task 7); here we unit-test the pure pieces it composes.
"""
from comfy_api_nodes.nodes_replicate import _fal_fn_for_input, _resolve_local_refs

FN_BY_MODE = {
    "reference": "reference-to-video",
    "firstLast": "image-to-video",
    "t2v": "text-to-video",
}


def test_fn_first_last_when_image_url_present():
    inp = {"prompt": "p", "image_url": "data:image/png;base64,x"}
    assert _fal_fn_for_input(inp, FN_BY_MODE) == "image-to-video"


def test_fn_reference_when_url_arrays_present():
    inp = {"prompt": "p", "image_urls": ["data:image/png;base64,x"]}
    assert _fal_fn_for_input(inp, FN_BY_MODE) == "reference-to-video"


def test_fn_text_to_video_when_no_media():
    inp = {"prompt": "p", "aspect_ratio": "16:9"}
    assert _fal_fn_for_input(inp, FN_BY_MODE) == "text-to-video"


def test_resolve_fal_list_and_str_keys(monkeypatch):
    import comfy_api_nodes.nodes_replicate as nr
    monkeypatch.setattr(nr, "_local_ref_to_data_url", lambda name: f"DATA:{name}")
    adv = {
        "image_urls": ["/view?filename=a.png&type=input", "https://x/y.png"],
        "image_url": "/view?filename=first.png&type=input",
        "end_image_url": "/view?filename=last.png&type=input",
    }
    out = _resolve_local_refs(adv)
    assert out["image_urls"] == ["DATA:a.png", "https://x/y.png"]
    assert out["image_url"] == "DATA:first.png"
    assert out["end_image_url"] == "DATA:last.png"
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/fal_dispatch_test.py -v`
Expected: FAIL — `_fal_fn_for_input` not defined; fal keys not resolved.

- [ ] **Step 3: Extend the resolve key tuples**

In `comfy_api_nodes/nodes_replicate.py`, update the two tuples:

```python
_LOCAL_REF_LIST_KEYS = (
    "reference_images", "reference_videos", "reference_audios",  # Replicate
    "image_urls", "video_urls", "audio_urls",                    # fal
)
_LOCAL_REF_STR_KEYS = (
    "image", "last_frame_image",   # Replicate
    "image_url", "end_image_url",  # fal
)
```

- [ ] **Step 4: Add `_fal_fn_for_input` and the fal import**

Near the top of `nodes_replicate.py` where sibling modules are imported, add:

```python
from comfy_api_nodes import fal_refs
```

Add the pure helper next to `_resolve_local_refs`:

```python
def _fal_fn_for_input(input_dict: dict, fn_by_mode: dict) -> str:
    """Pick the fal Seedance function from the built payload: a first-frame
    image_url => image-to-video; any *_urls reference arrays => reference-to-video;
    otherwise text-to-video."""
    if input_dict.get("image_url"):
        return fn_by_mode["firstLast"]
    if any(input_dict.get(k) for k in ("image_urls", "video_urls", "audio_urls")):
        return fn_by_mode["reference"]
    return fn_by_mode["t2v"]
```

- [ ] **Step 5: Branch `execute` on provider**

In `FilmShotNode.execute`, replace the final run/return block (currently the `_run_prediction(spec.replicate_slug, ...)` + `download_url_to_video_output(_first_output_url(pred), ...)` lines) with:

```python
        if spec.provider == "fal":
            fn = _fal_fn_for_input(input_dict, spec.fal_fn_by_mode or {})
            print(
                f"[FilmShot] provider=fal app={spec.fal_app!r} fn={fn!r} "
                f"model={model!r} advanced_keys={list(input_dict)}",
                flush=True,
            )
            pred = await fal_refs.run_fal_prediction(
                spec.fal_app, fn, input_dict,
                poll_deadline_sec=_VIDEO_POLL_DEADLINE_SEC,
            )
            url = fal_refs.first_fal_video_url(pred)
        else:
            pred = await _run_prediction(spec.replicate_slug, input_dict,
                                         poll_deadline_sec=_VIDEO_POLL_DEADLINE_SEC)
            url = _first_output_url(pred)
        video = await download_url_to_video_output(url, cls=cls)
        return IO.NodeOutput(video)
```

Keep the existing `[FilmShot] preset=… slug=…` debug print (the Replicate branch still logs it); the new print adds fal detail.

- [ ] **Step 6: Run to verify pass**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/fal_dispatch_test.py -v`
Expected: PASS (4 tests).

- [ ] **Step 7: Full Python suite gate**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/ -q`
Expected: PASS (all green; no regressions).

- [ ] **Step 8: Commit**

```bash
git add comfy_api_nodes/nodes_replicate.py tests-unit/comfy_api_test/fal_dispatch_test.py
git commit -m "feat(fal): resolve fal ref keys + route FilmShotNode by provider"
```

---

### Task 4: `seedance-2.0-fast` tier decision

**Files:**
- Modify (conditional): `comfy_api_nodes/video_models.py` (the `seedance-2.0-fast` spec entry ~line 468-474)
- Modify: `docs/superpowers/specs/2026-07-02-fal-provider-integration-design.md` (record the outcome)

**Interfaces:**
- Consumes: fields from Task 2.
- Produces: `seedance-2.0-fast` either flipped to `provider="fal"` (if a fal fast endpoint exists) or documented as staying on Replicate.

- [ ] **Step 1: Probe whether fal exposes a Seedance fast endpoint (free)**

Run:

```bash
FAL_KEY="$(grep -E '^(FAL_KEY|NUXT_FAL_TOKEN)=' frontend/.env | head -1 | cut -d= -f2- | tr -d '"'"'"'\'' ')" \
.venv/bin/python - <<'PY'
import os, json, urllib.request, urllib.error
key = os.environ["FAL_KEY"]
hdr = {"Authorization": f"Key {key}", "Content-Type": "application/json"}
# Submit a bogus body to the candidate app; a valid app returns IN_QUEUE + a
# response_url whose path echoes the app, an invalid app 404s "Application not found".
body = {"prompt": "t"}
url = "https://queue.fal.run/bytedance/seedance-2.0-fast/text-to-video"
req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=hdr)
try:
    r = json.load(urllib.request.urlopen(req))
    print("response_url:", r.get("response_url"))
    # If response_url path contains 'seedance-2.0-fast', the app exists.
except urllib.error.HTTPError as e:
    print("HTTP", e.code, e.read().decode()[:200])
PY
```

Decision rule: if `response_url` contains `bytedance/seedance-2.0-fast`, the app exists → flip fast to fal. If it 404s with "Application ... not found" (or the response_url path collapses to just `bytedance`), fal has no fast tier → leave fast on Replicate.

- [ ] **Step 2a: If fal fast EXISTS — flip the spec**

Change the `seedance-2.0-fast` entry:

```python
    VideoModel(
        id="seedance-2.0-fast", label="Seedance 2.0 Fast", brand="ByteDance",
        replicate_slug="bytedance/seedance-2.0-fast",
        aspect_ratios=["16:9", "9:16", "1:1", "4:3", "3:4"],
        durations=[5, 10], default_duration=5,
        modes=["t2v", "i2v"], build_input=_b_seedance_2_0,
        provider="fal", fal_app="bytedance/seedance-2.0-fast",
        fal_fn_by_mode={
            "reference": "reference-to-video",
            "firstLast": "image-to-video",
            "t2v": "text-to-video",
        },
    ),
```

Note: this repoints its builder to the shared fal `_b_seedance_2_0` and removes the old `_b_seedance_2_0_fast` usage. If `_b_seedance_2_0_fast` becomes unused, delete it and its tests in the same commit.

- [ ] **Step 2b: If fal fast does NOT exist — document and leave on Replicate**

Leave the `seedance-2.0-fast` entry unchanged (stays `provider="replicate"` by default, keeps `_b_seedance_2_0_fast`). Add a one-line note to the design spec under "Rollout / migration notes":

```markdown
- `seedance-2.0-fast` stays on Replicate — fal exposes no fast Seedance endpoint (probed 2026-07-02).
```

- [ ] **Step 3: Run the Python suite**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/ -q`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add comfy_api_nodes/video_models.py docs/superpowers/specs/2026-07-02-fal-provider-integration-design.md
# (If 2a deleted _b_seedance_2_0_fast tests, add that test file path too.)
git commit -m "feat(fal): resolve seedance-2.0-fast provider (per fal endpoint probe)"
```

---

### Task 5: Frontend `SEEDANCE_PROFILE` — `@Image` tags + fal input keys

**Files:**
- Modify: `frontend/app/lib/shotdirector/profiles.ts` (add `atTag`; `SEEDANCE_PROFILE.refTag` + `buildInput` ~line 38-72)
- Test: `frontend/tests/unit/shotdirector-profiles.unit.spec.ts`, `frontend/tests/unit/shotdirector-cast.unit.spec.ts`

**Interfaces:**
- Consumes: existing `ModelProfile`, `bracketTag`, `srcsByKind`.
- Produces: `SEEDANCE_PROFILE.refTag` returns `@Image{n}`; `SEEDANCE_PROFILE.buildInput` emits `image_urls`/`video_urls`/`audio_urls` (reference) or `image_url`+`end_image_url` (first/last), and omits `seed`.

- [ ] **Step 1: Write failing tests**

Append to `frontend/tests/unit/shotdirector-profiles.unit.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { SEEDANCE_PROFILE } from '~/lib/shotdirector/profiles'
import type { ShotSheet } from '~/lib/shotdirector/types'

describe('SEEDANCE_PROFILE fal shape', () => {
  it('tags references with @Image (fal), not [Image]', () => {
    expect(SEEDANCE_PROFILE.refTag('image', 1)).toBe('@Image1')
    expect(SEEDANCE_PROFILE.refTag('video', 2)).toBe('@Video2')
    expect(SEEDANCE_PROFILE.refTag('audio', 3)).toBe('@Audio3')
  })

  it('emits fal image_urls and no seed in reference mode', () => {
    const sheet = {
      mode: 'reference',
      references: [
        { kind: 'image', slot: 1, src: 'https://x/a.png', role: 'identity' },
        { kind: 'image', slot: 2, src: 'https://x/b.png', role: 'identity' },
      ],
      audio: { generate: true, dialogue: [] },
      format: { aspectRatio: '16:9', durationS: 5, resolution: '720p', seed: 42 },
    } as unknown as ShotSheet
    const input = SEEDANCE_PROFILE.buildInput(sheet, 'p')
    expect(input.image_urls).toEqual(['https://x/a.png', 'https://x/b.png'])
    expect(input.reference_images).toBeUndefined()
    expect(input.seed).toBeUndefined()
    expect(input.generate_audio).toBe(true)
  })

  it('emits image_url/end_image_url in firstLastFrame mode', () => {
    const sheet = {
      mode: 'firstLastFrame',
      references: [],
      firstFrame: 'https://x/first.png',
      lastFrame: 'https://x/last.png',
      audio: { generate: false, dialogue: [] },
      format: { aspectRatio: '16:9', durationS: 5, resolution: '720p', seed: 0 },
    } as unknown as ShotSheet
    const input = SEEDANCE_PROFILE.buildInput(sheet, 'p')
    expect(input.image_url).toBe('https://x/first.png')
    expect(input.end_image_url).toBe('https://x/last.png')
    expect(input.image).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run tests/unit/shotdirector-profiles.unit.spec.ts`
Expected: FAIL — profile still returns `[Image1]`, emits `reference_images`/`image`/`seed`.

- [ ] **Step 3: Add `atTag` and update the profile**

In `frontend/app/lib/shotdirector/profiles.ts`, add next to `bracketTag`:

```typescript
function atTag(kind: RefKind, slot: number): string {
  const label = kind === 'image' ? 'Image' : kind === 'video' ? 'Video' : 'Audio'
  return `@${label}${slot}`
}
```

Change `SEEDANCE_PROFILE.refTag` from `bracketTag` to `atTag`, and replace its `buildInput` body's reference/first-last/seed section:

```typescript
  buildInput(sheet, prompt) {
    const input: ModelInput = {
      prompt,
      duration: sheet.format.durationS,
      resolution: sheet.format.resolution,
    }
    if (sheet.mode === 'reference') {
      input.aspect_ratio = sheet.format.aspectRatio
      const images = srcsByKind(sheet, 'image')
      const videos = srcsByKind(sheet, 'video')
      const audios = srcsByKind(sheet, 'audio')
      if (images.length) input.image_urls = images
      if (videos.length) input.video_urls = videos
      if (audios.length) input.audio_urls = audios
    } else {
      if (sheet.firstFrame) input.image_url = sheet.firstFrame
      if (sheet.lastFrame) input.end_image_url = sheet.lastFrame
    }
    input.generate_audio = sheet.audio.generate
    // fal Seedance has no seed input — omit it.
    return input
  },
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run tests/unit/shotdirector-profiles.unit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Update the cast-clause test expectation to at-tags**

The cast clause renders through `profile.refTag`, so its output is now `@Image1`. In `frontend/tests/unit/shotdirector-cast.unit.spec.ts`, find assertions expecting `[Image1]` in the Characters clause and update them to `@Image1` (e.g. `Characters: Vera @Image1`). Run the file to confirm which assertions changed:

Run: `cd frontend && npx vitest run tests/unit/shotdirector-cast.unit.spec.ts`
Expected: PASS after updating the bracket→at expectations. If any compile-clause test in `shotdirector-compile.unit.spec.ts` asserts a bracketed tag for Seedance, update those too and re-run that file.

- [ ] **Step 6: Full frontend shotdirector suite gate**

Run: `cd frontend && npx vitest run tests/unit/shotdirector-*.unit.spec.ts`
Expected: PASS (all shotdirector suites green).

- [ ] **Step 7: Commit**

```bash
git add frontend/app/lib/shotdirector/profiles.ts frontend/tests/unit/shotdirector-profiles.unit.spec.ts frontend/tests/unit/shotdirector-cast.unit.spec.ts
# add shotdirector-compile.unit.spec.ts too if it changed
git commit -m "feat(fal): Seedance profile emits @Image tags + fal input keys, drops seed"
```

---

### Task 6: Config, stale comments, full-suite gate

**Files:**
- Modify: `frontend/.env` (add `FAL_KEY` — NOT committed; it is gitignored)
- Modify: `frontend/app/lib/shotdirector/compile.ts` + `frontend/app/lib/shotdirector/cast.ts` (stale `[Image1]` doc comments → `@Image1`; comments only, no logic change)

**Interfaces:** none (config + comments + gate).

- [ ] **Step 1: Add the fal credential**

Confirm `frontend/.env` is gitignored:

Run: `git check-ignore frontend/.env && echo IGNORED`
Expected: prints `frontend/.env` and `IGNORED`.

Add the key (replace with the real value; do not echo it into the transcript beyond the assignment):

```bash
printf '\nFAL_KEY=%s\n' "<your-fal-id:secret>" >> frontend/.env
```

- [ ] **Step 2: Fix stale `[Image1]` doc comments**

In `frontend/app/lib/shotdirector/compile.ts` (the `referenceSentence` comment) and `frontend/app/lib/shotdirector/cast.ts` (the `castClause` docstring), change the illustrative `[Image1]` in comments to `@Image1` so the docs match the emitted tag. These are comments only — no logic change.

- [ ] **Step 3: Frontend typecheck gate**

Run: `cd frontend && npm run typecheck 2>&1 | tail -5`
Expected: 396 errors (unchanged baseline — no new errors from this work).

- [ ] **Step 4: Frontend full unit gate**

Run: `cd frontend && npx vitest run 2>&1 | tail -15`
Expected: only the 3 known-unrelated failures (spacetype-palette ×2, gradientfx-mesh ×1); all shotdirector suites green.

- [ ] **Step 5: Python full gate**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/ -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/shotdirector/compile.ts frontend/app/lib/shotdirector/cast.ts
git commit -m "docs(fal): update stale [Image1] comments to @Image1 (frontend)"
```

(`frontend/.env` is gitignored and is not part of this commit.)

---

### Task 7: Live smoke — paid fal cast run end-to-end

**Files:** none (manual verification).

**Interfaces:** exercises the whole chain (frontend compile → model_options → Python execute → fal → video).

- [ ] **Step 1: Restart ComfyUI to load the Python changes**

Kill the running ComfyUI process and relaunch:

```bash
pkill -f "main.py --listen" ; sleep 2
.venv/bin/python main.py --listen 127.0.0.1 --port 8188 > /tmp/sailor-comfyui.out.log 2>&1 &
```

Wait for `curl -s http://127.0.0.1:8188/system_stats` to return JSON.

- [ ] **Step 2: Run one cast shot through the Shot Director UI**

In the running app (or `/dev/shot-director-harness`): cast a ready character with a photoreal reference sheet (e.g. Vera), write a simple benign shot ("… sips coffee at a café, then smiles"), set 720p / 5s, and Generate (~$0.90).

- [ ] **Step 3: Confirm success**

Verify in the ComfyUI log (`/tmp/sailor-comfyui.out.log`) a line `[FilmShot] provider=fal app='bytedance/seedance-2.0' fn='reference-to-video' …`, that `/history` shows the FilmShotNode succeeded (no E005), and that a video file was written to `output/video/`. Extract a frame and confirm the character's identity holds.

Expected: a clip returns with the cast identity — no moderation rejection. If it fails with a fal moderation error, that is a content issue (not a wiring bug); retry with more benign wording.

- [ ] **Step 4: Record sign-off**

Update `[[project_shot_director]]` memory noting fal-provider integration is live-verified end-to-end, and mark this plan complete.

---

## Notes for the executor

- **Order matters:** Task 1 → 2 → 3 are a chain (3 imports 1, uses 2's fields). Task 4 depends on 2. Task 5 is frontend-independent of 1–4 but should land before Task 7. Task 6 gates everything. Task 7 is last (needs restart + all prior).
- **Do not** re-add `seed` to the fal path or emit Replicate key names — the whole point is the fal shape.
- **Data URIs work on fal** — no upload step. `_resolve_local_refs` turning `/view` refs into data URIs is the entire ref-hosting story.
- **The frontend seam already exists:** `castClause`/`referenceSentence` call `profile.refTag()`, so Task 5 is genuinely one profile edit plus test expectation updates — resist touching cast.ts/compile.ts logic.
