# Smart Layout — de-clunk the Copy assistant

**Date:** 2026-07-10
**Status:** Approved (design)

## Problem

The Copy assistant (text-element panel) reads as a standalone "assistant console"
that floats *above* the Content field. Three failings:
1. **Divorced from the content** — you edit the text below, but drive AI from a
   separate bordered card above it. The thing being edited is visually secondary.
2. **Mode-first friction** — a permanent Variations / Write-from-brief / Translate
   segmented control forces a mode choice before any action, though the three have
   totally different input shapes.
3. **Always-open weight** — the full card + Generate is present even when typing copy
   by hand.

## Insight

Variations, Brief, and Translate aren't different *modes* — they're different
*instructions* that all return the same thing: **3–4 options you pick from**
(`count`, default 5, in the backend). That's what lets us collapse the mode switcher
without losing any capability.

## Design (approved)

Content-first, instruction-first. The Content/Text section stays on top (the hero);
the assistant moves **below** it as a subordinate zone.

Assistant zone:
- **One instruction input** (the brief) + a generate arrow. Placeholder: "Describe the
  copy you want…". Enter / arrow → `brief` mode.
- **Quick chips** operating on the current text: **`4 variations`** (one tap, no input)
  · **`Shorter`** · **`Punchier`** · **`Translate…`**.
- **`Translate…`** discloses the language pills inline (kept from today), then generate
  → one option per language.
- **Results** (3–4 option cards → click to apply) and the footer actions
  (`Add all as rows` / `Make variable + add as rows`) are unchanged.

### Interaction → backend mapping
| Surface | mode | notes |
|---|---|---|
| Input text + generate | `brief` | brief = input. **Unchanged.** |
| `4 variations` chip | `variations` | **Unchanged.** |
| `Shorter` chip | `variations` + `instruction` | "noticeably shorter/tighter" |
| `Punchier` chip | `variations` + `instruction` | "punchier, bolder, more energetic" |
| `Translate…` + langs | `translate` | **Unchanged.** |

### Backend change (small)
`server/lib/copyAssist.ts`: add optional `instruction?: string` to
`CopyAssistRequest`; in the **variations** branch, when present, inject it as an
explicit direction that **takes priority over the ±20% length rule** (so `Shorter`
can actually shorten). `brief`/`translate` prompts unchanged. Thread `instruction`
through `copy-assist.post.ts` (variations only) and `useCopyAssist`'s
`CopyAssistPayload`.

## Components touched
- `server/lib/copyAssist.ts` — `instruction` on request + variations prompt (pure,
  unit-tested).
- `server/api/copy-assist.post.ts` — parse/forward `instruction` (variations only).
- `app/composables/useCopyAssist.ts` — `instruction?` on payload.
- `app/components/templates/GridPropertyPanel.vue` — drop `copyMode` segmented control;
  reorder assistant below the Text section; add `generateBrief` /
  `generateVariations(instruction?)` / `generateTranslate` handlers + a `showTranslate`
  disclosure. Apply / add-rows / promote logic unchanged.

## Testing
- **Unit (headless):** extend `tests/unit/copy-assist-prompt.unit.spec.ts` — variations
  prompt includes the instruction and signals it overrides length; brief/translate
  prompts unchanged when no instruction; no-instruction variations byte-identical to
  today.
- **Owed to the user (needs a browser):** the panel's live feel — chip taps, translate
  disclosure, apply flow. Preview server still blocked by the concurrent session's dev
  server on the shared port.

## Non-goals
- Free-text *rewrite of current line* via the input (the input stays the brief; Shorter/
  Punchier cover in-place nudges). A custom-instruction rewrite field is a later add.
- Streaming/inline preview of a suggestion against the current text.
