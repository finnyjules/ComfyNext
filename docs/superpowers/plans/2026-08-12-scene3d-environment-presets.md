# Scene3D Environment Presets + Prism Material Preset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add selectable environment maps (Room / Dark studio / Softbox / Color gels) to 3D Studio plus a one-click Prism glass preset, so dispersion produces the refractive-prism rainbow look.

**Architecture:** A new `lighting.environment` doc field selects one of four procedural environment scenes, built in a new `environments.ts` module and PMREM'd by the engine exactly the way `RoomEnvironment` is today. The engine rebuilds the env target only when the kind changes and on context restore. The UI adds one segmented control (Lighting section) and one apply-values Prism chip (Material panel). The agent-control catalog gains one `select` entry.

**Tech Stack:** three.js (PMREMGenerator, MeshBasicMaterial HDR light boxes), Vue 3 + Nuxt 4, vitest.

**Spec:** `docs/superpowers/specs/2026-08-12-scene3d-environment-presets-design.md`

## Global Constraints

- All unit tests run from `frontend/`: `npx vitest run tests/unit/<file>` (baseline: whole suite green before and after each task).
- Typecheck baseline is ~328 pre-existing errors; a task must not add errors that name symbols it introduced (`npx nuxt typecheck` from `frontend/`).
- Commit style: `feat(scene3d): …` one-liners, commit directly on `main`, stage ONLY the files this plan touches (parallel sessions may have other files dirty — never `git add -A`, never stash).
- Action blue is the only accent colour; the Prism chip uses the existing `StudioButton` component, never a hand-rolled button.
- `dispersion`, `transmission`, `ior`, `thickness`, `attenuationDistance` already exist on `SceneMaterial` — do not re-declare them.

---

### Task 1: `lighting.environment` doc field (config)

**Files:**
- Modify: `frontend/app/lib/scene3d/config.ts` (~line 302 types, ~line 342 constants, ~line 502 `defaultDoc`, ~line 912 normalizer)
- Test: `frontend/tests/unit/scene3d-config.unit.spec.ts`

**Interfaces:**
- Consumes: existing `SceneLighting`, `defaultDoc`, `parseDoc`, `serializeDoc`.
- Produces: `export type EnvironmentKind = 'room' | 'darkStrips' | 'softbox' | 'colorGels'`, `export const ENVIRONMENT_KINDS: EnvironmentKind[]`, and `SceneLighting.environment: EnvironmentKind` — Tasks 2–5 import these exact names from `~/lib/scene3d/config`.

- [ ] **Step 1: Write the failing tests**

Append to the top-level `describe` in `frontend/tests/unit/scene3d-config.unit.spec.ts` (add `ENVIRONMENT_KINDS` to the existing import from `~/lib/scene3d/config`):

```ts
describe('lighting environment', () => {
  it('defaults to room', () => {
    expect(defaultDoc().lighting.environment).toBe('room')
  })

  it('round-trips every environment kind', () => {
    for (const kind of ENVIRONMENT_KINDS) {
      const doc = defaultDoc()
      doc.lighting.environment = kind
      expect(parseDoc(serializeDoc(doc)).lighting.environment).toBe(kind)
    }
  })

  it('normalizes missing and invalid environment to room', () => {
    const raw = JSON.parse(serializeDoc(defaultDoc()))
    delete raw.lighting.environment
    expect(parseDoc(JSON.stringify(raw)).lighting.environment).toBe('room')
    raw.lighting.environment = 'disco'
    expect(parseDoc(JSON.stringify(raw)).lighting.environment).toBe('room')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/unit/scene3d-config.unit.spec.ts`
Expected: FAIL — `ENVIRONMENT_KINDS` is not exported / `environment` is `undefined`.

- [ ] **Step 3: Implement the field**

In `frontend/app/lib/scene3d/config.ts`:

Next to `LightingPreset` (~line 302):

```ts
export type EnvironmentKind = 'room' | 'darkStrips' | 'softbox' | 'colorGels'
export interface SceneLighting {
  preset: LightingPreset
  environment: EnvironmentKind
  sunAzimuth: number
  sunElevation: number
  sunIntensity: number
  ambient: number
}
```

