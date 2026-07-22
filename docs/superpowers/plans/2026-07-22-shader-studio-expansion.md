# Shader Studio Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two new distortion shaders (`fbm_warp`, `flag`), un-hide the 11 generative effects in the Shader Studio picker, and add opt-in category sections to the shared `CatalogModal`.

**Architecture:** Effects are one `.frag` + one entry in `shader_effects/manifest.json`, auto-discovered by the backend catalog route (page reload, no server restart). UI changes live in `frontend/app/components/CatalogModal.vue` (shared, opt-in sections) and `frontend/app/components/vue-canvas/ShaderStudioSurface.vue` (drop generative filter, adopt sections).

**Tech Stack:** GLSL ES 3.0, Vue 3 + TS (Nuxt 4), pytest (server GL parity), Playwright (browser golden parity).

**Spec:** `docs/superpowers/specs/2026-07-22-shader-studio-expansion-design.md`

## Global Constraints

- House shader boilerplate: `#version 300 es`, `precision highp float`, `u_image0/u_resolution/u_time/u_seed`, `in vec2 v_texCoord`, `layout(location = 0) out vec4 fragColor0`, `pcg`-based hashing, clamped texture lookups.
- Do NOT regenerate or commit changes to existing golden PNGs; `crystal_prism` golden is pre-broken — never "fix" it here.
- The working tree has other sessions' dirty files — stage ONLY files this plan names. Never `git stash`. Commit straight to `main`.
- Dev servers already run under this session: frontend `http://127.0.0.1:3000`, ComfyUI `http://127.0.0.1:8188` (use 127.0.0.1, never `localhost`).
- Backend tests: `.venv/bin/python -m pytest <file> -q` from repo root. Frontend unit: `cd frontend && npx vitest run <file>`.

---

### Task 1: `fbm_warp` effect

**Files:**
- Create: `shader_effects/fbm_warp.frag`
- Modify: `shader_effects/manifest.json` (append one entry to the `effects` array)
- Test: `tests-unit/comfy_extras_test/shader_effects_test.py` (existing suite must pass), goldens via `tests-unit/shaderfx_golden/generate_goldens.py`

**Interfaces:**
- Produces: manifest id `fbm_warp` (category `distortion`) — Task 5 verifies it in the picker's Distortion section.

- [ ] **Step 1: Write the shader**

Create `shader_effects/fbm_warp.frag`:

```glsl
#version 300 es
precision highp float;
uniform sampler2D u_image0;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_seed;
in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor0;

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

uniform float u_amount;
uniform float u_scale;
uniform float u_warp;
uniform float u_detail;
uniform float u_speed;

// FBM with parameterized octave falloff, normalized so the output stays in
// [0,1] regardless of the falloff — keeps u_amount calibrated.
float fbmF(vec2 p, float seed, float falloff) {
    float v = 0.0, a = 0.5, norm = 0.0;
    for (int i = 0; i < 5; i++) {
        v += a * vnoise(p, seed + float(i) * 17.0);
        norm += a;
        p *= 2.03;
        a *= falloff;
    }
    return v / norm;
}

void main() {
    vec2 asp = vec2(u_resolution.x / u_resolution.y, 1.0);
    vec2 p = (v_texCoord - 0.5) * asp * u_scale;
    float t = u_time * u_speed * 0.2;
    float falloff = mix(0.35, 0.65, u_detail);

    // Two-stage domain warp (q feeds r) — the marbled wet-paint melt that
    // noise_distortion's single-stage offset can't reach.
    vec2 q = vec2(fbmF(p + vec2(0.0, t), u_seed, falloff),
                  fbmF(p + vec2(3.7, -t), u_seed + 5.0, falloff));
    vec2 r = vec2(fbmF(p + u_warp * q + vec2(1.7, 9.2) + t * 0.35, u_seed + 17.0, falloff),
                  fbmF(p + u_warp * q + vec2(8.3, 2.8) - t * 0.25, u_seed + 29.0, falloff));

    vec2 disp = (r - 0.5) * 2.0 * u_amount;
    fragColor0 = vec4(texture(u_image0, clamp(v_texCoord + disp, 0.0, 1.0)).rgb, 1.0);
}
```

