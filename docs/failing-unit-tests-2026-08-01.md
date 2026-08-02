# 16 failing unit tests — triage and handoff

*Captured 2026-08-01 at `aab1e2cd3`. Suite state: **6020 passing / 16 failing** across 8 files.*

Run the suite with:

```bash
cd frontend && npx vitest run
```

## The one thing to know first

**10 of the 16 belong to uncommitted work in the tree; only 6 are broken on `main`.**

Every failing suite whose *subject module* is currently dirty is very likely failing because that
work is unfinished — not because the test is wrong. Fixing those by editing tests would paper over
someone's in-flight change.

| Failing suite | Fails | Subject module | Dirty? | Whose problem |
|---|---|---|---|---|
| `ticker-effect` | 4 | `lib/spacetype/effects/ticker.ts` | **dirty** | in-flight work |
| `agent-capability-routing` | 2 | `lib/agent/capabilities.ts` | **dirty** | in-flight work |
| `gradientfx-frame-source` | 2 | `lib/gradientfx/frameSource.ts` | **dirty** | in-flight work |
| `spacetype-palette` | 2 | `effects/cornerPin.ts`, `effects/shutter.ts` | **dirty** | in-flight work |
| `gradientfx-mesh` | 1 | `lib/gradientfx/shaders.ts` | clean | **real, on main** |
| `video-model-adapt` | 1 | `data/video-models.ts` | clean | **real, on main** |
| `artifact-next-steps` | 2 | `lib/artifact/nextSteps.ts` | clean | **real, on main** |
| `critique-fix-chips` | 2 | `composables/useNextStepsStrip.ts` | clean | **real, on main** |

Verify the split yourself before acting — it will have moved as work lands:

```bash
git status --short frontend/app/lib/spacetype/effects/ticker.ts
```

A clean-worktree comparison would be more rigorous, but note that `git worktree` + a symlinked
`node_modules` does **not** work here — pnpm's store uses absolute paths and every test file fails
to resolve. You would need a real install in the worktree.

---

## The 6 real ones — fix these

### 1–2. `artifact-next-steps` (2) and `critique-fix-chips` (2)

```
TypeError: s.announceFreshTake is not a function
```

**This is a lost method, not a stale test.** `announceFreshTake` now appears *only* in the two test
files — there is no implementation anywhere in `frontend/app`. It used to exist:

- added by `08b02eecc feat(artifact-actions): singleton next-steps strip coordination composable`
- and `8a5989403 feat(artifact-actions): post-render next-steps chip strip on image artifacts`
- then disappeared in `c502c8e90 wip: snapshot working state before litegraph divorce (user-requested sweep commit)`

A sweep commit dropped it and left the tests behind.

**Do this:** recover the original implementation and decide whether it should come back.

```bash
git show 8a5989403 -- frontend/app/composables/useNextStepsStrip.ts
git show c502c8e90 -- frontend/app/composables/useNextStepsStrip.ts
```

If the strip feature is still wanted, restore the method. If it was deliberately retired, delete the
tests *and* whatever else references the strip — but only after confirming that, because right now
the tests are the only surviving record that it existed.

### 3. `gradientfx-mesh` (1)

```
AssertionError: expected '#version 300 es…' to contain 'u_flowOffset'
```

`u_flowOffset` has **zero occurrences** in `lib/gradientfx/shaders.ts` today. Same shape as above —
the token was removed and the test was left behind.

**Do this:** find when it went and whether flow offset still works by another name.

```bash
git log --oneline -S"u_flowOffset" -- frontend/app/lib/gradientfx/
```

If the uniform was renamed, update the test to the new name. If the capability was lost, that is a
real gradient regression — flow is one of the parameters the Act 1 work made animatable.

### 4. `video-model-adapt` (1)

```
AssertionError: expected [ '4', '6', '8' ] to deeply equal [ '8' ]
```

The committed data says veo-3.1 offers durations 4, 6 and 8; the test expects only 8. One of them is
wrong about the real model.

**Do this:** check what veo-3.1 actually accepts before touching either side. If the data is right,
the test is stale — fix the test. If the test is right, the data will produce API calls the model
rejects, which is the worse failure and worth fixing properly.

```bash
grep -n "veo-3.1" -A 6 frontend/app/data/video-models.ts
```

---

## The 10 WIP-linked ones — do not "fix" these

Leave them until the owning work lands, then re-run. If they still fail afterwards, *then* they are
real. Notes in case they turn out to be real:

- **`ticker-effect` (4)** — the assertions are `not.toEqual` checks that the travelling wave re-bakes
  geometry as it advances. They now find the arrays *identical*, i.e. the wave has stopped
  advancing. `ticker.ts` is mid-edit as part of a 25-file sweep moving per-effect state off module
  singletons onto `root.userData` — an incomplete conversion here would produce exactly this
  symptom, since a stale or shared state object would make every frame identical.
- **`spacetype-palette` (2)** — `cornerpin` and `shutter` fill defaults now come back as `solid` with
  different colours where the test expects a seeded `grid` palette prefix. Both effects are in that
  same sweep.
- **`agent-capability-routing` (2)** — "blue to purple gradient background" no longer routes to
  `GradientStudio`, and "glitchy vhs vibe" no longer puts `ShaderStudio` in the top 6. `capabilities.ts`
  is dirty. This is a **behavioural** regression in routing, so worth checking carefully once that
  work settles — silent routing changes are hard to notice in use.
- **`gradientfx-frame-source` (2)** — `Error: document is not defined`. The module touches the DOM at
  import time, which vitest's node environment has no answer for. Note this same property bit the
  embed work: `frameSource.ts` transitively pulls in Vue via a module-level `ref(0)`, which is why
  `motionConfigFor` had to be moved into the Vue-free `motion.ts`. The durable fix is to keep pure
  logic out of this module rather than to stub `document`.

---

## Suggested prompt for a fresh session

> Read `docs/failing-unit-tests-2026-08-01.md`. Fix only the 6 failures listed under "The 6 real
> ones" — leave the 10 WIP-linked ones alone. Before changing any test, confirm whether the code or
> the test is wrong; two of these are lost implementations, not stale assertions, so deleting the
> test would erase the only record that the feature existed. Re-run `cd frontend && npx vitest run`
> and report the before/after counts.
