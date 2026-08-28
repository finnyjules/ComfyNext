# Motion — Sailor

*Drafted 2026-08-27, from the motion direction session. Companion to [VISION.md](VISION.md) — this is the wedge, expanded. Status: draft for review.*

## The claim

**Motion is where Sailor's thesis pays off hardest.** The still image is a crowded, largely solved game. The moving piece is where the market has a real hole, where ownership is hardest to get from AI, and where everything Sailor already is — procedural materials, deterministic control, taste over the whole stack — compounds instead of merely applying.

In one line: **everything on Sailor's timeline is alive until you say it's done.**

## Why motion, why now

The evidence hasn't moved since the demand research: motion is the one gap that survived adversarial verification. Canva bought an After Effects alternative and a performance-video company *on the same day* because "customers have been asking." The field bifurcates into too-hard (After Effects: gatekept by years of craft) and too-basic (template animators: your piece moves like everyone's piece). And the AI-video explosion made it worse, not better — you can now *generate* stunning motion you cannot *steer*, which is precisely the inconsistency that churns 62% of designers off AI tools. The middle — motion you can actually author, without a production team — is still open.

There are really two motions, and the market treats them as two products:

- **Design-motion** — kinetic type, animated graphics, the frame-exact craft. The Cavalry / After Effects lane. Deterministic, ownable, priced in years of learning curve.
- **Generative video** — shots, scenes, film from models. The Sora / Runway / Kling lane. Astonishing, cheap-ish, and fundamentally *accepted rather than authored*: you prompt, you get, you take it or re-roll.

Every competitor lives in one lane. Sailor's position is that these were never two products — they're two materials, and the tool that puts them **on the same timeline** wins something neither lane can build.

**Butter is the proof the middle is real — and the bar for our front door.** Butter.video is winning the easy end of design-motion with exactly the right entry gesture: a **block** (kinetic type, 3D carousel, shader effect, physics sticker) lands on the timeline *already moving*, with good defaults, and the first interface is a few dials — never a keyframe. That gesture is the standard Sailor's timeline must meet: drop a living thing, it's already good, turn a couple of dials; keyframes are the deepening, not the door. (The Elements gallery — [specs/2026-08-18-elements-gallery-design.md](superpowers/specs/2026-08-18-elements-gallery-design.md) — is this lesson already absorbed on the canvas side, with the upgrade Butter can't match: brand-kit colors on arrival, so the gallery is *your brand's* callouts, not generic presets.) Where Butter ends is where Sailor begins: a block is an effect a few dials deep — it doesn't open into anything. A Sailor clip opens into the full studio. Blocks are effects; studios are worlds. And Butter has no taste layer, no agent, and no generative-video half at all — no shots, no bridge.

## What motion does in Sailor — the living timeline

One timeline. Everything you place on it stays alive.

A clip is not a frozen file — it's a **window onto something still running.** An animated headline loops inside its window. A generated shot plays inside its window. A 3D scene turns inside its window. And anything on the timeline, you can dive into, change, and pop back out — the same move every time:

- Dive into a kinetic-type clip → the full Type studio opens, on that clip → edit → back. Instant and free, because it's procedural.
- Dive into an AI-video clip → the shot opens — prompt, cast, camera → change it → that one clip re-renders. Costs a little money and a short wait, but it is *the same gesture.*

**Nothing is frozen until export.** That single property is what separates authoring from assembling. Every other tool makes you finish things elsewhere and carry the corpses to the timeline; changing your mind means leaving, redoing, re-exporting, re-placing. Sailor's timeline is where the work *keeps happening* — which makes it the place where the explore→transform→author walk continues into time, instead of ending at a still.

To be precise about what "alive" means — because the wrong reading costs us dearly: alive is **always re-openable, and auto-refreshing when changed.** It does not mean rendered from scratch every frame. A clip that plays cached frames but re-bakes itself the instant you edit it is fully alive in every way that matters; scrubbing must stay smooth, and caching is how. The promise is *no manual export-and-replace loop*, not live rendering for its own sake.

And the two dive-ins share a *navigation*, not a clock. Inside a procedural clip everything is instant. Inside an AI clip, the cheap rungs — words, stills, the blockout — are just as instant; only the final "film it" costs money and a wait, and it says so before you commit. Same move, honest about when you're spending.

### The bridge is a consequence, not a feature

Put both motions on one living timeline and the thing everyone wants — designed motion *over* generated film — simply falls out. Your kinetic title animates over a Veo shot. Your brand's lower-third rides a Kling clip. A grey-box 3D blockout drives the video model *and* is the thing your graphics are keyed to.

