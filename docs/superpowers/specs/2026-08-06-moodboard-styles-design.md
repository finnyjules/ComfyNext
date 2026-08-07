# Moodboards — taste-read styles for image generation

*2026-08-06. The productization of the executable-brand-kit spike's PASSED diffusion
channel ([spike + verdict](../spikes/2026-08-05-executable-brand-kit-spike.md)). Child of
the vision work in [2026-08-04-per-surface-roadmap-design.md](2026-08-04-per-surface-roadmap-design.md).*

## In plain language

Today, getting your aesthetic into Sailor's image generation means training a LoRA or
hand-writing a taste profile. This adds a third door, and it is the easiest one: **drop a
moodboard — 5 to 20 images you love — and Sailor reads it.** It shows you, in plain words,
what it sees; you correct anything it got wrong; you save. From then on the moodboard sits in the style gallery like any
style, and applying it to a generation steers the output into your board's world.

No training run, no cost beyond pennies, and — unlike every competitor's style tool — the
reading is text you can open and edit, not an opaque code.

The moodboard is a **canvas citizen**: a node you add from the toolbar, showing its images
as a small collage face — inspiration living next to the work. Opening it is where you
drop images and edit the reading; the style gallery is where you apply it.

## Why this, why now

The spike proved this channel end to end: Fable's reading of a real board was a bullseye,
and the style block moved a fixed-seed FLUX render unmistakably into the board's world at
$0.003/image. The procedural channel failed its runs (brief→config translation is
immature) and explicitly queues behind the agent-fidelity workstream. **The verdict
inverted the build order: diffusion first.**

**Run 8 (the five-model bake-off) then settled the channel question:** prose alone carries
a style's world and hues but loses its texture on every FLUX tier ("meets halfway"), while
**the board's own images riding along as references delivered full transfer including
texture** (Nano Banana Pro via the existing `nano-gen` route, which now has automatic fal
failover). The finding — *prose carries the world, references carry the finish* — is why
references are v1 scope below, not a fast-follow: without them, v1 ships the lukewarm
version of the experience.

## The object

A **Moodboard** = images + reading + identity, living in an **app-level library** (the
brand-kit precedent: server-side entries, referenced by id):

```
{ id, name, createdAt,
  folder,                      // server-side image folder (evidence survives; re-readable)
  reading: {
    summary: string,           // "what it sees" — editable prose, the heart of the object
    palette: {name, hex}[],    // CURATED (Fable-named), editable — never raw k-means
    avoids: string[],          // editable chips
  } }
```

**Ownership: the library owns; nodes reference.** A canvas MoodboardNode points at a
moodboard by id. Adding a node creates a draft entry; deleting a node never deletes the
moodboard; the same moodboard can sit on several canvases; gallery and node always show
the same current version.

Two palettes exist in the pipeline but only one is stored as design: the k-means
measurement stays spike/evidence tooling; **the moodboard persists the curated palette
Fable names** (spike run 6: measurement ≠ design; shadow clusters poison enforcement).

## The flow

### The node
**MoodboardNode** in the Add menu / toolbar — the canvas artifact. Its face is a **messy
pile**, not a grid: the top 3–5 images overlapping with slight rotations (±3–7°) and
offsets, top image dominant, soft shadows between layers, a count badge when more are
buried. Inspiration reads as collected, not produced — and nothing else on the canvas
looks like a pile, so it's recognizable at any zoom. It rhymes with the sketch-deck idiom
that already lives on the canvas.

Craft rules: the scatter is **seeded from image ids** (stable across re-renders — never
`Math.random` at frame time), hover fans the pile a few degrees and settles back, the
empty state is a dashed pile outline ("drop inspiration"), and the whole face fits the
standard node capsule footprint. Double-open follows the studio grammar every surface
already uses: node → modal editor. Dropping images directly onto the node is a
nice-to-have, not v1-required.

### Create / edit — the modal
Reached from the node (primary) or from the gallery's **Moodboards** tab
(**"＋ New moodboard"** creates a node-less library entry; editing an applied moodboard
opens the same modal).