- [ ] **Step 2: Add the manifest entry**

Append to the `effects` array in `shader_effects/manifest.json` (match neighbors' JSON style exactly):

```json
{
  "id": "fbm_warp",
  "name": "FBM Warp",
  "category": "distortion",
  "animated": true,
  "passes": 1,
  "centerParam": null,
  "textures": [],
  "params": [
    { "uniform": "u_amount", "label": "Amount", "type": "float", "min": 0.0, "max": 0.5, "default": 0.12, "step": 0.005 },
    { "uniform": "u_scale", "label": "Scale", "type": "float", "min": 0.5, "max": 8.0, "default": 3.0, "step": 0.25 },
    { "uniform": "u_warp", "label": "Warp", "type": "float", "min": 0.0, "max": 4.0, "default": 2.0, "step": 0.1 },
    { "uniform": "u_detail", "label": "Detail", "type": "float", "min": 0.0, "max": 1.0, "default": 0.5, "step": 0.05 },
    { "uniform": "u_speed", "label": "Speed", "type": "float", "min": 0.0, "max": 3.0, "default": 0.6, "step": 0.05 }
  ]
}
```

- [ ] **Step 3: Run the catalog test suite**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/shader_effects_test.py -q`
Expected: all pass (the loader validates every manifest entry; a typo fails here).

- [ ] **Step 4: Bake goldens for the new effect only**

Run: `.venv/bin/python tests-unit/shaderfx_golden/generate_goldens.py`
Then: `git status --porcelain tests-unit/shaderfx_golden/` — expect ONLY new files `fbm_warp_128.png`, `fbm_warp_256.png` (plus, after Task 2, `flag_*.png`). If any EXISTING golden shows as modified, restore it: `git checkout -- tests-unit/shaderfx_golden/<file>`.

- [ ] **Step 5: Eyeball the golden**

Open `tests-unit/shaderfx_golden/fbm_warp_256.png` (Read tool). Expected: the test-card fixture visibly melted/marbled — smeared gradients, warped disc edges. If it looks like faint jitter, u_warp/u_amount defaults are too timid — fix the shader or defaults, re-run Step 4.

- [ ] **Step 6: Commit**

```bash
git add shader_effects/fbm_warp.frag shader_effects/manifest.json tests-unit/shaderfx_golden/fbm_warp_128.png tests-unit/shaderfx_golden/fbm_warp_256.png
git commit -m "feat(shaderfx): FBM Warp — two-stage domain-warped image melt"
```

---

### Task 2: `flag` effect

**Files:**
- Create: `shader_effects/flag.frag`
- Modify: `shader_effects/manifest.json` (append one entry)
- Test: same harness as Task 1

**Interfaces:**
- Produces: manifest id `flag` (category `distortion`), enum uniform `u_anchor` (0 none / 1 left / 2 right / 3 top / 4 bottom).

- [ ] **Step 1: Write the shader**

Create `shader_effects/flag.frag`:

```glsl
#version 300 es
precision highp float;
uniform sampler2D u_image0;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_seed;
in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor0;

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
float fbm3(vec2 p, float seed) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 3; i++) { v += a * vnoise(p, seed + float(i) * 17.0); p *= 2.03; a *= 0.5; }
    return v;
}

uniform float u_anchor;     // 0 none · 1 left · 2 right · 3 top · 4 bottom
uniform float u_amplitude;
uniform float u_frequency;
uniform float u_speed;
uniform float u_gust;
uniform float u_shading;

