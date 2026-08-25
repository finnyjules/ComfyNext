# Texture Studio "Chips" mode — terrazzo and friends (Act 2, family 1 kickoff)

*2026-08-25. Driven by a live failure: "make me a seamless terrazzo pattern" routed
correctly, tuned plausibly, and rendered polka-dot wallpaper — because every Texture
Studio mode is a regular lattice tiling and terrazzo is irregular scattered chips.
Approved: Julien ("go for it").*

## In simple terms

Texture Studio gets one genuinely new kind of content: **chips** — irregular cells
scattered across the tile, each its own size and colour, with grout between them.
That one engine gives terrazzo, mosaic, pebbles, stained-glass, camo-ish looks from
the same knobs. It also fixes two agent honesty problems the failure exposed: the
proposal list showed a change to a value it already had (`square → square`), and the
tuner has no way to say "closest I can do is an approximation."

Technique: cell noise (Worley) — hash a grid of feature points, colour each pixel by
its nearest point, grout where first- and second-nearest are nearly tied. Seamless by
wrapped math, no new dependencies, and it fits the studio's existing architecture
exactly (fragment shader + a pure-TS twin of the same math).

## Scope

**In:**
1. **No-op proposal filter** (all studios): a proposed change whose value equals the
   current value is dropped before display. Unit-tested at the proposal-build seam.
2. **Honesty clause** in the texture tuner's prompt/guidance: when the requested look
   is outside the studio's vocabulary, pick the closest configuration AND say in the
   message that it is an approximation of X. (Generic wording — lives with the
   texture command-surface describe/hints; other studios can copy later.)
3. **Mode `'chips'`** in texturefx: new MODES entry; pure-TS math in pattern.ts
   (`chipColor`-style twin, unit-testable) + the mirroring fragment-shader branch in
   renderer.ts; ControlSpec entries in controls.ts (group 'Chips', `when isChips`):
   density (cells across, ~4..24), grout width, chip size variance (per-cell hashed
   radius scale), chip irregularity/roundness lever if the metric supports it
   cheaply, and colour-jitter's `when` extended to chips. Colours ride the EXISTING
   role/fill system (chips cycle the ink roles; ground = the ground role) so the
   palette pickers, fills, and post stack work unchanged. Seed rides the existing
   Roll button (seed lives outside the control list — keep that).
4. **Terrazzo recipe** in the tuner guidance: "terrazzo/speckled stone" → chips mode
   + high size variance + thin grout + off-white ground + 3-4 muted ink chips.
5. **Corpus/live**: the routing corpus already sends terrazzo → TextureStudio; add
   engine-level unit tests + a live browser verification that the prompt now ends in
   something that actually reads as terrazzo.

**Out:** data-driven point INPUT (the family's port stressor — later; seeds are
hashed from the seed integer for now), motion (Texture Studio has none), SVG export
(raster studio), new studio surfaces, d3-delaunay (not needed — Worley replaces it).

## Constraints

- Factory rules: the ControlSpec additions are the ONLY declaration — panel, agent,
  sweeps must derive (this is the factory's first genuinely NEW capability since the
  retrofit; treat any hand-written panel/agent code for these controls as a defect).
- Persisted param keys frozen once merged; `mode` value `'chips'` is additive.
- CPU twin and shader must share source or constants where the existing pattern does
  (truchetStates precedent); unit tests pin the CPU twin: determinism by seed,
  seamlessness (value at x=0 equals x=1 wrap for a ring of sample points),
  input correlation (grout width up → ground-colour share up; size variance 0 →
  near-uniform cell areas), palette roles respected.
- Agent vocabulary: the new controls arrive agent-VISIBLE by default (opt-out model)
  — this is a deliberate grant, called out in the commit; snapshots updated once.
- Live proof: type the terrazzo prompt in the real canvas bar and screenshot the
  result (the whole point of the exercise).
