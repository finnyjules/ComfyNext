# 3D Studio — full-bleed viewport (Part B ported to the studio shell)

**Date:** 2026-08-28
**Status:** approved (Julien: "should we extend the viewport to the entirety of the modal?" → "please do")
**Scope:** `StudioModalShell.vue` gains an opt-in `fullBleed` variant; `Scene3DStudioSurface.vue` opts in. No other studio changes behavior.

## Design

**Shell (`fullBleed` prop, default false — every existing studio byte-identical):**
- The body drops the three-column flex for one `relative` area: `#preview` renders `absolute inset-0` as the ground layer.
- `#aside` and `#controls` become floating glass panels over it (Compositor idiom: `absolute z-20`, left-4 / right-4, top below the header band, bottom above the actions footer, `rounded-xl border-white/10 bg-[#0e0e10]/80 backdrop-blur-md`, own scroll). Existing widths kept (w-72 each). The agent-takeover behavior (progress/proposal replacing controls) is untouched — it lives inside the right panel wherever the panel floats.
- The takes strip + agent bar cluster floats bottom-center over the viewport (same capped width), lifted by a `fullBleedBottomOffset` prop (px, default 16) so a surface with its own bottom overlay (Scene3D's add-pill) can raise the cluster above it.
- **⌘\ toggles both panels** in fullBleed mode (slide+fade like the Compositor), state in `sessionStorage` key `sailor:studio:panels`; toggling never unmounts panel content.
- Header band and actions footer stay as bands in v1 (the footer carries every studio's actions; the header is 40px). Full-bleed means the body.

**Scene3D opt-in:**
- Passes `full-bleed` + a bottom offset that clears its add-pill; its viewport container stretches (`h-full w-full` — the engine's resize observer follows the canvas box).
- The in-viewport overlays (snap/Light chips, add-pill, Light-View labels, sculpt panel if overlaid) already float and keep working; verify the sculpt/gen flows still hit-test correctly at the larger canvas.
- Panels must not leak pointer/wheel events into orbit (orbit listens on the canvas — verify wheel over a floating panel scrolls the panel).

## Non-goals

Other studios stay on the boxed layout (they can opt in later); no header/footer float; no persistence of panel visibility beyond the session key.

## Testing

- Unit: shell renders both variants (fullBleed off = current DOM shape — snapshot/structural assertion protecting the seven existing studios; on = ground layer + floating panels).
- Live (Playwright, real app, WebGL swiftshader args): viewport canvas box ≈ modal body size (measure); orbit drag works in the area previously covered by columns; wheel over the Objects panel scrolls it, not the camera; ⌘\ hides/shows both panels and the canvas KEEPS its size (no reflow jump — panels float); add-pill + its face/caret menus still anchored; agent bar cluster sits above the pill; Light-View labels track after resize; screenshot proof.
