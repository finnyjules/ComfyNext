# Shader Effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unicorn Studio-style `ShaderEffect` node — 14 GLSL effects with a live animated WebGL2 preview in the node body and identical server-side OpenGL rendering on Run.

**Architecture:** Each effect is one GLSL ES 3.00 fragment shader in a `shader_effects/` catalog (manifest + `.frag` files). The browser renders it via a shared singleton WebGL2 offscreen renderer (node bodies use cheap 2D canvases — no per-node GL contexts); the server renders the same source through the `nodes_glsl.py` OpenGL machinery (extended with a native CGL backend for macOS, verified working on this machine: GL 4.1 Metal, M3 Pro). Parity enforced by golden PNGs generated server-side and compared against headless-browser renders in Playwright.

**Tech Stack:** Python (PyOpenGL, ctypes CGL, aiohttp routes on PromptServer), GLSL ES 3.00, Vue 3 / Nuxt 4 (VueFlow custom node), WebGL2, pytest, vitest, Playwright.

**Design spec:** `docs/plans/2026-06-10-shader-effects-design.md`

**Verified facts (do not re-derive):**
- `_init_glfw()` raises on macOS by design ([nodes_glsl.py:166](../../comfy_extras/nodes_glsl.py)). EGL/OSMesa are unavailable on this Mac. A ctypes CGL context (from upstream branch commit `916bc190`) **works**: context + compile + FBO render + readback verified on this machine.
- Python unit tests mock the `nodes` module before importing `comfy_extras.*` (pattern: `tests-unit/comfy_extras_test/image_stitch_test.py`).
- Frontend: custom node components register via `ARTIFACT_NODE_COMPONENTS` in `frontend/app/composables/useVueNodes.ts` + the `:node-types` map in `frontend/app/components/vue-canvas/VueNodeCanvas.vue` (~line 3995). Widget values are read/written by index found via `props.data.widgetDefs.findIndex(w => w.name === ...)`, mutating `props.data.widgetsValues[i]` directly. Upstream images resolve via injected `vueFlowEdges`/`vueFlowNodes` (edge `targetHandle === 'input-0'`) → `src.data.images[0]` or LoadImage `/view?...` URL (pattern: `ArtifactFrameNode.vue:149-177`).
- Backend restarts are required after Python changes; per project convention **kill** the ComfyUI process (a supervisor restarts it), don't expect hot reload.
- Run python tests as `.venv/bin/python -m pytest tests-unit/comfy_extras_test/<file>.py -v` from repo root. Frontend: `cd frontend && npx vitest run tests/unit/<file>.unit.spec.ts`, Playwright: `cd frontend && npx playwright test tests/<file>.spec.ts --project=chromium`.

## File map

| Path | Responsibility |
|---|---|
| `comfy_extras/nodes_glsl.py` | MODIFY: add `_init_cgl()` backend (Task 0) |
| `shader_effects/manifest.json` | Effect catalog: params, categories, textures |
| `shader_effects/*.frag` | 14 effect shaders, GLSL ES 3.00 |
| `shader_effects/assets/` | `glyph_atlas.png` + `glyph_atlas.json` + generator script |
| `comfy_extras/_shader_effects.py` | Catalog loader, param resolution, `frame_plan()`, `render_effect()` |
| `comfy_extras/nodes_shader_effects.py` | `ShaderEffect` node + `/sailor/shader_effects` routes |
| `nodes.py` | MODIFY: register `nodes_shader_effects.py` |
| `tests-unit/comfy_extras_test/glsl_context_test.py` | GL context + passthrough render test |
| `tests-unit/comfy_extras_test/shader_effects_test.py` | Loader/params/frame_plan/node/golden tests |
| `tests-unit/shaderfx_golden/generate_goldens.py` | Fixture + golden PNG generator |
| `tests-unit/shaderfx_golden/*.png` | Fixtures (`fixture_128/256.png`) + goldens (`<effect>_<size>.png`) |
| `frontend/app/lib/shaderfx/types.ts` | Manifest TS types |
| `frontend/app/lib/shaderfx/params.ts` | Pure param helpers (vitest) |
| `frontend/app/lib/shaderfx/chain.ts` | Pure upstream-chain walk (vitest) |
| `frontend/app/lib/shaderfx/catalog.ts` | Fetch/cache catalog from backend |
| `frontend/app/lib/shaderfx/renderer.ts` | Singleton WebGL2 offscreen renderer |
| `frontend/app/components/vue-canvas/ShaderEffectNode.vue` | Node body: canvas, sliders, picker, handle |
| `frontend/app/pages/dev/shaderfx-harness.vue` | Playwright render harness |
| `frontend/tests/shaderfx-golden.spec.ts` | Browser-vs-server parity test (loops the catalog) |
| `frontend/tests/unit/shaderfx-params.unit.spec.ts` | params.ts tests |
| `frontend/tests/unit/shaderfx-chain.unit.spec.ts` | chain.ts tests |

## Conventions (apply to every shader)

- File starts with the standard preamble (below). Uniforms: `u_image0`, `u_resolution`, `u_time` (seconds), `u_seed`, plus `u_<param>` floats from the manifest. All manifest params are `float` (integer-like params use `step: 1` and `floor()` in the shader).
- **Resolution independence:** spatial sizes are fractions of image height. Aspect-corrected space: `vec2 asp = vec2(u_resolution.x / u_resolution.y, 1.0); vec2 p = v_texCoord * asp;` (or `(v_texCoord - center) * asp` for radial effects).
- Randomness uses the PCG uint hash (bitwise-identical on both runtimes for identical lattice inputs) — never `fract(sin(...))`.
- Standard preamble:

```glsl
#version 300 es
precision highp float;
uniform sampler2D u_image0;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_seed;
in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor0;
```

- Shared hash/noise snippet (copy into shaders that need it — no include mechanism):

```glsl
uint pcg(uint v) { v = v * 747796405u + 2891336453u; v = ((v >> ((v >> 28u) + 4u)) ^ v) * 277803737u; return (v >> 22u) ^ v; }
float hash2(vec2 ip, float seed) {
    uvec2 q = uvec2(ivec2(ip) + 32768);
    uint h = pcg(q.x ^ pcg(q.y ^ pcg(uint(int(seed)))));
    return float(h) * (1.0 / 4294967295.0);
}
float vnoise(vec2 p, float seed) {
    vec2 i = floor(p), f = fract(p);
    vec2 u2 = f * f * (3.0 - 2.0 * f);
    float a = hash2(i, seed), b = hash2(i + vec2(1, 0), seed);
    float c = hash2(i + vec2(0, 1), seed), d = hash2(i + vec2(1, 1), seed);
    return mix(mix(a, b, u2.x), mix(c, d, u2.x), u2.y);
}
float fbm(vec2 p, float seed) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * vnoise(p, seed + float(i) * 17.0); p *= 2.03; a *= 0.5; }
    return v;
}
```

---

### Task 0: CGL backend — make server GL work on macOS

**Files:**
- Modify: `comfy_extras/nodes_glsl.py` (add `_init_cgl`, wire into `GLContext.__init__` and `make_current`)
- Test: `tests-unit/comfy_extras_test/glsl_context_test.py`

- [ ] **Step 1: Write the failing test**

```python
"""GL context smoke test: a backend initializes and a passthrough shader round-trips."""
import sys
from unittest.mock import MagicMock

# Prevent CUDA/server init during import (established pattern, see image_stitch_test.py)
sys.modules.setdefault("nodes", MagicMock())

import numpy as np

from comfy_extras.nodes_glsl import (
    DEFAULT_FRAGMENT_SHADER,
    GLContext,
    _render_shader_batch,
)


def test_gl_context_initializes_on_this_platform():
    ctx = GLContext()
    assert ctx._backend in ("glfw", "egl", "osmesa", "cgl")


def test_passthrough_shader_roundtrips_image():
    rng = np.random.default_rng(7)
    img = rng.random((64, 64, 3), dtype=np.float32)
    outs = _render_shader_batch(DEFAULT_FRAGMENT_SHADER, 64, 64, [[img]], [], [])
    out = outs[0][0]
    assert out.shape == (64, 64, 4)
    assert np.abs(out[..., :3] - img).max() < 1.0 / 255.0
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/glsl_context_test.py -v`
Expected: FAIL — `RuntimeError: Failed to create OpenGL context` (all of GLFW/EGL/OSMesa fail on macOS).

- [ ] **Step 3: Add `_init_cgl()` to nodes_glsl.py**

Insert after `_init_egl()` (around line 279). This is the verified code from upstream commit `916bc190` plus a platform guard:

```python
def _init_cgl():
    """Initialize CGL (macOS native OpenGL, headless, GPU). Returns (context, opengl_lib)."""
    import ctypes
    import ctypes.util

    if sys.platform != "darwin":
        raise RuntimeError("CGL backend is macOS-only")

    logger.debug("_init_cgl: starting")
    opengl_path = ctypes.util.find_library("OpenGL")
    if not opengl_path:
        raise RuntimeError("Could not find OpenGL framework")
    opengl = ctypes.cdll.LoadLibrary(opengl_path)

    CGLPixelFormatObj = ctypes.c_void_p
    CGLContextObj = ctypes.c_void_p

    kCGLPFAOpenGLProfile = 99
    kCGLOGLPVersion_3_2_Core = 0x3200
    kCGLPFAAccelerated = 73
    kCGLPFAColorSize = 8
    kCGLPFAAllowOfflineRenderers = 96

    attrs = (ctypes.c_int * 9)(
        kCGLPFAOpenGLProfile, kCGLOGLPVersion_3_2_Core,
        kCGLPFAAccelerated,
        kCGLPFAColorSize, 32,
        kCGLPFAAllowOfflineRenderers,
        0,  # terminator
    )

    pix_fmt = CGLPixelFormatObj()
    npix = ctypes.c_int(0)
    err = opengl.CGLChoosePixelFormat(attrs, ctypes.byref(pix_fmt), ctypes.byref(npix))
    if err != 0 or not pix_fmt:
        raise RuntimeError(f"CGLChoosePixelFormat() failed with error {err}")

    ctx = CGLContextObj()
    err = opengl.CGLCreateContext(pix_fmt, None, ctypes.byref(ctx))
    opengl.CGLDestroyPixelFormat(pix_fmt)
    if err != 0 or not ctx:
        raise RuntimeError(f"CGLCreateContext() failed with error {err}")

    err = opengl.CGLSetCurrentContext(ctx)
    if err != 0:
        opengl.CGLDestroyContext(ctx)
        raise RuntimeError(f"CGLSetCurrentContext() failed with error {err}")

    logger.debug("_init_cgl: completed successfully")
    return ctx, opengl
```

- [ ] **Step 4: Wire CGL into `GLContext`**

In `GLContext.__init__`: add instance fields and a CGL attempt between the GLFW and EGL attempts:

```python
        self._cgl_ctx = None
        self._cgl_lib = None
```

```python
        if self._backend is None:
            logger.debug("GLContext.__init__: trying CGL backend")
            try:
                self._cgl_ctx, self._cgl_lib = _init_cgl()
                self._backend = "cgl"
                logger.debug("GLContext.__init__: CGL backend succeeded")
            except Exception as e:
                logger.debug(f"GLContext.__init__: CGL backend failed: {e}")
                errors.append(("CGL", e))
```

In `make_current()` add:

```python
        elif self._backend == "cgl":
            self._cgl_lib.CGLSetCurrentContext(self._cgl_ctx)
```

Also update the macOS `platform_help` string (the `brew install mesa` advice is now a fallback, CGL is automatic):

```python
                platform_help = (
                    "macOS: native CGL backend failed unexpectedly.\n"
                    "  Fallback: brew install mesa && pip install PyOpenGL PyOpenGL-accelerate"
                )
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/glsl_context_test.py -v`
Expected: 2 passed. The log line should read `GLSL context initialized ... (cgl) - Apple M3 Pro`.

- [ ] **Step 6: Commit**

```bash
git add comfy_extras/nodes_glsl.py tests-unit/comfy_extras_test/glsl_context_test.py
git commit -m "GLSL: native CGL backend so the GL pipeline works headless on macOS"
```

---

### Task 1: Catalog skeleton + Python loader

**Files:**
- Create: `shader_effects/manifest.json`, `shader_effects/noise_distortion.frag`, `shader_effects/halftone.frag`
- Create: `comfy_extras/_shader_effects.py` (loader + param resolution + frame_plan; rendering added in Task 2)
- Test: `tests-unit/comfy_extras_test/shader_effects_test.py`

- [ ] **Step 1: Create `shader_effects/manifest.json`**

```json
{
  "version": 1,
  "effects": [
    {
      "id": "noise_distortion",
      "name": "Noise Distortion",
      "category": "distortion",
      "animated": true,
      "passes": 1,
      "centerParam": null,
      "textures": [],
      "params": [
        { "uniform": "u_amount", "label": "Amount", "type": "float", "min": 0.0, "max": 0.3, "default": 0.06, "step": 0.005 },
        { "uniform": "u_scale", "label": "Scale", "type": "float", "min": 1.0, "max": 20.0, "default": 4.0, "step": 0.5 },
        { "uniform": "u_speed", "label": "Speed", "type": "float", "min": 0.0, "max": 3.0, "default": 1.0, "step": 0.05 }
      ]
    },
    {
      "id": "halftone",
      "name": "Halftone",
      "category": "stylize",
      "animated": false,
      "passes": 1,
      "centerParam": null,
      "textures": [],
      "params": [
        { "uniform": "u_size", "label": "Dot Size", "type": "float", "min": 0.004, "max": 0.1, "default": 0.02, "step": 0.002 },
        { "uniform": "u_angle", "label": "Angle", "type": "float", "min": 0.0, "max": 180.0, "default": 45.0, "step": 1.0 },
        { "uniform": "u_softness", "label": "Softness", "type": "float", "min": 0.01, "max": 0.5, "default": 0.12, "step": 0.01 }
      ]
    }
  ]
}
```

- [ ] **Step 2: Create `shader_effects/noise_distortion.frag`**

Standard preamble + hash/noise snippet from Conventions, then:

```glsl
uniform float u_amount;
uniform float u_scale;
uniform float u_speed;

void main() {
    vec2 asp = vec2(u_resolution.x / u_resolution.y, 1.0);
    vec2 p = v_texCoord * asp * u_scale;
    float t = u_time * u_speed;
    vec2 off = vec2(
        fbm(p + vec2(0.0, t), u_seed) - 0.5,
        fbm(p + vec2(5.2, t * 1.1), u_seed + 31.0) - 0.5
    ) * 2.0 * u_amount;
    fragColor0 = vec4(texture(u_image0, clamp(v_texCoord + off, 0.0, 1.0)).rgb, 1.0);
}
```

- [ ] **Step 3: Create `shader_effects/halftone.frag`**

Standard preamble (no noise snippet needed), then:

