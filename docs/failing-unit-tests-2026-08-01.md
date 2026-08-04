# Failing unit tests — triage

*First captured 2026-08-01 at 16 failures. **Updated 2026-08-03: now 6 failures / 6124 passing.***

```bash
cd frontend && npx vitest run
```

## What changed since the first capture

| Suite | Fails | Status |
|---|---|---|
| `ticker-effect` | 4 → 0 | **Fixed** — `fa4a8e8fe` |
| `video-model-adapt` | 1 → 0 | Fixed by other work |
| `artifact-next-steps` | 2 → 0 | Fixed by other work |
| `critique-fix-chips` | 2 → 0 | Fixed by other work |
| `gradientfx-mesh` | 1 → 0 | Fixed by other work |
| `agent-capability-routing` | 2 | **still failing** |
| `gradientfx-frame-source` | 2 | **still failing** |
| `spacetype-palette` | 2 | **still failing** |

### The ticker fix, and what it teaches

The per-scene state refactor moved each effect's state from a module-level variable onto
`root.userData`, and changed the interface to `update(t01, params, root?)`. Thirteen call sites in
`tests/unit/ticker-effect.unit.spec.ts` still used the two-argument form.

Because `root` is **optional** and `update()` does `root?.userData?.tickerRows ?? []`, a call without
`root` is a **silent no-op** — the loop body never runs, geometry never changes, and the wave tests
(which assert arrays *differ* across frames) found them identical.

Two tests in that file were also passing for the wrong reason: "leaves geometry untouched when the
wave is still" and "is pure in t01" both pass trivially when nothing happens at all. They now pass
for the right reason.

> **Design note worth acting on.** `root?: THREE.Object3D` being optional is what turned a signature
> change into four silent runtime failures. Making it required would have made these compile errors
> instead. That's a 26-effect interface change, so it is a judgement call — but the current shape
> means any future caller that forgets `root` gets a frozen effect and no error.

## The 3 remaining failures

**A correction to the first version of this doc:** `spacetype-palette` was originally classified as
caused by uncommitted work because `cornerPin.ts` and `shutter.ts` are dirty. That was wrong. Their
diffs touch **only** the state refactor — `git diff` on both files matches zero occurrences of
`fillList` or `defaultFillsFor`. The failure is pre-existing and would reproduce on a clean tree.

### `spacetype-palette` (2) — pre-existing

```
expected '[{"type":"solid","a":"#15171b",…' to be '[{"type":"grid","a":"#FF6259",…'
```

The test asserts every effect's declared `fillList` default equals `defaultFillsFor(n, effectId)`.
`cornerpin` and `shutter` have hand-written defaults that don't come from the palette.

Decide which is authoritative: if all effects should seed from the palette, fix those two effects'
defaults; if these two are deliberately different, the test needs an exemption list with a comment
saying why.

### `agent-capability-routing` (2) — check against `capabilities.ts`

```
expected [ 'Compositor', 'EditImageNode', …] to include 'GradientStudio'
expected [ 'RestyleFromImageNode', …] to include 'ShaderStudio'
```

"blue to purple gradient background" no longer routes to `GradientStudio`; "give the image a glitchy
vhs vibe" no longer puts `ShaderStudio` in the top 6. `lib/agent/capabilities.ts` is currently dirty,
so re-check after that work lands. This is a **behavioural** regression in routing if it survives —
silent routing changes are hard to notice in normal use.

### `gradientfx-frame-source` (2) — environment, not logic

```
Error: document is not defined
```

The module touches the DOM at import time; vitest runs in a node environment. Note the same property
bit the embed work — `frameSource.ts` transitively pulls in Vue via a module-level `ref(0)`, which is
why `motionConfigFor` had to be relocated into the Vue-free `motion.ts`. The durable fix is to keep
pure logic out of this module rather than to stub `document`.

## Method note

`git worktree` + a symlinked `node_modules` does **not** work here for comparing against a clean
HEAD — pnpm's store uses absolute paths and every test file fails to resolve. You would need a real
install in the worktree. The classification above is from git provenance plus reading the diffs.

Before changing any test, confirm whether the code or the test is wrong. Two of the original sixteen
turned out to be lost implementations rather than stale assertions, where deleting the test would
have erased the only record the feature existed.
