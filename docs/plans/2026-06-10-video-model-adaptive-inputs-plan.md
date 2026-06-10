# Adaptive Video-Node Inputs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Film-a-Shot and Generate-a-Video widgets adapt to the selected model — seed hides when the model ignores it, duration/aspect dropdowns show only the model's real values, and switching models snaps stranded values.

**Architecture:** Frontend-only (backend remap stays as fallback). A pure lib (`videoModelAdapt.ts`) reads the existing `video-models.ts` registry (gains a `supportsSeed` flag). Seed visibility plugs into `ComfyNode.vue`'s existing `WIDGET_VISIBILITY` registry; option filtering adds a sibling `WIDGET_OPTIONS` registry consumed via a non-mutating `effectiveWidgetDef()` wrapper; snap-on-model-change lands in `VideoModelGalleryModal.onConfirm` (the single model write path).

**Tech Stack:** Vue 3 / Nuxt 4, TypeScript, vitest (`frontend/tests/unit/`).

**Spec:** `docs/plans/2026-06-10-video-model-adaptive-inputs-design.md`

**Conventions:**
- All paths relative to the repo root; frontend commands run from `frontend/`.
- Vitest: `npx vitest run tests/unit/video-model-adapt.unit.spec.ts`
- Commit after every task; end messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- No backend changes anywhere in this plan.

---

### Task 1: `supportsSeed` flag in the model registry

**Files:**
- Modify: `frontend/app/data/video-models.ts`
- Test: `frontend/tests/unit/video-model-adapt.unit.spec.ts` (created here, grows in Task 2)

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/unit/video-model-adapt.unit.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { VIDEO_MODELS, VIDEO_MODELS_BY_ID } from '../../app/data/video-models'

// Audit of comfy_api_nodes/video_models.py (2026-06-10): every builder calls
// _maybe_set_seed except _b_kling_v2_5_turbo_pro (Replicate 422s on seed) and
// _b_fabric_1_0 (lip-sync, no seed input).
const NO_SEED_IDS = ['kling-v2.5-turbo-pro', 'fabric-1.0']