```glsl
uniform float u_size;
uniform float u_angle;
uniform float u_softness;

void main() {
    vec2 asp = vec2(u_resolution.x / u_resolution.y, 1.0);
    float ang = radians(u_angle);
    mat2 R = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
    vec2 p = (v_texCoord - 0.5) * asp;
    vec2 g = (R * p) / u_size;
    vec2 cell = floor(g) + 0.5;
    vec2 cuv = (transpose(R) * (cell * u_size)) / asp + 0.5;
    vec3 col = texture(u_image0, clamp(cuv, 0.0, 1.0)).rgb;
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    float radius = sqrt(max(1.0 - lum, 0.0)) * 0.7071;
    float d = length(g - cell);
    float m = smoothstep(radius, radius - max(u_softness, 0.001) * 0.7071, d);
    fragColor0 = vec4(mix(vec3(1.0), col, m), 1.0);
}
```

- [ ] **Step 4: Write failing loader tests**

Create `tests-unit/comfy_extras_test/shader_effects_test.py`:

```python
"""Catalog loader, param resolution, and frame-plan tests for shader effects."""
import sys
from unittest.mock import MagicMock

sys.modules.setdefault("nodes", MagicMock())

import json

import pytest

from comfy_extras._shader_effects import frame_plan, load_catalog, resolve_params


def test_catalog_loads_and_has_spike_effects():
    cat = load_catalog(refresh=True)
    assert "noise_distortion" in cat.effects
    assert "halftone" in cat.effects
    eff = cat.effects["noise_distortion"]
    assert eff.source.startswith("#version 300 es")
    assert eff.category == "distortion"
    assert eff.params[0].uniform == "u_amount"


def test_resolve_params_defaults_overrides_and_clamps():
    cat = load_catalog(refresh=True)
    eff = cat.effects["noise_distortion"]
    # Defaults
    u = resolve_params(eff, "{}")
    assert u["u_amount"] == pytest.approx(0.06)
    # Override + clamp + unknown key ignored
    u = resolve_params(eff, json.dumps({"u_amount": 99.0, "u_bogus": 1.0}))
    assert u["u_amount"] == pytest.approx(0.3)
    assert "u_bogus" not in u


def test_resolve_params_rejects_bad_json():
    cat = load_catalog(refresh=True)
    with pytest.raises(ValueError, match="params"):
        resolve_params(cat.effects["halftone"], "{not json")


def test_frame_plan_semantics():
    # Still + no duration -> one frame at `time`
    assert frame_plan(1, 2.5, 0.0, 24) == [(0, 2.5)]
    # Still + duration -> duration*fps frames advancing from `time`
    plan = frame_plan(1, 0.0, 1.0, 4)
    assert plan == [(0, 0.0), (0, 0.25), (0, 0.5), (0, 0.75)]
    # Batch input -> one output frame per input frame, duration ignored
    plan = frame_plan(3, 1.0, 99.0, 2)
    assert plan == [(0, 1.0), (1, 1.5), (2, 2.0)]
```

- [ ] **Step 5: Run to verify failure**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/shader_effects_test.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'comfy_extras._shader_effects'`

- [ ] **Step 6: Implement the loader in `comfy_extras/_shader_effects.py`**

```python
"""Shader-effects catalog: loading, validation, param resolution, frame planning.

The catalog (shader_effects/ at repo root) is the single source of truth for both
the browser preview (served via /sailor/shader_effects) and server rendering.
Rendering lives in render_effect() (added alongside; reuses nodes_glsl machinery).
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field

CATALOG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "shader_effects")
ASSETS_DIR = os.path.join(CATALOG_DIR, "assets")


@dataclass
class EffectParam:
    uniform: str
    label: str
    type: str
    min: float
    max: float
    default: float
    step: float


@dataclass
class Effect:
    id: str
    name: str
    category: str
    animated: bool
    passes: int
    center_param: list[str] | None
    textures: list[dict]
    params: list[EffectParam]
    source: str


@dataclass
class Catalog:
    version: int
    effects: dict[str, Effect] = field(default_factory=dict)


_catalog: Catalog | None = None


def load_catalog(refresh: bool = False) -> Catalog:
    global _catalog
    if _catalog is not None and not refresh:
        return _catalog

    manifest_path = os.path.join(CATALOG_DIR, "manifest.json")
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    effects: dict[str, Effect] = {}
    for entry in manifest["effects"]:
        eid = entry["id"]
        if eid in effects:
            raise ValueError(f"shader_effects manifest: duplicate effect id {eid!r}")
        frag_path = os.path.join(CATALOG_DIR, f"{eid}.frag")
        if not os.path.isfile(frag_path):
            raise ValueError(f"shader_effects manifest: missing shader file for {eid!r}")
        with open(frag_path, "r", encoding="utf-8") as f:
            source = f.read()
        params = [EffectParam(**p) for p in entry["params"]]
        for p in params:
            if not (p.min <= p.default <= p.max):
                raise ValueError(f"shader_effects {eid!r}: default for {p.uniform} outside [min, max]")
        effects[eid] = Effect(
            id=eid,
            name=entry["name"],
            category=entry["category"],
            animated=entry["animated"],
            passes=entry.get("passes", 1),
            center_param=entry.get("centerParam"),
            textures=entry.get("textures", []),
            params=params,
            source=source,
        )

    _catalog = Catalog(version=manifest["version"], effects=effects)
    return _catalog


def resolve_params(effect: Effect, params_json: str) -> dict[str, float]:
    """Defaults merged with user JSON; clamped to [min, max]; unknown keys dropped."""
    try:
        user = json.loads(params_json) if params_json.strip() else {}
        if not isinstance(user, dict):
            raise ValueError
    except (json.JSONDecodeError, ValueError):
        raise ValueError(f"ShaderEffect {effect.id!r}: params is not a valid JSON object")

    out: dict[str, float] = {}
    for p in effect.params:
        v = user.get(p.uniform, p.default)
        try:
            v = float(v)
        except (TypeError, ValueError):
            v = p.default
        out[p.uniform] = min(max(v, p.min), p.max)
    return out


def frame_plan(batch_size: int, time: float, duration: float, fps: int) -> list[tuple[int, float]]:
    """(input_frame_index, u_time) per output frame.

    Batch input: u_time advances per input frame, duration ignored.
    Still + duration: duration*fps frames from a single input frame.
    Still + no duration: one frame at `time`.
    """
    fps = max(1, int(fps))
    if batch_size > 1:
        return [(i, time + i / fps) for i in range(batch_size)]
    if duration > 0:
        n = max(1, round(duration * fps))
        return [(0, time + i / fps) for i in range(n)]
    return [(0, time)]
```

- [ ] **Step 7: Run to verify pass**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/shader_effects_test.py -v`
Expected: 4 passed.

- [ ] **Step 8: Commit**

```bash
git add shader_effects/ comfy_extras/_shader_effects.py tests-unit/comfy_extras_test/shader_effects_test.py
git commit -m "Shader effects: catalog skeleton (manifest + 2 spike shaders) and Python loader"
```

---

### Task 2: `render_effect()` — named-uniform GL executor

**Files:**
- Modify: `comfy_extras/_shader_effects.py` (append rendering section)
- Test: `tests-unit/comfy_extras_test/shader_effects_test.py` (append)

- [ ] **Step 1: Write failing render tests (append to shader_effects_test.py)**

```python
import numpy as np

from comfy_extras._shader_effects import render_effect

_UNIFORM_MIX_FRAG = """#version 300 es
precision highp float;
uniform sampler2D u_image0;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_seed;
uniform float u_mix;
in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor0;
void main() {
    vec3 col = texture(u_image0, v_texCoord).rgb;
    fragColor0 = vec4(mix(col, vec3(u_time), u_mix), 1.0);
}
"""


def _img(w=32, h=32, value=0.25):
    return np.full((h, w, 3), value, dtype=np.float32)


def test_render_effect_named_uniforms_and_passthrough():
    # u_mix=0 -> passthrough
    outs = render_effect(_UNIFORM_MIX_FRAG, 32, 32, [{"image": _img(), "uniforms": {"u_mix": 0.0, "u_time": 0.0}}])
    assert len(outs) == 1 and outs[0].shape == (32, 32, 4)
    assert np.abs(outs[0][..., :3] - 0.25).max() < 1.0 / 255.0


def test_render_effect_per_job_uniforms_differ():
    jobs = [
        {"image": _img(), "uniforms": {"u_mix": 1.0, "u_time": 0.0}},
        {"image": _img(), "uniforms": {"u_mix": 1.0, "u_time": 1.0}},
    ]
    outs = render_effect(_UNIFORM_MIX_FRAG, 32, 32, jobs)
    assert np.abs(outs[0][..., :3] - 0.0).max() < 1.0 / 255.0
    assert np.abs(outs[1][..., :3] - 1.0).max() < 1.0 / 255.0


def test_render_effect_compile_error_raises_with_log():
    import pytest
    with pytest.raises(RuntimeError, match="(?i)compil"):
        render_effect("#version 300 es\nvoid main() { bogus }", 8, 8, [{"image": _img(8, 8), "uniforms": {}}])


def test_render_effect_extra_texture_binds():
    frag = """#version 300 es
precision highp float;
uniform sampler2D u_image0;
uniform sampler2D u_lut;
uniform vec2 u_resolution;
in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor0;
void main() { fragColor0 = vec4(texture(u_lut, v_texCoord).rgb, 1.0); }
"""
    lut = np.zeros((4, 4, 4), dtype=np.float32)
    lut[..., 1] = 1.0  # green
    lut[..., 3] = 1.0
    outs = render_effect(frag, 16, 16, [{"image": _img(16, 16), "uniforms": {}}], extra_textures={"u_lut": lut})
    assert np.abs(outs[0][..., 1] - 1.0).max() < 1.0 / 255.0
    assert np.abs(outs[0][..., 0]).max() < 1.0 / 255.0
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/shader_effects_test.py -v`
Expected: new tests FAIL — `ImportError: cannot import name 'render_effect'`

- [ ] **Step 3: Implement `render_effect()` (append to `_shader_effects.py`)**

Reuses `GLContext`, `_create_program`, `_convert_es_to_desktop`, `VERTEX_SHADER` from `nodes_glsl`. Import lazily inside the function so merely importing `_shader_effects` (loader tests, route module) never touches GL.

```python
MAX_RENDER_DIM = 8192


def render_effect(
    fragment_code: str,
    width: int,
    height: int,
    jobs: list[dict],
    extra_textures: dict[str, "np.ndarray"] | None = None,
) -> list["np.ndarray"]:
    """Render `fragment_code` once per job. Compiles once; per-job image + uniforms.

    jobs: [{"image": (H, W, 3|4) float32 [0,1] or None, "uniforms": {name: float}}]
    extra_textures: {uniform_name: (H, W, 4) float32} — bound NEAREST (parity with browser).
    Returns one (height, width, 4) float32 array per job.
    """
    import numpy as np

    from comfy_extras import nodes_glsl
    from comfy_extras.nodes_glsl import (
        GLContext,
        VERTEX_SHADER,
        _convert_es_to_desktop,
        _create_program,
        _import_opengl,
    )

    if not jobs:
        return []
    if width > MAX_RENDER_DIM or height > MAX_RENDER_DIM:
        raise ValueError(f"ShaderEffect: render size {width}x{height} exceeds {MAX_RENDER_DIM}")

    ctx = GLContext()
    ctx.make_current()
    gl = _import_opengl()

    fragment_source = _convert_es_to_desktop(fragment_code)
    extra_textures = extra_textures or {}

    program = None
    fbo = None
    out_tex = None
    in_tex = None
    extra_tex_ids = []
    try:
        program = _create_program(VERTEX_SHADER, fragment_source)
        gl.glUseProgram(program)

        # Output FBO
        fbo = gl.glGenFramebuffers(1)
        gl.glBindFramebuffer(gl.GL_FRAMEBUFFER, fbo)
        out_tex = gl.glGenTextures(1)
        gl.glBindTexture(gl.GL_TEXTURE_2D, out_tex)
        gl.glTexImage2D(gl.GL_TEXTURE_2D, 0, gl.GL_RGBA32F, width, height, 0, gl.GL_RGBA, gl.GL_FLOAT, None)
        gl.glTexParameteri(gl.GL_TEXTURE_2D, gl.GL_TEXTURE_MIN_FILTER, gl.GL_LINEAR)
        gl.glTexParameteri(gl.GL_TEXTURE_2D, gl.GL_TEXTURE_MAG_FILTER, gl.GL_LINEAR)
        gl.glFramebufferTexture2D(gl.GL_FRAMEBUFFER, gl.GL_COLOR_ATTACHMENT0, gl.GL_TEXTURE_2D, out_tex, 0)
        gl.glDrawBuffers(1, [gl.GL_COLOR_ATTACHMENT0])
        if gl.glCheckFramebufferStatus(gl.GL_FRAMEBUFFER) != gl.GL_FRAMEBUFFER_COMPLETE:
            raise RuntimeError("ShaderEffect: framebuffer incomplete")

        # Input image texture on unit 0
        in_tex = gl.glGenTextures(1)
        gl.glActiveTexture(gl.GL_TEXTURE0)
        gl.glBindTexture(gl.GL_TEXTURE_2D, in_tex)
        for pname in (gl.GL_TEXTURE_MIN_FILTER, gl.GL_TEXTURE_MAG_FILTER):
            gl.glTexParameteri(gl.GL_TEXTURE_2D, pname, gl.GL_LINEAR)
        for pname in (gl.GL_TEXTURE_WRAP_S, gl.GL_TEXTURE_WRAP_T):
            gl.glTexParameteri(gl.GL_TEXTURE_2D, pname, gl.GL_CLAMP_TO_EDGE)
        loc = gl.glGetUniformLocation(program, "u_image0")
        if loc >= 0:
            gl.glUniform1i(loc, 0)

        # Extra textures on units 1+ (NEAREST: glyph atlases must be sampled exactly)
        for i, (uname, arr) in enumerate(sorted(extra_textures.items())):
            unit = 1 + i
            tex = gl.glGenTextures(1)
            extra_tex_ids.append(tex)
            gl.glActiveTexture(gl.GL_TEXTURE0 + unit)
            gl.glBindTexture(gl.GL_TEXTURE_2D, tex)
            for pname in (gl.GL_TEXTURE_MIN_FILTER, gl.GL_TEXTURE_MAG_FILTER):
                gl.glTexParameteri(gl.GL_TEXTURE_2D, pname, gl.GL_NEAREST)
            for pname in (gl.GL_TEXTURE_WRAP_S, gl.GL_TEXTURE_WRAP_T):
                gl.glTexParameteri(gl.GL_TEXTURE_2D, pname, gl.GL_CLAMP_TO_EDGE)
            th, tw, _ = arr.shape
            gl.glTexImage2D(gl.GL_TEXTURE_2D, 0, gl.GL_RGBA32F, tw, th, 0, gl.GL_RGBA, gl.GL_FLOAT,
                            np.ascontiguousarray(arr[::-1, :, :]))
            uloc = gl.glGetUniformLocation(program, uname)
            if uloc >= 0:
                gl.glUniform1i(uloc, unit)

        loc = gl.glGetUniformLocation(program, "u_resolution")
        if loc >= 0:
            gl.glUniform2f(loc, float(width), float(height))

        gl.glViewport(0, 0, width, height)
        gl.glDisable(gl.GL_BLEND)

        outputs = []
        for job in jobs:
            img = job.get("image")
            if img is not None:
                h, w, c = img.shape
                if c == 3:
                    upload = np.empty((h, w, 4), dtype=np.float32)
                    upload[:, :, :3] = img[::-1, :, :]
                    upload[:, :, 3] = 1.0
                else:
                    upload = np.ascontiguousarray(img[::-1, :, :], dtype=np.float32)
                gl.glActiveTexture(gl.GL_TEXTURE0)
                gl.glBindTexture(gl.GL_TEXTURE_2D, in_tex)
                gl.glTexImage2D(gl.GL_TEXTURE_2D, 0, gl.GL_RGBA32F, w, h, 0, gl.GL_RGBA, gl.GL_FLOAT, upload)

            for uname, val in job.get("uniforms", {}).items():
                uloc = gl.glGetUniformLocation(program, uname)
                if uloc >= 0:
                    gl.glUniform1f(uloc, float(val))

            gl.glBindFramebuffer(gl.GL_FRAMEBUFFER, fbo)
            gl.glClearColor(0, 0, 0, 0)
            gl.glClear(gl.GL_COLOR_BUFFER_BIT)
            gl.glDrawArrays(gl.GL_TRIANGLES, 0, 3)

            gl.glBindTexture(gl.GL_TEXTURE_2D, out_tex)
            data = gl.glGetTexImage(gl.GL_TEXTURE_2D, 0, gl.GL_RGBA, gl.GL_FLOAT)
            out = np.frombuffer(data, dtype=np.float32).reshape(height, width, 4)
            outputs.append(out[::-1, :, :].copy())

        return outputs
    finally:
        gl.glBindFramebuffer(gl.GL_FRAMEBUFFER, 0)
        gl.glUseProgram(0)
        if in_tex is not None:
            gl.glDeleteTextures(int(in_tex))
        if out_tex is not None:
            gl.glDeleteTextures(int(out_tex))
        for tex in extra_tex_ids:
            gl.glDeleteTextures(int(tex))
        if fbo is not None:
            gl.glDeleteFramebuffers(1, [fbo])
        if program is not None:
            gl.glDeleteProgram(program)
```

Note: `import numpy as np` already exists at module top after this task — move it to the top-level imports (`import numpy as np` under `import os`) and drop the local import.

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/shader_effects_test.py -v`
Expected: all pass (8 total).

- [ ] **Step 5: Commit**

```bash
git add comfy_extras/_shader_effects.py tests-unit/comfy_extras_test/shader_effects_test.py
git commit -m "Shader effects: render_effect() GL executor with named uniforms and extra textures"
```

---

### Task 3: `ShaderEffect` node + registration

**Files:**
- Create: `comfy_extras/nodes_shader_effects.py`
- Modify: `nodes.py` (extras list, next to `"nodes_glsl.py"` around line 2605)
- Test: `tests-unit/comfy_extras_test/shader_effects_test.py` (append)

- [ ] **Step 1: Write failing node tests (append)**

```python
import torch

from comfy_extras.nodes_shader_effects import ShaderEffect


def _run_node(image, effect="noise_distortion", params="{}", time=0.0, duration=0.0, fps=4, seed=42):
    # Execute the classmethod directly; hidden unique_id is only used for the ui preview.
    class _Hidden:
        unique_id = "test"
    ShaderEffect.hidden = _Hidden
    return ShaderEffect.execute(image, effect, params, time, duration, fps, seed)


def test_node_still_returns_single_frame():
    img = torch.rand(1, 48, 64, 3)
    out = _run_node(img).args[0]
    assert out.shape == (1, 48, 64, 3)


def test_node_duration_returns_frame_batch_that_animates():
    img = torch.rand(1, 32, 32, 3)
    out = _run_node(img, duration=1.0, fps=4).args[0]
    assert out.shape == (4, 32, 32, 3)
    assert (out[0] - out[3]).abs().max() > 1.0 / 255.0  # noise_distortion is animated


def test_node_batch_input_keeps_frame_count():
    img = torch.rand(3, 32, 32, 3)
    out = _run_node(img, duration=99.0).args[0]  # duration must be ignored
    assert out.shape == (3, 32, 32, 3)


def test_node_unknown_effect_raises():
    import pytest
    with pytest.raises(ValueError, match="bogus"):
        _run_node(torch.rand(1, 16, 16, 3), effect="bogus")
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/shader_effects_test.py -v`
Expected: new tests FAIL — no module `nodes_shader_effects`.

- [ ] **Step 3: Implement the node**

Create `comfy_extras/nodes_shader_effects.py`:

```python
"""ShaderEffect: Unicorn Studio-style GLSL effects with a live WebGL node preview.