**The modal reads as a brand-guidelines document, not a form** (Julien's call, mocked and
approved): a floating section nav on the left (`00 Board · 01 Reading · 02 Palette ·
03 Avoids`, active section tracking scroll), scrollable numbered sections on the right in
the Book grammar — one document grid, hairlines between sections, the board opening as
full-bleed plates. A floating footer carries Re-read · Save. This is deliberately the
same register the future Kits space uses — the moodboard modal is its seed. Content flow:

1. **Drop 5–20 images** (decoded client-side like the taste wall; JPEG-downscaled before
   upload). Thumbnails appear as a small board.
2. **Read** — one Fable vision call (key from Settings → AI, the product path — not a
   BYOK field). Output rendered as:
   - the **summary** in an editable text area — displayed as prose, prominently; this is
     the show-you-understood moment the spike proved,
   - the **curated palette** as named, strikeable swatches,
   - the **avoids** as editable chips (add/remove).
   Everything editable before save — the correction *is* the authorship.
3. **Name + Save.** Images upload to a server-side folder (the training-dataset storage
   pattern, own `moodboard_<ms>` prefix — the dataset routes' `FOLDER_RE` admits only
   `lora_dataset_\d+`, so moodboards get their own minimal list/serve routes rather than
   widening a guard that protects training data). Reading persists as a JSON sidecar in
   the same store the style gallery lists.

### Apply
Pick a moodboard into any LoRA slot from its tab. The slot renders the standard picked
card (name + a small board-strip thumbnail). At generation time `composeLoraStyle()`
injects the structured block:

```
In the style of: <summary>. Palette: <named hexes>. Avoid: <avoids>.
```

**Weightless-slot support is the one plumbing change:** a slot holding a moodboard skips
the LoRA URL/scale entirely (no weights exist) while contributing its block. Scale/trigger
UI hides for moodboard slots; reveal-next-slot logic treats them as filled.

**Stacking is free:** slots already compose — character in A, moodboard in B, trained
style in C. Each contributes its block in slot order via the per-slot `aesthetic_*` keys
that landed with multi-LoRA.

**References ride along where the model can take them (v1, per run 8).** When a moodboard
is applied (slot or wire) to a generation whose model accepts image conditioning, 2–3
board exemplars attach automatically with the style-only instruction proven on the wall
("match palette, light, grain and mood; do not copy subjects or composition") — the
`nano-gen` path (`image_input`, fal failover) is the proven implementation. Models without
image conditioning get prose-only, unchanged. **Plan-level recon task: enumerate which of
the product's generator nodes are ref-capable today** — the mechanism ships v1 on
whichever ones are; widening model coverage is the fast-follow, not the mechanism.

### Edit / evolve
Opening an existing moodboard from the gallery reopens the same modal: board shown,
reading editable, **Re-read** button (re-runs Fable over the stored images — evidence
survives precisely for this), save.

## The spectrum of commitment — moodboards as the LoRA alternative

The moodboard is the entry tier of a deliberate spectrum:

> **Read it** (free, instant, editable) → **read + reference** (cents: 2–3 board
> exemplars ride along as image conditioning — the sref mechanism, **proven in run 8,
> v1 on ref-capable models**) → **train it** (dollars, when the style earns weights).

Prose carries a style's *world* (palette, light, mood, era, composition) — most
sref-class aesthetics live entirely there. Weights remain for texture signatures,
identity, and high-volume consistency. **The stored board folder is shaped like a
training dataset, so "Train a LoRA from this board" is a one-click upgrade path** —
same evidence, escalated commitment (fast-follow). The LoRA Trainer becomes taste's
premium tier, not its entry gate.

**Named use case: sref boards.** Midjourney sref sample grids (usually composite
images) read fine as dropped screenshots — v1 supports this with zero extra work. A
future catalog play curates popular aesthetics into **house moodboards** at zero
training cost; hygiene rule pinned now: derived prose ships, source grids never do —
each house moodboard's thumbnail is *generated with its own derived style*.

## Convergence with trained styles (fast-follow, not v1)
The Style Publisher's "rewrite profile from training images" flow is the same read aimed
at a LoRA's dataset. Once both exist, trained styles and moodboards are one family — some
have weights, all have readable taste. Not in v1 scope; noted so the endpoint is built
shareable.

