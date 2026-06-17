# Bulletproofing node search — design

**Date:** 2026-06-16
**Branch:** feat/gradient-studio
**Status:** approved

## Problem

Typing a natural-language intent like `"change his pose"` into the canvas
search surfaces returns no node match — only the "Ask AI" fallback — even
though a `Pose Mannequin` node exists.

Root cause: both search surfaces filter with `field.includes(fullQuery)`,
testing whether a node field contains the **entire** query string verbatim.
`"change his pose"` never appears as a literal substring anywhere, so the
match fails even though the word `pose` is present in the node's description.
Compounding factors:

- No tokenization — the whole phrase is matched as one substring.
- No synonym/alias vocabulary — node names are noun phrases ("Pose
  Mannequin"); users type verbs/intents ("re-pose", "change pose").
- The AI fallback's catalog (`buildCatalog`) is filtered to nodes
  type-compatible with the anchored port, so an intent-relevant node can be
  excluded from the model's candidate list entirely.

## Approach

Centralize ranked matching in one pure, unit-tested module and wire all three
consumers (two local search surfaces + the AI catalog) to it. Dependency-free
token/subsequence scorer (no Fuse.js) — the failure mode is recall, not typo
tolerance, and a hand-rolled scorer stays deterministic and trivially testable.

## Components

### `app/lib/nodeMatch.ts` (new, pure)

- `tokenize(query): string[]` — lowercase, split on whitespace/punctuation,
  drop stopwords (`his`, `the`, `a`, `to`, `of`, `it`, `my`, …).
- `scoreNode(node, tokens, keywords): number` — weighted token scoring.
  Per token, best hit across fields: displayName/name > keyword > description
  /category; exact-token > prefix > subsequence. A token that matches nothing
  contributes 0; a node with no matched tokens scores 0.
- `searchNodes(nodes, query, { keywords, limit }): T[]` — tokenize, score,
  drop zeros, sort descending, slice. Empty query → identity (preserves the
  current "show all" behavior). Generic over the node shape so both
  `NodeType` and `NodeTypeLite` work.

### `app/lib/nodeKeywords.ts` (new)

`NODE_KEYWORDS: Record<string, string[]>` keyed by node class name — same
pattern as `nodeDescriptions.ts`. Seeds intent vocabulary for ~20 high-value
custom/API nodes (Pose Mannequin, Relight, Lens · 3D Reframe, Enhance Detail,
Outpaint, Remove Background, Upscale, Restyle, Fix Faces, …). Degrades
gracefully: a node absent from the map still matches on name/description.

Example: `PoseMannequin: ['pose', 're-pose', 'change pose', 'reposition',
'stance', 'posture', 'body position']`.

## Wiring

1. `useNodeSearch.ts` `filteredNodes` (NodeSearchDialog) — replace inline
   substring filter with `searchNodes(...)` after the source/category
   pre-filter.
2. `PortIntentPopover.vue` `candidates` — replace inline filter with
   `searchNodes(anchorCandidates(...), query, { keywords })`.
3. `portIntentCatalog.ts` `buildCatalog` — add optional `intent` param and a
   third **intent bucket**: top keyword/text matches for the intent not
   already in hop1/hop2, capped (~10). Threaded through
   `usePortIntent.suggest`. Backstop for the incompatible-port case so an
   intent-relevant node still reaches the model. Validation unchanged.

## Bonus

`PortIntentPopover.vue` "Ask AI" row currently uses violet accents — violates
the project's no-purple rule. Swap for neutral (white-opacity idle, emerald
for the active/AI-action state) while editing the file.

## Testing

`tests/unit/node-match.unit.spec.ts` (vitest, `npx vitest run`):

- tokenize strips stopwords and punctuation
- `"change his pose"` ranks `PoseMannequin` first against a small fixture
- keyword hit beats description-only hit
- empty query returns input unchanged (identity)
- no-match query returns empty
- ranking is stable/descending by score

## Non-goals

- No backend node-metadata changes (keywords live in the frontend).
- No change to AI suggestion validation or wiring logic.
- Not seeding keywords for all ~600 nodes — only high-value intent nodes.
