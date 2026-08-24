# Derived Inspector Retrofit — Gradient + 3D Studio panels drawn from the control list

*2026-08-24. Companion to ROADMAP.md Act 1. Approved direction: Julien, 2026-08-24 ("run with it").*

## In simple terms

Every studio keeps a list describing its controls (name, range, group). The agent,
animation, and batch variations already read that list. But the panels you see in
Gradient and 3D Studio are still built by hand, control by control — the same facts
written twice. This change deletes the hand-written copies and lets the panel draw
itself from the list, the way Texture, Shape and Vector Type panels already do.

Afterwards the panels should look and behave **the same**. What changes is under the
hood: one copy instead of two, and any future control added to the list appears in
the panel automatically — which is also the door-opener for the agent inventing
controls at runtime.

What could go wrong: a control could silently vanish, get the wrong range, or lose
its show/hide rule. The whole verification strategy is built around catching exactly
that.

## Scope

**In:**
1. **Gradient Studio — full retrofit** of the hand-written Design sections
   (Canvas, Color, Curve, Flow, Depth & light, Liquid surface, Mesh, Relief, Focus,
   Layer, Shape) to `StudioControlPanel` driven by `GRADIENT_CONTROLS`.
   The roadmap names this the Act 1 legacy proof ("delete ~500 lines of inspector markup").
2. **3D Studio — schema-backed sections only**: Transform, Material, Camera, Lighting,
   plus Background's two switches (`showFloor`, transparent background) and the
   Material `unlit` switch **added to `SCENE_CONTROLS`** as `switch` entries (closing
   documented schema gaps).
3. Small, generic extensions to the shared panel where the old sections need them
   (see Design), each reusable by every studio.

**Out (unchanged, stays hand-written):**
- Bespoke editors: Gradient's layer stack, colour-stop/ramp editor, mesh point
  add/remove rows, curve-handle preview overlay; 3D's object tree, geometry
  per-primitive params, Light/Decal sections, object motion, sculpt/merge, export
  footers, Motion sections. These are real editors, not rows — they keep their code
  and mount via the panel's `#section-<Title>` / `#control-<key>` slots or stay
  outside the panel entirely.
- Any behavior change visible to the user. Parity is the contract.
- Agent/motion/sweep derivations — already schema-driven; must not regress
  (characterization snapshots pin them).

## Design

**The move.** Both surfaces already run `StudioControlPanel` for their post-effects
sections (`order: POST_SECTIONS`). The retrofit extends `order` to the full design
section list (`GRADIENT_SECTIONS` / a new `SCENE_SECTIONS`), deletes the hand-written
section markup, and wires the same four props the post block already uses: `value`
(dotted-path read), `@set` (dotted-path write), `boundFor`, `@promote/@menu`.
Visibility = the schema's `when:` clauses via each studio's existing
`visibleGradientControls` / `visibleSceneControls`, passed as the panel's `visible`
callback — the same rules the agent already obeys, so panel and agent can no longer
disagree.

**Shared-panel extensions** (generic, schema-level, all optional):
1. `ControlMeta.bindable?: false` — honored by `StudioSectionTree` (today bindable is
   derived from kind alone). Needed by Gradient's Shape section, whose rows are
   `:bindable="false"` today.
2. Per-section chrome: badge text and default-open state. Mechanism: a
   `sections?: Record<title, { badge?: string | (() => string); open?: boolean | (() => boolean) }>`
   prop on `StudioControlPanel`, threaded to `StudioSection`. (Today the tree
   hardcodes open unless a `sectionToggle` exists.)
3. Dynamic label/bounds rows (e.g. Shape's "Ring count 2–40" vs "Count 2–64" by
   layout): expressed as **two schema entries with the same key and complementary
   `when:` clauses** — pure schema, no panel change; every consumer already applies
   `when`. Where that's awkward, the row becomes a `#control-<key>` slot instead.

**Schema additions (3D):** `object.material.unlit`, `showFloor`, `background.transparent`
as `switch` kind. Note the opt-out contract: adding them grants agent + sweeps by
default. That grant is *intended* (it closes the documented "hand-omitted booleans"
gap) and will be a deliberate snapshot update, called out in its own commit.

**Deletions:** the migrated template sections and their script-side v-model proxies
(`flowSpeed`, `flowProxy`, `mat*` computeds for migrated rows, etc.). A proxy stays
only if a surviving bespoke block uses it.

## Error handling / failure modes

- **A key in the schema that doesn't resolve on the config** writes a dead property
  (the known `makeConfigParams` hazard). Mitigation: the parity test (below) reads
  every migrated key through the same proxy the panel uses and asserts a defined,
  round-trippable value.
- **Over/under-hiding**: `when:` in the schema vs `v-if` in the old template can
  disagree. Every migrated section's gating is compared 1:1 during migration; any
  disagreement is resolved by matching the OLD PANEL's behavior (it is the shipped
  truth), and noted in the plan task.
- **Duplicate keys** (design decision 3): visibleness must select exactly one at any
  config state; a unit test sweeps layouts and asserts no two visible controls share
  a key.

## Testing

1. **Characterization first (before any template change):** for each surface, a unit
   spec enumerating the hand-written rows as they exist today — key, label, min/max/
   step/options, bindable, section, gating condition per relevant config state —
   captured from the recon table into a literal expectation. The migration must
   reproduce this table from `groupIntoSections(CONTROLS, order, visible)`. This is
   the parity contract; it fails if a control vanishes or drifts.
2. **Existing pinned snapshots** (agent grants, animatable targets) must not change
   except the three deliberate 3D switch additions.
3. **Live browser verification** (per `graceful-fallback-hides-integration-failure`:
   "it rendered" is not evidence): dev server, open each studio, per section move one
   control and observe the preview change; flip layout modes (linear/radial/liquid/
   mesh/banded; material types in 3D) and check sections/controls appear and
   disappear per the old rules; right-click-bind and promote one control; check the
   Shape section offers no bind. Screenshot per section, before vs after, compared.
4. **Baselines:** typecheck (~328 pre-existing), full unit suite, both run before and
   after; no new failures.

## Sequencing (implementation plan will detail)

1. Shared-panel extensions + their unit specs (no surface touched yet).
2. Gradient characterization spec → migrate section by section (template-only
   commits) → delete dead proxies → live verify.
3. Scene3D schema additions (deliberate snapshot update) → characterization →
   migrate the four schema-backed sections → live verify.
4. Docs: STATE.md surface table (Scene3D agent column is stale), ROADMAP Act 1
   status, dashboard artifact.

Gradient lands even if Scene3D slips — they are independent proofs, in this order
because Gradient is the named roadmap target and the higher-coverage, lower-risk one.
