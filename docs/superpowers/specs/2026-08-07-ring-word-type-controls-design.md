# Ring word type controls — design

*2026-08-07. Extends the Expressive Studio `ring` effect. Follows the ring tune-up.*

## In plain language

The ring's word/letter tiles are hardcoded to `Inter / 700 / 160px / white`
(`WORD_FONT_FAMILY`/`WEIGHT`/`SIZE_PX` in `ring.ts`). This adds real, **global** type controls so
the words can be any font, weight, size, tracking, and colour — the same shape every other Space
Type effect already has. Global = one set of type controls for all words in the ring (per-word
typography is a possible later expansion, deliberately out of scope).

## What is being built

Five new `ControlSpec`s on `ring.ts`, wired into the existing `layoutChars` call for word/letter
tiles. Keys mirror the shared Space Type type-control vocabulary (`font`, `typeWeight`, `typeYScale`,
`tracking`) so the surface's font picker and state resolvers apply, plus a `typeColor`:

| Key | Label | Kind / range | Default | Group |
|---|---|---|---|---|
| `font` | Font | `font` (shared Google picker) | `Inter` | Type |
| `typeWeight` | Type weight | slider 100–900 ×10 | 700 | Type |
| `typeYScale` | Type size | slider 40–320 ×2 | 160 | Type |
| `tracking` | Tracking | slider −20–80 ×1 | 0 | Type |
| `typeColor` | Type colour | `color` | `#ffffff` | Color |

Defaults are exactly the old hardcoded values, so **existing ring documents render identically**
(and the ring-tune-up's `RING_DEFAULTS` backfill means docs missing these keys get these defaults —
no NaN, no visual change).

### Wiring

Replace the hardcoded constants in `buildScene`'s word/letter branch with a `layoutOpts` built from
params, mirroring `cylinder.ts:172-182`:

```ts
import { resolveFontFamily, fontHasWeightAxis } from '~/lib/font/resolveFamily'
// ...
const family = resolveFontFamily(String(params.font))
const hasWght = fontHasWeightAxis(family)
// in the word/letter branch, replacing the hardcoded layoutChars opts:
layout = layoutChars({
  text: tile.text,
  fontFamily: family,
  fontWeight: hasWght ? n(params, 'typeWeight') : 400,
  fontSizePx: n(params, 'typeYScale'),
  tracking: n(params, 'tracking'),
  scaleX: 1,
  color: String(params.typeColor),
  axes: hasWght ? { wght: n(params, 'typeWeight') } : undefined,
})
```

Building `axes` locally from the ring's own `typeWeight` (rather than `env.axes`) keeps the effect
self-contained — the ring's weight control drives variable-font weight regardless of the surface
resolver. Delete the now-unused `WORD_FONT_FAMILY`/`WORD_FONT_WEIGHT`/`WORD_FONT_SIZE_PX` constants.

### Structural, not live

All five re-rasterise the glyph atlas (`layoutChars`), so they are **structural** (rebuild on change)
— do NOT add them to `liveKeys`. Same as every other type control in the suite. The per-sourceId
`layoutCache` still rasterises one atlas per word; the glyph-texture disposal registration is
unchanged.

## Testing

- **Unit:** extend the ring-effect test — a word-content doc with a non-default `font`/`typeWeight`/
  `typeYScale`/`typeColor` builds without error and still produces the right quad count (the atlas
  values themselves need canvas, so assert build/no-throw + count, not pixels). Confirm a doc missing
  the new keys (legacy) still builds finite (the `RING_DEFAULTS` backfill covers `typeWeight` etc.).
- **Manual/live:** words change font, weight, size, tracking, and colour in the studio; the picker
  lists Google fonts; a variable font's weight slider actually changes weight. Deferred to the user
  live pass (cross-origin iframe).

## Risks

- **Variable-font weight** needs the font's weight axis (`fontHasWeightAxis`) — non-variable fonts
  fall back to weight 400, matching `cylinder`. Low risk (proven pattern).
- **Colour baked into the atlas** (structural) means colour changes rebuild — acceptable, matches the
  suite; `typeColor` is a plain `color` control, no alpha-hex trap here (layoutChars takes the string
  straight to canvas fillStyle).

## Done when

The ring has Font / Type weight / Type size / Tracking / Type colour controls that change the words'
appearance; defaults reproduce the old `Inter/700/160/white`; existing ring docs render unchanged;
and the controls are keyframeable/agent-legible for free (declared `ControlSpec`s). Per-word
typography remains a future expansion.
