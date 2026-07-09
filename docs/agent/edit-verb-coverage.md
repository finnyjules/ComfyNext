# Edit-verb coverage matrix

How common image-edit requests map to nodes, and whether the canvas agent can
route a phrase to them. **Maintenance:** verbs live in `AGENT_CAPABILITIES`
intents (`frontend/app/lib/agent/capabilities.ts`); agent visibility is
enforced by `tests/unit/agent-coverage-guard.unit.spec.ts`. This doc is the
human map, not a registry — update it when the registry changes.

## Tier 1 — universal edits

| Verb | Example phrase | Node | Agent-visible | Interactive surface |
| --- | --- | --- | --- | --- |
| Remove object | "remove the lamppost" | RemoveObjectNode | ✓ | Edit menu → one-click remove (InpaintModal) |
| Remove background | "cut out the subject" | RemoveBackgroundNode | ✓ | Edit menu → Remove BG; Frame layer → Cut out subject |
| Upscale | "make this 4k" | UpscaleImageNode | ✓ | Edit menu → Upscale |
| Enhance detail | "sharpen this up" | EnhanceDetailNode | ✓ | Edit menu → Enhance Detail |
| Expand / outpaint | "zoom out, show more" | OutpaintImageNode | ✓ | — |
| Restyle | "make it look like this reference" | RestyleFromImageNode / RestyleWithLoRANode | ✓ | — |
| Generic edit | "add a hat" | EditImageNode | ✓ | Edit menu → Edit (Nano Banana) |

## Tier 2 — common, commerce-leaning

| Verb | Example phrase | Node | Agent-visible | Interactive surface |
| --- | --- | --- | --- | --- |
| Relight | "golden hour lighting" | RelightNode | ✓ | Edit menu → Relight |
| Reframe / new angle | "show it from the side" | RotateCameraNode (+ LensReframe) | ✓ | Edit menu → Reframe |
| Harmonize composite | "make the pasted object fit" | BlendSceneNode | ✓ | Frame layer → Harmonize into scene (modal-only pipeline, richer than the node) |
| Text edit | "change the sign to say OPEN" | TextEditNode | ✓ | Edit menu → Edit text… popover |
| Recolor object | "make the shirt brand-blue" | RecolorObjectNode | ✓ | Edit menu → Recolor… (brand-kit swatches) |
| Face fix / restore | "fix the faces" / "restore this old photo" | FixFacesNode / RestorePhotoNode | ✓ | — |
| Product scene swap | "put my product in a kitchen" | SwapProductNode / SwapBackgroundNode / ProductShotNode | ✗ (excluded: agent cannot source both a finished packshot scene AND the product cutout from a phrase alone); ✓ (SwapBackgroundNode + ProductShotNode) | — |

## Tier 3 & gaps

| Verb | Node | Status |
| --- | --- | --- |
| Pose change | PoseMannequin | ✗ (excluded: primary workflow is pose a 3D mannequin in a dedicated on-canvas editor; agent can't drive that editor from text) |
| Person swap | PersonSwap | ✗ (excluded: agent has no way to source both a scene AND a specific person-identity photo from a phrase alone) |
| Expression change ("make her smile") | — | **GAP** |
| Shadow / reflection generation | BlendSceneNode (partial) | **GAP** (procedural cast-shadow layer is an unbuilt stretch task) |
| Material swap ("make it chrome") | — | **GAP** |
| Colorize B&W | — | **GAP** (ImageColorize raw node exists; no capability) |
| Perspective correction | — | **GAP** |
| Age / hairstyle | — | GAP, deliberately off-roadmap |

## Candidates for the next slice (ranked by the 2026-07-08 tier analysis)

1. Expression change — consumer-heavy, nano-banana-2 instruction edit, same
   minimal-node pattern as RemoveObjectNode.
2. Material swap — strong for product design; same pattern.
3. Shadow generation — pairs with Swap Background; procedural version is
   already specced as the cast-shadow stretch task.
4. Colorize B&W — cheap to add (existing models), clear verb.
