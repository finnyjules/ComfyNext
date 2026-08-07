# Krea 2 + FLUX 3 Video + FLUX.2 Fallover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire three new/upgraded models into Sailor's catalogs — Krea 2 (text-to-image), FLUX 3 (video+audio), and fal fallover + `flux-2-dev` for the existing FLUX.2 image family.

**Architecture:** Every model lives in **two hand-mirrored catalogs** keyed by a matching `id`: a TS file that drives the gallery UI and a Python file that drives execution. The image dispatcher (`GenerateImageNode`) auto-fails-over Replicate→fal when a model sets both `replicate_slug` and `fal_slug`; the video dispatcher (`GenerateVideoNode`) is single-provider per model (`provider="fal"` xor `"replicate"`). No node or component code changes — both dispatchers read their `*_MODELS_BY_ID` maps. We add catalog entries + pure input-builder functions + unit tests for the builder logic.

**Tech Stack:** Python 3 (dataclasses, pytest), TypeScript (Nuxt 4 data modules, vitest).

## Global Constraints

- **`id` must match byte-for-byte** across the TS and Python catalog for each model — it is the dispatch key. A mismatch means the gallery shows a card that can't run.
- **fal and Replicate use different input schemas.** Replicate image models take an `aspect_ratio` *string* (e.g. `"16:9"`); most fal image models take an `image_size` *enum* (`landscape_16_9`). Map via the existing `_fal_image_size(ar)` helper. Krea 2 and Nano-Banana are exceptions — they take `aspect_ratio` natively.
- **Only map a fal endpoint that is an EXACT counterpart** of the Replicate model (per the fleet-wide note in `image_models.py:39-52`). A vN model must never silently degrade to fal's v(N-1).
- **fal endpoint slugs and field names in this plan are drawn from fal's public model pages (Aug 2026) but MUST be re-verified against fal's live OpenAPI** before the builder is trusted — the file's own convention is "fal endpoints/schemas verified against fal's live OpenAPI" (`image_models.py:647`). Each task has an explicit verify step.
- **No API key is available in this environment.** Unit tests cover builder *mapping logic* (pure functions). A live paid render is the only proof the endpoint accepts the payload — that is **owed, not done**, and is captured in Task 6's checklist. Do not claim any model "works" without a paid render (see memory: *graceful-fallback-hides-integration-failure*).
- **Python tests:** `pytest`. **Frontend tests:** `cd frontend && npm run test:unit` (vitest). **Frontend types:** `cd frontend && npx nuxt typecheck` (baseline ~328 pre-existing errors — a new model must not add any that name its own types; see memory *typecheck-baseline-anchoring*).
- Commit after each green task. Main-direct, staging only your own hunks (memory: *parallel-sessions-commit-hygiene*).

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `comfy_api_nodes/image_models.py` | Image execution catalog + builders | Add Krea builders + 2 entries; add FLUX.2 fal builders + set `fal_slug`/`fal_build_input` on 3 entries; add `flux-2-dev` entry + builder |
| `frontend/app/data/image-models.ts` | Image gallery catalog | Add `'Krea'` to `ImageModelBrand`; add 2 Krea entries; add `flux-2-dev` entry |
| `frontend/app/data/brand-icons.ts` | Brand accent colors | Add `'Krea'` color |
| `comfy_api_nodes/video_models.py` | Video execution catalog + builders | Add `_b_flux_3` builder + 1 entry |
| `frontend/app/data/video-models.ts` | Video gallery catalog | Add `'BFL'` to `VideoModelBrand`; add `flux-3` entry |
| `tests/image_models_fal_test.py` | fal image-builder contracts | Add Krea + FLUX.2 fal builder tests |
| `tests-unit/comfy_api_test/video_models_flux3_test.py` | FLUX 3 builder contract | Create |
| `frontend/tests/unit/catalog-parity.unit.spec.ts` | TS↔Python id parity guard | Create |

---

## Task 1: Krea 2 — Python execution catalog

**Files:**
- Modify: `comfy_api_nodes/image_models.py` (builders near `:669-814`; registry `:819-908`)
- Test: `tests/image_models_fal_test.py`

**Interfaces:**
- Consumes: `_fal_image_size` is **not** used (Krea takes `aspect_ratio` natively); `_opt_str`, `_opt_int`, `_maybe_set_seed`, `_ar_or` from the same module.
- Produces: `_b_krea2(prompt, ar, seed, adv) -> dict` (Replicate shape), `_fal_krea2(prompt, ar, seed, adv) -> dict` (fal shape); registry entries `krea-2-large`, `krea-2-medium`.

- [ ] **Step 1: Verify the live fal + Replicate Krea schemas**