The browser renders the same .frag sources (served by the routes below) in the
node body; this module is the server half that produces real IMAGE output.
Design: docs/plans/2026-06-10-shader-effects-design.md
"""
from __future__ import annotations

import os

import numpy as np
import torch
from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview
from comfy_extras._shader_effects import (
    ASSETS_DIR,
    frame_plan,
    load_catalog,
    render_effect,
    resolve_params,
)


def _effect_ids() -> list[str]:
    try:
        return list(load_catalog().effects.keys())
    except Exception:
        return []


def _load_effect_textures(effect) -> tuple[dict[str, np.ndarray], dict[str, float]]:
    """Load catalog texture assets for an effect. Returns (textures, extra_uniforms)."""
    from PIL import Image as PILImage

    textures: dict[str, np.ndarray] = {}
    extra_uniforms: dict[str, float] = {}
    for t in effect.textures:
        path = os.path.join(ASSETS_DIR, t["file"])
        img = PILImage.open(path).convert("RGBA")
        arr = np.asarray(img, dtype=np.float32) / 255.0
        textures[t["uniform"]] = arr
        for k, v in t.get("extraUniforms", {}).items():
            extra_uniforms[k] = float(v)
    return textures, extra_uniforms


class ShaderEffect(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="ShaderEffect",
            display_name="Shader Effect",
            description="Real-time shader effects (distortion, dither, halftone…) with a live animated preview. Runs locally on the GPU.",
            category="image/effects",
            inputs=[
                IO.Image.Input("image"),
                IO.Combo.Input("effect", options=_effect_ids() or ["noise_distortion"]),
                IO.String.Input("params", default="{}", multiline=True),
                IO.Float.Input("time", default=0.0, min=0.0, max=3600.0, step=0.05),
                IO.Float.Input("duration", default=0.0, min=0.0, max=60.0, step=0.5),
                IO.Int.Input("fps", default=24, min=1, max=60, step=1),
                IO.Int.Input("seed", default=42, min=0, max=2 ** 31 - 1, step=1),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, effect, params, time, duration, fps, seed) -> IO.NodeOutput:
        catalog = load_catalog()
        if effect not in catalog.effects:
            raise ValueError(f"ShaderEffect: unknown effect {effect!r}")
        eff = catalog.effects[effect]

        uniforms = resolve_params(eff, params)
        textures, extra_uniforms = _load_effect_textures(eff)
        uniforms.update(extra_uniforms)

        np_img = image.cpu().numpy().astype(np.float32)
        b, h, w, _ = np_img.shape
        plan = frame_plan(b, float(time), float(duration), int(fps))

        jobs = [
            {
                "image": np.ascontiguousarray(np_img[fi]),
                "uniforms": {**uniforms, "u_time": t, "u_seed": float(seed % 10000)},
            }
            for fi, t in plan
        ]
        outs = render_effect(eff.source, w, h, jobs, extra_textures=textures)
        out = torch.from_numpy(np.stack([o[..., :3] for o in outs])).clamp(0, 1)
        return IO.NodeOutput(out, ui=save_live_preview(out, str(cls.hidden.unique_id)))


class ShaderEffectsExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [ShaderEffect]


async def comfy_entrypoint() -> ShaderEffectsExtension:
    return ShaderEffectsExtension()
```

Check the sibling files' exact extension/entrypoint naming (e.g. top of `comfy_extras/nodes_glsl_distortion.py`) and match it — if they use a different entrypoint convention, follow theirs.

- [ ] **Step 4: Register in `nodes.py`**

In the extras filename list (the block containing `"nodes_glsl_unicorn.py"` / `"nodes_glsl.py"`), add:

```python
        "nodes_shader_effects.py",
```

- [ ] **Step 5: Run to verify pass**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/shader_effects_test.py -v`
Expected: all pass (12 total).

- [ ] **Step 6: Commit**

```bash
git add comfy_extras/nodes_shader_effects.py nodes.py tests-unit/comfy_extras_test/shader_effects_test.py
git commit -m "Shader effects: ShaderEffect node with time/duration/batch semantics"
```

---

### Task 4: HTTP routes serving the catalog

**Files:**
- Modify: `comfy_extras/nodes_shader_effects.py` (append routes + payload function)
- Test: `tests-unit/comfy_extras_test/shader_effects_test.py` (append)

- [ ] **Step 1: Write failing payload test (append)**

```python
from comfy_extras.nodes_shader_effects import catalog_payload


def test_catalog_payload_inlines_sources():
    payload = catalog_payload()
    assert payload["version"] == 1
    by_id = {e["id"]: e for e in payload["effects"]}
    assert by_id["halftone"]["source"].startswith("#version 300 es")
    assert by_id["halftone"]["params"][0]["uniform"] == "u_size"
    assert by_id["noise_distortion"]["animated"] is True
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/shader_effects_test.py::test_catalog_payload_inlines_sources -v`
Expected: FAIL — `ImportError: cannot import name 'catalog_payload'`

- [ ] **Step 3: Implement payload + routes (append to nodes_shader_effects.py)**

Mirror the guarded registration pattern from `comfy_extras/nodes_sailor_projects.py` (lines ~284-407):

```python
def catalog_payload() -> dict:
    """Manifest with .frag sources inlined — what the frontend preview consumes.

    Re-reads from disk every call (cheap) so shader iteration only needs a
    browser refresh, not a server restart. Node combo options DO need a restart.
    """
    catalog = load_catalog(refresh=True)
    effects = []
    for eff in catalog.effects.values():
        effects.append({
            "id": eff.id,
            "name": eff.name,
            "category": eff.category,
            "animated": eff.animated,
            "passes": eff.passes,
            "centerParam": eff.center_param,
            "textures": eff.textures,
            "params": [vars(p) for p in eff.params],
            "source": eff.source,
        })
    return {"version": catalog.version, "effects": effects}


try:
    from aiohttp import web

    from server import PromptServer

    @PromptServer.instance.routes.get("/sailor/shader_effects")
    async def _get_shader_effects(request):
        try:
            return web.json_response(catalog_payload())
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    @PromptServer.instance.routes.get("/sailor/shader_effects/assets/{name}")
    async def _get_shader_asset(request):
        name = os.path.basename(request.match_info["name"])  # no traversal
        path = os.path.join(ASSETS_DIR, name)
        if not os.path.isfile(path):
            return web.json_response({"error": "not found"}, status=404)
        return web.FileResponse(path)

except Exception as e:  # imported headless (tests) — pure functions still work
    print(f"[Sailor] shader_effects routes not registered: {e}")
```

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/shader_effects_test.py -v`
Expected: all pass (13 total).

- [ ] **Step 5: Live-check the endpoint**

Kill the ComfyUI process (supervisor restarts it; per project convention do NOT try to hot-reload), wait for it to come back, then:

Run: `curl -s http://127.0.0.1:8188/sailor/shader_effects | head -c 300`
Expected: JSON starting `{"version": 1, "effects": [{"id": "noise_distortion"...`

Also verify the node registered: `curl -s http://127.0.0.1:8188/object_info/ShaderEffect | head -c 300` → JSON schema with `effect` combo listing both ids.

- [ ] **Step 6: Commit**

```bash
git add comfy_extras/nodes_shader_effects.py tests-unit/comfy_extras_test/shader_effects_test.py
git commit -m "Shader effects: /sailor/shader_effects catalog + asset routes"
```

---

### Task 5: Golden fixtures + server goldens for the spike effects

**Files:**
- Create: `tests-unit/shaderfx_golden/generate_goldens.py`
- Create (generated): `tests-unit/shaderfx_golden/fixture_128.png`, `fixture_256.png`, `noise_distortion_128.png`, `noise_distortion_256.png`, `halftone_128.png`, `halftone_256.png`
- Test: `tests-unit/comfy_extras_test/shader_effects_test.py` (append regression test)

**Fixed render settings for ALL goldens (both runtimes must use exactly these):** params = manifest defaults, `u_time = 0.7`, `seed = 42`, sizes 128 and 256.

- [ ] **Step 1: Write the generator**

Create `tests-unit/shaderfx_golden/generate_goldens.py`:

```python
"""(Re)generate shader-effect golden PNGs: procedural fixture + server render per effect.

Usage: .venv/bin/python tests-unit/shaderfx_golden/generate_goldens.py
Goldens are machine-calibrated (GPU-dependent); regenerate on the machine that runs the tests.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from unittest.mock import MagicMock

sys.modules.setdefault("nodes", MagicMock())

import numpy as np
from PIL import Image

from comfy_extras._shader_effects import load_catalog, render_effect, resolve_params

HERE = os.path.dirname(os.path.abspath(__file__))
GOLDEN_TIME = 0.7
GOLDEN_SEED = 42.0
SIZES = (128, 256)


def make_fixture(size: int) -> np.ndarray:
    """Deterministic colorful test card: gradients + two soft discs. No resampling anywhere."""
    y, x = np.mgrid[0:size, 0:size].astype(np.float64) / (size - 1)
    r = np.clip(1.0 - np.hypot(x - 0.35, y - 0.4) / 0.25, 0, 1)
    g = np.clip(1.0 - np.hypot(x - 0.7, y - 0.65) / 0.35, 0, 1)
    img = np.stack(
        [0.2 + 0.8 * x, 0.15 + 0.7 * y, 0.5 + 0.5 * np.sin(2.0 * np.pi * (x + y))], axis=-1
    )
    img[..., 0] = np.maximum(img[..., 0], r)
    img[..., 1] = np.maximum(img[..., 1], g)
    return np.clip(img, 0, 1).astype(np.float32)


def save_png(arr: np.ndarray, path: str) -> None:
    Image.fromarray(np.clip(arr * 255.0 + 0.5, 0, 255).astype(np.uint8)).save(path)


def load_png(path: str) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.float32) / 255.0


def main() -> None:
    catalog = load_catalog(refresh=True)
    for size in SIZES:
        fixture_path = os.path.join(HERE, f"fixture_{size}.png")
        save_png(make_fixture(size), fixture_path)
        fixture = load_png(fixture_path)  # round-trip through 8-bit, same as the browser sees
        for eff in catalog.effects.values():
            uniforms = resolve_params(eff, "{}")
            textures = {}
            for t in eff.textures:
                from comfy_extras._shader_effects import ASSETS_DIR
                tex = Image.open(os.path.join(ASSETS_DIR, t["file"])).convert("RGBA")
                textures[t["uniform"]] = np.asarray(tex, dtype=np.float32) / 255.0
                for k, v in t.get("extraUniforms", {}).items():
                    uniforms[k] = float(v)
            jobs = [{"image": fixture, "uniforms": {**uniforms, "u_time": GOLDEN_TIME, "u_seed": GOLDEN_SEED}}]
            out = render_effect(eff.source, size, size, jobs, extra_textures=textures)[0]
            save_png(out[..., :3], os.path.join(HERE, f"{eff.id}_{size}.png"))
            print(f"golden: {eff.id}_{size}.png")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it and eyeball the output**

