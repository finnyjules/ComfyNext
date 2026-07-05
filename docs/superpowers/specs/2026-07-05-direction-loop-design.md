# Direction Loop — design spec

*2026-07-05. Status: design, pre-build.*

## North star
**The user directs; the AI executes.** People are better at *reacting* than at *creating from a blank page* — so the loop's job is to keep putting good, distinct **directions** in front of the user and let their picks steer. The AI proposes; the human judges; the AI breeds the judgment. We never claim to know what's *good* — we propose diverse, sensible options and let taste stay human. (See [[agentic-north-star]].)

## The loop
```
Generate ─▶ DIVERGE (propose directions, as text — free)
                     │  pick one (or a few, or write your own)
                     ▼
              COMMIT (render only the picked direction — paid)
                     │  result lands in the vertical stack
                     ▼
              BREED  ("more like this" → diverge again, refinements)
                     └──▲  or EXPLORE (diverge again, lateral)
```
Two costs, kept separate:
- **Divergence is free + instant** — proposing directions is a text/vision call (fraction of a cent, sub-second).
- **Rendering is slow + paid** — only happens on a greenlit direction (~$0.04/image).

Generating N images upfront spends N× to render directions the user discards in seconds. Propose-then-render is cheaper, faster, and more like directing.

## UI (lightweight)
- **A one-line list**, not a form. Each direction = a short chip-sized label (2–4 words) + a leading dot. Tap = render. Hover = a small tooltip with the one-liner + cost. No badges/descriptions/prompt-diffs inline.
- A **"＋ your own…"** row — the user's typed direction is a first-class option beside the AI's.
- **Axis convention:** the pipeline flows **→ right** (generate → edit → upscale); exploration grows **↓ down**. Rendered picks stack vertically as cards; each card can breed further (indented branch = visible funnel).
- **Escape hatches:** multi-select to render 2–3 at once; "render all" for a full contact sheet when you *want* to see, not read.
- Rendered results reuse the existing **Takes** system (non-destructive, `node.data.takes`).

## The hard part: proposing directions that *make sense*
Not a fixed menu. A **vision call on the actual rendered image** + the brief. Same engine as the result-critique (`buildResultReviewPrompt`), pointed at a different question: critique asks *"what's wrong?"*; this asks *"what are the interesting forks from here?"*

A direction "makes sense" iff it is:
1. **Grounded** — responds to what the image *actually is* (don't offer "warmer" if it's already warm; if the background is dead, "fill the bar with life" is a real lever).
2. **On-brief** — explores *within* the request; never abandons it (no "make it watercolor" for a "GTA-style" ask).
3. **Distinct** — each of the 3–4 is a *different kind* of change (lighting / framing / content / interpretation), not four palette tweaks.
4. **Has headroom** — only where there's real room to move and plausible upside.

"Makes sense" is *relevance + distinctness + headroom + intent-fidelity* — all judgeable. It is **not** a taste verdict (those stay off-limits).

### Two flavors (the gesture picks which)
- **Explore** (first divergence, or "none of these") → *lateral alternatives*: different valid takes.
- **Refine** ("more like this" on a keeper) → *nudges*: smaller mutations around the kept image along one axis; keep the seed, jitter prompt/strength.

## The prompt (draft — to pressure-test)
`buildDirectionsPrompt(intent, mode, n)` → attach the rendered image; structured output.

> You are a sharp art director. The ATTACHED IMAGE was generated for this brief: "{intent}". Propose the {n} most interesting DIRECTIONS to explore from here — {mode == 'refine' ? 'small nudges that keep this exact image and push it further along one axis' : 'distinct alternative takes'}. GROUND every direction in what you actually SEE: name the specific thing in THIS image it changes (a dead background, flat lighting, a static pose, a centered subject, a muted palette). Each direction must (a) still honor the brief — never abandon the requested subject, style, or scene; (b) be a DIFFERENT KIND of change from the others — spread them across lighting, framing/composition, content/energy, palette, and interpretation, never two of the same kind; (c) have real HEADROOM — only propose a change where there's room to move and a plausible upside (skip "sharper" if it's already sharp). Do NOT propose generic directions that could apply to any image ("more detail", "different angle", "cooler tones") — if you couldn't point at the exact spot in THIS image it addresses, drop it. For each: a LABEL of 2–4 words (chip text), an `axis` tag (one of: lighting, composition, palette, content, mood, interpretation), a one-line `why` grounded in the image, and the concrete `patch` — a prompt fragment to add/replace and/or a param change (seed: keep|new). Return {n} directions, ordered most-promising first. If the image is already excellent and you cannot name a genuinely useful fork, return fewer (or none) rather than padding with filler.

**Schema:** `{ directions: [{ label, axis, why, patch: { promptAdd?, promptReplace?, seed: 'keep'|'new', paramSet?: {name,value}[] } }] }`

### Pressure-test rubric
Feed ~20 varied real results through it; for each direction score **sharp vs generic**:
- SHARP = names a specific thing in the image, distinct axis, plausible upside. ("the bar behind her is empty → fill it with patrons + a bartender for life")
- GENERIC = could be pasted onto any image. ("warmer palette", "more detail")
Target: ≥3 of 4 directions "sharp" across the set. If not, tighten the prompt's grounding + anti-generic clauses. This eval is the go/no-go for the whole feature — the UI is trivial; the *quality of the directions* is the product.

## Data model change (the keystone)
`Take.params` exists but is never populated (`buildTake` callers at `VueNodeCanvas.vue:159/2461` pass nothing). Thread the generating node's `{ prompt, seed, model, loraStrength, aspect }` + `{ axis?, parentTakeId?, round?, label? }` so a take knows *how it was made* and *what it came from*. **Nothing breeds without this.**

## Build slices
1. **Provenance** — populate `Take.params` at both `appendTake` sites. Small, unblocks everything.
2. **Directions prompt + eval** — `buildDirectionsPrompt` + the pressure-test harness. Prove the directions come out sharp BEFORE building UI.
3. **Diverge UI** — the lightweight list under a result; tap a direction → apply its patch to live widgets → render → lands as a take tagged with its axis/label.
4. **Breed / Explore** — gestures on a rendered take spawn a new divergence (refine vs lateral); rounds stack as the indented funnel.
5. **Preference learning** — log picks per project → bias which axes the next divergence favors. Personalized, not universal.
6. **Polish** — Compare grid, multi-select render, cheap-diverge→expensive-commit (low-res scout renders).

## Open calls
- Breed: text-first everywhere (cheapest, consistent) vs render-3-mutations directly once you love a look. *Leaning text-first.*
- Diverge default N: 3 or 4.
- Where "explore directions" lives: a chip on the fresh-result strip (reuses `useNextStepsStrip`).