Next to `LIGHTING_PRESETS` (~line 342):

```ts
export const ENVIRONMENT_KINDS: EnvironmentKind[] = ['room', 'darkStrips', 'softbox', 'colorGels']
```

In `defaultDoc()` add `environment: 'room'` to the `lighting` literal. In the normalizer's `lighting` block (mirrors the `preset` line):

```ts
environment: ENVIRONMENT_KINDS.includes(raw.lighting?.environment) ? raw.lighting.environment : d.lighting.environment,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/scene3d-config.unit.spec.ts`
Expected: PASS (all, including the pre-existing round-trip tests — `defaultDoc` now carries the field so `toEqual` round-trips still hold).

- [ ] **Step 5: Commit**

```bash
cd frontend && git add app/lib/scene3d/config.ts tests/unit/scene3d-config.unit.spec.ts && git commit -m "feat(scene3d): lighting.environment doc field (room/darkStrips/softbox/colorGels)"
```

---

### Task 2: Procedural environment scenes module

**Files:**
- Create: `frontend/app/lib/scene3d/environments.ts`
- Test: `frontend/tests/unit/scene3d-environments.unit.spec.ts`

**Interfaces:**
- Consumes: `EnvironmentKind` from `~/lib/scene3d/config`; `RoomEnvironment` from `three/examples/jsm/environments/RoomEnvironment.js`.
- Produces: `export function buildEnvironmentScene(kind: EnvironmentKind): THREE.Scene & { dispose(): void }` — Task 3 calls this from the engine. Every returned scene has a `dispose()` that frees geometries/materials.

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/unit/scene3d-environments.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildEnvironmentScene } from '~/lib/scene3d/environments'
import { ENVIRONMENT_KINDS } from '~/lib/scene3d/config'

function meshes(scene: THREE.Scene): THREE.Mesh[] {
  const out: THREE.Mesh[] = []
  scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh) })
  return out
}
function maxChannel(c: THREE.Color): number { return Math.max(c.r, c.g, c.b) }