void main() {
    int anchor = int(u_anchor + 0.5);
    vec2 uv = v_texCoord;

    // s runs 0 at the anchored edge -> 1 at the free edge; displacement is
    // perpendicular to the wind axis. Horizontal anchors wave along x and
    // displace y; vertical anchors wave along y and displace x.
    float s, across;
    vec2 dispAxis, windAxis;
    if (anchor == 3 || anchor == 4) {
        s = (anchor == 3) ? uv.y : 1.0 - uv.y;
        across = uv.x;
        dispAxis = vec2(1.0, 0.0);
        windAxis = (anchor == 3) ? vec2(0.0, 1.0) : vec2(0.0, -1.0);
    } else {
        s = (anchor == 2) ? 1.0 - uv.x : uv.x;
        across = uv.y;
        dispAxis = vec2(0.0, 1.0);
        windAxis = (anchor == 2) ? vec2(-1.0, 0.0) : vec2(1.0, 0.0);
    }
    float env = (anchor == 0) ? 0.75 : smoothstep(0.0, 1.0, s);

    float t = u_time * u_speed;
    // Gust: slow FBM wobble travelling with the wind, so the wave never loops
    // robotically. Centered on 0.
    float gust = (fbm3(vec2(s * 2.0 - t * 0.7, across * 2.0), u_seed) - 0.5) * 2.0;
    float phase = s * u_frequency * 6.2831853 - t * 6.2831853
                + u_gust * gust * 2.0 + across * 0.9;
    // Primary wave + half-frequency harmonic; /1.5 keeps the sum in [-1,1].
    float wave = (sin(phase) + 0.5 * sin(phase * 0.5 + 1.7)) / 1.5;

    vec2 off = dispAxis * wave * env * u_amplitude;
    if (anchor != 0) {
        // Gravity sag toward the free edge (horizontal flags droop down;
        // vertical flags get a slight symmetric belly via the same term on x).
        float sag = 0.35 * u_amplitude * s * s;
        off += (anchor == 3 || anchor == 4) ? vec2(sag * 0.4, 0.0) : vec2(0.0, sag);
        // Fold compression: bunch the cloth along the wind on wave slopes.
        off += windAxis * (0.25 * u_amplitude * cos(phase) * env);
    }

    vec3 img = texture(u_image0, clamp(uv + off, 0.0, 1.0)).rgb;
    // Cloth shading from the wave slope — bright faces toward the light on
    // rising slopes, shadowed folds on falling ones.
    float light = 1.0 + u_shading * 0.45 * cos(phase) * env;
    fragColor0 = vec4(clamp(img * light, 0.0, 1.0), 1.0);
}
```

- [ ] **Step 2: Add the manifest entry**

Append to `shader_effects/manifest.json`:

```json
{
  "id": "flag",
  "name": "Flag",
  "category": "distortion",
  "animated": true,
  "passes": 1,
  "centerParam": null,
  "textures": [],
  "params": [
    { "uniform": "u_anchor", "label": "Anchor", "type": "enum", "default": 1, "options": [
      { "label": "None (billow)", "value": 0 },
      { "label": "Left", "value": 1 },
      { "label": "Right", "value": 2 },
      { "label": "Top", "value": 3 },
      { "label": "Bottom", "value": 4 }
    ] },
    { "uniform": "u_amplitude", "label": "Amplitude", "type": "float", "min": 0.0, "max": 0.25, "default": 0.08, "step": 0.005 },
    { "uniform": "u_frequency", "label": "Frequency", "type": "float", "min": 0.5, "max": 8.0, "default": 2.5, "step": 0.1 },
    { "uniform": "u_speed", "label": "Speed", "type": "float", "min": 0.0, "max": 3.0, "default": 1.0, "step": 0.05 },
    { "uniform": "u_gust", "label": "Gust", "type": "float", "min": 0.0, "max": 1.0, "default": 0.35, "step": 0.05 },
    { "uniform": "u_shading", "label": "Shading", "type": "float", "min": 0.0, "max": 1.0, "default": 0.5, "step": 0.05 }
  ]
}
```

- [ ] **Step 3: Run the catalog test suite**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/shader_effects_test.py -q`
Expected: all pass.

