# Agent capability registry

*How the in-canvas agent knows the full set of things this app can do — every
generator and studio, not just raw ComfyUI nodes. Added 2026-06-29.*

## The problem it solves

The canvas agent builds its node palette from ComfyUI's `/object_info`, trimmed
to what's relevant to the request. Two gaps made it miss the app's real powers:

1. **Studios are invisible.** GradientStudio / ShaderStudio / TextureStudio /
   SpaceType are frontend-only nodes — they have **no `/object_info` entry**, so
   `buildCatalog` (which iterates `/object_info`) literally could not see or add
   them.
2. **Generators had no vocabulary.** The ~60 Replicate generators *are* real
   nodes, but only ~15 had intent synonyms, so oblique phrasings ("cut out the
   subject", "make a product shot") didn't surface them — and the agent wrongly
   reported capabilities as impossible.

A third, subtler bug: `buildCatalog` truncated intent-matched nodes that were
*also* type-compatible — so "remove the background" on an image dropped the
RemoveBackground node off the 40/60-node cap. Fixed (see below).

## The registry — `app/lib/agent/capabilities.ts`

A curated `AGENT_CAPABILITIES: AgentCapability[]` of **6 studios + 43 user-facing
generators**. Each entry:

```ts
{ nodeType, kind: 'studio'|'generator'|'effect', title, summary,
  intents: string[],            // rich NL synonyms — the recall engine
  inputs, outputs,              // link ports the agent can wire
  frontendOnly?: boolean,       // studios with no /object_info
  boost?: number }              // additive rank bonus (default by kind)
```

Derived maps feed the existing matcher (`lib/nodeMatch` + `portIntentCatalog`):
- `capabilityKeywords()` — nodeType → intents (matched as `keywords`)
- `capabilityBoosts()` — nodeType → boost (studios 3 > generators 2.5 > effects 2)
- `studioNodeTypes()` / `studioCatalogEntries()` — synthesized `NodeTypeLite` /
  `CatalogEntry` for the frontend-only studios so `buildCatalog` can include +
  wire them despite no `/object_info`.

## Wiring — `VueNodeCanvas.agentNodeTypes` / `agentCatalog`

`agentNodeTypes()` = `/object_info` nodes **+** `studioNodeTypes()`.
`agentCatalog(intent)` = `buildCatalog(...)` with `keywords = {…NODE_KEYWORDS,
…capabilityKeywords()}` and `boosts = {…NODE_BOOST, …capabilityBoosts()}`. So
studios + generators surface for their intents and rank above raw nodes.

`buildCatalog` now ranks intent matches over **all** node types first (not
excluding type-compatible hop1), so an intent-relevant node is never truncated.

Materialization is unchanged: `addNode` → `createNodeData` already handles studio
node types (wildcard output; ShaderStudio takes IMAGE; Compositor/SmartLayout are
real backend nodes).

## The agent prompt

The `addNode` command hint tells the model the palette leads with high-level
generators + studios and to **prefer one capability over wiring raw nodes**, and
to "addNode the capability then connect the image to it" for image actions.

## Testing — `tests/unit/agent-capability-routing.unit.spec.ts`

A deterministic, LLM-free corpus (160 cases) that is the safety net:
- **Intent vocabulary** — every capability's full intent list routes back to it
  (top-3). This is whole-registry collision detection: if intent X for cap A
  surfaces cap B first, the test fails.
- **Paraphrases** (70+) — realistic phrasings NOT verbatim in the intents.
- **Flagship** — the common requests land #1.
- **Distractor dominance** — capabilities beat raw ComfyUI nodes.
- **Collisions** — known overlaps disambiguate to the right capability.
- **buildCatalog integration** — capabilities land in the assembled palette on an
  IMAGE anchor (the original bug) and frontend studios appear despite no
  `/object_info`.

## How to extend it

Add a new generator/studio → one entry in `AGENT_CAPABILITIES` (nodeType MUST
equal the registered `/object_info` `node_id`; frontend studios set
`frontendOnly: true`). Author 8-15 `intents` covering verbs + nouns users say.
Add a flagship/paraphrase case to the corpus; run the routing test — it will
flag any collision with an existing capability so you can disambiguate.