describe('video-models supportsSeed flag', () => {
  it('every model declares a boolean supportsSeed', () => {
    for (const m of VIDEO_MODELS) {
      expect(typeof (m as any).supportsSeed, `${m.id} missing supportsSeed`).toBe('boolean')
    }
  })

  it('flags match the Python builder audit', () => {
    for (const m of VIDEO_MODELS) {
      const expected = !NO_SEED_IDS.includes(m.id)
      expect((m as any).supportsSeed, m.id).toBe(expected)
    }
    for (const id of NO_SEED_IDS) {
      expect(VIDEO_MODELS_BY_ID[id], `${id} missing from registry`).toBeTruthy()
    }
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run (from `frontend/`): `npx vitest run tests/unit/video-model-adapt.unit.spec.ts`
Expected: FAIL — `supportsSeed` is undefined on every model.

- [ ] **Step 3: Add the flag**

In `frontend/app/data/video-models.ts`:

(a) Add to the `VideoModel` interface, after `modes`:

```typescript
  // Whether the model's Replicate schema accepts a seed. Mirrors which Python
  // builders call _maybe_set_seed in comfy_api_nodes/video_models.py — keep in
  // sync when adding models. false ⇒ the node hides its seed widget.
  supportsSeed: boolean
```

(b) Add `supportsSeed: true,` to every entry (directly after its `modes:` line), EXCEPT:
- `kling-v2.5-turbo-pro` → `supportsSeed: false,  // Replicate 422s on seed (2026-06-10)`
- `fabric-1.0` → `supportsSeed: false,  // lip-sync model, no seed input`

(c) Also extend the file's header comment ("Mirrors …") with one line: `supportsSeed mirrors the Python builders — see _maybe_set_seed call sites.`

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/video-model-adapt.unit.spec.ts`
Expected: 2 passed. Also `npx vue-tsc --noEmit 2>&1 | grep -i "video-models" || echo clean` → clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/data/video-models.ts frontend/tests/unit/video-model-adapt.unit.spec.ts
git commit -m "Adaptive inputs: supportsSeed flag on the video-model registry

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: The adaptation lib

**Files:**
- Create: `frontend/app/lib/videoModelAdapt.ts`
- Test: `frontend/tests/unit/video-model-adapt.unit.spec.ts` (append)

- [ ] **Step 1: Append the failing tests**

Append to `frontend/tests/unit/video-model-adapt.unit.spec.ts`:

```typescript
import {
  modelSupportsSeed, allowedDurations, allowedAspectRatios, snapWidgetsToModel,
} from '../../app/lib/videoModelAdapt'

describe('videoModelAdapt', () => {
  it('modelSupportsSeed reads the flag; unknown/empty ids are permissive', () => {
    expect(modelSupportsSeed('veo-3.1')).toBe(true)
    expect(modelSupportsSeed('kling-v2.5-turbo-pro')).toBe(false)
    expect(modelSupportsSeed('fabric-1.0')).toBe(false)
    expect(modelSupportsSeed('does-not-exist')).toBe(true)
    expect(modelSupportsSeed('')).toBe(true)
  })

  it('allowedDurations returns the model durations as strings; unknown → null', () => {
    expect(allowedDurations('veo-3.1')).toEqual(['8'])
    expect(allowedDurations('kling-v2.5-turbo-pro'))
      .toEqual(VIDEO_MODELS_BY_ID['kling-v2.5-turbo-pro'].durations.map(String))
    expect(allowedDurations('does-not-exist')).toBeNull()
  })

  it('allowedAspectRatios returns the model ratios; unknown → null', () => {
    expect(allowedAspectRatios('veo-3.1')).toEqual(['16:9', '9:16'])
    expect(allowedAspectRatios('does-not-exist')).toBeNull()
  })

  it('snapWidgetsToModel corrects out-of-range duration and aspect', () => {
    const defs = [{ name: 'model' }, { name: 'duration' }, { name: 'aspect_ratio' }]
    const kling = VIDEO_MODELS_BY_ID['kling-v2.5-turbo-pro']
    const values = ['kling-v2.5-turbo-pro', '8', 'not-a-ratio']  // stranded leftovers ('8' is Veo's duration; the ratio is deliberately fake so the test doesn't depend on Kling's exact AR list)
    const fixes = snapWidgetsToModel(defs, values, 'kling-v2.5-turbo-pro')
    expect(fixes).toContainEqual({ name: 'duration', value: String(kling.defaultDuration) })
    const aspectFix = fixes.find(f => f.name === 'aspect_ratio')
    expect(aspectFix).toBeTruthy()
    expect(kling.aspectRatios).toContain(aspectFix!.value)
  })

  it('snapWidgetsToModel leaves valid values alone and tolerates unknowns', () => {
    const defs = [{ name: 'model' }, { name: 'duration' }, { name: 'aspect_ratio' }]
    expect(snapWidgetsToModel(defs, ['veo-3.1', '8', '16:9'], 'veo-3.1')).toEqual([])
    expect(snapWidgetsToModel(defs, ['x', '8', '16:9'], 'does-not-exist')).toEqual([])
    expect(snapWidgetsToModel([], [], 'veo-3.1')).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/video-model-adapt.unit.spec.ts`
Expected: Task-1 tests pass; new block FAILS — cannot resolve `../../app/lib/videoModelAdapt`.

- [ ] **Step 3: Create the lib**

Create `frontend/app/lib/videoModelAdapt.ts` (relative import keeps it vitest-loadable — no `~` alias in the vitest config):

```typescript
/**
 * Per-model input adaptation for the video nodes (FilmShotNode +
 * GenerateVideoNode). Pure functions over the video-model registry: which
 * widgets make sense for the selected model, and what their option lists are.
 *
 * Unknown/empty model ids are always PERMISSIVE (everything visible, no
 * filtering) so stale workflows never lose widgets.
 *
 * Design: docs/plans/2026-06-10-video-model-adaptive-inputs-design.md
 */
import { VIDEO_MODELS_BY_ID } from '../data/video-models'

/** False only when the registry explicitly says the model takes no seed. */
export function modelSupportsSeed(modelId: string): boolean {
  const m = VIDEO_MODELS_BY_ID[modelId]
  return m ? m.supportsSeed : true
}

/** The model's duration options as combo-value strings; null = don't filter. */
export function allowedDurations(modelId: string): string[] | null {
  const m = VIDEO_MODELS_BY_ID[modelId]
  return m ? m.durations.map(String) : null
}

/** The model's aspect-ratio options; null = don't filter. */
export function allowedAspectRatios(modelId: string): string[] | null {
  const m = VIDEO_MODELS_BY_ID[modelId]
  return m ? [...m.aspectRatios] : null
}

export interface WidgetCorrection { name: string; value: string }

/**
 * After a model change, corrections for `duration` / `aspect_ratio` values the
 * new model doesn't support (duration → model default; aspect → model default).
 * Positional slots are untouched — callers apply values at the widget's index.
 */
export function snapWidgetsToModel(
  widgetDefs: any[], widgetsValues: any[], modelId: string,
): WidgetCorrection[] {
  const m = VIDEO_MODELS_BY_ID[modelId]
  if (!m) return []
  const out: WidgetCorrection[] = []
  const idxOf = (name: string) => (widgetDefs ?? []).findIndex((d: any) => d?.name === name)

  const durIdx = idxOf('duration')
  if (durIdx >= 0) {
    const cur = String(widgetsValues?.[durIdx] ?? '')
    if (!m.durations.map(String).includes(cur)) {
      out.push({ name: 'duration', value: String(m.defaultDuration) })
    }
  }
  const arIdx = idxOf('aspect_ratio')
  if (arIdx >= 0) {
    const cur = String(widgetsValues?.[arIdx] ?? '')
    if (!m.aspectRatios.includes(cur)) {
      out.push({ name: 'aspect_ratio', value: m.defaultAspectRatio })
    }
  }
  return out
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/video-model-adapt.unit.spec.ts`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/videoModelAdapt.ts frontend/tests/unit/video-model-adapt.unit.spec.ts
git commit -m "Adaptive inputs: videoModelAdapt lib — seed/duration/aspect rules + snap

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Seed visibility (+ stale-gate cleanup) in ComfyNode.vue

**Files:**
- Modify: `frontend/app/components/vue-canvas/ComfyNode.vue` (~lines 240–330: `WIDGET_VISIBILITY`, `MODEL_GATED_WIDGETS`)

READ the surrounding code first. The existing structure: `WIDGET_VISIBILITY` is a `Record<nodeType, (name, values, defs) => boolean>`; `MODEL_GATED_WIDGETS.GenerateVideoNode` maps legacy widget names (`resolution`, `camera_fixed`, `negative_prompt`, `cfg_scale`) to legacy model labels (`'Seedance 2.0'`, `'Veo 3'`, `'Kling 2.1'`) — those widgets no longer exist on the post-dispatcher node (they live in the gallery's `model_options` bag), so the entry is dead code.

- [ ] **Step 1: Import the lib**

Add to ComfyNode.vue's imports (match the file's existing import style):

```typescript
import { modelSupportsSeed } from '~/lib/videoModelAdapt'
```

- [ ] **Step 2: Add the shared seed gate + node entries**

Directly ABOVE the `const WIDGET_VISIBILITY` declaration, add:

```typescript
// Video nodes: hide the seed widget (and its hidden control companion) when
// the selected model's API takes no seed (registry flag supportsSeed — e.g.
// Kling v2.5 Turbo Pro 422s on it). Visibility is render-only; the positional
// widgets_values slots are untouched, so alignment is safe.
const videoSeedGate = (name: string, values: any[], defs: any[]): boolean => {
  if (name !== 'seed' && name !== 'seed_control') return true
  const modelIdx = defs.findIndex((d: any) => d?.name === 'model')
  if (modelIdx < 0) return true
  return modelSupportsSeed(String(values[modelIdx] ?? ''))
}
```

Then in `WIDGET_VISIBILITY`:
- Replace the existing `GenerateVideoNode:` line with `GenerateVideoNode: videoSeedGate,`
- Add alongside it: `FilmShotNode: videoSeedGate,`

- [ ] **Step 3: Remove the dead gate entry**

Delete the `GenerateVideoNode: { ... }` block from `MODEL_GATED_WIDGETS` (the one mapping `resolution`/`camera_fixed`/`negative_prompt`/`cfg_scale` to `'Seedance 2.0'`/`'Veo 3'`/`'Kling 2.1'`). Update the comment above `WIDGET_VISIBILITY`'s Replicate section if it references GenerateVideoNode gating. Leave `UpscaleImageNode` and `OutpaintImageNode` untouched.

- [ ] **Step 4: Verify**

```bash
npx vue-tsc --noEmit 2>&1 | grep -iE "ComfyNode.vue.*(videoSeedGate|modelSupportsSeed)" || echo clean
npx vitest run 2>&1 | tail -2
```
Expected: clean; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/ComfyNode.vue
git commit -m "Adaptive inputs: seed hides on no-seed models; drop dead GenerateVideoNode gates

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Option filtering — `WIDGET_OPTIONS` + `effectiveWidgetDef`

**Files:**
- Modify: `frontend/app/components/vue-canvas/ComfyNode.vue` (registry beside `WIDGET_VISIBILITY`; the three `<VueCanvasComfyNodeWidget` template binds at ~lines 1112, 1137, 1164)

- [ ] **Step 1: Extend the lib import**

```typescript
import { allowedAspectRatios, allowedDurations, modelSupportsSeed } from '~/lib/videoModelAdapt'
```

- [ ] **Step 2: Add the options registry + resolver**

Directly below the `WIDGET_VISIBILITY` declaration, add:

```typescript
// Sibling of WIDGET_VISIBILITY: per-node option FILTERS for combo widgets.
// A rule returns the allowed values for a widget (null = leave schema options
// alone). The filtered list is intersected with the schema options and falls
// back to the schema when the intersection is empty — we never invent values
// the backend combo would reject.
const videoOptionsFilter = (name: string, values: any[], defs: any[]): string[] | null => {
  if (name !== 'duration' && name !== 'aspect_ratio') return null
  const modelIdx = defs.findIndex((d: any) => d?.name === 'model')
  if (modelIdx < 0) return null
  const id = String(values[modelIdx] ?? '')
  return name === 'duration' ? allowedDurations(id) : allowedAspectRatios(id)
}

const WIDGET_OPTIONS: Record<string, (name: string, values: any[], defs: any[]) => string[] | null> = {
  GenerateVideoNode: videoOptionsFilter,
  FilmShotNode: videoOptionsFilter,
}

// The widget def handed to ComfyNodeWidget — the original, or a shallow clone
// with filtered options. node.data.widgetDefs is NEVER mutated.
function effectiveWidgetDef(widget: any): any {
  const rule = WIDGET_OPTIONS[props.data.nodeType]
  if (!rule) return widget
  const allowed = rule(widget.name, props.data.widgetsValues || [], props.data.widgetDefs || [])
  if (!allowed) return widget
  const schema: string[] = Array.isArray(widget.options) ? widget.options : []
  const filtered = schema.filter((o: any) => allowed.includes(String(o)))
  if (filtered.length === 0 || filtered.length === schema.length) return widget
  return { ...widget, options: filtered }
}
```

(Place `effectiveWidgetDef` near `isWidgetVisible` so the per-widget helpers read together. `props` is already in scope in `<script setup>`.)

- [ ] **Step 3: Use it at the three template binds**

At each of the three `<VueCanvasComfyNodeWidget` blocks (flat ~1112, grouped ~1137, third ~1164), change `:widget-def="widget"` to `:widget-def="effectiveWidgetDef(widget)"`. Nothing else in the binds changes.

- [ ] **Step 4: Verify**

```bash
npx vue-tsc --noEmit 2>&1 | grep -iE "effectiveWidgetDef|WIDGET_OPTIONS" || echo clean
npx vitest run 2>&1 | tail -2
```
Expected: clean; all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/ComfyNode.vue
git commit -m "Adaptive inputs: duration/aspect combos filter to the selected model's values

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Snap on model change in VideoModelGalleryModal

**Files:**
- Modify: `frontend/app/components/vue-canvas/VideoModelGalleryModal.vue` (`onConfirm`, ~line 205)

- [ ] **Step 1: Import**

```typescript
import { snapWidgetsToModel } from '~/lib/videoModelAdapt'
```

- [ ] **Step 2: Apply corrections after the model write**

READ the existing `onConfirm(item: VideoModel)` (~line 205) — it writes `node.value!.data.widgetsValues[idx] = item.id` then proceeds (options-bag mirror, close). Directly AFTER the model-id write, add:

```typescript
  // Snap duration/aspect to the new model's supported values so a Veo→Kling
  // switch doesn't leave duration '8' stranded on a 5/10 model.
  const defs = node.value!.data.widgetDefs ?? []
  for (const fix of snapWidgetsToModel(defs, node.value!.data.widgetsValues ?? [], item.id)) {
    const i = defs.findIndex((d: any) => d?.name === fix.name)
    if (i >= 0) node.value!.data.widgetsValues[i] = fix.value
  }
```

(Direct mutation matches the modal's existing write idiom. If `onConfirm`'s shape differs from the description, adapt placement but keep: model write first, snap immediately after, before close.)

- [ ] **Step 3: Verify**

```bash
npx vue-tsc --noEmit 2>&1 | grep -iE "VideoModelGalleryModal" || echo clean
npx vitest run 2>&1 | tail -2
```
Expected: clean; all pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/vue-canvas/VideoModelGalleryModal.vue
git commit -m "Adaptive inputs: snap duration/aspect when the video model changes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: End-to-end verification

**Files:** none.

- [ ] **Step 1: Full suites**

```bash
cd frontend && npx vitest run            # all pass (149+ incl. 7 adapt tests)
npx vue-tsc --noEmit 2>&1 | grep -iE "videoModelAdapt|video-models|VideoModelGallery" || echo clean
```

- [ ] **Step 2: Browser smoke (manual)**

Hard-refresh the canvas tab, drop a **Film a Shot** node:
1. Default model Kling v2.5 Turbo Pro → **no Seed field**; Duration shows only 5/10.
2. Open the model gallery → pick **Veo 3.1** → Seed appears; Duration snaps to 8 and shows only 8; Aspect shows 16:9/9:16 only.
3. Pick Kling again → Seed hides; duration snaps back to 5.
4. Same checks on a **Generate Video** node.
5. Run a cheap clip to confirm nothing positional broke (widgets land in the right backend fields — the `[FilmShot]`/`[GenerateVideo]` log line shows the input keys).

- [ ] **Step 3: Done** — report results; no commit needed unless smoke surfaced fixes.

---

## Self-review notes

- **Spec coverage:** flag (T1), lib + snap (T2), visibility (T3), option filter (T4), snap wiring (T5), tests inline + smoke (T6). Ports/backend remain out of scope per spec.
- **Known judgment calls:** `seed_control` is listed in the gate even though it's already `hidden: true` (belt-and-braces, per spec). The stale `MODEL_GATED_WIDGETS.GenerateVideoNode` entry is removed as code-we're-touching cleanup sanctioned by the spec's mechanism change.
- **Type consistency:** `videoSeedGate`/`videoOptionsFilter` share the `(name, values, defs)` signature of existing registries; `snapWidgetsToModel(widgetDefs, widgetsValues, modelId)` matches between lib (T2) and call site (T5); lib imports `../data/video-models` relatively for vitest loadability.