- [ ] **Step 4: Bake goldens**

Run: `.venv/bin/python tests-unit/shaderfx_golden/generate_goldens.py`
Then `git status --porcelain tests-unit/shaderfx_golden/` — only `flag_128.png` / `flag_256.png` new; restore any modified existing golden with `git checkout --`.

- [ ] **Step 5: Eyeball the golden**

Open `tests-unit/shaderfx_golden/flag_256.png`. Expected (default anchor=left): left edge of the test card nearly undistorted, ripple growing rightward, visible bright/dark fold bands. If the anchored edge moves or shading is invisible, fix and re-bake.

- [ ] **Step 6: Commit**

```bash
git add shader_effects/flag.frag shader_effects/manifest.json tests-unit/shaderfx_golden/flag_128.png tests-unit/shaderfx_golden/flag_256.png
git commit -m "feat(shaderfx): Flag — anchored cloth-wave distortion with fold shading"
```

---

### Task 3: Un-hide generative effects in the studio picker

**Files:**
- Modify: `frontend/app/components/vue-canvas/ShaderStudioSurface.vue` (~lines 363, 368-377, 389)

**Interfaces:**
- Consumes: catalog `EffectDef.generative` flag (stays in the type — the standalone node still uses it).
- Produces: `pickerItems` including all 61+ effects; a `generative` chip in `pickerFilters`.

- [ ] **Step 1: Remove the three generative filters**

In `ShaderStudioSurface.vue`, delete the `if (!def.generative)` / `!e.generative` conditions at the three call sites (thumb warming watcher ~line 363, `pickerFilters` counts ~370-371, picker items computed ~376, `openPicker` ~389). E.g. line 363:

```ts
    if (pickerOpen.value) for (const def of catalog.value?.effects ?? []) ensureThumb(def)
```

and the items computed becomes (keep the search/filter conditions that follow):

```ts
  return (catalog.value?.effects ?? []).filter(e =>
    (pickerFilter.value === 'all' || e.category === pickerFilter.value)
```

Adjust the total count line 371 to `(catalog.value?.effects ?? []).length` accordingly.

- [ ] **Step 2: Verify in the running app**

Reload `http://127.0.0.1:3000`, open a project, add/open a Shader Studio node, open the effect picker. Expected: a `generative` chip appears with count 11; `FBM Field`, `Aurora`, `Starfield` are present with live thumbnails.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/vue-canvas/ShaderStudioSurface.vue
git commit -m "feat(shaderfx): show generative effects in the Shader Studio picker"
```

Note: this file has ANOTHER session's uncommitted edits — stage only if `git diff` shows only your hunks; otherwise extract your hunks with `git diff > p.patch`, filter to your hunks, `git checkout -- <file>` is FORBIDDEN (destroys their work) — instead use `git apply --cached` with the filtered patch (see the persistence-fix commit `3eaa10174` for the exact technique).

---

### Task 4: Category sections in `CatalogModal` + shader picker adoption

**Files:**
- Modify: `frontend/app/components/CatalogModal.vue`
- Modify: `frontend/app/components/vue-canvas/ShaderStudioSurface.vue` (picker items ordering + new props at the `<CatalogModal>` call ~line 852)
- Test: `frontend/tests/unit/catalog-sections.unit.spec.ts` (new — pure grouping helper)

**Interfaces:**
- Consumes: `pickerItems` (Task 3 shape).
- Produces: `CatalogModal` optional props `sections?: { id: string; label: string }[]` and `sectionOf?: (item: T) => string`; exported pure helper `groupBySections<T>(items: T[], sections: {id:string;label:string}[], sectionOf: (i:T)=>string): { id: string; label: string; items: T[] }[]` from a new small module `frontend/app/lib/catalogSections.ts`.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/catalog-sections.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { groupBySections } from '~/lib/catalogSections'

const SECTIONS = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]
const items = [
  { id: '1', cat: 'b' },
  { id: '2', cat: 'a' },
  { id: '3', cat: 'b' },
  { id: '4', cat: 'zzz' },
]

describe('groupBySections', () => {
  it('groups items into declared sections in order, keeping item order within a section', () => {
    const g = groupBySections(items, SECTIONS, i => i.cat)
    expect(g.map(s => s.id)).toEqual(['a', 'b', '__other'])
    expect(g[1]!.items.map(i => i.id)).toEqual(['1', '3'])
  })

  it('drops empty sections and omits __other when everything matches', () => {
    const g = groupBySections(items.slice(0, 3), SECTIONS, i => i.cat)
    expect(g.map(s => s.id)).toEqual(['a', 'b'])
  })

  it('labels the fallback group "Other"', () => {
    const g = groupBySections([{ id: 'x', cat: 'nope' }], SECTIONS, i => i.cat)
    expect(g).toEqual([{ id: '__other', label: 'Other', items: [{ id: 'x', cat: 'nope' }] }])
  })
})
```