## Ports — what wires in v1, and the pinned design for what follows

**v1 ships the node whole: taste out AND images out.** A portless node in a node-graph
tool is a decoration, and is explicitly rejected — and the taste port is the node's
*identity*, so it does not wait for a fast-follow.

- **`style` output (taste-typed)** — the node's primary port, carrying the READING itself
  (summary, palette, avoids), never a pre-flattened string. The consumer compiles:
  a generator compiles it to the prompt block at run time; a procedural studio compiles
  it to a config later, when agent fidelity lands. One edge type, every future consumer.
- **`image` output** — a board image (top of pile by default, pickable), wirable into
  anything that accepts IMAGE today. The board's images also join the **@refs registry**.

**Consumer side, v1: two generator nodes** (the same two the Idea node design scoped —
not all fifty models) gain TWO new inputs together, in one schema change, **appended
never inserted** (the multi-LoRA positional-widget lesson; guard tests exist):
- `style_in` — accepts the taste edge; at run the reading compiles to the block. Wired
  style and slot styles coexist and concatenate — wire first (ambient influence), slots
  after (per-node picks) — through the existing `composeLoraStyle` composition.
- `prompt_in` — plain text, the *subject/intent*. This is the Idea node's socket landing
  as a free rider: subject and style must be wirable *simultaneously* (an Idea node
  saying what, a moodboard saying how it feels, into the same generator), and one
  substrate change serves both features.

Slot-apply remains alongside the wire, same duality as images: wire it, or pick it
per-node.

## Out of scope, deliberately
- **No kit-finish pass on generated outputs** — the Compositor-grain enforcement proven on
  the wall ("the kit guarantees the finish") is the named NEXT fast-follow after v1, not
  in it: it needs a home in the generation result flow, which is its own small design.
- **No in-modal preview and no fonts section** — cut by Julien ("they serve no purpose"):
  the first real generation IS the preview, and fonts return only when something consumes
  them. The reading drops the `fonts` field entirely for v1.
- **No strength dial** — apply is on/off per slot (prompt blocks don't dial cleanly; a
  wording-based strength is a later experiment).
- **No facet bars** in the modal — the 12-facet reading is spike instrumentation; the
  product shows summary/palette/avoids only. Facets stay in the API response for future
  consumers (the Kits space, procedural channel).
- **No procedural channel** — gated on agent fidelity per the verdict.
- **No Kits space** — this ships inside the existing gallery; the Kits space later
  absorbs moodboards as its Board pane, vocabulary intact.
- **No board editing after creation beyond re-read** (add/remove images is v1.1).

## Error and edge states
- Read fails (no key / refusal / unparseable): modal keeps the board, shows the error
  plainly, offers retry — never saves a moodboard without a reading.
- Fewer than 5 images: allowed with a soft warning ("more images read better").
- A moodboard slot on a deployed server behaves identically (no weights to miss).

## Testing
Unit: block composition (summary+palette+avoids, empty parts omitted — extend the spike's
`styleBlock` tests), weightless-slot handling in `composeLoraStyle` order/keys, sidecar
round-trip, folder-route guards (path traversal, prefix), taste-edge compile (reading →
block at run time), ref-attachment gating (ref-capable model gets exemplars + style-only
instruction; non-capable gets prose only — a broken gate must fail), pile-face scatter
determinism (same ids → same layout). E2E: create-from-drop with a mocked read → save →
appears in tab → pick into slot B → prompt payload carries the block (assert on the
composed prompt, not just UI); wire taste edge → same assertion; saved-workflow round-trip
proving appended inputs shift no positional widget values. Broken-control discipline
throughout. The live Fable read and one real tasted generation get a manual checklist
run (paid-verification pattern).

## Done when
A user can add a MoodboardNode from the toolbar, drop images into its modal,
read+correct, save a named moodboard, see it in the gallery's Moodboards tab,
apply it to any slot alone or stacked, **wire the node's taste output into a generator's
`style_in` and see the block in the composed prompt, wire a board image into an
image-accepting input, and reference board images via @refs** — verified live end to end
including a saved-workflow round-trip proving the appended inputs shift no positional
widget values, with the reading editable at every step, and node deletion leaving the
library entry intact.