Confirm before writing the builder. fal large endpoint page: `https://fal.ai/models/krea/v2/large/text-to-image/api`; medium: swap `large`→`medium`. Replicate: `https://replicate.com/krea/krea-2-large`. Confirm: fal slug `krea/v2/large/text-to-image` (no `fal-ai/` prefix), input fields `prompt`, `aspect_ratio` (enum `1:1,4:3,3:2,16:9,2.35:1,4:5,2:3,9:16`), `creativity` (`raw,low,medium,high`), `seed`; Replicate model id `krea/krea-2-large` and whether **`krea/krea-2-medium` exists on Replicate** (fal has medium; Replicate may not). Note the answer — it decides `krea-2-medium`'s `replicate_slug` in Step 6.

- [ ] **Step 2: Write the failing tests**

Add to `tests/image_models_fal_test.py`:

```python
from comfy_api_nodes.image_models import (
    MODELS, _fal_flux_schnell, _b_krea2, _fal_krea2,
)

KREA_ARS = {"1:1", "4:3", "3:2", "16:9", "2.35:1", "4:5", "2:3", "9:16"}


def test_krea_large_is_fal_primary_with_replicate_backup():
    spec = next(m for m in MODELS if m.id == "krea-2-large")
    assert spec.primary == "fal"
    assert spec.fal_slug == "krea/v2/large/text-to-image"
    assert spec.fal_build_input is _fal_krea2
    assert spec.replicate_slug == "krea/krea-2-large"


def test_fal_krea_uses_native_aspect_ratio_not_image_size():
    inp = _fal_krea2("a boat", "16:9", 0, {})
    assert inp["prompt"] == "a boat"
    assert inp["aspect_ratio"] == "16:9"     # native, NOT "landscape_16_9"
    assert "image_size" not in inp
    assert inp["creativity"] == "medium"     # default


def test_fal_krea_unsupported_ar_falls_back_to_square():
    inp = _fal_krea2("x", "21:9", 0, {})     # not in Krea's enum
    assert inp["aspect_ratio"] == "1:1"


def test_fal_krea_creativity_clamped_to_enum():
    assert _fal_krea2("x", "1:1", 0, {"creativity": "wild"})["creativity"] == "medium"
    assert _fal_krea2("x", "1:1", 0, {"creativity": "raw"})["creativity"] == "raw"


def test_krea_seed_only_when_nonzero():
    assert "seed" not in _fal_krea2("x", "1:1", 0, {})
    assert _fal_krea2("x", "1:1", 7, {})["seed"] == 7


def test_replicate_krea_shape():
    inp = _b_krea2("x", "3:2", 5, {"creativity": "high"})
    assert inp["aspect_ratio"] == "3:2"
    assert inp["creativity"] == "high"
    assert inp["seed"] == 5
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pytest tests/image_models_fal_test.py -k krea -v`
Expected: FAIL — `ImportError: cannot import name '_b_krea2'`.

- [ ] **Step 4: Implement the builders**

Add near the other fal builders (after `_fal_seedream_v4`, ~`:815`):

```python
# ---------- Krea ------------------------------------------------------------
_KREA_AR = {"1:1", "4:3", "3:2", "16:9", "2.35:1", "4:5", "2:3", "9:16"}
_KREA_CREATIVITY = {"raw", "low", "medium", "high"}


def _krea_creativity(adv: dict) -> str:
    v = _opt_str(adv, "creativity", "medium")
    return v if v in _KREA_CREATIVITY else "medium"


def _b_krea2(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    # Replicate krea/krea-2-large. Native aspect_ratio + creativity enum.
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_KREA_AR, ar),
        "creativity": _krea_creativity(adv),
    }
    _maybe_set_seed(inp, seed)
    return inp


def _fal_krea2(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    # fal krea/v2/{large,medium}/text-to-image — same field names as Replicate.
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_KREA_AR, ar),
        "creativity": _krea_creativity(adv),
    }
    _maybe_set_seed(inp, seed)
    return inp
```