- [ ] **Step 2: Run it, verify failure**

Run: `cd frontend && npx vitest run tests/unit/catalog-sections.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/catalogSections`.

- [ ] **Step 3: Implement the helper**

Create `frontend/app/lib/catalogSections.ts`:

```ts
/**
 * Grouping for CatalogModal's opt-in sectioned grid. Pure so pickers (and
 * tests) can reason about grouping without mounting the modal. Section order
 * follows the declared list; items keep their incoming order within a
 * section; items whose section id isn't declared fall into a trailing
 * "Other" group; empty sections are dropped.
 */
export interface CatalogSection { id: string; label: string }

export function groupBySections<T>(
  items: T[],
  sections: CatalogSection[],
  sectionOf: (item: T) => string,
): { id: string; label: string; items: T[] }[] {
  const by = new Map<string, T[]>()
  for (const item of items) {
    const sid = sections.some(s => s.id === sectionOf(item)) ? sectionOf(item) : '__other'
    const list = by.get(sid) ?? []
    if (!list.length) by.set(sid, list)
    list.push(item)
  }
  const out = sections
    .filter(s => (by.get(s.id)?.length ?? 0) > 0)
    .map(s => ({ id: s.id, label: s.label, items: by.get(s.id)! }))
  const other = by.get('__other')
  if (other?.length) out.push({ id: '__other', label: 'Other', items: other })
  return out
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd frontend && npx vitest run tests/unit/catalog-sections.unit.spec.ts`
Expected: 3 passed.

- [ ] **Step 5: Wire sections into `CatalogModal.vue`**

Add to the props interface (after `emptyMessage`):

```ts
  /** Opt-in sectioned grid: ordered headers + item→section mapping. Absent ⇒
   *  today's flat grid. Callers should pass `items` ordered section-by-section
   *  so arrow-key nav (flat index based) follows the visual order. */
  sections?: CatalogSection[]
  sectionOf?: (item: T) => string
```

with `import { groupBySections, type CatalogSection } from '~/lib/catalogSections'`.

Add a computed that always yields groups (single anonymous group when the feature is off — one template path, no duplicated card markup):

```ts
const grouped = computed(() => {
  if (props.sections?.length && props.sectionOf) {
    return groupBySections(props.items, props.sections, props.sectionOf)
  }
  return [{ id: '__all', label: '', items: props.items }]
})
```

Replace the grid block (the `v-else` div with `style="grid-template-columns: …"` and its inner `v-for="item in items"`) with a per-group loop. The card `<button>` markup moves unchanged inside the inner loop:

