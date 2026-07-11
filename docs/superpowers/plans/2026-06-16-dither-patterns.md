# Dither with patterns — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the single-pattern `bayer_dither` shaderfx effect into a Morflax-style "Dither" effect with a 12-entry pattern dropdown (ordered Bayer 2/4/8, clustered, scanline, diagonal, white/blue/R2 noise), backed by a baked blue-noise texture and a new enum-param capability in the shaderfx schema.

**Architecture:** `bayer_dither` keeps its id (back-compat) but gains a `u_pattern` enum param + a `u_blueNoise` texture. Enum params are added additively to the schema across Python (`_shader_effects.py`), the manifest, the frontend types/resolver, and both effect-param UIs. A committed offline script bakes the blue-noise PNG via void-and-cluster.

**Tech Stack:** GLSL ES 3.00 (renderer contract in `comfy_extras/_shader_effects.py` + `frontend/app/lib/shaderfx/renderer.ts`), Python (numpy/scipy/PIL, `.venv/bin/python`), Vue 3 + TS, Vitest (`npm run test:unit`), pytest (`.venv/bin/python -m pytest`).

**Reference files (read before starting):**
- Spec: `docs/superpowers/specs/2026-06-16-dither-patterns-design.md`
- `comfy_extras/_shader_effects.py` (EffectParam, load_catalog, resolve_params, render_effect)
- `comfy_extras/nodes_shader_effects.py` (`_load_effect_textures`, catalog route)
- `shader_effects/bayer_dither.frag`, `shader_effects/manifest.json`, `shader_effects/assets/`
- `tests-unit/shaderfx_golden/generate_goldens.py`
- `frontend/app/lib/shaderfx/{types.ts,params.ts}`, `frontend/tests/unit/shaderfx-params.unit.spec.ts`
- `frontend/app/components/vue-canvas/{ShaderEffectNode.vue,ShaderStudioSurface.vue}` (param loops)

**Conventions:** repo root `/Users/julien/Documents/GitHub/Sailor`. Python via `.venv/bin/python`. Frontend tests from `frontend/`: `npm run test:unit -- <file>`. No purple/violet accents in UI. Commit after each task. `bayer_dither` keeps its id; default `u_pattern=1` (Bayer 4×4) preserves the current look.

---

## Prerequisite: Isolated branch

The working tree shares a checkout with other agents. Before starting, create an isolated worktree off `feat/gradient-studio` HEAD (use `superpowers:using-git-worktrees`). Branch: `feat/dither-patterns`. All tasks run inside it.

---

## File structure

**Create:**
- `shader_effects/bake_blue_noise.py` — offline void-and-cluster → `assets/blue_noise.png`
- `shader_effects/assets/blue_noise.png` — committed asset (output of the script)
- `tests-unit/test_shader_effects_enum.py` — pytest for enum schema (Python)

**Modify:**
- `shader_effects/bayer_dither.frag` — 12-pattern threshold + blue-noise sampler
- `shader_effects/manifest.json` — `bayer_dither` entry: name "Dither", texture, `u_pattern` enum param
- `comfy_extras/_shader_effects.py` — `EffectParam` enum support; `load_catalog` validation; `resolve_params` snapping
- `frontend/app/lib/shaderfx/types.ts` — `EffectParamDef` enum
- `frontend/app/lib/shaderfx/params.ts` — `resolveUniforms` enum
- `frontend/tests/unit/shaderfx-params.unit.spec.ts` — enum tests
- `frontend/app/components/vue-canvas/ShaderEffectNode.vue` — `<select>` for enum params
- `frontend/app/components/vue-canvas/ShaderStudioSurface.vue` — `<select>` for enum params
- `tests-unit/shaderfx_golden/bayer_dither_128.png`, `_256.png` — regenerated goldens
- `tests-unit/shaderfx_golden/generate_goldens.py` — (no change expected; it already binds textures)

---

## Task 1: Bake the blue-noise texture

**Files:**
- Create: `shader_effects/bake_blue_noise.py`
- Create (generated): `shader_effects/assets/blue_noise.png`

- [ ] **Step 1: Write the bake script**