Be precise about which half of this is ours, because half of it is commodity. *Overlaying* designed motion on a video file is something CapCut does for free and Butter does with blocks — anyone can import an AI clip and put text on it. What no one else has is the shot staying **directable from inside the same document**: dive into the AI clip, change the prompt, the cast, the camera, re-roll that one clip in place, with the characters holding continuity and the brand kit conditioning both halves. The overlay is table stakes. *The directable shot, next to your directable type, under one taste* — that's the bridge no one else can build without becoming a different company.

### Rising fidelity — motion you can afford to direct

Generative motion is expensive, so directing it must be cheap. On Sailor's timeline, a shot exists at **rising fidelity**: words (a beat) → a still (composition, ~free) → a grey-box 3D blocking (the motion itself, ~free, scrubbed in real time) → real video (money, gated, cost shown before you commit). The timeline is playable at *every* rung — video where it exists, stills where it doesn't — so the piece is always watchable and always the North. You direct in the cheap rungs; the expensive rung only renders what you already approved. Backtracking is editing one slot in place, never a restart.

And the grey-box rung is secretly the bridge again: the same blockout that lets you *check* the motion becomes the control signal that *drives* the video model. One asset, two jobs — previz and steering wheel.

## Why this is Sailor's to win

**Procedural materials are alive by construction.** A shader, a gradient, a type effect, a 3D scene — these don't need to be "made" animatable; they are functions of time already. The factory's whole promise — one declaration yields inspector + agent + motion + sweeps — means every material Sailor absorbs *arrives moving*. Competitors animate assets; Sailor's assets were never still.

**Determinism is the reliability answer, in the medium that needs it most.** A procedural loop renders the same every time, at any size, forever. In stills, inconsistency is an annoyance; in motion — where a client change means re-rendering a sequence — it's fatal. The deterministic half of Sailor's timeline is repeatable by construction, and it wraps the probabilistic half (the AI shots) in a frame that stays under your hand.

**Ownership shows most clearly in motion.** A still you generated might pass as yours. Motion betrays its author instantly — template motion looks like the template, prompted motion looks like the model. Motion you *scrubbed, retimed, dove into, and re-entered* — motion carrying your taste in its curves and your system in its type — is unmistakably yours. This is the thesis ("the piece you couldn't have made before is unmistakably your own") at its highest contrast.

**Taste extends into time.** A house style in Sailor already conditions gradients, type, and lighting. On the living timeline it conditions *timing* — how your brand enters, holds, breathes, and cuts. An executable brand kit that includes motion is a brand kit no LoRA can compile.

**And the agent gets a stage worth driving.** The destination — after the timeline stands — is the agent composing on it: rough-cut a piece from a brief, retime everything to a new duration, apply the brand's motion language across every clip. Against Butter specifically (no agent, no taste), an agent that directs living clips is the difference between a block library and a studio. The timeline is agent-invisible today; making it the agent's best surface is where this program ultimately points.

## What winning looks like

Paint it concretely, because "success" hides in generalities. Three altitudes.

### One afternoon, one piece

A freelancer — call her the one-person studio the vision keeps promising — gets a brief
at ten: fifteen seconds for a client's product drop, three formats, due tomorrow.

She opens the client's kit. The canvas already holds their world: the moodboard, the
characters, last month's shots. She sketches the piece as four beats — words only, free.
Two beats become stills; one needs motion she wants to *check*, so she blocks it grey-box
in 3D and scrubs the camera move until it feels right — still free. The timeline has been
playable this whole time: an animatic of stills and words that already *is* the piece,
at low fidelity.

She films the two shots that matter — the blockout drives the model, the cast holds
continuity, the cost was on the button before she clicked. Over the top: the client's
kinetic title, dropped from her Elements shelf, already in their palette, already moving
in their motion language. She retypes it; it still fits. The client calls at four —
"can the product name land two beats earlier, and warmer?" She drags the title, dives
into the shot, warms the grade word, re-rolls *that one clip* for pocket change. Nothing
else moved. Nothing was redone. Export: 16:9, 9:16, 1:1 — same living piece, three
deliveries, that evening.

The old version of this afternoon was three tools, two exports that went stale the
moment the client called, and a night of redoing. The new version is one document that
never froze. **And she is faster the second time, because nothing she learned was
tool-glue — it was all directing.**

### What her practice becomes

The piece isn't the unit anymore; the *kit* is. Her client's brand now includes how it
moves — enters, holds, breathes, cuts — and that motion language is software she owns
and rents out. Client changes stop being dreaded, because a change is an edit, not a
redo. She takes motion briefs she used to decline, because the middle that needed an
After Effects specialist or accepted a template now takes her an afternoon. Her
published pieces look like *her* — recognizably, across clients — which is the
portfolio effect no template tool can produce, and it brings the next client in.

### What Sailor becomes

The place where the open middle lives: above the template animators because the ceiling
is real studios, below the AE priesthood because the entry is drop-it-and-it-moves.
The only tool where the AI shot and the designed motion share a document and a taste —
Butter without the shallow blocks, Runway without the slot machine, and the agent
directing living clips is the demo nobody else can film. Every new material the factory
absorbs arrives on the timeline already moving, so the gap *widens* on its own.