Run: `.venv/bin/python tests-unit/shaderfx_golden/generate_goldens.py`
Expected: prints 4 golden lines (2 effects × 2 sizes) plus writes 2 fixtures. Open `tests-unit/shaderfx_golden/halftone_128.png` and `noise_distortion_256.png` (Read tool) and confirm: halftone = colored dots on white in a 45° grid; noise_distortion = visibly warped test card. If either looks black/blank/garbage, debug the shader before committing anything.

- [ ] **Step 3: Add a server-side golden regression test (append to shader_effects_test.py)**

```python
import os


def test_server_render_matches_goldens():
    """Catches shader regressions; loops the whole catalog so new effects are auto-covered."""
    from PIL import Image

    golden_dir = os.path.join(os.path.dirname(__file__), "..", "shaderfx_golden")
    catalog = load_catalog(refresh=True)
    for size in (128, 256):
        fixture = np.asarray(
            Image.open(os.path.join(golden_dir, f"fixture_{size}.png")).convert("RGB"),
            dtype=np.float32) / 255.0
        for eff in catalog.effects.values():
            golden_path = os.path.join(golden_dir, f"{eff.id}_{size}.png")
            assert os.path.isfile(golden_path), f"missing golden for {eff.id} at {size} — run generate_goldens.py"
            golden = np.asarray(Image.open(golden_path).convert("RGB"), dtype=np.float32) / 255.0
            uniforms = resolve_params(eff, "{}")
            textures = {}
            for t in eff.textures:
                from comfy_extras._shader_effects import ASSETS_DIR
                tex = Image.open(os.path.join(ASSETS_DIR, t["file"])).convert("RGBA")
                textures[t["uniform"]] = np.asarray(tex, dtype=np.float32) / 255.0
                for k, v in t.get("extraUniforms", {}).items():
                    uniforms[k] = float(v)
            jobs = [{"image": fixture, "uniforms": {**uniforms, "u_time": 0.7, "u_seed": 42.0}}]
            out = render_effect(eff.source, size, size, jobs, extra_textures=textures)[0][..., :3]
            diff = np.abs(out - golden)
            assert diff.max() <= 2.0 / 255.0, f"{eff.id}@{size}: max diff {diff.max() * 255:.2f}/255"
```

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/shader_effects_test.py -v`
Expected: all pass (14 total).

- [ ] **Step 5: Commit**

```bash
git add tests-unit/shaderfx_golden/ tests-unit/comfy_extras_test/shader_effects_test.py
git commit -m "Shader effects: golden generator + server goldens for spike effects"
```

---

### Task 6: Frontend runtime — types, params, catalog, renderer

**Files:**
- Create: `frontend/app/lib/shaderfx/types.ts`, `params.ts`, `catalog.ts`, `renderer.ts`
- Test: `frontend/tests/unit/shaderfx-params.unit.spec.ts`

- [ ] **Step 1: Create `frontend/app/lib/shaderfx/types.ts`**

```typescript
export interface EffectParamDef {
  uniform: string
  label: string
  type: 'float'
  min: number
  max: number
  default: number
  step: number
}

export interface EffectTextureDef {
  uniform: string
  file: string
  extraUniforms?: Record<string, number>
}

export interface EffectDef {
  id: string
  name: string
  category: string
  animated: boolean
  passes: number
  centerParam: string[] | null
  textures: EffectTextureDef[]
  params: EffectParamDef[]
  source: string
}

export interface ShaderFxCatalog {
  version: number
  effects: EffectDef[]
}
```

- [ ] **Step 2: Write failing params tests**

Create `frontend/tests/unit/shaderfx-params.unit.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { parseParams, resolveUniforms, serializeParams } from '~/lib/shaderfx/params'
import type { EffectDef } from '~/lib/shaderfx/types'

const eff: EffectDef = {
  id: 'x', name: 'X', category: 'distortion', animated: true, passes: 1,
  centerParam: null, textures: [], source: '',
  params: [
    { uniform: 'u_amount', label: 'Amount', type: 'float', min: 0, max: 0.3, default: 0.06, step: 0.005 },
    { uniform: 'u_scale', label: 'Scale', type: 'float', min: 1, max: 20, default: 4, step: 0.5 },
  ],
}

describe('shaderfx params', () => {
  it('parses bad JSON to empty object', () => {
    expect(parseParams('{nope')).toEqual({})
    expect(parseParams('')).toEqual({})
  })

  it('resolves defaults, clamps overrides, drops unknown keys', () => {
    expect(resolveUniforms(eff, {})).toEqual({ u_amount: 0.06, u_scale: 4 })
    const u = resolveUniforms(eff, { u_amount: 99, u_bogus: 1 })
    expect(u.u_amount).toBe(0.3)
    expect('u_bogus' in u).toBe(false)
  })

  it('serializes only non-default values', () => {
    expect(serializeParams(eff, { u_amount: 0.06, u_scale: 9 })).toBe('{"u_scale":9}')
    expect(serializeParams(eff, { u_amount: 0.06, u_scale: 4 })).toBe('{}')
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `cd frontend && npx vitest run tests/unit/shaderfx-params.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/shaderfx/params`.

- [ ] **Step 4: Implement `frontend/app/lib/shaderfx/params.ts`**

```typescript
import type { EffectDef } from './types'

export function parseParams(json: string): Record<string, number> {
  try {
    const v = JSON.parse(json)
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}

/** Defaults merged with overrides; clamped; unknown keys dropped. Mirrors Python resolve_params. */
export function resolveUniforms(eff: EffectDef, overrides: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const p of eff.params) {
    const raw = overrides[p.uniform]
    const v = typeof raw === 'number' && Number.isFinite(raw) ? raw : p.default
    out[p.uniform] = Math.min(Math.max(v, p.min), p.max)
  }
  return out
}

/** Store only non-default values in the widget so workflows stay tidy. */
export function serializeParams(eff: EffectDef, uniforms: Record<string, number>): string {
  const out: Record<string, number> = {}
  for (const p of eff.params) {
    const v = uniforms[p.uniform]
    if (typeof v === 'number' && v !== p.default) out[p.uniform] = v
  }
  return JSON.stringify(out)
}
```

- [ ] **Step 5: Run to verify pass**

Run: `cd frontend && npx vitest run tests/unit/shaderfx-params.unit.spec.ts`
Expected: 3 passed.

- [ ] **Step 6: Implement `frontend/app/lib/shaderfx/catalog.ts`**

```typescript
import type { EffectDef, ShaderFxCatalog } from './types'

let promise: Promise<ShaderFxCatalog> | null = null

/** Fetch the catalog from the backend (proxied /sailor route). Cached per page load. */
export function fetchShaderFxCatalog(force = false): Promise<ShaderFxCatalog> {
  if (!promise || force) {
    promise = $fetch<ShaderFxCatalog>('/sailor/shader_effects').catch((err) => {
      promise = null
      throw err
    })
  }
  return promise
}

export async function getEffect(id: string): Promise<EffectDef | null> {
  const cat = await fetchShaderFxCatalog()
  return cat.effects.find(e => e.id === id) ?? null
}

export function assetUrl(file: string): string {
  return `/sailor/shader_effects/assets/${encodeURIComponent(file)}`
}
```

(`$fetch` is Nuxt-auto-imported at runtime; for vitest-imported modules it is not — which is why catalog.ts has no unit test and stays I/O-only.)

- [ ] **Step 7: Implement `frontend/app/lib/shaderfx/renderer.ts`**

The singleton renderer. One hidden canvas + WebGL2 context for the entire app — node bodies are plain 2D canvases that `drawImage` from it. Multi-pass via ping-pong FBO textures; final blit pass flips Y onto the canvas.

```typescript
// Singleton WebGL2 renderer for ShaderEffect previews.
// One GL context app-wide (browsers cap ~8-16); callers drawImage() the returned canvas.

export type Uniforms = Record<string, number>

export interface ShaderPass {
  /** Program cache key — use the effect id. */
  id: string
  /** Full GLSL ES 3.00 fragment source from the catalog. */
  source: string
  uniforms: Uniforms
  textures?: Record<string, TexImageSource>
}

const VS = `#version 300 es
out vec2 v_texCoord;
void main() {
  vec2 verts[3] = vec2[](vec2(-1.,-1.), vec2(3.,-1.), vec2(-1.,3.));
  v_texCoord = verts[gl_VertexID] * 0.5 + 0.5;
  gl_Position = vec4(verts[gl_VertexID], 0., 1.);
}`

const BLIT_FS = `#version 300 es
precision highp float;
uniform sampler2D u_image0;
in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor0;
void main() { fragColor0 = texture(u_image0, vec2(v_texCoord.x, 1.0 - v_texCoord.y)); }`

class ShaderFxRenderer {
  private canvas: HTMLCanvasElement | null = null
  private gl: WebGL2RenderingContext | null = null
  private programs = new Map<string, WebGLProgram>()
  private blit: WebGLProgram | null = null
  private fboTex: (WebGLTexture | null)[] = [null, null]
  private fbos: (WebGLFramebuffer | null)[] = [null, null]
  private fboSize = [0, 0]
  private baseTex: WebGLTexture | null = null
  private extraTexCache = new Map<TexImageSource, WebGLTexture>()

  private ensure(width: number, height: number): WebGL2RenderingContext {
    if (!this.gl) {
      this.canvas = document.createElement('canvas')
      // preserveDrawingBuffer so toDataURL/drawImage after render is always safe
      this.gl = this.canvas.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false })
      if (!this.gl) throw new Error('WebGL2 unavailable')
    }
    const gl = this.gl
    if (this.canvas!.width !== width || this.canvas!.height !== height) {
      this.canvas!.width = width
      this.canvas!.height = height
    }
    if (this.fboSize[0] !== width || this.fboSize[1] !== height) {
      for (let i = 0; i < 2; i++) {
        if (this.fboTex[i]) gl.deleteTexture(this.fboTex[i])
        if (this.fbos[i]) gl.deleteFramebuffer(this.fbos[i])
        const tex = gl.createTexture()
        gl.bindTexture(gl.TEXTURE_2D, tex)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        const fbo = gl.createFramebuffer()
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
        this.fboTex[i] = tex
        this.fbos[i] = fbo
      }
      this.fboSize = [width, height]
    }
    return gl
  }

  private program(id: string, source: string): WebGLProgram {
    const key = `${id}:${source.length}:${source.slice(0, 64)}`
    let prog = this.programs.get(key)
    if (prog) return prog
    const gl = this.gl!
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s)
        gl.deleteShader(s)
        throw new Error(`shaderfx compile (${id}): ${log}`)
      }
      return s
    }
    prog = gl.createProgram()!
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS))
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, source))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`shaderfx link (${id}): ${gl.getProgramInfoLog(prog)}`)
    this.programs.set(key, prog)
    return prog
  }

  private uploadTexture(tex: WebGLTexture, src: TexImageSource, flipY: boolean, nearest: boolean): void {
    const gl = this.gl!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    const filter = nearest ? gl.NEAREST : gl.LINEAR
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  /**
   * Run `passes` over `base`, return the canvas (valid until the next render call).
   * Pass 0 reads base; pass N reads pass N-1's output. Internal orientation is
   * GL y-up (matches the server's flipped upload); the final blit flips back.
   */
  render(passes: ShaderPass[], base: TexImageSource, width: number, height: number): HTMLCanvasElement {
    const gl = this.ensure(width, height)

    if (!this.baseTex) this.baseTex = gl.createTexture()
    this.uploadTexture(this.baseTex!, base, true, false)

    let readTex = this.baseTex!
    for (let i = 0; i < passes.length; i++) {
      const pass = passes[i]!
      const prog = this.program(pass.id, pass.source)
      gl.useProgram(prog)
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos[i % 2])
      gl.viewport(0, 0, width, height)
      gl.disable(gl.BLEND)

      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, readTex)
      const imgLoc = gl.getUniformLocation(prog, 'u_image0')
      if (imgLoc) gl.uniform1i(imgLoc, 0)

      let unit = 1
      for (const [name, src] of Object.entries(pass.textures ?? {})) {
        let tex = this.extraTexCache.get(src)
        gl.activeTexture(gl.TEXTURE0 + unit)
        if (!tex) {
          tex = gl.createTexture()!
          this.uploadTexture(tex, src, true, true) // NEAREST — glyph atlases sampled exactly
          this.extraTexCache.set(src, tex)
        } else {
          gl.bindTexture(gl.TEXTURE_2D, tex)
        }
        const loc = gl.getUniformLocation(prog, name)
        if (loc) gl.uniform1i(loc, unit)
        unit++
      }

      const resLoc = gl.getUniformLocation(prog, 'u_resolution')
      if (resLoc) gl.uniform2f(resLoc, width, height)
      for (const [name, value] of Object.entries(pass.uniforms)) {
        const loc = gl.getUniformLocation(prog, name)
        if (loc) gl.uniform1f(loc, value)
      }

      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      readTex = this.fboTex[i % 2]!
    }

    // Blit final texture to the canvas, flipping Y back to image orientation.
    if (!this.blit) this.blit = this.program('__blit__', BLIT_FS)
    gl.useProgram(this.blit)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, width, height)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, readTex)
    const loc = gl.getUniformLocation(this.blit, 'u_image0')
    if (loc) gl.uniform1i(loc, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    return this.canvas!
  }
}

export const shaderFx = new ShaderFxRenderer()
```

Edge case the code above handles deliberately: with zero passes the blit just draws `baseTex` — callers can rely on that for "no effect selected".

- [ ] **Step 8: Typecheck + commit**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -i shaderfx` (no output = clean; ignore pre-existing unrelated errors)

```bash
git add frontend/app/lib/shaderfx/ frontend/tests/unit/shaderfx-params.unit.spec.ts
git commit -m "Shader effects: frontend runtime (params, catalog, singleton WebGL2 renderer)"
```

---

### Task 7: Harness page + Playwright parity test — THE SPIKE GATE

**Files:**
- Create: `frontend/app/pages/dev/shaderfx-harness.vue`
- Create: `frontend/tests/shaderfx-golden.spec.ts`

This is the decision gate from the design: if the noise-heavy effect diverges beyond tolerance, fix determinism (hash quantization) BEFORE writing the remaining 12 shaders.

- [ ] **Step 1: Create the harness page**

`frontend/app/pages/dev/shaderfx-harness.vue` — no backend dependency; the test injects shader source + fixture directly:

```vue
<template>
  <div style="padding: 8px; font: 12px monospace">shaderfx harness ready</div>
</template>

<script setup lang="ts">
import { shaderFx } from '~/lib/shaderfx/renderer'

interface HarnessJob {
  effectId: string
  source: string
  uniforms: Record<string, number>
  /** dataURL -> uniform name, e.g. { u_glyphs: 'data:image/png;base64,...' } */
  textures: Record<string, string>
  baseDataUrl: string
  width: number
  height: number
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

async function renderJob(job: HarnessJob): Promise<string> {
  const base = await loadImage(job.baseDataUrl)
  const textures: Record<string, TexImageSource> = {}
  for (const [name, url] of Object.entries(job.textures)) textures[name] = await loadImage(url)
  const canvas = shaderFx.render(
    [{ id: job.effectId, source: job.source, uniforms: job.uniforms, textures }],
    base, job.width, job.height,
  )
  return canvas.toDataURL('image/png')
}

if (import.meta.client) {
  ;(window as any).__renderShaderFx = renderJob
}
</script>
```

- [ ] **Step 2: Write the parity spec**

`frontend/tests/shaderfx-golden.spec.ts`. It loops the catalog read from disk, so every future effect is automatically covered. Mirror the timeline harness's structure and tolerances (`frontend/tests/timeline-golden.spec.ts`):

```typescript
import { expect, test } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { PNG } from 'pngjs'

const ROOT = path.join(__dirname, '..', '..')
const CATALOG = path.join(ROOT, 'shader_effects')
const GOLDEN = path.join(ROOT, 'tests-unit', 'shaderfx_golden')

const GOLDEN_TIME = 0.7
const GOLDEN_SEED = 42
const SIZES = [128, 256]

// Browser-vs-server tolerance, starting from the calibrated timeline WebGL numbers
// (mean 2.5/255, >8/255 outliers ≤ 6%). Recalibrate in Step 4 if the spike demands it.
const PCT_THRESHOLD = 8 / 255
const MAX_MEAN = 2.5 / 255
const MAX_PCT_OVER = 0.06

function diffStats(a: PNG, b: PNG): { max: number; mean: number; pctOver: number } {
  if (a.width !== b.width || a.height !== b.height) return { max: 1, mean: 1, pctOver: 1 }
  let max = 0, sum = 0, over = 0, n = 0
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.data[i + c]! - b.data[i + c]!) / 255
      if (d > max) max = d
      if (d > PCT_THRESHOLD) over++
      sum += d
      n++
    }
  }
  return { max, mean: sum / n, pctOver: over / n }
}

function dataUrl(file: string): string {
  return `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`
}

interface ManifestEffect {
  id: string
  params: { uniform: string; default: number }[]
  textures: { uniform: string; file: string; extraUniforms?: Record<string, number> }[]
}

const manifest = JSON.parse(fs.readFileSync(path.join(CATALOG, 'manifest.json'), 'utf-8'))

for (const eff of manifest.effects as ManifestEffect[]) {
  for (const size of SIZES) {
    test(`parity: ${eff.id} @ ${size}`, async ({ page }) => {
      const goldenPath = path.join(GOLDEN, `${eff.id}_${size}.png`)
      expect(fs.existsSync(goldenPath), `missing golden ${goldenPath} — run generate_goldens.py`).toBe(true)

      const uniforms: Record<string, number> = { u_time: GOLDEN_TIME, u_seed: GOLDEN_SEED }
      for (const p of eff.params) uniforms[p.uniform] = p.default
      const textures: Record<string, string> = {}
      for (const t of eff.textures) {
        textures[t.uniform] = dataUrl(path.join(CATALOG, 'assets', t.file))
        for (const [k, v] of Object.entries(t.extraUniforms ?? {})) uniforms[k] = v
      }

      await page.goto('/dev/shaderfx-harness')
      await page.waitForFunction(() => (window as any).__renderShaderFx)
      const out = await page.evaluate(
        job => (window as any).__renderShaderFx(job),
        {
          effectId: eff.id,
          source: fs.readFileSync(path.join(CATALOG, `${eff.id}.frag`), 'utf-8'),
          uniforms,
          textures,
          baseDataUrl: dataUrl(path.join(GOLDEN, `fixture_${size}.png`)),
          width: size,
          height: size,
        },
      )

      const browser = PNG.sync.read(Buffer.from(out.split(',')[1]!, 'base64'))
      const golden = PNG.sync.read(fs.readFileSync(goldenPath))
      const stats = diffStats(browser, golden)
      console.log(`parity ${eff.id}@${size}: mean=${(stats.mean * 255).toFixed(3)}/255 max=${(stats.max * 255).toFixed(1)}/255 pctOver=${(stats.pctOver * 100).toFixed(2)}%`)
      expect(stats.mean).toBeLessThanOrEqual(MAX_MEAN)
      expect(stats.pctOver).toBeLessThanOrEqual(MAX_PCT_OVER)
    })
  }
}
```

- [ ] **Step 3: Run the parity test (the spike measurement)**

Frontend dev server must be running (Playwright config handles it the same way timeline-golden does — check `frontend/playwright.config.ts` `webServer` and follow it).

Run: `cd frontend && npx playwright test tests/shaderfx-golden.spec.ts --project=chromium`
Expected: 4 tests. Record the logged mean/pctOver numbers for both effects.

- [ ] **Step 4: Calibrate / fix divergence (decision gate)**

- If all pass: done, record the numbers in the commit message.
- If `halftone` fails: there is an orientation or color-pipeline bug (it is deterministic math — it cannot legitimately diverge). Debug: dump both PNGs side by side (`PNG` writes), check Y-flip first (a flipped image gives mean ≫ 10/255), then sRGB (uniform ~1-3/255 shift everywhere suggests color-space mismatch — check `premultipliedAlpha`/canvas color space). Fix the renderer, not the tolerance.
- If only `noise_distortion` fails and the diff is structured around noise cell boundaries: tighten determinism — in `vnoise`, the `mix`/smoothstep interpolation is the only non-exact part; acceptable fixes are quantizing fbm output (`floor(v * 1024.0) / 1024.0`) in BOTH the shader (one source — applies to both runtimes automatically)…, or raising tolerance for `animated: true` effects only (add `MAX_MEAN_NOISY = 4/255` and pick by `eff.animated`). Prefer quantization only if it is visually invisible; otherwise the per-class tolerance is honest.
- Update this plan file's tolerance constants AND the design doc's Testing section if calibration changes them.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/pages/dev/shaderfx-harness.vue frontend/tests/shaderfx-golden.spec.ts
git commit -m "Shader effects: browser/server parity harness — spike calibrated (mean X/255, pctOver Y%)"
```

---

### Task 8: ShaderEffectNode.vue — node body with live preview + sliders

**Files:**
- Create: `frontend/app/components/vue-canvas/ShaderEffectNode.vue`
- Modify: `frontend/app/composables/useVueNodes.ts` (ARTIFACT_NODE_COMPONENTS)
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue` (import + `:node-types`)
- Modify: `frontend/app/lib/nodeDescriptions.ts` (description entry)

- [ ] **Step 1: Register the component type**

In `frontend/app/composables/useVueNodes.ts`, add to `ARTIFACT_NODE_COMPONENTS`:

```typescript
  ShaderEffect: 'shader-effect',
```

In `frontend/app/components/vue-canvas/VueNodeCanvas.vue`: add `import ShaderEffectNode from './ShaderEffectNode.vue'` next to the other node imports, and add `'shader-effect': markRaw(ShaderEffectNode)` to the `:node-types` object (line ~3995).

In `frontend/app/lib/nodeDescriptions.ts`, add (match the file's existing entry format):

```typescript
  ShaderEffect: 'Real-time shader effects — distortion, halftone, dither, and more. Live animated preview; renders locally on your GPU at no credit cost.',
```

- [ ] **Step 2: Create `ShaderEffectNode.vue`**

The component below is complete except the picker modal (Task 10) and center handle (Task 11). Follow `PoseMannequinNode.vue` for the node-frame scaffolding (header, ports rendering, selection ring) — copy its template skeleton for the outer frame and handles, replacing the body content. Core script:

```vue
<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { fetchShaderFxCatalog } from '~/lib/shaderfx/catalog'
import { walkShaderChain } from '~/lib/shaderfx/chain'
import { parseParams, resolveUniforms, serializeParams } from '~/lib/shaderfx/params'
import { shaderFx } from '~/lib/shaderfx/renderer'
import type { EffectDef, ShaderFxCatalog } from '~/lib/shaderfx/types'

const props = defineProps<{
  id: string
  selected?: boolean
  data: {
    nodeType: string
    title: string
    inputs: { name: string; type: string; link: number | null }[]
    outputs: { name: string; type: string; links: number[] | null }[]
    widgetsValues: any[]
    widgetDefs?: any[]
    properties?: Record<string, any>
    mode: number
    running?: boolean
    error?: boolean
    images?: string[]
  }
}>()

const injectedEdges = inject<any>('vueFlowEdges', null)
const injectedNodes = inject<any>('vueFlowNodes', null)

const catalog = ref<ShaderFxCatalog | null>(null)
const hovered = ref(false)
const playing = ref(true)
const previewCanvas = ref<HTMLCanvasElement | null>(null)
const glError = ref<string | null>(null)

// ---- widgets ----------------------------------------------------------------
function widgetIdx(name: string): number {
  return props.data.widgetDefs?.findIndex((w: any) => w.name === name) ?? -1
}
function widgetVal(name: string): any {
  const i = widgetIdx(name)
  return i >= 0 ? props.data.widgetsValues?.[i] : undefined
}
function setWidget(name: string, value: any) {
  const i = widgetIdx(name)
  if (i >= 0) props.data.widgetsValues[i] = value
}

const effectId = computed<string>(() => String(widgetVal('effect') ?? ''))
const effectDef = computed<EffectDef | null>(
  () => catalog.value?.effects.find(e => e.id === effectId.value) ?? null,
)
const uniforms = computed<Record<string, number>>(() =>
  effectDef.value ? resolveUniforms(effectDef.value, parseParams(String(widgetVal('params') ?? '{}'))) : {},
)
const seed = computed<number>(() => Number(widgetVal('seed') ?? 42) % 10000)

function setParam(uniform: string, value: number) {
  if (!effectDef.value) return
  const next = { ...uniforms.value, [uniform]: value }
  setWidget('params', serializeParams(effectDef.value, next))
  window.dispatchEvent(new CustomEvent('sailor:shaderfx-changed', { detail: { id: props.id } }))
  if (!animating.value) renderOnce()
}

// ---- preview rendering --------------------------------------------------------
const PREVIEW_W = 288
const baseImage = ref<HTMLImageElement | null>(null)
const placeholder = makePlaceholder()
let lastChainIds: string[] = []

function makePlaceholder(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 288; c.height = 162
  const ctx = c.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 288, 162)
  g.addColorStop(0, '#3b2a68'); g.addColorStop(0.55, '#1f6f8b'); g.addColorStop(1, '#e8a33d')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 288, 162)
  return c
}