> Note: `_b_krea2` and `_fal_krea2` are intentionally identical today (Krea's fal and Replicate schemas match). Keep them separate — the fal schema (style refs / moodboards) will diverge when the taste-system tie-in lands, and the dispatcher passes distinct builder refs.

- [ ] **Step 5: Confirm `_ar_or` signature**

Check `_ar_or` in `image_models.py` — if its signature is `_ar_or(allowed_set, ar, fallback="1:1")`, the calls above are correct. If the default differs, pass `"1:1"` explicitly. Adjust the builder calls to match.

- [ ] **Step 6: Add the registry entries**

In `MODELS` (`:819`), after the BFL block / in brand order, add a Krea section. Use the Step 1 finding for `krea-2-medium`'s `replicate_slug`: if `krea/krea-2-medium` exists on Replicate, use it; if not, set `primary="fal"` and point `replicate_slug` at `"krea/krea-2-large"` is **wrong** — instead give it its own slug `"krea/krea-2-medium"` and accept that fallover 404s until Replicate ships medium (fal is primary, so the happy path is unaffected).

```python
    # Krea --------------------------------------------------------------------
    ImageModel("krea-2-large",  "Krea 2 Large",  "Krea", "krea/krea-2-large",  sorted(_KREA_AR), _b_krea2,
               fal_slug="krea/v2/large/text-to-image",  fal_build_input=_fal_krea2, primary="fal"),
    ImageModel("krea-2-medium", "Krea 2 Medium", "Krea", "krea/krea-2-medium", sorted(_KREA_AR), _b_krea2,
               fal_slug="krea/v2/medium/text-to-image", fal_build_input=_fal_krea2, primary="fal"),
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pytest tests/image_models_fal_test.py -k krea -v`
Expected: PASS (all krea tests).

- [ ] **Step 8: Run the full fal test file to check for regressions**

Run: `pytest tests/image_models_fal_test.py -v`
Expected: PASS (no pre-existing tests broken).

- [ ] **Step 9: Commit**

```bash
git add comfy_api_nodes/image_models.py tests/image_models_fal_test.py
git commit -m "feat(models): wire Krea 2 (large+medium) image models — fal primary, Replicate backup"
```

---

## Task 2: Krea 2 — TS gallery catalog

**Files:**
- Modify: `frontend/app/data/image-models.ts` (brand union `:46-49`; catalog `:141+`)
- Modify: `frontend/app/data/brand-icons.ts` (`BRAND_COLORS` `:81-107`)

**Interfaces:**
- Consumes: `ImageModel` interface (`:63-76`), `ImageModelBrand` union.
- Produces: gallery cards `krea-2-large`, `krea-2-medium` with `id` matching the Python side exactly.

- [ ] **Step 1: Add `'Krea'` to the brand union**

Edit `image-models.ts:46-49`:

```typescript
export type ImageModelBrand =
  | 'BFL' | 'Google' | 'OpenAI' | 'ByteDance' | 'Ideogram'
  | 'Recraft' | 'Stability AI' | 'Alibaba' | 'Tencent' | 'xAI'
  | 'Pruna' | 'Meta' | 'Bria' | 'Luma' | 'MiniMax' | 'Reve' | 'Krea' | 'Other'
```

- [ ] **Step 2: Add the Krea brand color**

Edit `brand-icons.ts` `BRAND_COLORS` (after the image-catalog brands block, ~`:98`):

```typescript
  'Reve':         '#c7b1ff',
  'Krea':         '#7c5cff',
```

- [ ] **Step 3: Add a shared Krea aspect-ratio const**

Near the other AR consts (`image-models.ts:117-137`):

```typescript
const KREA_AR = ['1:1', '4:3', '3:2', '16:9', '2.35:1', '4:5', '2:3', '9:16']
```

- [ ] **Step 4: Add the catalog entries**

In `IMAGE_MODELS`, add a Krea block (place after the BFL block for brand grouping). `creativity` is the only per-model advanced field:

```typescript
  // ===== Krea ===============================================================
  {
    id: 'krea-2-large',
    label: 'Krea 2 Large',
    brand: 'Krea',
    replicateSlug: 'krea/krea-2-large',
    pitch: 'Krea\'s foundation model — photoreal, raw aesthetics, strong style transfer.',
    tags: ['flagship', 'photoreal'],
    pricePerImage: null,
    aspectRatios: KREA_AR,
    defaultAspectRatio: '1:1',
    advanced: [
      { name: 'creativity', type: 'select', label: 'Creativity', default: 'medium',
        options: ['raw', 'low', 'medium', 'high'],
        description: '"raw" renders only what you describe; "high" takes creative liberty.' },
    ],
  },
  {
    id: 'krea-2-medium',
    label: 'Krea 2 Medium',
    brand: 'Krea',
    replicateSlug: 'krea/krea-2-medium',
    pitch: 'Smaller, faster Krea 2 — strong for illustration, anime, and painterly styles.',
    tags: ['fast'],
    pricePerImage: null,
    aspectRatios: KREA_AR,
    defaultAspectRatio: '1:1',
    advanced: [
      { name: 'creativity', type: 'select', label: 'Creativity', default: 'medium',
        options: ['raw', 'low', 'medium', 'high'] },
    ],
  },
```

> Confirm `tags` values (`'flagship'`, `'photoreal'`, `'fast'`) exist in the `ImageModelTag` union near the top of the file; if not, use ones that do. Confirm `pricePerImage: null` renders as "varies" in the gallery (the interface allows null at `:71`).

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx nuxt typecheck 2>&1 | grep -c "error"`
Expected: count ≤ baseline (~328). Then confirm none mention `krea` or `Krea`:
Run: `cd frontend && npx nuxt typecheck 2>&1 | grep -i krea`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/data/image-models.ts frontend/app/data/brand-icons.ts
git commit -m "feat(gallery): add Krea 2 image-model cards + brand"
```

---

## Task 3: FLUX.2 — fal fallover + `flux-2-dev`

The FLUX.2 family (`flux-2-max`, `flux-2-pro`, `flux-2-flex`, `flux-2-klein-4b`) is **already in both catalogs, Replicate-only**. This task (a) adds fal as an automatic *backup* to the pro/max/flex trio, and (b) adds the missing `flux-2-dev`. We keep `primary="replicate"` (default) — fal is the fallover, not the primary, until real latency data justifies flipping it.

**Files:**
- Modify: `comfy_api_nodes/image_models.py` (fal builders ~`:815`; entries `:828-831`)
- Modify: `frontend/app/data/image-models.ts` (catalog, after `flux-2-klein-4b` `:288`)
- Test: `tests/image_models_fal_test.py`

**Interfaces:**
- Consumes: `_fal_image_size`, `_opt_int`, `_opt_str`, `_maybe_set_seed`, `_ar_or`, `_FLUX_2_AR`.
- Produces: `_fal_flux_2_basic`, `_fal_flux_2_tunable(prompt, ar, seed, adv) -> dict`; sets fal fields on 3 entries; new `_b_flux_2_dev` + `flux-2-dev` entry.

- [ ] **Step 1: Verify the live fal FLUX.2 schemas**

Fetch `https://fal.ai/models/fal-ai/flux-2-pro/api`, `.../flux-2-max/api`, `.../flux-2-flex/api`, and find the `flux-2-dev` fal slug (likely `fal-ai/flux-2/dev` or `fal-ai/flux-2-dev` — confirm). Confirm: `image_size` enum (not aspect_ratio), `safety_tolerance` as **string** `"1".."5"`, `output_format` ∈ `{jpeg,png}`, and that flex/dev additionally accept `guidance_scale` (default 3.5) + `num_inference_steps` (default 28). Record the confirmed `flux-2-dev` slug and Replicate slug (`black-forest-labs/flux-2-dev`, confirmed present in Replicate's BFL listing).

- [ ] **Step 2: Write the failing tests**

Add to `tests/image_models_fal_test.py`:

```python
from comfy_api_nodes.image_models import _fal_flux_2_basic, _fal_flux_2_tunable


def test_flux_2_pro_has_fal_backup():
    spec = next(m for m in MODELS if m.id == "flux-2-pro")
    assert spec.fal_slug == "fal-ai/flux-2-pro"
    assert spec.fal_build_input is _fal_flux_2_basic
    assert spec.primary == "replicate"   # fal is the BACKUP, not primary


def test_fal_flux_2_maps_ar_to_image_size():
    inp = _fal_flux_2_basic("x", "16:9", 0, {})
    assert inp["image_size"] == "landscape_16_9"
    assert "aspect_ratio" not in inp


def test_fal_flux_2_safety_tolerance_is_string_capped_at_5():
    assert _fal_flux_2_basic("x", "1:1", 0, {"safety_tolerance": 9})["safety_tolerance"] == "5"
    assert _fal_flux_2_basic("x", "1:1", 0, {})["safety_tolerance"] == "2"


def test_fal_flux_2_output_format_coerced_to_fal_enum():
    # TS default for flux-2 is webp, which fal flux-2 rejects.
    assert _fal_flux_2_basic("x", "1:1", 0, {"output_format": "webp"})["output_format"] in {"jpeg", "png"}


def test_fal_flux_2_tunable_forwards_steps_and_guidance():
    inp = _fal_flux_2_tunable("x", "1:1", 0, {"steps": 40, "guidance": 6.0})
    assert inp["num_inference_steps"] == 40
    assert inp["guidance_scale"] == 6.0


def test_flux_2_dev_exists_and_maps_both_providers():
    spec = next(m for m in MODELS if m.id == "flux-2-dev")
    assert spec.replicate_slug == "black-forest-labs/flux-2-dev"
    assert spec.fal_build_input is _fal_flux_2_tunable
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pytest tests/image_models_fal_test.py -k "flux_2" -v`
Expected: FAIL — `ImportError: cannot import name '_fal_flux_2_basic'`.

- [ ] **Step 4: Implement the fal FLUX.2 builders**

Add near the other fal builders (~`:815`):

```python
def _fal_flux_2_out_fmt(adv: dict) -> str:
    # fal flux-2 accepts only jpeg/png; our TS default is webp.
    v = _opt_str(adv, "output_format", "png")
    return "png" if v == "png" else "jpeg"


def _fal_flux_2_basic(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    # fal-ai/flux-2-pro and fal-ai/flux-2-max — same input schema.
    tol = min(5, max(1, _opt_int(adv, "safety_tolerance", 2)))
    inp = {
        "prompt": prompt,
        "image_size": _fal_image_size(ar),
        "safety_tolerance": str(tol),
        "output_format": _fal_flux_2_out_fmt(adv),
    }
    _maybe_set_seed(inp, seed)
    return inp


def _fal_flux_2_tunable(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    # fal-ai/flux-2-flex and fal-ai/flux-2/dev — adds steps + guidance.
    inp = _fal_flux_2_basic(prompt, ar, seed, adv)
    inp["num_inference_steps"] = _opt_int(adv, "steps", 28)
    inp["guidance_scale"] = float(adv.get("guidance", 3.5))
    return inp
```

- [ ] **Step 5: Wire fal onto the existing pro/max/flex entries**

Edit the three entries at `image_models.py:828-830` to add fal fields (keep `primary` default):

```python
    ImageModel("flux-2-max",  "Flux 2 Max",  "BFL", "black-forest-labs/flux-2-max",  sorted(_FLUX_2_AR), _b_flux_2_max,
               fal_slug="fal-ai/flux-2-max",  fal_build_input=_fal_flux_2_basic),
    ImageModel("flux-2-pro",  "Flux 2 Pro",  "BFL", "black-forest-labs/flux-2-pro",  sorted(_FLUX_2_AR), _b_flux_2_pro,
               fal_slug="fal-ai/flux-2-pro",  fal_build_input=_fal_flux_2_basic),
    ImageModel("flux-2-flex", "Flux 2 Flex", "BFL", "black-forest-labs/flux-2-flex", sorted(_FLUX_2_AR), _b_flux_2_flex,
               fal_slug="fal-ai/flux-2-flex", fal_build_input=_fal_flux_2_tunable),
```

- [ ] **Step 6: Add `_b_flux_2_dev` (Replicate builder) + the entry**

Model the Replicate builder on `_b_flux_2_flex` (dev is tunable). Find `_b_flux_2_flex` (`:234`) and mirror it as `_b_flux_2_dev` (same fields — `aspect_ratio` via `_ar_or(_FLUX_2_AR, ar)`, resolution, steps, guidance). Then add the entry after `flux-2-klein-4b` (`:831`), using the fal slug confirmed in Step 1:

```python
    ImageModel("flux-2-dev", "Flux 2 Dev", "BFL", "black-forest-labs/flux-2-dev", sorted(_FLUX_2_AR), _b_flux_2_dev,
               fal_slug="fal-ai/flux-2/dev", fal_build_input=_fal_flux_2_tunable),
```

- [ ] **Step 7: Add the `flux-2-dev` TS entry**

In `image-models.ts`, after `flux-2-klein-4b` (`:288`), add (model its advanced on the flex entry — steps/guidance/resolution):

```typescript
  {
    id: 'flux-2-dev',
    label: 'Flux 2 Dev',
    brand: 'BFL',
    replicateSlug: 'black-forest-labs/flux-2-dev',
    pitch: 'Open-weight Flux 2 — tunable steps and guidance, self-hostable lineage.',
    tags: ['flagship', 'typography'],
    pricePerImage: 0.03,
    aspectRatios: FLUX_2_AR,
    defaultAspectRatio: '1:1',
    advanced: [
      { name: 'resolution', type: 'select', label: 'Resolution', default: '1 MP',
        options: ['0.5 MP', '1 MP', '2 MP', '4 MP'] },
      { name: 'steps', type: 'integer', label: 'Steps', default: 28, min: 1, max: 50 },
      { name: 'guidance', type: 'float', label: 'Guidance', default: 3.5, min: 1.5, max: 10, step: 0.1 },
      { name: 'safety_tolerance', type: 'integer', label: 'Safety tolerance', default: 2, min: 1, max: 5 },
      { ...OUTPUT_FORMAT_WPJ, default: 'webp' },
    ],
  },
```

- [ ] **Step 8: Run tests + typecheck**

Run: `pytest tests/image_models_fal_test.py -v`
Expected: PASS (all flux_2 + krea + schnell tests).
Run: `cd frontend && npx nuxt typecheck 2>&1 | grep -i "flux-2-dev\|flux_2"`
Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add comfy_api_nodes/image_models.py frontend/app/data/image-models.ts tests/image_models_fal_test.py
git commit -m "feat(models): add fal fallover to FLUX.2 pro/max/flex + wire flux-2-dev"
```

---

## Task 4: FLUX 3 — Python video execution catalog

FLUX 3 is a **video+audio** model. On fal it lives at app `blackforestlabs/flux-3` with per-mode functions (`text-to-video`, `image-to-video`, plus `interpolation`/`keyframes-to-video` reserved for a later task). We wire the core `t2v` + `i2v` modes now, using `provider="fal"`.

**Files:**
- Modify: `comfy_api_nodes/video_models.py` (builders `:147+`; catalog `:422-543`)
- Test: `tests-unit/comfy_api_test/video_models_flux3_test.py` (create)

**Interfaces:**
- Consumes: `_ar_or`, `_dur_or`, `_opt_str`, `_opt_bool`, `_maybe_set_seed`. The dispatcher's `_fal_fn_for_input` (`nodes_replicate.py:3540`) requires `fal_fn_by_mode` to define keys `"t2v"`, `"firstLast"`, `"reference"` — omit any and it raises `KeyError`.
- Produces: `_b_flux_3(prompt, ar, dur, seed, image, audio, adv) -> dict`; entry `flux-3`.

- [ ] **Step 1: Verify the live fal FLUX 3 video schema**

Fetch `https://fal.ai/models/blackforestlabs/flux-3/text-to-video/api` and `.../image-to-video/api`. Confirm: app namespace `blackforestlabs/flux-3`, function names `text-to-video` / `image-to-video`, and the input fields — `prompt`, duration form (int seconds vs string `"10s"`), `resolution` enum (`720p`/`1080p`), aspect-ratio field name, first-frame field name (`image_url`?), and the audio toggle field name (`generate_audio`?). This plan assumes int `duration`, `resolution`, `aspect_ratio` (t2v only), `image_url` (i2v), `generate_audio`. **Correct the builder in Step 4 to match what you find.**

- [ ] **Step 2: Write the failing tests**

Create `tests-unit/comfy_api_test/video_models_flux3_test.py`:

```python
"""Input-shape tests for the FLUX 3 (video) builder targeting fal.ai.

fal blackforestlabs/flux-3 splits t2v / i2v into separate functions selected by
_fal_fn_for_input: a first-frame image_url => image-to-video, else text-to-video.
"""
from comfy_api_nodes.video_models import _b_flux_3, VIDEO_MODELS_BY_ID
from comfy_api_nodes.nodes_replicate import _fal_fn_for_input

DATA_URL = "data:image/png;base64,x"


def test_flux3_t2v_baseline():
    inp = _b_flux_3("a boat at sea", "16:9", 10, 0, None, None, {})
    assert inp["prompt"] == "a boat at sea"
    assert inp["aspect_ratio"] == "16:9"
    assert inp["resolution"] == "720p"
    assert "image_url" not in inp


def test_flux3_i2v_sets_image_url_and_drops_aspect_ratio():
    inp = _b_flux_3("p", "16:9", 10, 0, DATA_URL, None, {})
    assert inp["image_url"] == DATA_URL
    assert "aspect_ratio" not in inp   # framing follows the image


def test_flux3_duration_clamped_to_supported_set():
    inp = _b_flux_3("p", "16:9", 99, 0, None, None, {})
    assert inp["duration"] in (5, 10, 15, 20)


def test_flux3_generate_audio_defaults_on():
    assert _b_flux_3("p", "16:9", 10, 0, None, None, {})["generate_audio"] is True
    assert _b_flux_3("p", "16:9", 10, 0, None, None, {"generate_audio": False})["generate_audio"] is False


def test_flux3_registry_entry_is_fal_with_full_fn_map():
    spec = VIDEO_MODELS_BY_ID["flux-3"]
    assert spec.provider == "fal"
    assert spec.fal_app == "blackforestlabs/flux-3"
    # _fal_fn_for_input needs all three keys or it KeyErrors
    for key in ("t2v", "firstLast", "reference"):
        assert key in spec.fal_fn_by_mode


def test_flux3_fn_selection_matches_dispatcher():
    spec = VIDEO_MODELS_BY_ID["flux-3"]
    t2v_inp = _b_flux_3("p", "16:9", 10, 0, None, None, {})
    i2v_inp = _b_flux_3("p", "16:9", 10, 0, DATA_URL, None, {})
    assert _fal_fn_for_input(t2v_inp, spec.fal_fn_by_mode) == "text-to-video"
    assert _fal_fn_for_input(i2v_inp, spec.fal_fn_by_mode) == "image-to-video"
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pytest tests-unit/comfy_api_test/video_models_flux3_test.py -v`
Expected: FAIL — `ImportError: cannot import name '_b_flux_3'`.

- [ ] **Step 4: Implement the builder**

Add near the other builders (after the Veo block, ~`:184`), adjusting field names/forms per Step 1:

```python
# ===== Black Forest Labs (FLUX 3 video) =====================================

_FLUX3_AR   = {"16:9", "9:16", "1:1"}
_FLUX3_DURS = [5, 10, 15, 20]


def _b_flux_3(prompt, ar, dur, seed, image, audio, adv):
    """fal blackforestlabs/flux-3 text-to-video / image-to-video. A wired first
    frame (image) selects the i2v function via _fal_fn_for_input, so framing
    follows the image and aspect_ratio is dropped in that mode. Native audio is
    on by default (the model's headline feature); flip it off for a cheaper,
    silent render."""
    inp: dict[str, Any] = {
        "prompt": prompt,
        "duration": _dur_or(_FLUX3_DURS, dur, 10),
        "resolution": _opt_str(adv, "resolution", "720p"),
        "generate_audio": _opt_bool(adv, "generate_audio", True),
    }
    if image:
        inp["image_url"] = image
    else:
        inp["aspect_ratio"] = _ar_or(_FLUX3_AR, ar, "16:9")
    _maybe_set_seed(inp, seed)
    return inp
```

- [ ] **Step 5: Add the registry entry**

In `MODELS` (`video_models.py:422`), after the OpenAI/Sora block (BFL has no existing video group), add:

```python
    VideoModel(
        id="flux-3", label="FLUX 3", brand="BFL",
        replicate_slug="black-forest-labs/flux-3",
        aspect_ratios=["16:9", "9:16", "1:1"],
        durations=[5, 10, 15, 20], default_duration=10,
        modes=["t2v", "i2v"], build_input=_b_flux_3,
        provider="fal", fal_app="blackforestlabs/flux-3",
        fal_fn_by_mode={"t2v": "text-to-video", "firstLast": "image-to-video", "reference": "image-to-video"},
    ),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest tests-unit/comfy_api_test/video_models_flux3_test.py -v`
Expected: PASS (all 6 tests).

- [ ] **Step 7: Run the video test suite for regressions**

Run: `pytest tests-unit/comfy_api_test/ -k video -v`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add comfy_api_nodes/video_models.py tests-unit/comfy_api_test/video_models_flux3_test.py
git commit -m "feat(video): wire FLUX 3 (t2v + i2v) via fal, native audio default-on"
```

---

## Task 5: FLUX 3 — TS video gallery catalog

**Files:**
- Modify: `frontend/app/data/video-models.ts` (brand union `:48-50`; catalog `:121+`)

**Interfaces:**
- Consumes: `VideoModel` interface (`:64-87`), `VideoModelBrand` union. `'BFL'` accent color already exists in `BRAND_COLORS` (`brand-icons.ts:83`) — no color change needed.
- Produces: gallery card `flux-3` with `id`, `modes`, `durations`, `resolutions` matching the Python entry.

- [ ] **Step 1: Add `'BFL'` to the video brand union**

Edit `video-models.ts:48-50`:

```typescript
export type VideoModelBrand =
  | 'Google' | 'OpenAI' | 'Runway' | 'Kling' | 'ByteDance'
  | 'MiniMax' | 'Wan' | 'Luma' | 'Lightricks' | 'PixVerse' | 'VEED' | 'BFL' | 'Other'
```

- [ ] **Step 2: Add the catalog entry**

In `VIDEO_MODELS`, after the OpenAI/Sora entries, add. `supportsSeed: true` mirrors that `_b_flux_3` calls `_maybe_set_seed`. Confirm the `VideoModelTag` values used exist in that union (near top of file); swap if not:

```typescript
  {
    id: 'flux-3',
    label: 'FLUX 3',
    brand: 'BFL',
    replicateSlug: 'black-forest-labs/flux-3',
    pitch: 'BFL\'s multimodal model — up to 20s video with native synchronized audio.',
    tags: ['flagship', 'audio'],
    modes: ['t2v', 'i2v'],
    supportsSeed: true,
    priceHint: '~$0.20–0.40 / s',
    aspectRatios: ['16:9', '9:16', '1:1'],
    defaultAspectRatio: '16:9',
    durations: [5, 10, 15, 20],
    defaultDuration: 10,
    resolutions: ['720p', '1080p'],
    defaultResolution: '720p',
    advanced: [
      { name: 'generate_audio', type: 'boolean', label: 'Generate audio', default: true,
        description: 'Native synchronized audio. Off is cheaper and silent.' },
    ],
  },
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx nuxt typecheck 2>&1 | grep -i "flux-3\|flux_3"`
Expected: no output. Then confirm total error count ≤ baseline (~328).

- [ ] **Step 4: Commit**

```bash
git add frontend/app/data/video-models.ts
git commit -m "feat(gallery): add FLUX 3 video-model card"
```

---

## Task 6: Cross-catalog parity guard + verification

**Files:**
- Create: `frontend/tests/unit/catalog-parity.unit.spec.ts`

**Interfaces:**
- Consumes: `IMAGE_MODELS_BY_ID`, `VIDEO_MODELS_BY_ID` from the TS catalogs.

- [ ] **Step 1: Write the parity test**

The TS and Python catalogs are hand-mirrored; a drifted `id` silently breaks dispatch. This test asserts the new ids are present with the fields the dispatcher relies on. Create `frontend/tests/unit/catalog-parity.unit.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { IMAGE_MODELS_BY_ID } from '~/data/image-models'
import { VIDEO_MODELS_BY_ID } from '~/data/video-models'

describe('new model catalog entries', () => {
  it('exposes the Krea 2 image models', () => {
    expect(IMAGE_MODELS_BY_ID['krea-2-large']?.brand).toBe('Krea')
    expect(IMAGE_MODELS_BY_ID['krea-2-medium']?.brand).toBe('Krea')
    expect(IMAGE_MODELS_BY_ID['krea-2-large']?.replicateSlug).toBe('krea/krea-2-large')
  })

  it('exposes flux-2-dev alongside the existing FLUX.2 family', () => {
    for (const id of ['flux-2-pro', 'flux-2-max', 'flux-2-flex', 'flux-2-dev']) {
      expect(IMAGE_MODELS_BY_ID[id], id).toBeTruthy()
    }
  })

  it('exposes FLUX 3 as a t2v+i2v video model', () => {
    const m = VIDEO_MODELS_BY_ID['flux-3']
    expect(m?.brand).toBe('BFL')
    expect(m?.modes).toEqual(['t2v', 'i2v'])
    expect(m?.durations).toContain(20)
  })
})
```

- [ ] **Step 2: Run the parity test**

Run: `cd frontend && npm run test:unit -- catalog-parity`
Expected: PASS (3 tests).

- [ ] **Step 3: Full unit-test sanity + count check**

Run: `cd frontend && npm run test:unit 2>&1 | tail -5`
Note the total passed/failed (memory: *vitest-counts-lie-under-load* — check the collected-file total, don't quote a single flaky run). No new failures attributable to the catalog change.
Run: `pytest tests/image_models_fal_test.py tests-unit/comfy_api_test/ -q`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/tests/unit/catalog-parity.unit.spec.ts
git commit -m "test(models): parity guard for Krea 2 / FLUX.2 dev / FLUX 3 catalog entries"
```

- [ ] **Step 5: Live paid-render verification (OWED — do not skip, do not fake)**

Unit tests prove *mapping logic*, not that the endpoints accept the payloads. With a real `FAL_KEY` / `REPLICATE_API_TOKEN` in `frontend/.env`, run each once from the app and confirm a real output — a green render, not a fallover-hidden failure (memory: *fal-enum-mismatch-silent-fallover*: a bad fal field 200s at submit and only fails at result, then falls over to a Replicate cold boot):

  1. **Krea 2 Large** — drop a Generate-Image node, pick Krea 2 Large, render. Watch the ComfyUI console for `provider=fal app='krea/v2/large/text-to-image'`. Confirm an image, not a Replicate-fallover log line.
  2. **Krea 2 Medium** — same; confirm the `.../medium/...` fal app in the log.
  3. **FLUX.2 pro/flex fallover** — force a Replicate failure (or trust the path) and confirm fal takes over cleanly; at minimum render `flux-2-dev` once on Replicate.
  4. **FLUX 3** — Generate-Video node, FLUX 3, t2v render; confirm `provider=fal app='blackforestlabs/flux-3' fn='text-to-video'` and a video with audio. Then wire a first frame and confirm `fn='image-to-video'`.

Record the outcomes (pass/fail + cost) in a memory note; until then these models are **code-complete but runtime-unverified**.

---

## Deferred / follow-up (not in this plan)

- **Krea 2 taste tie-in**: Krea's `image_style_references`, `moodboards`, and `styles` (LoRA presets) params map onto Sailor's taste + LoRA system. Its own design pass — the builders here leave hooks (separate `_b_krea2`/`_fal_krea2`) so the fal shape can diverge without touching Replicate.
- **FLUX 3 advanced modes**: `interpolation`, `keyframes-to-video`, `video-continuation`, and 1080p upscaling go beyond the `t2v`/`i2v` `modes` schema — extending `VideoModel.modes` + the dispatcher's `_fal_fn_for_input` is a follow-on.
- **FLUX 3 Image**: when BFL ships the text-to-image endpoint, it slots into `image-models.ts` + `image_models.py` like Krea 2 (this plan's Task 1/2 shape).
- **Flip FLUX.2 to `primary="fal"`**: once latency data shows fal is steadier, as it did for schnell/pro-v1.1.

## Self-Review

- **Spec coverage:** Krea 2 (Tasks 1–2) ✓; FLUX 3 video (Tasks 4–5) ✓; FLUX.2 variants — reframed to fal-fallover + `flux-2-dev` since max/flex/pro already existed (Task 3) ✓; parity + runtime verification (Task 6) ✓.
- **Placeholder scan:** every code step carries real code; verify-against-live-schema steps are genuine actions with URLs, not "TODO".
- **Type consistency:** builder names (`_b_krea2`, `_fal_krea2`, `_fal_flux_2_basic`, `_fal_flux_2_tunable`, `_b_flux_2_dev`, `_b_flux_3`) are used identically in their tasks' tests and registry entries; the video builder's 7-arg signature `(prompt, ar, dur, seed, image, audio, adv)` matches `VideoModelInputBuilder`; `fal_fn_by_mode` includes all three keys `_fal_fn_for_input` reads.