### The signs we'd measure it by

- **The third piece takes an afternoon.** Time-to-piece collapses with practice — the
  north-star test ("more capable next time") made measurable.
- **A client change never triggers a redo.** Every revision is an in-place edit; if
  someone re-exports and re-places by hand, the spine has failed.
- **Two practitioners of five ship a motion piece to a real client** during the beta —
  primary demand evidence, at last.
- **Pieces are attributable.** Shown three Sailor pieces by three makers, people can
  tell whose is whose. Taste-over-time is working.
- **The bridge is used unprompted** — designed motion over a directed shot appears in
  real pieces without us suggesting it.

## What it is not

- **Not a video editor.** Editors arrange finished things. Sailor's timeline runs living ones; trimming is the least of what a clip can do.
- **Not a render farm for prompts.** Generation without steerability is the slot machine again, at 24 frames a second. The shot is a document you direct, not a lever you pull.
- **Not After Effects rebuilt.** The craft ceiling matters, but the entry is act-and-see: drop a living thing on the timeline and it already moves; authoring deepens from there. Nobody should need a course before their first second of motion.
- **Not a contestant in the editor-ergonomics war.** Ripple edit, markers, audio ducking, caption styling — that's the CapCut/Premiere commodity fight, unwinnable solo and worthless won. The differentiation lives *inside the clips*, never in the timeline chrome. The timeline stays minimal by policy; every "editors have X" request is judged against this line.

## The honest risks

- **Live has a physics budget.** Many living clips means many running engines; browsers cap WebGL contexts. The architecture answer (only playhead-adjacent clips run live; the rest serve cached frames) must be proven, not assumed — and note the trap: *scrubbing* sweeps the playhead across everything, so the cache must hold up exactly when the user is judging smoothness. Bar to hit before the clip cap lifts: a 30-clip timeline scrubs at 60fps.
- **Two renderers, one truth.** The browser previews; the server renders finals. Golden tests hold them together today — every new living clip kind adds to that tax and must pay it.
- **"Same gesture, different price" is a UX bet.** Diving into a free procedural clip and a $2 AI shot *feel* identical by design; the cost-confirm gate is what keeps that from becoming an expensive surprise. If the gesture ever fires money without consent, trust dies with it.
- **The quality bar for pro motion is real and unproven here.** Controllable AI motion at a bar professionals accept is still an open demand question — the wedge is evidenced, the ceiling isn't. All demand evidence remains secondary; the five-practitioner beta must include watching someone make a *motion* piece, not just stills — that's this program's demand checkpoint.
- **Butter's block ecosystem is a rival absorption engine.** Their p5.js → block → shared-and-monetized pipeline means *many hands* absorbing creative tech into their catalog, against Sailor's one factory. If that ecosystem gets network effects, it challenges the out-absorb moat structurally, not feature-by-feature. The counter must stay true to stay a counter: community blocks are shallow by construction (only the dials an author chose to expose); the factory's output is deep materials that arrive with agent + taste + motion for free. Depth-per-absorption vs. hands-per-absorption — and we should watch which one compounds faster.

## Where it starts

Not with the flashy half. The load-bearing mechanic — *dive into a living clip, edit the real studio, pop back, nothing frozen* — is proven first with the cheapest material: one procedural studio, live and editable in place, on the timeline that already ships. Then the same seam carries symbols (change once, update everywhere), then every other studio, then the AI shot. The bridge arrives not as a launch but as the day both halves are standing on the same floor.

**Elements rides this order, deliberately not first** (decided 2026-08-27). The Elements gallery — our answer to Butter's blocks, adapted to our frame with brand-kit taste on arrival — is firmly part of the strategy: it's the casual front door, the drop-it-and-it's-already-good gesture. But it's a *door*, and doors are worth more once the house behind them is standing. The spec is approved and waits behind the timeline mechanic; when Elements lands, it lands as ready-made living things that inherit everything the spine has by then — including, eventually, a place on the timeline.

First step: [specs/2026-08-27-timeline-live-studio-clip-editing-design.md](superpowers/specs/2026-08-27-timeline-live-studio-clip-editing-design.md).

**Before it: the bridge probe (one day, a few dollars).** The shipped Timeline already
plays video clips and already layers transparent Space Type clips — which means the
shallow bridge may work *today*. Make one real piece: an AI shot on the timeline, a
branded kinetic title over it, exported. It tests the wedge's demand claim with an
artifact you can show people, surfaces the real integration gaps before spec 1 commits
to a design, and it's act-and-see before build-then-run. If the piece feels flat,
that's the cheapest warning we could buy; if it sings, it's the demo and the conviction.