```python
# shader_effects/bake_blue_noise.py
"""Bake a tileable 64x64 blue-noise tile via Ulichney's void-and-cluster.

Run once (output committed): .venv/bin/python shader_effects/bake_blue_noise.py
Deterministic (seeded) so re-runs produce identical bytes. Needs numpy + scipy + PIL.
"""
import os
import numpy as np
from scipy.ndimage import gaussian_filter
from PIL import Image

SIZE = 64
SIGMA = 1.9  # energy spread; ~1.5-2.0 gives good blue-noise spectra at this size


def _energy(binary: np.ndarray) -> np.ndarray:
    # Toroidal gaussian energy of the binary point set.
    return gaussian_filter(binary.astype(np.float64), SIGMA, mode="wrap")


def void_and_cluster(size: int, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = size * size
    binary = np.zeros((size, size), dtype=bool)
    init = max(1, n // 10)
    binary.flat[rng.choice(n, init, replace=False)] = True

    # Phase 0: relax the initial pattern until tightest cluster == largest void.
    while True:
        c = int(np.where(binary, _energy(binary), -np.inf).argmax())
        binary.flat[c] = False
        v = int(np.where(~binary, _energy(binary), np.inf).argmin())
        binary.flat[v] = True
        if c == v:
            break

    rank = np.full(n, -1, dtype=np.int64)

    # Phase 1: rank the initial ones (remove tightest clusters), descending.
    work = binary.copy()
    ones = int(work.sum())
    for r in range(ones - 1, -1, -1):
        c = int(np.where(work, _energy(work), -np.inf).argmax())
        work.flat[c] = False
        rank[c] = r

    # Phase 2: rank the rest (fill largest voids), ascending.
    work = binary.copy()
    for r in range(ones, n):
        v = int(np.where(~work, _energy(work), np.inf).argmin())
        work.flat[v] = True
        rank[v] = r

    return rank.reshape(size, size)


def main() -> None:
    rank = void_and_cluster(SIZE, seed=12345)
    thresh = np.floor((rank + 0.5) / (SIZE * SIZE) * 256.0).clip(0, 255).astype(np.uint8)
    rgb = np.dstack([thresh, thresh, thresh])
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "blue_noise.png")
    Image.fromarray(rgb, "RGB").save(out)
    print(f"wrote {out}  ({SIZE}x{SIZE})")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it to generate the asset**

Run: `cd /Users/julien/Documents/GitHub/Sailor && .venv/bin/python shader_effects/bake_blue_noise.py`
Expected: prints `wrote .../assets/blue_noise.png  (64x64)`.

- [ ] **Step 3: Verify dimensions + determinism**

Run:
```bash
cd /Users/julien/Documents/GitHub/Sailor
.venv/bin/python -c "from PIL import Image; im=Image.open('shader_effects/assets/blue_noise.png'); print(im.size, im.mode)"
md5 shader_effects/assets/blue_noise.png
.venv/bin/python shader_effects/bake_blue_noise.py >/dev/null && md5 shader_effects/assets/blue_noise.png
```
Expected: `(64, 64) RGB`, and the two md5 hashes are identical (deterministic). (On Linux use `md5sum` instead of `md5`.)

- [ ] **Step 4: Commit**

```bash
git add shader_effects/bake_blue_noise.py shader_effects/assets/blue_noise.png
git commit -m "feat(dither): bake tileable blue-noise texture (void-and-cluster)"
```

---

## Task 2: Enum param support — Python

**Files:**
- Modify: `comfy_extras/_shader_effects.py:19-27` (EffectParam), `:72-75` (load_catalog validation), `:93-110` (resolve_params)
- Test: `tests-unit/test_shader_effects_enum.py`

- [ ] **Step 1: Write the failing test**

```python
# tests-unit/test_shader_effects_enum.py
import os
import sys
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.modules.setdefault("nodes", MagicMock())

from comfy_extras._shader_effects import EffectParam, Effect, resolve_params


