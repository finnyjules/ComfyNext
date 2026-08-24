# 3D Studio — full schema derivation (parity with Gradient)

*2026-08-24. Follow-up to the derived-inspector retrofit (same-day). Approved: Julien ("go for it").*

## In simple terms

After yesterday's retrofit, Gradient is fully automatic: add a control to its list and
it appears in the panel, wired. 3D Studio is not — it has two hand-kept gatekeeper
lists, so a new control added to its schema is silently invisible and unwritable. Its
Transform section also stayed hand-written (the shared slider clamps typed numbers;
Transform's real inputs are unbounded), its dropdowns show raw values like `shader`
where the old buttons said "Effect", and three whole sections (Geometry, Light, Decal)
were never in the schema at all.

This change closes all four gaps. Afterwards, 3D Studio behaves like Gradient: a
control declared in the list appears, is writable, shows friendly names, and the only
hand-written panel areas left are genuine editors (object tree, sculpt, merge, motion
pickers, add-menus). That is the precondition for "an agent invents a control — or a
whole studio's worth of them — and they just work."

What could go wrong: loosening the gatekeepers could let a bad key silently write a
dead property (the known dotted-path hazard); the unclamped-entry row could regress
every other studio's sliders; new Geometry/Light/Decal schema entries could leak into
the agent/motion/sweep vocabularies unintentionally. Each risk gets a named guard.

## Scope

**In (four parts, sequenced):**
A. **Permissive panel** — replace `panelCardOf`'s key allow-list and `setControl`'s
   whitelist dispatch with fall-throughs (unknown Material-group key → drawn in the
   Material card, sorted last; unknown key writes via the generic dotted-path route
   the post block already uses). Guard: a test injecting a novel schema entry asserts
   it is drawn AND a write round-trips onto the doc. The dead-property hazard is
   handled the same way Gradient handles it: keys must address a real leaf; the guard
   test writes then reads back through the same proxy.
B. **Soft-range row + Transform migration** — a new opt-in on slider ControlSpecs
   (`entry: 'unclamped'` or similar): min/max/step still drive the track, fill, and
   drag scrubbing, but typed entry and arrow-keys are NOT clamped (arrows step from
   the current value even out of range; a click on the track still jumps within
   range). Implemented in the shared row machinery (`lib/studio/row.ts` `parseTyped`,
   `scrub.ts`, `StudioRow.vue`) with characterization tests for BOTH modes (default
   behavior byte-identical). Then Transform's nine rows migrate to the panel using it
   — reinstating the reverted migration, this time without the data-destruction
   hazard (the x=35 arrow-press case becomes a test).
   NOTE: `StudioRow.vue` carries another session's uncommitted readout-interaction
   WIP — commits must stage only this work's hunks (`git apply --cached`), never the
   readout WIP.
C. **Option display labels** — `optionLabels?: string[]` (parallel to `options`) on
   the select ControlSpec + `RowSelect` support. Applied to: 3D Relief
   (None/Effect/Image), 3D Palette/Type/Shading pills' successors where text drifted,
   Gradient `focus.shape` (restore the "Off — blur everything" prose), and Gradient
   `layer.ramp.shape`'s row label back to "Shape". Stored values NEVER change.
D. **Geometry, Light, Decal join the schema** — every template row in those three
   sections becomes a schema entry (`agent: false, animatable: false` — deliberate
   quiet landing; granting the agent these is a separate later decision), with
   per-primitive/per-kind `when` gating mirroring the template, characterization
   spec transcribed from the template BEFORE the swap (same discipline as the
   retrofit), then the template sections swap to the panel. Bespoke bits stay as
   anchors (light type buttons if they are a button grid, decal image picker,
   modifier axis buttons, cloner mode buttons).

**Out:** object-motion selects (bespoke, stays), sculpt/merge, object tree,
add-object menus, GLB import, agent/motion GRANTS for the new entries (explicitly a
later decision), any Gradient work beyond the two label fixes in C.

## Constraints (same as the retrofit, they worked)

- Template wins on every disagreement; characterization first for D.
- Agent, motion, and sweep vocabularies stay byte-identical throughout (dump-diff
  before/after per part; the only allowed diffs are NONE — parts A–D grant nothing).
- Persisted keys frozen. Snapshot changes: none expected; any is a stop-and-look.
- No new typecheck errors naming touched files (baseline 420). Full covering-spec runs
  per part; live browser verification at the end (both studios, including the x=35
  Transform case and a novel-key injection smoke).
- Commit hygiene: own hunks only; StudioRow WIP untouched.

## Sequencing

A (unblocks everything, smallest) → B (shared row + Transform) → C (labels) → D (the
long tail, biggest). Each part lands independently; D can slip without hurting A–C.