const chain = computed(() => walkShaderChain(props.id, injectedNodes?.value ?? [], injectedEdges?.value ?? []))

watch(() => chain.value.baseUrl, (url) => {
  baseImage.value = null
  if (!url) return
  const img = new Image()
  img.onload = () => { baseImage.value = img; if (!animating.value) renderOnce() }
  img.src = url
}, { immediate: true })

let epoch = performance.now()
let frozenTime = 0.7

function buildPasses(t: number) {
  if (!catalog.value) return []
  return chain.value.passes
    .map((p) => {
      const def = catalog.value!.effects.find(e => e.id === p.effectId)
      if (!def) return null
      return {
        id: def.id,
        source: def.source,
        uniforms: { ...resolveUniforms(def, p.params), u_time: t, u_seed: p.seed % 10000, ...textureUniforms(def) },
        textures: textureSources(def),
      }
    })
    .filter(Boolean) as any[]
}

// Catalog textures (e.g. glyph atlas) — loaded lazily, cached module-wide
const textureImages = new Map<string, HTMLImageElement>()
function textureSources(def: EffectDef): Record<string, TexImageSource> {
  const out: Record<string, TexImageSource> = {}
  for (const t of def.textures) {
    const img = textureImages.get(t.file)
    if (img?.complete) out[t.uniform] = img
    else if (!img) {
      const el = new Image()
      el.onload = () => { if (!animating.value) renderOnce() }
      el.src = `/sailor/shader_effects/assets/${encodeURIComponent(t.file)}`
      textureImages.set(t.file, el)
    }
  }
  return out
}
function textureUniforms(def: EffectDef): Record<string, number> {
  const out: Record<string, number> = {}
  for (const t of def.textures) for (const [k, v] of Object.entries(t.extraUniforms ?? {})) out[k] = v
  return out
}

function renderFrame(t: number) {
  const canvas = previewCanvas.value
  if (!canvas || !catalog.value) return
  const base = baseImage.value ?? placeholder
  const w = PREVIEW_W
  const h = Math.max(16, Math.round((base.height / base.width) * w))
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
  try {
    const out = shaderFx.render(buildPasses(t), base, w, h)
    canvas.getContext('2d')!.drawImage(out, 0, 0)
    glError.value = null
  } catch (e: any) {
    glError.value = String(e?.message ?? e)
  }
}

function renderOnce() { renderFrame(frozenTime) }

// ---- animation lifecycle: only selected/hovered nodes run a rAF loop ---------
const animating = computed(() => (props.selected || hovered.value) && playing.value && !glError.value)
let raf = 0
function loop() {
  frozenTime = (performance.now() - epoch) / 1000
  renderFrame(frozenTime)
  raf = requestAnimationFrame(loop)
}
watch(animating, (on) => {
  cancelAnimationFrame(raf)
  if (on) raf = requestAnimationFrame(loop)
}, { immediate: false })

// Upstream param changes: single-frame refresh so chained previews never go stale
function onUpstreamChange(ev: Event) {
  const changedId = (ev as CustomEvent).detail?.id
  if (changedId === props.id) return
  if (lastChainIds.includes(changedId) && !animating.value) renderOnce()
}

onMounted(async () => {
  catalog.value = await fetchShaderFxCatalog().catch(() => null)
  lastChainIds = chain.value.nodeIds
  watch(() => chain.value.nodeIds, ids => { lastChainIds = ids; if (!animating.value) renderOnce() })
  window.addEventListener('sailor:shaderfx-changed', onUpstreamChange)
  renderOnce()
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('sailor:shaderfx-changed', onUpstreamChange)
})
</script>
```

Template body (inside the node-frame skeleton copied from PoseMannequinNode):

```vue
<div @mouseenter="hovered = true" @mouseleave="hovered = false">
  <canvas ref="previewCanvas" class="w-full rounded-md" />
  <div v-if="glError" class="text-xs text-red-400 p-1">{{ glError }}</div>
  <button class="text-xs opacity-70" @click="playing = !playing">{{ playing ? 'Pause' : 'Play' }}</button>

  <div v-if="effectDef" class="space-y-1 p-1">
    <div v-for="p in effectDef.params" :key="p.uniform" class="flex items-center gap-2 text-xs">
      <span class="w-20 truncate opacity-70">{{ p.label }}</span>
      <input
        type="range" class="flex-1" :min="p.min" :max="p.max" :step="p.step"
        :value="uniforms[p.uniform]"
        @input="setParam(p.uniform, Number(($event.target as HTMLInputElement).value))"
      />
      <span class="w-10 text-right tabular-nums">{{ (uniforms[p.uniform] ?? 0).toFixed(2) }}</span>
    </div>
  </div>
