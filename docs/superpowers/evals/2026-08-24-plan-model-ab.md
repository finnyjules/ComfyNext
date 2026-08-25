# Canvas planner A/B — `claude-sonnet-4-6` vs `claude-sonnet-5`

Generated 2026-08-25T00:34:39.643Z by `frontend/tests/unit/plan-model-ab.eval.unit.spec.ts`.

## How to run

```bash
cd frontend
NUXT_ANTHROPIC_API_KEY=sk-... npx vitest run tests/unit/plan-model-ab.eval.unit.spec.ts
```

Without the key the spec skips silently (one always-green gate assertion runs) and
this report is **not** rewritten. With the key it makes 10 prompts × 2 models = **20**
real Anthropic calls (~2–4k input tokens, ≤2048 output each) — a few cents in total.

## What is being compared

The PRODUCTION canvas-planner request: `describeCanvas` → `buildAgentPrompt` +
`buildCommandSchema` (app/lib/agent/…), posted to `/v1/messages` in the exact shape
`server/api/agent-plan.post.ts` uses (non-streaming, `output_config.format` =
`json_schema`, `max_tokens: 2048`, first text block). Snapshot: an EMPTY canvas —
the first-prompt case — with a catalog assembled from the app's own
`AGENT_CAPABILITIES` through the real `buildCatalog` ranking pipeline.

**Synthetic-catalog caveat:** no raw /object_info nodes (empty "low-level" bucket), no widget defs/defaults/enums (widgets: [] on every entry), no trained-style library. Everything else (ranking,
caps, pins, preferred/raw split, prompt text, schema) is the shipped path.

## Results

First `addNode` agreement: **7/10**.

| Prompt | claude-sonnet-4-6 → first addNode | tuneNode follows | claude-sonnet-5 → first addNode | tuneNode follows |
| --- | --- | --- | --- | --- |
| a warm dreamy gradient background for a hero banner | `GradientStudio` | yes | `GradientStudio` | yes |
| kinetic typography that says LAUNCH | `VectorType` | yes | `VectorType` | yes |
| make me a seamless terrazzo pattern | `TextureStudio` | yes | `TextureStudio` | yes |
| a glassy chrome 3D version of the word BLOOM | `VectorType` | yes | `VectorType` | yes |
| give it that 35mm film look | `none` | no | `none` | no |
| a 1970s italian film poster vibe | `GenerateImageNode` | no | `GenerateImageNode` | no |
| moody berlin techno flyer background | `GenerateImageNode` | no | `GenerateImageNode` | no |
| confetti burst around the product shot | `ProductShotNode` | no | `GenerateImageNode` | no |
| an underwater caustics effect on my logo | `ShaderStudio` | yes | `none` | no |
| something calm for a meditation app splash | `SmartLayout` | yes | `GradientStudio` | yes |

## Reasoning (first ~100 chars) and full op sequence

### a warm dreamy gradient background for a hero banner

- **claude-sonnet-4-6** (2 cmds: addNode → tuneNode, stop_reason: end_turn)  
  The user wants a warm dreamy gradient background for a hero banner. Since this is essentially a grad
- **claude-sonnet-5** (2 cmds: addNode → tuneNode, stop_reason: end_turn)  
  This is a verbless description of a gradient/colour field, which the GradientStudio capability owns 

### kinetic typography that says LAUNCH

- **claude-sonnet-4-6** (2 cmds: addNode → tuneNode, stop_reason: end_turn)  
  The user wants kinetic typography displaying 'LAUNCH'. The VectorType node is perfect for this — it 
- **claude-sonnet-5** (2 cmds: addNode → tuneNode, stop_reason: end_turn)  
  Kinetic typography — animated letterforms — maps to the VectorType capability (variable-font glyph o

### make me a seamless terrazzo pattern

- **claude-sonnet-4-6** (2 cmds: addNode → tuneNode, stop_reason: end_turn)  
  The user wants a seamless terrazzo pattern. This is clearly a seamless/tileable/repeating pattern or
- **claude-sonnet-5** (2 cmds: addNode → tuneNode, stop_reason: end_turn)  
  A 'seamless terrazzo pattern' is a tileable texture, which is explicitly owned by TextureStudio rath

### a glassy chrome 3D version of the word BLOOM

- **claude-sonnet-4-6** (5 cmds: addNode → tuneNode → addNode → connect → tuneNode, stop_reason: end_turn)  
  The user wants a glassy chrome 3D typographic treatment of the word 'BLOOM'. The best approach is to
- **claude-sonnet-5** (2 cmds: addNode → tuneNode, stop_reason: end_turn)  
  The word BLOOM styled as glassy chrome 3D type is fundamentally a typography/glyph-outline request, 

### give it that 35mm film look

- **claude-sonnet-4-6** (0 cmds: —, stop_reason: end_turn)  
  The user wants a '35mm film look' applied to an image, but the graph is currently empty (0 nodes, 0 
- **claude-sonnet-5** (0 cmds: —, stop_reason: end_turn)  
  The user wants a 35mm film-look effect applied to "it", but the graph currently has zero nodes and n

### a 1970s italian film poster vibe

- **claude-sonnet-4-6** (1 cmds: addNode, stop_reason: end_turn)  
  The user wants a 1970s Italian film poster vibe — this is a creative image generation request with a
- **claude-sonnet-5** (1 cmds: addNode, stop_reason: end_turn)  
  The request is a plain descriptive scene/style with no command verb, so per the direct-generation ru

### moody berlin techno flyer background

- **claude-sonnet-4-6** (1 cmds: addNode, stop_reason: end_turn)  
  The user wants a moody Berlin techno flyer background. This is a verbless description of a backgroun
- **claude-sonnet-5** (1 cmds: addNode, stop_reason: end_turn)  
  This is a verbless scene description (no command verb), so it maps to direct generation rather than 

### confetti burst around the product shot

- **claude-sonnet-4-6** (3 cmds: addNode → addNode → connect, stop_reason: end_turn)  
  The user wants a confetti burst effect around a product shot. There's no product shot node currently
- **claude-sonnet-5** (1 cmds: addNode, stop_reason: end_turn)  
  The graph is currently empty, so there's no existing product image to attach an effect to. "confetti

### an underwater caustics effect on my logo

- **claude-sonnet-4-6** (2 cmds: addNode → tuneNode, stop_reason: end_turn)  
  The user wants an underwater caustics effect applied to their logo. There's no existing logo node in
- **claude-sonnet-5** (0 cmds: —, stop_reason: end_turn)  
  The request asks to apply a caustics effect to "my logo", but the graph currently has zero nodes — t

### something calm for a meditation app splash

- **claude-sonnet-4-6** (2 cmds: addNode → tuneNode, stop_reason: end_turn)  
  The user wants a calm meditation app splash screen. This calls for a SmartLayout (preferred capabili
- **claude-sonnet-5** (2 cmds: addNode → tuneNode, stop_reason: end_turn)  
  "Something calm for a meditation app splash" describes a mood/colour field for a splash background, 

---

Follow-through: 9799d89fb — Scene3D look-intents, propose-don't-block hint, 9 corpus cases.