describe('scene3d environments', () => {
  it('builds a disposable scene for every kind', () => {
    for (const kind of ENVIRONMENT_KINDS) {
      const scene = buildEnvironmentScene(kind)
      expect(scene.isScene).toBe(true)
      expect(typeof scene.dispose).toBe('function')
      scene.dispose()
    }
  })

  it('darkStrips is a black void with several HDR-bright thin bars', () => {
    const scene = buildEnvironmentScene('darkStrips')
    expect((scene.background as THREE.Color).getHex()).toBe(0x000000)
    const bars = meshes(scene)
    expect(bars.length).toBeGreaterThanOrEqual(5)
    // Every bar is emissive-bright beyond LDR white so PMREM captures streaks.
    for (const b of bars) {
      const m = b.material as THREE.MeshBasicMaterial
      expect(maxChannel(m.color)).toBeGreaterThan(1)
    }
    scene.dispose()
  })

  it('softbox is a grey void with big soft panels', () => {
    const scene = buildEnvironmentScene('softbox')
    const bg = scene.background as THREE.Color
    expect(bg.r).toBeGreaterThan(0)   // not black
    expect(bg.r).toBeLessThan(0.5)    // not white
    expect(meshes(scene).length).toBeGreaterThanOrEqual(2)
    scene.dispose()
  })

  it('colorGels has opposing magenta-ish and cyan-ish sources on black', () => {
    const scene = buildEnvironmentScene('colorGels')
    expect((scene.background as THREE.Color).getHex()).toBe(0x000000)
    const mats = meshes(scene).map((m) => m.material as THREE.MeshBasicMaterial)
    const magenta = mats.find((m) => m.color.r > m.color.g && m.color.b > m.color.g)
    const cyan = mats.find((m) => m.color.g > m.color.r && m.color.b > m.color.r)
    expect(magenta).toBeTruthy()
    expect(cyan).toBeTruthy()
    scene.dispose()
  })

  it('dispose frees every geometry and material', () => {
    const scene = buildEnvironmentScene('darkStrips')
    const disposed: string[] = []
    for (const m of meshes(scene)) {
      m.geometry.addEventListener('dispose', () => disposed.push('g'))
      ;(m.material as THREE.Material).addEventListener('dispose', () => disposed.push('m'))
    }
    const count = meshes(scene).length
    scene.dispose()
    expect(disposed.filter((d) => d === 'g').length).toBe(count)
    expect(disposed.filter((d) => d === 'm').length).toBe(count)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/unit/scene3d-environments.unit.spec.ts`
Expected: FAIL — module `~/lib/scene3d/environments` does not exist.

- [ ] **Step 3: Implement the module**

Create `frontend/app/lib/scene3d/environments.ts`:

```ts
// Procedural environment scenes for Scene3D. Each kind is a tiny THREE.Scene fed
// to PMREMGenerator.fromScene exactly like three's RoomEnvironment — built once
// per kind switch, then disposed. HDR trick: MeshBasicMaterial colours above 1.0
// survive into the float PMREM target, so bars/panels read as light sources.
// Selected by `lighting.environment` (config.ts) — add kinds there first.
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { EnvironmentKind } from './config'

type EnvScene = THREE.Scene & { dispose(): void }

class ProceduralEnv extends THREE.Scene {
  dispose(): void {
    this.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    })
  }
}

/** A box "light bar": w×h×d at `pos`, aimed by `rotZ`/`rotY` (radians), with an
 *  HDR colour (`intensity` multiplies the channels past LDR white). */
function bar(scene: THREE.Scene, w: number, h: number, d: number,
  pos: [number, number, number], rotY: number, rotZ: number,
  color: THREE.Color, intensity: number): void {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshBasicMaterial({ color: color.multiplyScalar(intensity) }),
  )
  m.position.set(...pos)
  m.rotation.set(0, rotY, rotZ)
  scene.add(m)
}

/** Black void + long thin very bright bars at varied angles — studio strip
 *  softboxes. Glass dispersion turns these streaks into rainbow bands. */
function darkStrips(): EnvScene {
  const s = new ProceduralEnv()
  s.background = new THREE.Color(0x000000)
  const white = (warmth: number) => new THREE.Color(1, 1 - warmth * 0.08, 1 - warmth * 0.15)
  bar(s, 8, 0.35, 0.1, [-4, 4, -5], 0.4, 0.5, white(1), 10)
  bar(s, 10, 0.3, 0.1, [5, 3, -4], -0.5, -0.6, white(0), 12)
  bar(s, 7, 0.25, 0.1, [0, -3.5, -5], 0.1, 0.35, white(-1), 8)   // cool from below
  bar(s, 9, 0.3, 0.1, [-5, -1, 4], 2.6, -0.4, white(0.5), 9)
  bar(s, 6, 0.4, 0.1, [4, 5, 3], 2.9, 0.7, white(-0.5), 11)
  bar(s, 8, 0.2, 0.1, [0, 6, 0], 1.2, 1.57, white(0), 7)          // overhead
  return s
}

/** Mid-grey void + two huge soft white panels — the classic product-render
 *  studio: big gradient windows sliding across curved surfaces. */
function softbox(): EnvScene {
  const s = new ProceduralEnv()
  s.background = new THREE.Color(0x2a2a2a)
  bar(s, 6, 4.5, 0.1, [-4, 3, -3], 0.7, 0, new THREE.Color(1, 1, 1), 6)   // key
  bar(s, 4, 3, 0.1, [4.5, 1, 2], -2.2, 0, new THREE.Color(1, 1, 1), 2.5)  // fill
  return s
}

/** Black void + opposing magenta/cyan area sources — two-tone neon look. */
function colorGels(): EnvScene {
  const s = new ProceduralEnv()
  s.background = new THREE.Color(0x000000)
  bar(s, 5, 4, 0.1, [-4.5, 1.5, -1], 1.1, 0, new THREE.Color(1, 0.05, 0.65), 7)  // magenta
  bar(s, 5, 4, 0.1, [4.5, 1.5, -1], -1.1, 0, new THREE.Color(0.05, 0.8, 1), 7)   // cyan
  bar(s, 3, 0.3, 0.1, [0, 5.5, 2], 0, 1.57, new THREE.Color(1, 1, 1), 4)          // white rim strip
  return s
}

export function buildEnvironmentScene(kind: EnvironmentKind): EnvScene {
  switch (kind) {
    case 'darkStrips': return darkStrips()
    case 'softbox': return softbox()
    case 'colorGels': return colorGels()
    case 'room': default: return new RoomEnvironment() as unknown as EnvScene
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/scene3d-environments.unit.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd frontend && git add app/lib/scene3d/environments.ts tests/unit/scene3d-environments.unit.spec.ts && git commit -m "feat(scene3d): procedural environment scenes (darkStrips/softbox/colorGels)"
```

---

### Task 3: Engine wiring — kind-aware env build, sync, context restore

**Files:**
- Modify: `frontend/app/lib/scene3d/engine.ts` (`buildEnvironment` ~line 497, `syncFromDoc` lighting block ~line 628, `restoreGLResources` ~line 535)

**Interfaces:**
- Consumes: `buildEnvironmentScene` (Task 2), `EnvironmentKind` (Task 1), `doc.lighting.environment` (Task 1).
- Produces: engine rebuilds the PMREM env when `doc.lighting.environment` changes; context restore rebuilds the CURRENT kind. No new public API.

- [ ] **Step 1: Rewrite `buildEnvironment` to be kind-aware**

Replace the existing method (keep its doc comment, amend as shown) and add the tracking field next to `envTarget`'s declaration:

```ts
/** The environment kind the current envTarget was built from — compared in
 *  syncFromDoc so the (expensive) PMREM rebuild only runs on an actual switch. */
private envKind: EnvironmentKind = 'room'

/** (Re)build the PMREM environment map for `kind` (default: current kind, which
 *  is what context-restore wants). Split out of the constructor so restore can
 *  rebuild it — the render target is a GPU resource lost with the context.
 *  Disposes the prior target AND the throwaway source scene. */
private buildEnvironment(kind: EnvironmentKind = this.envKind): void {
  this.envKind = kind
  this.envTarget?.dispose()
  const pmrem = new THREE.PMREMGenerator(this.renderer)
  const envScene = buildEnvironmentScene(kind)
  this.envTarget = pmrem.fromScene(envScene, 0.04)
  this.scene.environment = this.envTarget.texture
  envScene.dispose()
  pmrem.dispose()
}
```

Imports: add `import { buildEnvironmentScene } from './environments'` and add `EnvironmentKind` to the existing type import from `./config`. Remove the now-unused `RoomEnvironment` import from engine.ts (it moved into environments.ts).

- [ ] **Step 2: Rebuild on doc change in `syncFromDoc`**

In the `// Lighting + background.` block (~line 628), before `this.scene.environmentIntensity = …`:

```ts
if (doc.lighting.environment !== this.envKind) this.buildEnvironment(doc.lighting.environment)
```

`restoreGLResources` already calls `this.buildEnvironment()` — with the default parameter it now rebuilds the current kind. Verify, change nothing there.

- [ ] **Step 3: Run the engine + full scene3d unit suites**

Run: `cd frontend && npx vitest run tests/unit/scene3d-engine.unit.spec.ts && npx vitest run tests/unit --silent 2>&1 | tail -5`
Expected: PASS / no new failures vs baseline. (Engine env build is GPU-side; runtime proof is Task 6's pixel diff.)

- [ ] **Step 4: Typecheck names you introduced**

Run: `cd frontend && npx nuxt typecheck 2>&1 | grep -i "environment" | head`
Expected: no errors naming `environments`, `EnvironmentKind`, `buildEnvironmentScene`, or `envKind`.

- [ ] **Step 5: Commit**

```bash
cd frontend && git add app/lib/scene3d/engine.ts && git commit -m "feat(scene3d): engine builds env from lighting.environment, rebuilds on switch + context restore"
```

---

### Task 4: UI — Environment control + Prism chip

**Files:**
- Modify: `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue` (proxies ~line 427, Lighting section ~line 4034, Transparency details ~line 3684)

**Interfaces:**
- Consumes: `doc.lighting.environment` (Task 1), `applyMaterial` (existing, ~line 478), `enumProxy` (existing, ~line 424), `StudioSegmented`/`StudioButton` (existing imports).
- Produces: user-facing controls; no exports.

- [ ] **Step 1: Add the environment proxy with display labels**

Next to `lightingPresetProxy` (~line 427). `StudioSegmented` binds raw strings, so map kind↔label:

```ts
const ENV_OPTIONS = ['room', 'dark', 'softbox', 'gels'] as const
const ENV_BY_LABEL: Record<string, EnvironmentKind> = { room: 'room', dark: 'darkStrips', softbox: 'softbox', gels: 'colorGels' }
const ENV_LABEL: Record<EnvironmentKind, string> = { room: 'room', darkStrips: 'dark', softbox: 'softbox', colorGels: 'gels' }
const environmentProxy = computed<string>({
  get: () => ENV_LABEL[doc.lighting.environment],
  set: (v) => { doc.lighting.environment = ENV_BY_LABEL[v] ?? 'room' },
})
```

Add `EnvironmentKind` to the existing type imports from `~/lib/scene3d/config`.

- [ ] **Step 2: Add the segmented control to the Lighting section**

Inside `<StudioSection title="Lighting">` (~line 4034), directly under the preset `StudioSegmented` row, following the same row markup as the preset control above it:

```html
<StudioSegmented v-model="environmentProxy" :options="[...ENV_OPTIONS]" />
```

(Wrap with the same label row the preset uses — copy that exact wrapper markup, label text "Environment".)

- [ ] **Step 3: Add the Prism chip + handler**

Handler in script (near `applyMaterial`):

```ts
/** One-click prism look: tuned glass + the dark-strips environment + black bg.
 *  Apply-values action, not a mode — every slider stays live afterwards. */
function applyPrismPreset(): void {
  applyMaterial((m) => {
    m.type = 'glass'
    m.color = '#ffffff'
    m.roughness = 0
    m.metalness = 0
    m.transmission = 1
    m.ior = 1.55
    m.thickness = 1.5
    m.dispersion = 3.5
    m.attenuationDistance = 0
  })
  doc.lighting.environment = 'darkStrips'
  doc.background = '#000000'
}
```

Template — first row inside the Transparency `<details>` body (~line 3687, above the Opacity slider):

```html
<div class="flex items-center justify-between">
  <span class="text-[11px] text-white/55">Prism look</span>
  <StudioButton variant="secondary" @click="applyPrismPreset">Prism</StudioButton>
</div>
```

- [ ] **Step 4: Verify compile + behavior**

Run: `cd frontend && npx nuxt typecheck 2>&1 | grep -c "Scene3DStudioSurface" ` — expected: same count as on `main` before this task (no new errors in this file naming the new symbols).
Then Vite compile check per the dev-environment recipe: with the dev server running, `curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3000/"` → `200`.

- [ ] **Step 5: Commit**

```bash
cd frontend && git add app/components/vue-canvas/Scene3DStudioSurface.vue && git commit -m "feat(scene3d): environment segmented control + one-click Prism glass chip"
```

---

### Task 5: Agent controls — expose `lighting.environment`

**Files:**
- Modify: `frontend/app/lib/scene3d/controls.ts` (~line 226, the Lighting group)
- Modify: `frontend/app/lib/scene3d/agentControls.ts` (~line 195, LIGHTING/CAMERA/POST prose)
- Test: `frontend/tests/unit/scene3d-controls.unit.spec.ts`

**Interfaces:**
- Consumes: `ENVIRONMENT_KINDS` (Task 1), existing `select(...)` helper and `D` defaults in controls.ts.
- Produces: agent-addressable `lighting.environment` control.

- [ ] **Step 1: Write the failing test**

Append to `frontend/tests/unit/scene3d-controls.unit.spec.ts` (match the file's existing import/lookup style — it asserts over the exported control list; find the existing `lighting.preset` assertion and mirror it):

```ts
it('exposes lighting.environment as a select over ENVIRONMENT_KINDS', () => {
  const c = SCENE3D_CONTROLS.find((c) => c.path === 'lighting.environment')
  expect(c).toBeTruthy()
  expect(c!.kind).toBe('select')
  expect((c as any).options).toEqual(['room', 'darkStrips', 'softbox', 'colorGels'])
})
```

(If the list export is named differently in that spec file, use the name the file already imports — the assertion body stays the same.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/scene3d-controls.unit.spec.ts`
Expected: FAIL — no control at path `lighting.environment`. Note whether any OTHER test in this file fails on a control COUNT — if so, that count needs +1 in Step 3.

- [ ] **Step 3: Add the control + prose**

`controls.ts`, directly under the `lighting.preset` select (~line 226; import `ENVIRONMENT_KINDS` alongside `LIGHTING_PRESETS`):

```ts
select('lighting.environment', 'Environment', [...ENVIRONMENT_KINDS], D.lighting.environment, 'Lighting'),
```

`agentControls.ts` ~line 195 — extend the LIGHTING/CAMERA/POST sentence after the `lighting.preset` clause:

```
`lighting.environment` picks the world the scene reflects — 'room' (neutral), 'darkStrips' (black studio with bright light bars — THE choice for prismatic/dispersive glass), 'softbox' (product-photo panels), 'colorGels' (magenta/cyan neon);
```

Fix any control-count assertions found in Step 2 (controls or agent-controls specs) by +1 with a comment-free value bump.

- [ ] **Step 4: Run the control suites**

Run: `cd frontend && npx vitest run tests/unit/scene3d-controls.unit.spec.ts tests/unit/scene3d-agent-controls.unit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd frontend && git add app/lib/scene3d/controls.ts app/lib/scene3d/agentControls.ts tests/unit/scene3d-controls.unit.spec.ts && git commit -m "feat(scene3d): agent-controllable lighting.environment"
```

---

### Task 6: Runtime pixel-diff verification (no code — evidence)

**Files:**
- None modified. Evidence goes in the task report / screenshots.

**Interfaces:**
- Consumes: everything above, the running dev app (`./dev.sh` if no healthy server), the Browser pane.

- [ ] **Step 1: Get a Scene3D studio open with a glass object**

Use the canvas repro: open `http://127.0.0.1:3000`, run `sailor:addNode` for a Scene3D node (per the dev-environment recipe), open the studio, add a `box` primitive, set Material → glass.

- [ ] **Step 2: Capture the three proof pairs**

Screenshots (Browser pane, same camera, same scene):
1. environment `room` vs `darkStrips` (dispersion 3.5) — MUST differ visibly.
2. `darkStrips` with dispersion `0` vs `5` — MUST differ visibly (rainbow fringes appear).
3. Prism chip from a fresh standard-material box — one click yields glass-on-black with streak highlights; verify sliders show 3.5/1.5/1.55.

"It rendered" is NOT evidence (graceful-fallback lesson): if a pair does not differ, that is a FAILURE to diagnose (check env rebuild actually fired — `envKind` guard), not a pass.

- [ ] **Step 3: Check softbox + colorGels visually**

Switch through all four environments on a chrome-ish sphere (metalness 1, roughness 0.1): each must read distinct (grey room / dark streaks / big soft windows / magenta-cyan). Screenshot the four.

- [ ] **Step 4: Report**

Post the screenshots + one line per pair confirming the diff. No commit.

---

### Task 7: Docs + dashboard

**Files:**
- Modify: `docs/STATE.md` (feature landed entry)
- Modify: `docs/ROADMAP.md` (only if it lists this work)
- Update the live ⛵ build-dashboard artifact (standing rule: read the LIVE artifact first, then redeploy with this feature added)

- [ ] **Step 1: Add the landed entry to `docs/STATE.md`** — short entry: environment presets (room/darkStrips/softbox/colorGels) + Prism chip, spec link, date 2026-08-12.
- [ ] **Step 2: Update the ⛵ dashboard artifact** — fetch current live artifact content, add this feature to its landed list, redeploy to the SAME URL.
- [ ] **Step 3: Commit**

```bash
git add docs/STATE.md docs/ROADMAP.md && git commit -m "docs(state): scene3d environment presets + prism chip landed"
```