</div>
```

**Ordering:** this component imports `walkShaderChain` from Task 9's `chain.ts`. Execute Task 9 Steps 1–4 (pure module + vitest, no dependency on this component) BEFORE this task; Task 9 Step 5 (manual stacking verification in the app) runs after this task is done.

- [ ] **Step 3: Manual verification (preview tools)**

With both servers running: add a LoadImage → ShaderEffect to the canvas, pick an image. Verify: preview shows the image with noise distortion animating while the node is selected/hovered; sliders move the effect in real time; deselect freezes the last frame; the JSON in the `params` widget (check via export/workflow JSON) contains only changed params. Run the graph; verify the node executes and the saved output matches the frozen preview's character.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/vue-canvas/ShaderEffectNode.vue frontend/app/composables/useVueNodes.ts frontend/app/components/vue-canvas/VueNodeCanvas.vue frontend/app/lib/nodeDescriptions.ts
git commit -m "Shader effects: ShaderEffectNode body — live WebGL preview, manifest-driven sliders"
```

---

### Task 9: Chain walk + downstream refresh

**Files:**
- Create: `frontend/app/lib/shaderfx/chain.ts`
- Test: `frontend/tests/unit/shaderfx-chain.unit.spec.ts`

- [ ] **Step 1: Write failing chain tests**

```typescript
import { describe, expect, it } from 'vitest'
import { walkShaderChain } from '~/lib/shaderfx/chain'

function node(id: string, nodeType: string, extra: any = {}) {
  return { id, data: { nodeType, widgetsValues: [], widgetDefs: [], images: [], ...extra } }
}
const edge = (source: string, target: string) => ({ source, target, targetHandle: 'input-0' })

const shaderDefs = [
  { name: 'effect' }, { name: 'params' }, { name: 'time' }, { name: 'duration' }, { name: 'fps' }, { name: 'seed' },
]
function shaderNode(id: string, effect: string, params = '{}', images: string[] = []) {
  return node(id, 'ShaderEffect', { widgetDefs: shaderDefs, widgetsValues: [effect, params, 0, 0, 24, 42], images })
}

describe('walkShaderChain', () => {
  it('single node, image upstream', () => {
    const nodes = [shaderNode('b', 'halftone'), node('a', 'PreviewImage', { images: ['/view?x=1'] })]
    const r = walkShaderChain('b', nodes, [edge('a', 'b')])
    expect(r.passes.map(p => p.effectId)).toEqual(['halftone'])
    expect(r.baseUrl).toBe('/view?x=1')
    expect(r.nodeIds).toEqual(['a'])
  })

  it('stacks unexecuted upstream ShaderEffects in order', () => {
    const nodes = [
      shaderNode('c', 'halftone'),
      shaderNode('b', 'noise_distortion', '{"u_amount":0.1}'),
      node('a', 'LoadImage', { widgetsValues: ['cat.png'] }),
    ]
    const r = walkShaderChain('c', nodes, [edge('b', 'c'), edge('a', 'b')])
    expect(r.passes.map(p => p.effectId)).toEqual(['noise_distortion', 'halftone'])
    expect(r.passes[0]!.params).toEqual({ u_amount: 0.1 })
    expect(r.baseUrl).toContain('cat.png')
    expect(r.nodeIds).toEqual(['b', 'a'])
  })

  it('an executed upstream ShaderEffect terminates the walk with its output image', () => {
    const nodes = [shaderNode('c', 'halftone'), shaderNode('b', 'noise_distortion', '{}', ['/view?out=b'])]
    const r = walkShaderChain('c', nodes, [edge('b', 'c')])
    expect(r.passes.map(p => p.effectId)).toEqual(['halftone'])
    expect(r.baseUrl).toBe('/view?out=b')
  })

  it('cycles and missing edges terminate safely', () => {
    const nodes = [shaderNode('a', 'halftone'), shaderNode('b', 'halftone')]
    const r = walkShaderChain('a', nodes, [edge('b', 'a'), edge('a', 'b')])
    expect(r.baseUrl).toBeNull()
    expect(r.passes.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run tests/unit/shaderfx-chain.unit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `frontend/app/lib/shaderfx/chain.ts`**

```typescript
import { parseParams } from './params'

export interface ChainPass {
  effectId: string
  params: Record<string, number>
  seed: number
}

export interface ChainResult {
  /** Render order: most-upstream first. Always includes the node itself (last). */
  passes: ChainPass[]
  /** Image to feed pass 0, or null (placeholder). */
  baseUrl: string | null
  /** Upstream node ids visited (for downstream-refresh checks). */
  nodeIds: string[]
}

function widgetVal(n: any, name: string): any {
  const i = n?.data?.widgetDefs?.findIndex((w: any) => w.name === name) ?? -1
  return i >= 0 ? n.data.widgetsValues?.[i] : undefined
}

function passOf(n: any): ChainPass {
  return {
    effectId: String(widgetVal(n, 'effect') ?? ''),
    params: parseParams(String(widgetVal(n, 'params') ?? '{}')),
    seed: Number(widgetVal(n, 'seed') ?? 42),
  }
}

/** Same image-URL resolution as ArtifactFrameNode.resolveSrcUrl. */
function resolveSrcUrl(src: any): string | null {
  if (src?.data?.images?.length) return src.data.images[0]
  if (src?.data?.nodeType === 'LoadImage' && src?.data?.widgetsValues?.[0]) {
    return `/view?${new URLSearchParams({ filename: src.data.widgetsValues[0], type: 'input' })}`
  }
  return null
}