```html
              <div v-else class="flex flex-col gap-5">
                <section v-for="g in grouped" :key="g.id">
                  <div
                    v-if="g.label"
                    class="flex items-center gap-2.5 mb-2.5"
                  >
                    <span class="text-[10px] uppercase tracking-[0.14em] font-semibold text-white/45">{{ g.label }}</span>
                    <span class="text-[10px] text-white/25 tabular-nums">{{ g.items.length }}</span>
                    <div class="flex-1 h-px bg-white/[0.06]" />
                  </div>
                  <div
                    class="grid gap-3"
                    style="grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));"
                  >
                    <button
                      v-for="item in g.items"
                      :key="item.id"
                      ...existing card button markup and slots, unchanged...
                    </button>
                  </div>
                </section>
              </div>
```

(Keyboard nav, focus, detail pane, footer: untouched — they read the flat `items` prop.)

- [ ] **Step 6: Adopt in the shader picker**

In `ShaderStudioSurface.vue`:

```ts
// Picker sections: image-transforming families first, generators last as
// their own shelf. Items are sorted in this order so keyboard nav follows
// the visual grouping.
const SHADER_SECTIONS = [
  { id: 'distortion', label: 'Distortion' },
  { id: 'stylize', label: 'Stylize' },
  { id: 'color', label: 'Color' },
  { id: 'lens', label: 'Lens' },
  { id: 'blur', label: 'Blur' },
  { id: 'glow', label: 'Glow' },
  { id: 'generative', label: 'Generative' },
]
```

Sort the picker items computed by section order (stable within a section — catalog order):

```ts
    .sort((a, b) =>
      SHADER_SECTIONS.findIndex(s => s.id === a.category)
      - SHADER_SECTIONS.findIndex(s => s.id === b.category))
```

and pass the new props at the `<CatalogModal>` call site (~line 852):

```html
    :sections="SHADER_SECTIONS" :section-of="(e: any) => e.category"
```

- [ ] **Step 7: Typecheck the touched files**

Run: `cd frontend && npx nuxt typecheck 2>&1 | grep -E "CatalogModal|catalogSections|ShaderStudioSurface"`
Expected: no NEW errors attributable to these edits (pre-existing baseline errors elsewhere are fine; ShaderStudioSurface has parallel-session edits — compare against the errors it showed before if any appear).

- [ ] **Step 8: Verify in the running app**

Reload `http://127.0.0.1:3000`, open the shader picker. Expected: titled sections in the order Distortion → … → Generative with hairline rules and counts; chips still filter (picking `blur` shows just the Blur section); search that matches nothing in a category hides that section; `fbm_warp` and `flag` appear under Distortion. Screenshot for the record.

- [ ] **Step 9: Commit**

```bash
git add frontend/app/lib/catalogSections.ts frontend/tests/unit/catalog-sections.unit.spec.ts frontend/app/components/CatalogModal.vue frontend/app/components/vue-canvas/ShaderStudioSurface.vue
git commit -m "feat(catalog): opt-in category sections in CatalogModal; shader picker adopts them"
```

(Same parallel-session caution for `ShaderStudioSurface.vue` as Task 3.)

---

### Task 5: Full verification pass

**Files:** none created; runs the gates.

- [ ] **Step 1: Backend suites**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/shader_effects_test.py tests-unit/comfy_api_test/projects_storage_test.py -q`
Expected: all pass.

- [ ] **Step 2: Browser golden parity for the two new effects**

Run: `cd frontend && SHADERFX_BASE_URL=http://127.0.0.1:3000 npx playwright test tests/shaderfx-golden.spec.ts --project=chromium 2>&1 | tail -20`
Expected: `fbm_warp` and `flag` PASS at 128 and 256. `crystal_prism` failures are pre-existing — ignore them, everything else must pass.

- [ ] **Step 3: Studio end-to-end smoke**

In the running app: drop an image onto the canvas, add Shader Studio, apply `Flag` (anchor Left) — confirm the anchored edge holds still and folds shade; switch to `FBM Warp`, push Warp to 4 — confirm the melt. Apply `FBM Field` from the Generative section — confirm it renders as a base layer. Screenshot each.

- [ ] **Step 4: Report**

Summarize commits, test counts, and attach the screenshots.
