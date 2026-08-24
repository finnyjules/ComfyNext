# From a prompt to the right creative in the right studio — what exists, what's missing

*2026-08-24. Codebase survey (very-thorough sweep) distilled for product decisions.
Companion question to the studio-on-demand thesis: before Sailor can "whip out the
right studio," the path from a typed sentence to a configured studio has to be solid.*

## The pipeline today, in five steps

**1. Where you type.** Two real doors: the canvas prompt bar (one field above the
toolbar) and each studio's own "Describe the look" bar (Gradient, Shader, Shape,
Texture, Vector Type, Compositor, Smart Layout all have one). Two other typed
surfaces — node search and the wire-drag suggestions — can NOT reach the studios at
all; they only see backend nodes.

**2. Picking the studio.** Two stages. First a cheap word-matching pass scores your
sentence against each studio's hand-written trigger phrases and builds a shortlist
(top candidates never cut). Then a real model (Sonnet) sees the shortlist — labelled
"PREFERRED capabilities — use these first" — and picks, constrained to a strict
command schema. Tie-breaks live as prose hints ("a gradient belongs to Gradient
Studio, not the image generator"). If your wording shares no words with any trigger
list ("make it feel like a 1970s Italian film poster"), the shortlist scores zero
everywhere and you fall through to the image generator. There are no embeddings and
no semantic fallback.

**3. Putting the studio on canvas.** The model answers "add node X"; the plan is
dry-run validated, shown as ghost nodes, and a single-studio plan skips the ceremony
and commits immediately (the "fast lane"). Solid.

**4. Configuring it to match the sentence.** The bridge is a second command
("tuneNode") the model is TOLD to emit right after adding a studio — prose
instruction, nothing enforces it, so the fast lane can land a studio on defaults.
When it fires: the studio's control list (the same ControlSpec schema everything
else derives from) + a hand-written guidance block go to a fast model (Haiku) that
returns key/value changes, range-clamped and written through the dotted-path proxy.
One prompt can set many controls at once. Gradient's guidance is excellent (presets,
synonym→knob maps, worked examples); Shader has NO guidance at all; six placeable
surfaces (Expressive/Space Type, Shot Director, Character, Collection, Moodboard,
LipSync) have no tuner — the agent parks them on defaults and apologizes.

**5. Taste.** Today taste conditions diffusion prompts only. The vibe call carries
no taste profile, no brand kit, no accept/reject history. A facet→parameter mapping
(taste dials steering ~30 studio params with gain curves) EXISTS but is wired only
to a dev page. This is the "taste over the whole stack" moat claim — built as a
spike, not shipped.

## What this means, honestly

The spine is real: sentence → studio → on canvas → configured, end to end, for the
8 tuned studios. The two weak joints are exactly the two halves of the thesis:

- **"The right studio"** is one implicit model pick with word-overlap recall in
  front of it. Nothing tries alternatives, nothing explains trade-offs, novel
  vocabulary falls through to raw generation. The Direction Loop (one prompt → a few
  materially different directions) is fully designed in code and consumed only by a
  dev page. Multi-studio exploration — the Explore axis of the vision — does not
  exist on the product path.
- **"Configured to your taste"** stops at generic guidance prose. The user's own
  dialect (what they accept, reject, re-roll) is never learned; the taste mapping
  never reaches /api/vibe.

## Gap list, ordered by leverage

1. **Enforce configure-after-place** (small): the fast lane should refuse to land a
   tunable studio without its tuneNode, or auto-fire the vibe pass. Kills the
   "studio on defaults" failure.
2. **Close the tuner gaps** (small-medium): guidance prose for Shader (its 63
   effects are the flagship material); tuners for Expressive/Space Type first (it
   routes strongly for kinetic-type asks and then can't be configured).
3. **Semantic fallback for routing** (medium): one cheap model call (or embeddings)
   when keyword recall scores ~0, so novel phrasings still find studios. The corpus
   test file is the safety net — extend it with Scene3D cases (currently zero).
4. **Ship the Direction Loop** (medium): the multi-directions machinery exists;
   surfacing 3 live studio-backed directions from one prompt is the Explore axis and
   the probabilistic-game answer. This is the "whip out the right studio" moment
   made visible — plus the routing explanation for free.
5. **Taste into the vibe call** (medium-large, the moat): thread the profile +
   the facet→param mapping + accept/reject history into /api/vibe. This is the
   un-copied claim; today it is a dev page.

## Why the factory work this week matters here

Every step above consumes the same ControlSpec schema the factory now derives
everything from. The Gradient + 3D retrofits mean: whatever the router picks and
whatever the tuner writes, the panel, agent, motion, and sweeps CANNOT disagree —
and a studio (or effect) the agent invents arrives already routable and tunable,
because its control list IS its agent interface. Routing and configuring are thin
exactly where they are not schema-derived: trigger phrases, guidance prose, taste.
The pattern that fixed the panels — one declaration, everything derives — is the
same pattern those three need.