export function walkShaderChain(nodeId: string, nodes: any[], edges: any[], maxDepth = 8): ChainResult {
  const byId = new Map(nodes.map((n: any) => [n.id, n]))
  const self = byId.get(nodeId)
  const passes: ChainPass[] = self ? [passOf(self)] : []
  const nodeIds: string[] = []
  let baseUrl: string | null = null
  const seen = new Set<string>([nodeId])

  let current = nodeId
  for (let depth = 0; depth < maxDepth; depth++) {
    const e = edges.find((e: any) => e.target === current && e.targetHandle === 'input-0')
    if (!e) break
    const src = byId.get(e.source)
    if (!src || seen.has(src.id)) break
    seen.add(src.id)
    nodeIds.push(src.id)
    const executed = !!src.data?.images?.length
    if (src.data?.nodeType === 'ShaderEffect' && !executed) {
      passes.unshift(passOf(src))
      current = src.id
      continue
    }
    baseUrl = resolveSrcUrl(src)
    break
  }
  return { passes, baseUrl, nodeIds }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run tests/unit/shaderfx-chain.unit.spec.ts`
Expected: 4 passed.

- [ ] **Step 5: Manual verification of stacking**

In the app: LoadImage → ShaderEffect(noise_distortion) → ShaderEffect(halftone). Select the halftone node — its preview must show BOTH effects animating. Drag a noise_distortion slider — the halftone node's frozen/live preview must update (single-frame refresh via the `sailor:shaderfx-changed` event). Run the graph and confirm the saved output shows the same stack.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/shaderfx/chain.ts frontend/tests/unit/shaderfx-chain.unit.spec.ts
git commit -m "Shader effects: upstream chain walk — stacked previews + downstream refresh"
```

---

### Task 10: Effect gallery picker

**Files:**
- Modify: `frontend/app/components/vue-canvas/ShaderEffectNode.vue`

- [ ] **Step 1: Add picker state + thumbnail rendering to the script**

Thumbnails are rendered through the shared singleton (sequentially, one frame each at `t = 1.2` on the placeholder) and cached module-wide as data URLs — no extra GL contexts, computed once per page load:

```typescript
const pickerOpen = ref(false)
const thumbs = ref<Record<string, string>>({})
const thumbCache: Record<string, string> = ((globalThis as any).__shaderFxThumbs ??= {})

async function openPicker() {
  pickerOpen.value = true
  if (!catalog.value) return
  for (const def of catalog.value.effects) {
    if (!thumbCache[def.id]) {
      try {
        const out = shaderFx.render(
          [{ id: def.id, source: def.source, uniforms: { ...resolveUniforms(def, {}), u_time: 1.2, u_seed: 42, ...textureUniforms(def) }, textures: textureSources(def) }],
          placeholder, 96, 54,
        )
        thumbCache[def.id] = out.toDataURL('image/jpeg', 0.8)
      } catch { thumbCache[def.id] = '' }
    }
  }
  thumbs.value = { ...thumbCache }
}

const categories = computed(() => {
  const map = new Map<string, EffectDef[]>()
  for (const e of catalog.value?.effects ?? []) {
    if (!map.has(e.category)) map.set(e.category, [])
    map.get(e.category)!.push(e)
  }
  return map
})

function pickEffect(id: string) {
  setWidget('effect', id)
  setWidget('params', '{}') // params are per-effect; reset on switch
  pickerOpen.value = false
  window.dispatchEvent(new CustomEvent('sailor:shaderfx-changed', { detail: { id: props.id } }))
  if (!animating.value) renderOnce()
}
```

- [ ] **Step 2: Add picker UI to the template**

Above the sliders (styling: match the Film a Shot picker's look — check its modal classes in the codebase and reuse them; structure below is the contract):

```vue
<button class="text-xs w-full text-left px-1 py-0.5 rounded bg-white/5 hover:bg-white/10" @click="openPicker">
  {{ effectDef?.name ?? 'Choose effect…' }} ▾
</button>

<Teleport to="body">
  <div v-if="pickerOpen" class="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" @click.self="pickerOpen = false">
    <div class="bg-neutral-900 rounded-xl p-4 max-h-[80vh] w-[560px] overflow-y-auto">
      <div v-for="[cat, effects] in categories" :key="cat" class="mb-3">
        <div class="text-xs uppercase opacity-50 mb-1">{{ cat }}</div>
        <div class="grid grid-cols-4 gap-2">
          <button
            v-for="e in effects" :key="e.id"
            class="rounded-lg overflow-hidden text-left ring-1 ring-white/10 hover:ring-white/40"
            :class="{ 'ring-2 ring-blue-400': e.id === effectId }"
            @click="pickEffect(e.id)"
          >
            <img v-if="thumbs[e.id]" :src="thumbs[e.id]" class="w-full aspect-video object-cover" />
            <div v-else class="w-full aspect-video bg-white/5" />
            <div class="text-xs p-1 truncate">{{ e.name }}</div>
          </button>
        </div>
      </div>
    </div>
  </div>
</Teleport>
```

- [ ] **Step 3: Manual verification**

Open the picker: every catalog effect shows a thumbnail of the effect applied to the gradient placeholder, grouped by category; picking one swaps the param sliders and resets `params` to `{}`; the preview switches live.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/vue-canvas/ShaderEffectNode.vue
git commit -m "Shader effects: gallery picker with rendered thumbnails"
```

---

### Task 11: Draggable center handle

**Files:**
- Modify: `frontend/app/components/vue-canvas/ShaderEffectNode.vue`

For effects whose manifest sets `centerParam: ["u_centerX", "u_centerY"]`. Coordinates are texture-space y-up (matches the shader), so display y is inverted.

- [ ] **Step 1: Add handle logic**

```typescript
const hasCenter = computed(() => (effectDef.value?.centerParam?.length ?? 0) === 2)
const centerStyle = computed(() => {
  if (!hasCenter.value) return {}
  const [cx, cy] = effectDef.value!.centerParam!
  const x = uniforms.value[cx!] ?? 0.5
  const y = uniforms.value[cy!] ?? 0.5
  return { left: `${x * 100}%`, top: `${(1 - y) * 100}%` }
})

let draggingCenter = false
function onCenterDown(ev: PointerEvent) {
  draggingCenter = true
  ;(ev.target as HTMLElement).setPointerCapture(ev.pointerId)
  ev.stopPropagation() // don't drag the node
}
function onCenterMove(ev: PointerEvent) {
  if (!draggingCenter || !hasCenter.value || !previewCanvas.value) return
  const r = previewCanvas.value.getBoundingClientRect()
  const x = Math.min(Math.max((ev.clientX - r.left) / r.width, 0), 1)
  const y = 1 - Math.min(Math.max((ev.clientY - r.top) / r.height, 0), 1)
  const [cx, cy] = effectDef.value!.centerParam!
  if (!effectDef.value) return
  const next = { ...uniforms.value, [cx!]: x, [cy!]: y }
  setWidget('params', serializeParams(effectDef.value, next))
  window.dispatchEvent(new CustomEvent('sailor:shaderfx-changed', { detail: { id: props.id } }))
  if (!animating.value) renderOnce()
}
function onCenterUp() { draggingCenter = false }
```

- [ ] **Step 2: Add handle element over the canvas**

Wrap the canvas in `position: relative` container and add:

```vue
<div
  v-if="hasCenter"
  class="absolute w-3 h-3 -ml-1.5 -mt-1.5 rounded-full border-2 border-white bg-blue-500/70 cursor-move"
  :style="centerStyle"
  @pointerdown="onCenterDown" @pointermove="onCenterMove" @pointerup="onCenterUp"
/>
```

- [ ] **Step 3: Verify + commit**

No effect has `centerParam` yet (swirl/pinch/ripple arrive in Task 13) — verify it renders nothing for the spike effects, then re-verify drag behavior during Task 13's manual check.

```bash
git add frontend/app/components/vue-canvas/ShaderEffectNode.vue
git commit -m "Shader effects: draggable center handle for centerParam effects"
```

---

### Task 12: Glyph atlas asset

**Files:**
- Create: `shader_effects/assets/generate_glyph_atlas.py`
- Create (generated): `shader_effects/assets/glyph_atlas.png`, `shader_effects/assets/glyph_atlas.json`

- [ ] **Step 1: Write the generator**

```python
"""Generate the glyph atlas for ASCII/Glyph Dither: 10 glyphs in a brightness ramp.

Uses PIL's built-in bitmap font (deterministic across machines), nearest-upscaled
for a chunky retro look. Cells are CELL_W x CELL_H, glyphs ordered dark -> bright.
Usage: .venv/bin/python shader_effects/assets/generate_glyph_atlas.py
"""
import json
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
RAMP = " .:-=+*#%@"
CELL_W, CELL_H = 32, 48
SCALE = 4  # render small, upscale NEAREST


def main() -> None:
    n = len(RAMP)
    small_w, small_h = CELL_W // SCALE, CELL_H // SCALE
    atlas = Image.new("L", (n * small_w, small_h), 0)
    draw = ImageDraw.Draw(atlas)
    font = ImageFont.load_default()
    for i, ch in enumerate(RAMP):
        bbox = draw.textbbox((0, 0), ch, font=font)
        w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
        draw.text((i * small_w + (small_w - w) // 2 - bbox[0], (small_h - h) // 2 - bbox[1]), ch, fill=255, font=font)
    atlas = atlas.resize((n * CELL_W, CELL_H), Image.NEAREST)
    atlas.save(os.path.join(HERE, "glyph_atlas.png"))
    with open(os.path.join(HERE, "glyph_atlas.json"), "w", encoding="utf-8") as f:
        json.dump({"count": n, "cellWidth": CELL_W, "cellHeight": CELL_H, "ramp": RAMP}, f, indent=2)
    print(f"glyph_atlas.png: {n} glyphs at {CELL_W}x{CELL_H}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it and eyeball**

Run: `.venv/bin/python shader_effects/assets/generate_glyph_atlas.py`
Open `shader_effects/assets/glyph_atlas.png` (Read tool): 10 white glyphs ` .:-=+*#%@` on black, left to right.

- [ ] **Step 3: Commit**

```bash
git add shader_effects/assets/
git commit -m "Shader effects: glyph atlas asset + generator"
```

---

### Task 13: Distortion shaders — wave, swirl, pinch_bulge, water_ripple, liquify

**Files:**
- Create: `shader_effects/wave.frag`, `swirl.frag`, `pinch_bulge.frag`, `water_ripple.frag`, `liquify.frag`
- Modify: `shader_effects/manifest.json`

Every shader file = standard preamble + (hash/noise snippet only where noted) + the code below. After adding ALL five: regenerate goldens, run both test suites (they loop the catalog — no new test code needed), visually check each effect.

- [ ] **Step 1: `wave.frag`**

```glsl
uniform float u_amplitude;
uniform float u_frequency;
uniform float u_speed;
uniform float u_angle;

void main() {
    float ang = radians(u_angle);
    vec2 dir = vec2(cos(ang), sin(ang));
    float phase = dot(v_texCoord, dir) * u_frequency * 6.2831853 + u_time * u_speed * 6.2831853;
    vec2 off = vec2(-dir.y, dir.x) * sin(phase) * u_amplitude;
    fragColor0 = vec4(texture(u_image0, clamp(v_texCoord + off, 0.0, 1.0)).rgb, 1.0);
}
```

Manifest entry:

```json
{
  "id": "wave", "name": "Wave", "category": "distortion", "animated": true, "passes": 1,
  "centerParam": null, "textures": [],
  "params": [
    { "uniform": "u_amplitude", "label": "Amplitude", "type": "float", "min": 0.0, "max": 0.2, "default": 0.03, "step": 0.002 },
    { "uniform": "u_frequency", "label": "Frequency", "type": "float", "min": 1.0, "max": 50.0, "default": 10.0, "step": 0.5 },
    { "uniform": "u_speed", "label": "Speed", "type": "float", "min": 0.0, "max": 3.0, "default": 0.8, "step": 0.05 },
    { "uniform": "u_angle", "label": "Angle", "type": "float", "min": 0.0, "max": 360.0, "default": 90.0, "step": 1.0 }
  ]
}
```

- [ ] **Step 2: `swirl.frag`** (centerParam)

```glsl
uniform float u_strength;
uniform float u_radius;
uniform float u_speed;
uniform float u_centerX;
uniform float u_centerY;

void main() {
    vec2 asp = vec2(u_resolution.x / u_resolution.y, 1.0);
    vec2 c = vec2(u_centerX, u_centerY);
    vec2 p = (v_texCoord - c) * asp;
    float r = length(p);
    float fall = smoothstep(u_radius, 0.0, r);
    float a = u_strength * fall * (1.0 + 0.15 * sin(u_time * u_speed * 6.2831853));
    mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
    vec2 uv = c + (R * p) / asp;
    fragColor0 = vec4(texture(u_image0, clamp(uv, 0.0, 1.0)).rgb, 1.0);
}
```

```json
{
  "id": "swirl", "name": "Swirl", "category": "distortion", "animated": true, "passes": 1,
  "centerParam": ["u_centerX", "u_centerY"], "textures": [],
  "params": [
    { "uniform": "u_strength", "label": "Strength", "type": "float", "min": -10.0, "max": 10.0, "default": 3.0, "step": 0.1 },
    { "uniform": "u_radius", "label": "Radius", "type": "float", "min": 0.05, "max": 1.5, "default": 0.45, "step": 0.01 },
    { "uniform": "u_speed", "label": "Speed", "type": "float", "min": 0.0, "max": 3.0, "default": 0.5, "step": 0.05 },
    { "uniform": "u_centerX", "label": "Center X", "type": "float", "min": 0.0, "max": 1.0, "default": 0.5, "step": 0.01 },
    { "uniform": "u_centerY", "label": "Center Y", "type": "float", "min": 0.0, "max": 1.0, "default": 0.5, "step": 0.01 }
  ]
}
```

- [ ] **Step 3: `pinch_bulge.frag`** (centerParam)

```glsl
uniform float u_strength;
uniform float u_radius;
uniform float u_speed;
uniform float u_centerX;
uniform float u_centerY;

void main() {
    vec2 asp = vec2(u_resolution.x / u_resolution.y, 1.0);
    vec2 c = vec2(u_centerX, u_centerY);
    vec2 p = (v_texCoord - c) * asp;
    float r = length(p);
    float strength = u_strength * (1.0 + 0.2 * sin(u_time * u_speed * 6.2831853));
    if (r < u_radius && r > 0.0) {
        float k = r / u_radius;
        // exponent in (0.1, 3]: strength > 0 pinches (samples pull outward), < 0 bulges
        float r2 = u_radius * pow(k, clamp(1.0 + strength, 0.1, 3.0));
        p = (p / r) * r2;
    }
    vec2 uv = c + p / asp;
    fragColor0 = vec4(texture(u_image0, clamp(uv, 0.0, 1.0)).rgb, 1.0);
}
```

```json
{
  "id": "pinch_bulge", "name": "Pinch / Bulge", "category": "distortion", "animated": true, "passes": 1,
  "centerParam": ["u_centerX", "u_centerY"], "textures": [],
  "params": [
    { "uniform": "u_strength", "label": "Strength", "type": "float", "min": -0.9, "max": 2.0, "default": 0.6, "step": 0.05 },
    { "uniform": "u_radius", "label": "Radius", "type": "float", "min": 0.05, "max": 1.5, "default": 0.5, "step": 0.01 },
    { "uniform": "u_speed", "label": "Speed", "type": "float", "min": 0.0, "max": 3.0, "default": 0.0, "step": 0.05 },
    { "uniform": "u_centerX", "label": "Center X", "type": "float", "min": 0.0, "max": 1.0, "default": 0.5, "step": 0.01 },
    { "uniform": "u_centerY", "label": "Center Y", "type": "float", "min": 0.0, "max": 1.0, "default": 0.5, "step": 0.01 }
  ]
}
```

- [ ] **Step 4: `water_ripple.frag`** (centerParam)

```glsl
uniform float u_amplitude;
uniform float u_wavelength;
uniform float u_speed;
uniform float u_decay;
uniform float u_centerX;
uniform float u_centerY;

void main() {
    vec2 asp = vec2(u_resolution.x / u_resolution.y, 1.0);
    vec2 c = vec2(u_centerX, u_centerY);
    vec2 p = (v_texCoord - c) * asp;
    float r = length(p);
    float phase = (r / max(u_wavelength, 1e-4) - u_time * u_speed) * 6.2831853;
    float att = exp(-u_decay * r);
    vec2 dir = r > 0.0 ? p / r : vec2(0.0);
    vec2 off = dir * sin(phase) * u_amplitude * att;
    fragColor0 = vec4(texture(u_image0, clamp(v_texCoord + off / asp, 0.0, 1.0)).rgb, 1.0);
}
```

```json
{
  "id": "water_ripple", "name": "Water Ripple", "category": "distortion", "animated": true, "passes": 1,
  "centerParam": ["u_centerX", "u_centerY"], "textures": [],
  "params": [
    { "uniform": "u_amplitude", "label": "Amplitude", "type": "float", "min": 0.0, "max": 0.1, "default": 0.02, "step": 0.002 },
    { "uniform": "u_wavelength", "label": "Wavelength", "type": "float", "min": 0.01, "max": 0.3, "default": 0.06, "step": 0.005 },
    { "uniform": "u_speed", "label": "Speed", "type": "float", "min": 0.0, "max": 4.0, "default": 1.2, "step": 0.05 },
    { "uniform": "u_decay", "label": "Decay", "type": "float", "min": 0.0, "max": 8.0, "default": 2.0, "step": 0.1 },
    { "uniform": "u_centerX", "label": "Center X", "type": "float", "min": 0.0, "max": 1.0, "default": 0.5, "step": 0.01 },
    { "uniform": "u_centerY", "label": "Center Y", "type": "float", "min": 0.0, "max": 1.0, "default": 0.5, "step": 0.01 }
  ]
}
```

- [ ] **Step 5: `liquify.frag`** (needs the hash/noise snippet)

```glsl
uniform float u_amount;
uniform float u_scale;
uniform float u_speed;

void main() {
    vec2 asp = vec2(u_resolution.x / u_resolution.y, 1.0);
    vec2 p = v_texCoord * asp * u_scale;
    float t = u_time * u_speed;
    vec2 q = vec2(
        fbm(p + vec2(0.0, 0.0) + 0.30 * t, u_seed),
        fbm(p + vec2(5.2, 1.3) - 0.20 * t, u_seed + 7.0)
    );
    vec2 w = vec2(
        fbm(p + 2.0 * q + vec2(1.7, 9.2) + 0.15 * t, u_seed + 13.0),
        fbm(p + 2.0 * q + vec2(8.3, 2.8), u_seed + 29.0)
    );
    vec2 off = (w - 0.5) * 2.0 * u_amount;
    fragColor0 = vec4(texture(u_image0, clamp(v_texCoord + off, 0.0, 1.0)).rgb, 1.0);
}
```

```json
{
  "id": "liquify", "name": "Liquify", "category": "distortion", "animated": true, "passes": 1,
  "centerParam": null, "textures": [],
  "params": [
    { "uniform": "u_amount", "label": "Amount", "type": "float", "min": 0.0, "max": 0.4, "default": 0.12, "step": 0.005 },
    { "uniform": "u_scale", "label": "Scale", "type": "float", "min": 0.5, "max": 12.0, "default": 3.0, "step": 0.25 },
    { "uniform": "u_speed", "label": "Speed", "type": "float", "min": 0.0, "max": 2.0, "default": 0.4, "step": 0.05 }
  ]
}
```

- [ ] **Step 6: Regenerate goldens, run all suites**

```bash
.venv/bin/python tests-unit/shaderfx_golden/generate_goldens.py
.venv/bin/python -m pytest tests-unit/comfy_extras_test/shader_effects_test.py -v
cd frontend && npx playwright test tests/shaderfx-golden.spec.ts --project=chromium
```

Expected: pytest all pass; Playwright 14 parity tests (7 effects × 2 sizes) all pass. Eyeball each new golden PNG (Read tool) — every effect must be clearly recognizable on the test card (wave = wavy bands, swirl = spiral around center, pinch = sucked-in center, ripple = concentric rings, liquify = melted look). Tune defaults in the manifest if an effect is too subtle on the fixture, then regenerate.

- [ ] **Step 7: Manual check + commit**

Kill ComfyUI (restart picks up new combo options). In the app, flip through all 7 effects in the picker; verify center-handle drag works on swirl/pinch/ripple.

```bash
git add shader_effects/ tests-unit/shaderfx_golden/
git commit -m "Shader effects: distortion family (wave, swirl, pinch/bulge, ripple, liquify)"
```

---

### Task 14: Stylize shaders — pixelate, outline, ascii_dither, glyph_dither

**Files:**
- Create: `shader_effects/pixelate.frag`, `outline.frag`, `ascii_dither.frag`, `glyph_dither.frag`
- Modify: `shader_effects/manifest.json`

- [ ] **Step 1: `pixelate.frag`**

```glsl
uniform float u_size;

void main() {
    vec2 cellPx = vec2(max(u_size * u_resolution.y, 1.0));
    vec2 px = v_texCoord * u_resolution;
    vec2 cuv = (floor(px / cellPx) + 0.5) * cellPx / u_resolution;
    fragColor0 = vec4(texture(u_image0, clamp(cuv, 0.0, 1.0)).rgb, 1.0);
}
```

```json
{
  "id": "pixelate", "name": "Pixelate", "category": "stylize", "animated": false, "passes": 1,
  "centerParam": null, "textures": [],
  "params": [
    { "uniform": "u_size", "label": "Pixel Size", "type": "float", "min": 0.002, "max": 0.2, "default": 0.03, "step": 0.002 }
  ]
}
```

- [ ] **Step 2: `outline.frag`** (Sobel "Tron" edges)

```glsl
uniform float u_thickness;
uniform float u_threshold;
uniform float u_softness;
uniform float u_intensity;
uniform float u_background;

float lum(vec2 uv) {
    return dot(texture(u_image0, clamp(uv, 0.0, 1.0)).rgb, vec3(0.299, 0.587, 0.114));
}

void main() {
    vec2 s = vec2(max(u_thickness * u_resolution.y, 0.5)) / u_resolution;
    float tl = lum(v_texCoord + vec2(-s.x,  s.y)), t = lum(v_texCoord + vec2(0.0,  s.y)), tr = lum(v_texCoord + vec2(s.x,  s.y));
    float l  = lum(v_texCoord + vec2(-s.x,  0.0)),                                        r  = lum(v_texCoord + vec2(s.x,  0.0));
    float bl = lum(v_texCoord + vec2(-s.x, -s.y)), b = lum(v_texCoord + vec2(0.0, -s.y)), br = lum(v_texCoord + vec2(s.x, -s.y));
    float gx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
    float gy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);
    float e = length(vec2(gx, gy));
    float m = smoothstep(u_threshold, u_threshold + max(u_softness, 1e-3), e) * u_intensity;
    vec3 base = texture(u_image0, v_texCoord).rgb * u_background;
    fragColor0 = vec4(clamp(base + vec3(m), 0.0, 1.0), 1.0);
}
```

```json
{
  "id": "outline", "name": "Outline", "category": "stylize", "animated": false, "passes": 1,
  "centerParam": null, "textures": [],
  "params": [
    { "uniform": "u_thickness", "label": "Thickness", "type": "float", "min": 0.001, "max": 0.012, "default": 0.003, "step": 0.0005 },
    { "uniform": "u_threshold", "label": "Threshold", "type": "float", "min": 0.0, "max": 1.0, "default": 0.2, "step": 0.01 },
    { "uniform": "u_softness", "label": "Softness", "type": "float", "min": 0.0, "max": 1.0, "default": 0.25, "step": 0.01 },
    { "uniform": "u_intensity", "label": "Intensity", "type": "float", "min": 0.0, "max": 2.0, "default": 1.0, "step": 0.05 },
    { "uniform": "u_background", "label": "Background", "type": "float", "min": 0.0, "max": 1.0, "default": 0.15, "step": 0.01 }
  ]
}
```

- [ ] **Step 3: `ascii_dither.frag`** (hash snippet + glyph atlas)

```glsl
uniform sampler2D u_glyphs;
uniform float u_glyphCount;
uniform float u_cell;
uniform float u_jitter;
uniform float u_speed;
uniform float u_colored;

void main() {
    vec2 cellPx = vec2(max(u_cell * u_resolution.y, 2.0));
    // glyph cells are 2:3 (CELL_W 32 x CELL_H 48)
    cellPx.x *= 2.0 / 3.0;
    vec2 cell = floor(v_texCoord * u_resolution / cellPx);
    vec2 cuv = (cell + 0.5) * cellPx / u_resolution;
    vec3 col = texture(u_image0, clamp(cuv, 0.0, 1.0)).rgb;
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    float tick = floor(u_time * u_speed * 8.0);
    float jitter = u_jitter * (hash2(cell + tick * 101.0, u_seed) - 0.5);
    float g = clamp(lum + jitter, 0.0, 1.0);
    float gi = min(floor(g * u_glyphCount), u_glyphCount - 1.0);
    vec2 inCell = fract(v_texCoord * u_resolution / cellPx);
    float glyph = texture(u_glyphs, vec2((gi + inCell.x) / u_glyphCount, inCell.y)).r;
    vec3 ink = mix(vec3(1.0), col / max(lum, 1e-3), step(0.5, u_colored));
    fragColor0 = vec4(clamp(ink * glyph, 0.0, 1.0), 1.0);
}
```

```json
{
  "id": "ascii_dither", "name": "ASCII Dither", "category": "stylize", "animated": true, "passes": 1,
  "centerParam": null,
  "textures": [{ "uniform": "u_glyphs", "file": "glyph_atlas.png", "extraUniforms": { "u_glyphCount": 10 } }],
  "params": [
    { "uniform": "u_cell", "label": "Cell Size", "type": "float", "min": 0.01, "max": 0.1, "default": 0.03, "step": 0.002 },
    { "uniform": "u_jitter", "label": "Jitter", "type": "float", "min": 0.0, "max": 0.5, "default": 0.08, "step": 0.01 },
    { "uniform": "u_speed", "label": "Speed", "type": "float", "min": 0.0, "max": 3.0, "default": 1.0, "step": 0.05 },
    { "uniform": "u_colored", "label": "Colored", "type": "float", "min": 0.0, "max": 1.0, "default": 1.0, "step": 1.0 }
  ]
}
```

- [ ] **Step 4: `glyph_dither.frag`** (hash snippet; "redacted" bar fill)

```glsl
uniform float u_cellW;
uniform float u_cellH;
uniform float u_jitter;
uniform float u_speed;
uniform float u_colored;

void main() {
    vec2 cellPx = vec2(max(u_cellW * u_resolution.y, 2.0), max(u_cellH * u_resolution.y, 2.0));
    vec2 cell = floor(v_texCoord * u_resolution / cellPx);
    vec2 cuv = (cell + 0.5) * cellPx / u_resolution;
    vec3 col = texture(u_image0, clamp(cuv, 0.0, 1.0)).rgb;
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    float tick = floor(u_time * u_speed * 8.0);
    float fill = clamp(lum + u_jitter * (hash2(cell + tick * 101.0, u_seed) - 0.5), 0.0, 1.0);
    vec2 inCell = fract(v_texCoord * u_resolution / cellPx);
    float m = step(inCell.x, fill) * step(0.12, inCell.y) * step(inCell.y, 0.88);
    vec3 ink = mix(vec3(1.0), col / max(lum, 1e-3), step(0.5, u_colored));
    fragColor0 = vec4(clamp(ink * m, 0.0, 1.0), 1.0);
}
```

```json
{
  "id": "glyph_dither", "name": "Glyph Dither", "category": "stylize", "animated": true, "passes": 1,
  "centerParam": null, "textures": [],
  "params": [
    { "uniform": "u_cellW", "label": "Cell Width", "type": "float", "min": 0.01, "max": 0.15, "default": 0.05, "step": 0.005 },
    { "uniform": "u_cellH", "label": "Cell Height", "type": "float", "min": 0.005, "max": 0.08, "default": 0.018, "step": 0.002 },
    { "uniform": "u_jitter", "label": "Jitter", "type": "float", "min": 0.0, "max": 0.5, "default": 0.1, "step": 0.01 },
    { "uniform": "u_speed", "label": "Speed", "type": "float", "min": 0.0, "max": 3.0, "default": 1.0, "step": 0.05 },
    { "uniform": "u_colored", "label": "Colored", "type": "float", "min": 0.0, "max": 1.0, "default": 1.0, "step": 1.0 }
  ]
}
```

- [ ] **Step 5: Regenerate goldens, run suites, eyeball, commit**

```bash
.venv/bin/python tests-unit/shaderfx_golden/generate_goldens.py
.venv/bin/python -m pytest tests-unit/comfy_extras_test/shader_effects_test.py -v
cd frontend && npx playwright test tests/shaderfx-golden.spec.ts --project=chromium
```

Expected: pytest pass; Playwright 22 parity tests (11 effects × 2). Eyeball each new golden (Read tool): pixelate = mosaic, outline = bright edges on dark, ascii = test card readable as character ramp, glyph = redacted-bars look. The ascii/glyph parity also proves the NEAREST atlas path end-to-end.

```bash
git add shader_effects/ tests-unit/shaderfx_golden/
git commit -m "Shader effects: stylize family (pixelate, outline, ascii dither, glyph dither)"
```

---

### Task 15: Structural stylize shaders — blocks, mondrian, recursive_grid

**Files:**
- Create: `shader_effects/blocks.frag`, `mondrian.frag`, `recursive_grid.frag`
- Modify: `shader_effects/manifest.json`

All three need the hash/noise snippet.

- [ ] **Step 1: `blocks.frag`** (flowing blocks of color)

```glsl
uniform float u_size;
uniform float u_flow;
uniform float u_speed;

void main() {
    vec2 asp = vec2(u_resolution.x / u_resolution.y, 1.0);
    vec2 p = v_texCoord * asp;
    vec2 g = floor(p / u_size);
    float t = u_time * u_speed;
    vec2 flow = vec2(
        vnoise(g * 0.35 + vec2(0.7, 0.3) * t, u_seed) - 0.5,
        vnoise(g * 0.35 + vec2(7.0, 7.0) - vec2(0.2, 0.6) * t, u_seed + 3.0) - 0.5
    ) * u_flow;
    vec2 cuv = ((g + 0.5) * u_size) / asp + flow;
    fragColor0 = vec4(texture(u_image0, clamp(cuv, 0.0, 1.0)).rgb, 1.0);
}
```

```json
{
  "id": "blocks", "name": "Blocks", "category": "stylize", "animated": true, "passes": 1,
  "centerParam": null, "textures": [],
  "params": [
    { "uniform": "u_size", "label": "Block Size", "type": "float", "min": 0.01, "max": 0.3, "default": 0.07, "step": 0.005 },
    { "uniform": "u_flow", "label": "Flow", "type": "float", "min": 0.0, "max": 0.5, "default": 0.15, "step": 0.01 },
    { "uniform": "u_speed", "label": "Speed", "type": "float", "min": 0.0, "max": 2.0, "default": 0.5, "step": 0.05 }
  ]
}
```

- [ ] **Step 2: `mondrian.frag`** (recursive random splits → per-rect displacement + borders)

```glsl
uniform float u_depth;
uniform float u_border;
uniform float u_wobble;
uniform float u_speed;

void main() {
    vec2 lo = vec2(0.0), hi = vec2(1.0);
    for (int i = 0; i < 8; i++) {
        if (float(i) >= u_depth) break;
        vec2 key = lo * 977.0 + hi * 389.0 + float(i);
        float h1 = hash2(key, u_seed);
        float ratio = mix(0.3, 0.7, hash2(key + 31.0, u_seed + 5.0));
        ratio += u_wobble * 0.15 * sin(u_time * u_speed * 6.2831853 + h1 * 6.2831853);
        ratio = clamp(ratio, 0.15, 0.85);
        if (h1 > 0.5) {
            float s = mix(lo.x, hi.x, ratio);
            if (v_texCoord.x < s) hi.x = s; else lo.x = s;
        } else {
            float s = mix(lo.y, hi.y, ratio);
            if (v_texCoord.y < s) hi.y = s; else lo.y = s;
        }
    }
    vec3 col = texture(u_image0, (lo + hi) * 0.5).rgb;
    vec2 dEdge = min(v_texCoord - lo, hi - v_texCoord) * u_resolution;
    float border = step(u_border * u_resolution.y, min(dEdge.x, dEdge.y));
    fragColor0 = vec4(col * border, 1.0);
}
```

```json
{
  "id": "mondrian", "name": "Mondrian", "category": "stylize", "animated": true, "passes": 1,
  "centerParam": null, "textures": [],
  "params": [
    { "uniform": "u_depth", "label": "Depth", "type": "float", "min": 2.0, "max": 8.0, "default": 5.0, "step": 1.0 },
    { "uniform": "u_border", "label": "Border", "type": "float", "min": 0.0, "max": 0.02, "default": 0.004, "step": 0.001 },
    { "uniform": "u_wobble", "label": "Wobble", "type": "float", "min": 0.0, "max": 1.0, "default": 0.3, "step": 0.05 },
    { "uniform": "u_speed", "label": "Speed", "type": "float", "min": 0.0, "max": 2.0, "default": 0.3, "step": 0.05 }
  ]
}
```

**Determinism warning:** the split keys (`lo*977 + hi*389 + i`) are floats fed to `hash2`, which floors them — splits land on non-integer coordinates, so two runtimes could floor differently at cell boundaries. If the Playwright parity test shows >6% outliers clustered on rectangle borders, quantize the key: `vec2 key = floor((lo * 977.0 + hi * 389.0) * 64.0) + float(i);` in the one shader source (fixes both runtimes at once), regenerate goldens, re-run.

- [ ] **Step 3: `recursive_grid.frag`** (fractal quadtree pixelation)

```glsl
uniform float u_size;
uniform float u_subdiv;
uniform float u_border;
uniform float u_speed;

void main() {
    vec2 asp = vec2(u_resolution.x / u_resolution.y, 1.0);
    vec2 p = v_texCoord * asp;
    float size = u_size;
    float tick = floor(u_time * u_speed * 2.0);
    vec2 cell = floor(p / size);
    for (int i = 0; i < 4; i++) {
        if (hash2(cell + float(i) * 1013.0 + tick * 101.0, u_seed) >= u_subdiv) break;
        size *= 0.5;
        cell = floor(p / size);
    }
    vec2 cuv = ((cell + 0.5) * size) / asp;
    vec3 col = texture(u_image0, clamp(cuv, 0.0, 1.0)).rgb;
    vec2 inCell = fract(p / size);
    vec2 dEdge = min(inCell, 1.0 - inCell) * size * u_resolution.y;
    float border = step(u_border * u_resolution.y, min(dEdge.x, dEdge.y));
    fragColor0 = vec4(col * border, 1.0);
}
```

```json
{
  "id": "recursive_grid", "name": "Recursive Grid", "category": "stylize", "animated": true, "passes": 1,
  "centerParam": null, "textures": [],
  "params": [
    { "uniform": "u_size", "label": "Cell Size", "type": "float", "min": 0.05, "max": 0.5, "default": 0.18, "step": 0.01 },
    { "uniform": "u_subdiv", "label": "Subdivide", "type": "float", "min": 0.0, "max": 1.0, "default": 0.55, "step": 0.05 },
    { "uniform": "u_border", "label": "Border", "type": "float", "min": 0.0, "max": 0.02, "default": 0.003, "step": 0.001 },
    { "uniform": "u_speed", "label": "Speed", "type": "float", "min": 0.0, "max": 2.0, "default": 0.4, "step": 0.05 }
  ]
}
```

- [ ] **Step 4: Regenerate goldens, run suites, eyeball, commit**

```bash
.venv/bin/python tests-unit/shaderfx_golden/generate_goldens.py
.venv/bin/python -m pytest tests-unit/comfy_extras_test/shader_effects_test.py -v
cd frontend && npx playwright test tests/shaderfx-golden.spec.ts --project=chromium
```

Expected: Playwright 28 parity tests (14 × 2) all green. Eyeball each new golden (Read tool): blocks = mosaic with displaced sampling, mondrian = irregular rectangles with black borders, recursive_grid = quadtree mosaic with mixed cell sizes.

```bash
git add shader_effects/ tests-unit/shaderfx_golden/
git commit -m "Shader effects: structural family (blocks, mondrian, recursive grid) — full v1 catalog"
```

---

### Task 16: Final verification + ship

- [ ] **Step 1: Full test sweep**

```bash
.venv/bin/python -m pytest tests-unit/comfy_extras_test/glsl_context_test.py tests-unit/comfy_extras_test/shader_effects_test.py -v
cd frontend && npx vitest run tests/unit/shaderfx-params.unit.spec.ts tests/unit/shaderfx-chain.unit.spec.ts
cd frontend && npx playwright test tests/shaderfx-golden.spec.ts --project=chromium
```

Expected: everything green. If any pre-existing suite is quick, run it too (`npx vitest run` whole unit dir) to catch collateral damage.

- [ ] **Step 2: End-to-end manual pass (the Unicorn test)**

Kill ComfyUI; with both servers up, verify in the app:
1. LoadImage → ShaderEffect(liquify) → ShaderEffect(ascii_dither) → SaveImage.
2. Select ascii node: stacked animated preview (liquid + ascii). Tweak liquify's Amount: ascii preview follows.
3. Drag swirl's center handle (swap effect briefly) — handle moves the vortex live.
4. Set duration=2, fps=12 on the final node, Run: output is a 24-frame batch; feed it to a video save/Timeline node and confirm motion matches the preview's character.
5. Open the picker: 14 thumbnails across distortion + stylize categories.
6. Performance: with 5+ ShaderEffect nodes on canvas, only the selected one consumes GPU (check no fan spin / Activity Monitor GPU idle when deselected).

- [ ] **Step 3: Update memory + design doc status**

Mark the design doc header `**Status:** v1 implemented` and update the project memory file (`project_shader_effects.md`) with: shipped state, calibrated parity numbers, and the CGL-backend fact (server GL now works on macOS via CGL).

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "Shader effects v1: 14 Unicorn-style effects, live preview + parity-tested server render"
```

---

## Self-review notes (kept for the executor)

- **Spec coverage:** catalog/single-source ✓ (Tasks 1, 4) · CGL/server render ✓ (0, 2) · node semantics incl. batch-vs-duration ✓ (3) · resolution-independent units ✓ (conventions + dual-size goldens) · one-GL-context rule ✓ (singleton renderer, Task 6) · selected-only animation ✓ (8) · chained previews + downstream refresh ✓ (9) · picker ✓ (10) · center handle / mouse story ✓ (11) · glyph atlas ✓ (12) · 14 effects ✓ (1, 13–15) · parity testing ✓ (5, 7) · error handling ✓ (compile-error test in 2, glError in 8, route guards in 4).
- **Known deliberate deviations from spec text:** the spec's "node acquires a GL context on select" is implemented as the strictly-better shared singleton renderer (the spec itself names this as the alternative); `passes` field exists but only single-pass shaders ship in v1 (per spec).
- **Type consistency spot-checks:** `walkShaderChain` returns `{passes, baseUrl, nodeIds}` and Task 8 consumes exactly those; `render_effect(jobs=[{image, uniforms}])` shape is identical in Tasks 2, 3, 5; golden constants (t=0.7, seed=42, sizes 128/256) match across Tasks 5, 7 and the python regression test.
- **Risk ordering:** Task 0 (server GL on mac) and Task 7 (parity gate) are the two go/no-go points; everything after Task 7 is low-risk volume work.



