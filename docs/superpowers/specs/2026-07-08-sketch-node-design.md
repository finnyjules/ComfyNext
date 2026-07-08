# Sketch node — draft-as-a-node (corrective slice)

**Date:** 2026-07-08
**Status:** Approved design (user-directed correction to the sketchbook loop's UX)
**Builds on:** 2026-07-07-sketchbook-loop-design.md — all its machinery ships and is reused; this slice changes the *surface*.

## Problem

The sketchbook loop shipped drafting as a *mode* (header toggle rerouting existing generators). The user's mental model — and the product's native language, where everything is a card and escalators spawn nodes — is drafting as a **node**: a dedicated fast generator you drop on the canvas, iterate on at sketch speed, and promote out of when a result earns it. Draft-ness should be spatial and visible, not a chrome state.

## Design

### 1. The Sketch node is a preset, not a new node type

"Sketch" appears in the node search (Space) as its own entry — display name **Sketch**, description "Fast, cheap draft images — iterate here, promote the winner", keywords draft/fast/cheap/sketch/idea. Selecting it adds a **GenerateImageNode** with:

- `widgetOverrides`: `model: 'flux-schnell'`, `model_options: '{"megapixels":"0.5"}'`
- `propertyOverrides`: `{ sketch: true }`

No Python, no backend restart, no new class_type — saves/loads/runs as a plain GenerateImageNode everywhere (export, history, agent). The synthetic entry is injected into `useNodeSearch`'s list after the `/object_info` fetch (frontend-only entries precedent exists: Collection, SpaceType, GradientStudio are class_type-less). `addNode` already supports both override kinds.

### 2. The card wears its draft-ness

The generator card component, when `properties.sketch` is true: dashed ring on the card frame, a small PencilLine "Sketch" chip in the header, default title "Sketch". Same visual token as draft takes (dashed + neutral — never pastel, never purple). Nothing else about the card changes: widgets, takes strip, Variations ×4, Light Table all work as-is (its takes are cheap by construction; they additionally get `draft: true` badges automatically when the canvas-level draft mode is on, but the sketch node does NOT depend on the mode).

### 3. Promote spawns the final node beside it

On a sketch node's takes (strip hover + Light Table + Cmd+Enter), **Promote** does NOT re-run in place. It spawns a full **Generate an Image** node placed to the right of the sketch node (reuse the `sourceNodeId`-relative placement the studio-spawn handlers already use), with `widgetOverrides` built from the chosen take's provenance: `prompt`, `seed`, `aspect_ratio` — and `model` left at the schema default (the user picks their finisher model; remembering last-used is a follow-up). Seed arrives **locked** (`propertyOverrides: { seedLocks: { seed: true } }`) so the first run reproduces the sketch's composition. Placed focused, **never auto-run** (standing rule). The sketch node stays put — the canvas visibly records sketch → final.

Non-sketch draft takes (created by the mode toggle) keep the existing in-place Promote unchanged. Dispatch: sketch-promote is decided by `node.properties.sketch` at the promote call site.

### 4. The mode toggle stays, demoted in spirit

The header Draft/Final toggle remains as the power lever for running an existing full graph cheaply. No changes this slice; whether to hide it behind settings is a later product call after real usage.

## Out of scope

Start-modal / Add-toolbar entries for Sketch (node search only, v1); remembering the user's preferred finisher model; auto-wiring the sketch's prompt to the spawned node via a live link (copy, don't link, v1); any change to the mode toggle.

## Testing

Unit: synthetic search entry present + maps to correct overrides; promote-override builder from take params (prompt/seed/aspect, no model, seed lock). Browser: add Sketch via Space → dashed card; (paid-render deferred) takes → promote → full generator lands beside with copied prompt/locked seed.