def _enum_effect():
    p_enum = EffectParam(
        uniform="u_pattern", label="Pattern", type="enum", default=1.0,
        options=[{"label": "A", "value": 0}, {"label": "B", "value": 1}, {"label": "C", "value": 2}],
    )
    p_float = EffectParam(uniform="u_scale", label="Scale", type="float", min=1.0, max=10.0, default=4.0, step=1.0)
    return Effect(id="t", name="T", category="stylize", animated=False, passes=1,
                  center_param=None, textures=[], params=[p_enum, p_float], source="")


def test_enum_default_when_missing():
    out = resolve_params(_enum_effect(), "{}")
    assert out["u_pattern"] == 1.0
    assert out["u_scale"] == 4.0


def test_enum_keeps_valid_value():
    out = resolve_params(_enum_effect(), '{"u_pattern": 2}')
    assert out["u_pattern"] == 2.0


def test_enum_falls_back_to_default_on_invalid():
    out = resolve_params(_enum_effect(), '{"u_pattern": 99}')
    assert out["u_pattern"] == 1.0


def test_float_still_clamps():
    out = resolve_params(_enum_effect(), '{"u_scale": 999}')
    assert out["u_scale"] == 10.0
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/julien/Documents/GitHub/Sailor && .venv/bin/python -m pytest tests-unit/test_shader_effects_enum.py -q`
Expected: FAIL — `EffectParam.__init__` got an unexpected keyword `options` (and missing min/max/step).

- [ ] **Step 3: Update `EffectParam`, `load_catalog`, `resolve_params`**

In `comfy_extras/_shader_effects.py`, replace the `EffectParam` dataclass (currently lines ~19-27):

```python
@dataclass
class EffectParam:
    uniform: str
    label: str
    type: str
    default: float
    min: float = 0.0
    max: float = 0.0
    step: float = 0.0
    options: list[dict] | None = None
```

In `load_catalog`, replace the validation loop (currently lines ~73-75):

```python
        for p in params:
            if p.type == "enum":
                values = [o["value"] for o in (p.options or [])]
                if not values:
                    raise ValueError(f"shader_effects {eid!r}: enum {p.uniform} has no options")
                if p.default not in values:
                    raise ValueError(f"shader_effects {eid!r}: enum default for {p.uniform} not an option")
            elif not (p.min <= p.default <= p.max):
                raise ValueError(f"shader_effects {eid!r}: default for {p.uniform} outside [min, max]")
```

In `resolve_params`, replace the per-param loop body (currently lines ~103-109):

```python
    out: dict[str, float] = {}
    for p in effect.params:
        v = user.get(p.uniform, p.default)
        try:
            v = float(v)
        except (TypeError, ValueError):
            v = p.default
        if p.type == "enum":
            values = [float(o["value"]) for o in (p.options or [])]
            out[p.uniform] = v if v in values else float(p.default)
        else:
            out[p.uniform] = min(max(v, p.min), p.max)
    return out
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/julien/Documents/GitHub/Sailor && .venv/bin/python -m pytest tests-unit/test_shader_effects_enum.py -q`
Expected: PASS (4 tests).

- [ ] **Step 5: Confirm the existing catalog still loads (float effects unaffected)**

Run:
```bash
cd /Users/julien/Documents/GitHub/Sailor
.venv/bin/python -c "import sys; from unittest.mock import MagicMock; sys.modules.setdefault('nodes', MagicMock()); from comfy_extras._shader_effects import load_catalog; c=load_catalog(refresh=True); print('effects:', len(c.effects))"
```
Expected: prints `effects: 49` (loads with no error — float params still validate).

- [ ] **Step 6: Commit**

```bash
git add comfy_extras/_shader_effects.py tests-unit/test_shader_effects_enum.py
git commit -m "feat(dither): enum param support in shaderfx Python schema"
```

---

## Task 3: Enum param support — frontend

**Files:**
- Modify: `frontend/app/lib/shaderfx/types.ts:1-9` (EffectParamDef)
- Modify: `frontend/app/lib/shaderfx/params.ts:13-21` (resolveUniforms)
- Test: `frontend/tests/unit/shaderfx-params.unit.spec.ts`

- [ ] **Step 1: Add the failing test**

Append to `frontend/tests/unit/shaderfx-params.unit.spec.ts`:

```ts
const enumEff: EffectDef = {
  id: 'd', name: 'Dither', category: 'stylize', animated: false, passes: 1,
  centerParam: null, textures: [], source: '',
  params: [
    { uniform: 'u_pattern', label: 'Pattern', type: 'enum', default: 1,
      options: [{ label: 'A', value: 0 }, { label: 'B', value: 1 }, { label: 'C', value: 2 }] },
    { uniform: 'u_scale', label: 'Scale', type: 'float', min: 1, max: 10, default: 4, step: 1 },
  ],
}

