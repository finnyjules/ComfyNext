# Canvas planner A/B — `claude-sonnet-4-6` vs `claude-sonnet-5`

> **Not yet run.** This file is the placeholder the harness overwrites. No
> `NUXT_ANTHROPIC_API_KEY` was available in the environment where the harness was
> written, so no model calls have been made and there is no data below yet.

## How to run

```bash
cd frontend
NUXT_ANTHROPIC_API_KEY=sk-... npx vitest run tests/unit/plan-model-ab.eval.unit.spec.ts
```

Without the key the spec skips silently (one always-green gate assertion runs) and
this report is **not** rewritten. With the key it makes 10 prompts × 2 models = **20**
real Anthropic calls (~2–4k input tokens, ≤2048 output each) — a few cents in total.
On success it overwrites this file with the comparison table plus, per prompt, each
model's reasoning excerpt and full command sequence.

## What is being compared

The PRODUCTION canvas-planner request: `describeCanvas` → `buildAgentPrompt` +
`buildCommandSchema` (app/lib/agent/…), posted to `/v1/messages` in the exact shape
`server/api/agent-plan.post.ts` uses (non-streaming, `output_config.format` =
`json_schema`, `max_tokens: 2048`, first text block). Snapshot: an EMPTY canvas —
the first-prompt case — with a catalog assembled from the app's own
`AGENT_CAPABILITIES` through the real `buildCatalog` ranking pipeline.

Recorded per prompt × model: the first `addNode`'s `nodeType`, whether a `tuneNode`
later in the plan targets that same node, the `reasoning` field's first ~100 chars,
the full op sequence, and `stop_reason`.

**Synthetic-catalog caveat:** no raw /object_info nodes (the "low-level" palette
bucket is empty), no widget defs/defaults/enums (`widgets: []` on every entry), and
no trained-style library. Everything else — ranking, caps, pins, preferred/raw
split, prompt text, schema — is the shipped path.

## The 10 prompts

1. a warm dreamy gradient background for a hero banner
2. kinetic typography that says LAUNCH
3. make me a seamless terrazzo pattern
4. a glassy chrome 3D version of the word BLOOM
5. give it that 35mm film look
6. a 1970s italian film poster vibe
7. moody berlin techno flyer background
8. confetti burst around the product shot
9. an underwater caustics effect on my logo
10. something calm for a meditation app splash

## Results

_Pending a run with an API key._
