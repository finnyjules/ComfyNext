# Ring card ratio — design

*2026-08-07. Extends the Expressive Studio `ring` effect. Follows the ring tune-up + word type controls.*

## In plain language

animos forces every card to a chosen aspect ratio (1:1, 4:3, …) so the ring reads as uniform cards.
Ours uses each photo's native shape, so cards look like different shapes under perspective. This adds
a **Card ratio** control that forces **image** cards to a fixed aspect, cover-cropping the photo (fill
the card, crop the overflow — no distortion). Words keep their text shape.

## What is being built

One `cardRatio` select control on `ring.ts` + cover-crop wiring in the image tile's existing
`onBeforeCompile` shader.

| Key | Label | Kind | Options | Default | Group |
|---|---|---|---|---|---|
| `cardRatio` | Card ratio | `select` | `native, 1:1, 4:3, 3:4, 16:9, 9:16` | `native` | Ribbon |

`native` = current behaviour (use the image's own aspect), so **existing ring docs are unchanged**.
Structural (changes card shape) → NOT in `liveKeys`; a select has no continuous drag, so rebuild-per-choice is fine.

### Ratio → aspect (w/h)

`{ '1:1':1, '4:3':4/3, '3:4':3/4, '16:9':16/9, '9:16':9/16 }`; `native` uses `tile.aspect`.

### Applies to image tiles only

Word/letter tiles ignore `cardRatio` — they keep their text aspect (a word forced into a square
would crop/distort). Only the `tile.kind === 'image'` branch consults it.

### Wiring (image tile branch)

Compute the card's **render aspect** and the **cover-crop** for each image tile:

```ts
const RATIOS: Record<string, number> = { '1:1': 1, '4:3': 4/3, '3:4': 3/4, '16:9': 16/9, '9:16': 9/16 }
const ratioKey = String(params.cardRatio ?? 'native')
const cardR = ratioKey === 'native' ? tile.aspect : (RATIOS[ratioKey] ?? tile.aspect)
// render aspect = the card's own shape (drives mesh scale, bend width, corner SDF aspect)
aspect = cardR
// cover-crop: sample a sub-rect of the native image (A = tile.aspect) so it fills a cardR card
const A = tile.aspect
const uvScale: [number, number] = A >= cardR ? [cardR / A, 1] : [1, A / cardR]  // native → [1,1]
```

- Set `mesh.userData.aspect = cardR` (so the live `update` scale, bend `w`, and everything downstream
  use the card's shape, keeping cards uniform).
- Extend the image material's `onBeforeCompile` (which already injects the corner-radius SDF):
  - Add `uniform vec2 uUvScale;`, uniform value `{ value: new THREE.Vector2(uvScale[0], uvScale[1]) }`.
  - Cover-crop the map sample by replacing `#include <map_fragment>` with the same chunk but sampling
    at the cropped UV. For three@0.171.0 the chunk is
    `#ifdef USE_MAP\n vec4 sampledDiffuseColor = texture2D( map, vMapUv );\n ... diffuseColor *= sampledDiffuseColor;\n#endif`
    — VERIFY the exact current chunk text in `node_modules/three/.../map_fragment.glsl.js` and swap only
    the sampled UV to `(vMapUv - 0.5) * uUvScale + 0.5`, preserving every other line (colorspace decode etc.).
  - Keep the corner-radius SDF using **`vMapUv` (uncropped, 0..1 card space)** with `uAspect = cardR`,
    so corners round on the card shape, not the cropped image.

`cardRatio` is structural, so the crop uniform is computed at build; no live-update juggling. (If a
future task wants it live, set `uUvScale.value`/`uAspect.value` from `update` like `uCorner` — out of scope.)

## Testing

- **Unit:** extend the ring-effect test — an image doc with `cardRatio: '1:1'` builds without error and
  `mesh.userData.aspect === 1` for its image quad (native image aspect overridden). A word doc with a
  card ratio set leaves the word tile's aspect at its text aspect (ratio ignored for words) — assert
  the image path vs word path. (Shader/crop pixels need GL — deferred to live.)
- **Manual/live:** photos become uniform cards at the chosen ratio, cover-cropped (not stretched, not
  letterboxed); words keep their shape; corner radius still rounds the card. Deferred to the user pass.

## Risks

- **map_fragment chunk text drift** across three versions — mitigated by verifying the exact chunk in
  the installed `three` before replacing, and swapping only the UV expression.
- **Cover-crop vs corner SDF interaction** — kept independent by design: the crop transforms only the
  *map sample* UV, while the corner SDF uses the untouched `vMapUv` in card space. No coupling.
- **Existing docs** — `native` default + the ring's `RING_DEFAULTS` backfill (missing key → `native`)
  means pre-existing rings render identically.

## Done when

A Card ratio control forces image cards to the chosen aspect (cover-cropped, undistorted); words keep
their shape; `native` preserves current behaviour; existing rings unchanged; corner radius still
rounds correctly on the ratio'd card.