describe('shaderfx params — enum', () => {
  it('defaults the enum when missing', () => {
    expect(resolveUniforms(enumEff, {})).toEqual({ u_pattern: 1, u_scale: 4 })
  })
  it('keeps a valid enum value and clamps floats', () => {
    const u = resolveUniforms(enumEff, { u_pattern: 2, u_scale: 999 })
    expect(u.u_pattern).toBe(2)
    expect(u.u_scale).toBe(10)
  })
  it('falls back to default on invalid enum value', () => {
    expect(resolveUniforms(enumEff, { u_pattern: 99 }).u_pattern).toBe(1)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npm run test:unit -- shaderfx-params`
Expected: FAIL — TS/`options` not on `EffectParamDef`, and enum not handled.

- [ ] **Step 3: Update the type**

In `frontend/app/lib/shaderfx/types.ts`, replace `EffectParamDef` (lines 1-9):

```ts
export interface EffectParamDef {
  uniform: string
  label: string
  type: 'float' | 'enum'
  min?: number
  max?: number
  default: number
  step?: number
  options?: { label: string; value: number }[]
}
```

- [ ] **Step 4: Update `resolveUniforms`**

In `frontend/app/lib/shaderfx/params.ts`, replace the loop in `resolveUniforms` (lines ~14-20):

```ts
  for (const p of eff.params) {
    const raw = overrides[p.uniform]
    if (p.type === 'enum') {
      const values = (p.options ?? []).map(o => o.value)
      out[p.uniform] = typeof raw === 'number' && values.includes(raw) ? raw : p.default
    } else {
      const v = typeof raw === 'number' && Number.isFinite(raw) ? raw : p.default
      out[p.uniform] = Math.min(Math.max(v, p.min ?? -Infinity), p.max ?? Infinity)
    }
  }
```

- [ ] **Step 5: Run it to verify it passes**

Run: `cd frontend && npm run test:unit -- shaderfx-params`
Expected: PASS (original 3 tests + 3 new).

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/shaderfx/types.ts frontend/app/lib/shaderfx/params.ts frontend/tests/unit/shaderfx-params.unit.spec.ts
git commit -m "feat(dither): enum param support in shaderfx frontend schema"
```

---

## Task 4: Dither shader + manifest

**Files:**
- Modify: `shader_effects/bayer_dither.frag` (full rewrite)
- Modify: `shader_effects/manifest.json` (the `bayer_dither` entry)

- [ ] **Step 1: Rewrite the shader**

Replace the entire contents of `shader_effects/bayer_dither.frag`:

```glsl
#version 300 es
precision highp float;
uniform sampler2D u_image0;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_seed;
in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor0;

uniform float u_scale;
uniform float u_levels;
uniform float u_colored;
uniform float u_pattern;
uniform sampler2D u_blueNoise;

const int BN = 64; // blue-noise tile size (matches bake_blue_noise.py SIZE)

const int B2[4] = int[4](0, 2, 3, 1);
const int B4[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
const int B8[64] = int[64](
   0, 32,  8, 40,  2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26,
  12, 44,  4, 36, 14, 46,  6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
   3, 35, 11, 43,  1, 33,  9, 41, 51, 19, 59, 27, 49, 17, 57, 25,
  15, 47,  7, 39, 13, 45,  5, 37, 63, 31, 55, 23, 61, 29, 53, 21);
const int CL8[64] = int[64](
  24, 10, 12, 26, 35, 47, 49, 37,
   8,  0,  2, 14, 45, 59, 61, 51,
  22,  6,  4, 16, 43, 57, 63, 53,
  30, 20, 18, 28, 33, 41, 55, 39,
  34, 46, 48, 38, 25, 11, 13, 27,
  44, 58, 60, 50,  9,  1,  3, 15,
  42, 56, 62, 52, 23,  7,  5, 17,
  32, 40, 54, 36, 31, 21, 19, 29);

int imod(int a, int b) { int r = a - (a / b) * b; return r < 0 ? r + b : r; }

uint pcg(uint v) { v = v * 747796405u + 2891336453u; uint w = ((v >> ((v >> 28) + 4u)) ^ v) * 277803737u; return (w >> 22) ^ w; }
float ihash(ivec2 p) { uint h = pcg(uint(p.x) * 73856093u ^ pcg(uint(p.y) * 19349663u)); return float(h & 0xffffffu) / 16777216.0; }

float blueAt(ivec2 c, float s) {
  ivec2 p = ivec2(floor(vec2(c) / s));
  return texelFetch(u_blueNoise, ivec2(imod(p.x, BN), imod(p.y, BN)), 0).r;
}

float ditherThreshold(ivec2 c, int pat) {
  if (pat == 0) return (float(B2[imod(c.y, 2) * 2 + imod(c.x, 2)]) + 0.5) / 4.0;
  if (pat == 1) return (float(B4[imod(c.y, 4) * 4 + imod(c.x, 4)]) + 0.5) / 16.0;
  if (pat == 2) return (float(B8[imod(c.y, 8) * 8 + imod(c.x, 8)]) + 0.5) / 64.0;
  if (pat == 3) return (float(CL8[imod(c.y, 8) * 8 + imod(c.x, 8)]) + 0.5) / 64.0;
  if (pat == 4) return (float(imod(c.y, 4)) + 0.5) / 4.0;
  if (pat == 5) return (float(imod(c.x + c.y, 4)) + 0.5) / 4.0;
  if (pat == 6) return ihash(c);
  if (pat == 7) return ihash(c / 2);
  if (pat == 8) return blueAt(c, 1.0);
  if (pat == 9) return blueAt(c, 2.0);
  if (pat == 10) return blueAt(c, 0.5);
  return fract(float(c.x) * 0.7548776662 + float(c.y) * 0.5698402910);
}

void main() {
  float cell = max(u_scale * u_resolution.y, 1.0);
  ivec2 dc = ivec2(floor(v_texCoord * u_resolution / cell));
  vec2 cuv = (vec2(dc) + 0.5) * cell / u_resolution;
  vec3 src = texture(u_image0, clamp(cuv, 0.0, 1.0)).rgb;

  int pat = int(u_pattern + 0.5);
  float L = max(u_levels, 2.0) - 1.0;
  float th = ditherThreshold(dc, pat) - 0.5;
  if (u_colored > 0.5) {
    vec3 col = floor(src * L + th + 0.5) / L;
    fragColor0 = vec4(clamp(col, 0.0, 1.0), 1.0);
  } else {
    float lum = dot(src, vec3(0.299, 0.587, 0.114));
    float q = floor(lum * L + th + 0.5) / L;
    fragColor0 = vec4(vec3(clamp(q, 0.0, 1.0)), 1.0);
  }
}
```

Notes: pattern 1 reproduces the old `bayer()` exactly (default look unchanged). All randomness uses integer `pcg`/`texelFetch` (no `sin`-hash) so the CGL (server) and WebGL2 (browser) runtimes stay bit-stable. `B8`/`CL8` are flattened into single 64-int arrays (the previous shader used a 16-int Bayer; the formatting above is one contiguous `int[64]`).

- [ ] **Step 2: Update the manifest entry**

In `shader_effects/manifest.json`, find the `bayer_dither` effect object and replace it with (keep its position in the array):

```json
    {
      "id": "bayer_dither",
      "name": "Dither",
      "category": "stylize",
      "animated": false,
      "passes": 1,
      "centerParam": null,
      "textures": [
        { "uniform": "u_blueNoise", "file": "blue_noise.png" }
      ],
      "generative": false,
      "params": [
        {
          "uniform": "u_pattern",
          "label": "Pattern",
          "type": "enum",
          "default": 1,
          "options": [
            { "label": "Coarse 2×2", "value": 0 },
            { "label": "Bayer 4×4", "value": 1 },
            { "label": "Fine 8×8", "value": 2 },
            { "label": "Clustered", "value": 3 },
            { "label": "Scanline", "value": 4 },
            { "label": "Diagonal", "value": 5 },
            { "label": "White Noise", "value": 6 },
            { "label": "Noise 2×", "value": 7 },
            { "label": "Blue Noise", "value": 8 },
            { "label": "Blue Noise 2×", "value": 9 },
            { "label": "Blue Noise 0.5×", "value": 10 },
            { "label": "R2 Noise", "value": 11 }
          ]
        },
        { "uniform": "u_scale", "label": "Size", "type": "float", "min": 0.003, "max": 0.05, "default": 0.01, "step": 0.001 },
        { "uniform": "u_levels", "label": "Levels", "type": "float", "min": 2.0, "max": 8.0, "default": 3.0, "step": 1.0 },
        { "uniform": "u_colored", "label": "Colored", "type": "float", "min": 0.0, "max": 1.0, "default": 1.0, "step": 1.0 }
      ]
    }
```

(`×` is the × character; using the escape keeps the JSON ASCII-safe. A literal `×` is also fine.)

- [ ] **Step 3: Verify the catalog loads + the shader renders all 12 patterns server-side**

Run:
```bash
cd /Users/julien/Documents/GitHub/Sailor
.venv/bin/python -c "
import sys, numpy as np
from unittest.mock import MagicMock
sys.modules.setdefault('nodes', MagicMock())
from PIL import Image
from comfy_extras._shader_effects import load_catalog, render_effect, resolve_params, ASSETS_DIR
import os
c = load_catalog(refresh=True)
e = c.effects['bayer_dither']
assert e.name == 'Dither', e.name
tex = {'u_blueNoise': np.asarray(Image.open(os.path.join(ASSETS_DIR,'blue_noise.png')).convert('RGBA'), np.float32)/255.0}
fix = np.random.default_rng(0).random((64,64,3)).astype(np.float32)
outs = []
for pat in range(12):
    u = resolve_params(e, '{\"u_pattern\": %d}' % pat)
    job = [{'image': fix, 'uniforms': {**u, 'u_time':0.0,'u_seed':42.0,'u_hasInput':1.0}}]
    o = render_effect(e.source, 64, 64, job, extra_textures=tex, passes=e.passes)[0]
    assert np.isfinite(o).all(), pat
    outs.append(o)
# patterns must be distinct from each other (no two identical)
import itertools
for a,b in itertools.combinations(range(12),2):
    assert not np.allclose(outs[a], outs[b]), (a,b)
print('all 12 patterns render, finite, and distinct')
"
```
Expected: `all 12 patterns render, finite, and distinct`. (This proves the GLSL compiles server-side for every pattern and that each pattern produces different output. If it fails to compile, the error names the bad line.)

- [ ] **Step 4: Commit**

```bash
git add shader_effects/bayer_dither.frag shader_effects/manifest.json
git commit -m "feat(dither): 12-pattern Dither shader + manifest enum param"
```

---

## Task 5: Regenerate goldens

**Files:**
- Modify (regenerated): `tests-unit/shaderfx_golden/bayer_dither_128.png`, `tests-unit/shaderfx_golden/bayer_dither_256.png`

The golden generator binds manifest textures, so it now binds `blue_noise.png` for `bayer_dither`. Goldens render at the default pattern (Bayer 4×4).

- [ ] **Step 1: Regenerate all goldens**

Run: `cd /Users/julien/Documents/GitHub/Sailor && .venv/bin/python tests-unit/shaderfx_golden/generate_goldens.py`
Expected: prints `golden: <id>_<size>.png` for every effect, including `bayer_dither_128.png` and `_256.png`.

- [ ] **Step 2: Confirm only bayer_dither goldens changed**

Run: `cd /Users/julien/Documents/GitHub/Sailor && git status --short tests-unit/shaderfx_golden/`
Expected: only `bayer_dither_128.png` and `bayer_dither_256.png` show as modified (other effects' shaders/params are untouched, so their goldens regenerate identically). If other goldens changed, STOP and investigate — nothing else should have moved.

- [ ] **Step 3: Commit**

```bash
git add tests-unit/shaderfx_golden/bayer_dither_128.png tests-unit/shaderfx_golden/bayer_dither_256.png
git commit -m "test(dither): regenerate Dither goldens (shader rewritten)"
```

---

## Task 6: UI dropdowns for enum params

**Files:**
- Modify: `frontend/app/components/vue-canvas/ShaderEffectNode.vue` (param loop, ~lines 418-428)
- Modify: `frontend/app/components/vue-canvas/ShaderStudioSurface.vue` (param loop, ~lines 261-263)

- [ ] **Step 1: ShaderEffectNode.vue — render enum as a select**

In `frontend/app/components/vue-canvas/ShaderEffectNode.vue`, replace the param-loop block (the `<div v-for="p in effectDef?.params ?? []" :key="p.uniform"> ... </div>` that contains the range input) with:

```vue
      <div v-for="p in effectDef?.params ?? []" :key="p.uniform">
        <label class="text-[9px] text-muted-foreground tracking-normal mb-0.5 block">{{ p.label }}</label>
        <select
          v-if="p.type === 'enum'"
          class="nopan nodrag w-full px-2 py-1 rounded border border-white/10 bg-white/[0.04] hover:border-white/20 text-[11px] text-white/85 outline-none cursor-pointer"
          :value="uniforms[p.uniform]"
          @change="setParam(p.uniform, Number(($event.target as HTMLSelectElement).value))"
        >
          <option v-for="o in p.options" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <template v-else>
          <div class="flex items-center justify-between mb-0.5">
            <span class="text-[9px] text-white/45 tabular-nums">{{ (uniforms[p.uniform] ?? 0).toFixed(2) }}</span>
          </div>
          <input
            type="range" class="nopan nodrag w-full accent-white" :min="p.min" :max="p.max" :step="p.step"
            :value="uniforms[p.uniform]"
            @input="setParam(p.uniform, Number(($event.target as HTMLInputElement).value))"
          />
        </template>
      </div>
```

(Note: the existing block has the label and value on one row; the rewrite keeps the label, shows the numeric value only for sliders, and shows a `<select>` for enums. Match the file's surrounding indentation.)

- [ ] **Step 2: ShaderStudioSurface.vue — render enum as a select**

In `frontend/app/components/vue-canvas/ShaderStudioSurface.vue`, replace the effect-param loop (the `<div v-for="p in effectDef?.params ?? []" :key="p.uniform"> ... </div>` containing the range input, ~lines 261-263) with:

```vue
        <div v-for="p in effectDef?.params ?? []" :key="p.uniform">
          <label class="mb-0.5 flex justify-between text-[11px] text-white/60">
            <span>{{ p.label }}</span>
            <span v-if="p.type !== 'enum'" class="text-white/40">{{ (effectUniforms[p.uniform] ?? 0).toFixed(2) }}</span>
          </label>
          <select
            v-if="p.type === 'enum'"
            class="mb-2 w-full rounded bg-white/10 px-2 py-1 text-xs"
            :value="effectUniforms[p.uniform]"
            @change="setParam(p.uniform, Number(($event.target as HTMLSelectElement).value))"
          >
            <option v-for="o in p.options" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
          <input
            v-else type="range" class="mb-2 w-full accent-white" :min="p.min" :max="p.max" :step="p.step"
            :value="effectUniforms[p.uniform]" @input="setParam(p.uniform, Number(($event.target as HTMLInputElement).value))"
          />
        </div>
```

- [ ] **Step 3: Verify imports/types still compile**

Run: `cd frontend && npm run test:unit -- shaderfx-params shaderstudio`
Expected: PASS (the lib the components import is type-clean; this catches a broken `p.options`/`p.type` reference).

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/vue-canvas/ShaderEffectNode.vue frontend/app/components/vue-canvas/ShaderStudioSurface.vue
git commit -m "feat(dither): enum param dropdown in ShaderEffect + Shader Studio UIs"
```

---

## Task 7: Full suites green

- [ ] **Step 1: Python**

Run: `cd /Users/julien/Documents/GitHub/Sailor && .venv/bin/python -m pytest tests-unit/test_shader_effects_enum.py -q`
Expected: PASS (4).

- [ ] **Step 2: Golden regression (server render == committed goldens)**

If the golden pytest exists, run it; otherwise re-run the generator and confirm git shows no diff (idempotent):
```bash
cd /Users/julien/Documents/GitHub/Sailor
.venv/bin/python tests-unit/shaderfx_golden/generate_goldens.py >/dev/null
git status --short tests-unit/shaderfx_golden/
```
Expected: empty output (regeneration is deterministic; goldens already committed in Task 5).

- [ ] **Step 3: Frontend unit suite**

Run: `cd frontend && npm run test:unit`
Expected: same pass/fail profile as before this feature (the pre-existing `spacetype-effect.unit.spec.ts > gradientMode` failure is unrelated and predates this work; everything else green, including the new enum tests).

- [ ] **Step 4: Commit (only if fixes were needed)**

```bash
git add -A && git commit -m "test(dither): suites green"
```

---

## Task 8: In-app verification

Manual (GPU/preview-gated). Start servers per `CLAUDE.md`:
- `cd frontend && npm run dev`
- `cd /Users/julien/Documents/GitHub/Sailor && .venv/bin/python main.py --listen 127.0.0.1 --port 8188` (restart ComfyUI so the rewritten shader + manifest reload)

- [ ] **Step 1:** Add a **ShaderEffect** node, pick "Dither" — confirm a **Pattern** dropdown appears with all 12 entries, plus Size/Levels/Colored sliders.
- [ ] **Step 2:** Switch through all 12 patterns — confirm each renders distinctly; the three Blue Noise variants look like smooth blue-noise grain (not blocky/white), differing in grain scale.
- [ ] **Step 3:** In **Shader Studio**, open the Stylized Effects picker, pick Dither — confirm the same Pattern dropdown in the surface; enable **Duotone** and confirm the dither + ink/paper look matches the Morflax comp.
- [ ] **Step 4:** Queue/execute a graph with the Dither ShaderEffect node on a real image — confirm the saved output matches the preview (server == browser) for a couple of patterns including a Blue Noise one.
- [ ] **Step 5:** Note any issues; fix source + re-verify from the relevant step.

---

## Task 9: Finish the branch

- [ ] **Step 1:** Use `superpowers:finishing-a-development-branch`.
- [ ] **Step 2:** Update memory: append the Dither-patterns work to `project_shader_studio.md` (or a short note under [[project-shader-effects]]) — enum param support + 12-pattern Dither + baked blue-noise asset.

---

## Spec coverage self-check

- 12 patterns faithful → Task 4 shader + manifest options. ✓
- Enum schema (Python + frontend + both UIs) → Tasks 2, 3, 6. ✓
- Baked blue-noise texture (void-and-cluster, committed PNG, manifest texture) → Task 1 + Task 4 manifest. ✓
- Keep id `bayer_dither`, name "Dither", default pattern 1 → Task 4. ✓
- Color Mode = existing Duotone pass (no effect change) → confirmed (no color logic added). ✓
- Goldens regenerated → Task 5. ✓
- Per-pattern correctness: the spec proposed a browser parity test; this plan refines it to a **Python per-pattern render test** (Task 4 Step 3: all 12 compile + finite + distinct) plus **in-app browser spot-check** (Task 8), since the existing browser-parity harness only covers default params and a bespoke 12-pattern Playwright addition is gated/heavy. Integer-only hashing in the shader keeps server/browser bit-stable, making the default-pattern parity (already in the suite) representative. ✓
- No purple accents → UI uses neutral/white-opacity selects. ✓

**Non-goals:** enum on other effects; continuous noise-scale slider; color modes in the effect; id rename.
