# Take strip — calm & confident redesign

**Date:** 2026-08-27
**Scope:** Visual + interaction redesign of the take strip (the filmstrip of AI-proposed takes in the studio compose-and-pick flow). Presentation only — no change to how takes are generated, materialized, kept, or logged.

## Goal

Make the moment of getting and picking four takes feel **calm and confident**: quiet, refined, effortless to compare and choose. Restraint over motion. Elevate the feel without adding chrome.

Design converged through visual brainstorming with the owner (mockups in `.superpowers/brainstorm/85242-1787807479/`, direction 4 = `calm-v4.html`).

## The problems being fixed (owner-confirmed)

1. **Labels fight the texture** — white take names were stamped on busy gradients, needing a heavy shadow and still reading as noise-on-noise.
2. **The description interrupted** — an unstyled, OS-default pop-over jumped over the tiles on hover and covered what you were comparing.
3. **Four buttons, one crowded row** — different-directions / variations / dismiss / keep, all equal weight, jammed together.
4. **The "current" tile looked cheap** — a dashed stroke (wrong use of a dashed border) and the wrong word ("yours").

## The design

### Tiles

- **Pure image.** No text on any tile. The gradient is the whole message.
- Height ~100px, radius 10px, hairline border (`#23262d`), even gaps.
- **Hovered / selected** tile: soft accent ring (action blue `#4a8df0`, 1px + subtle glow) and a 2px lift. Calm, not loud.

### The "current" tile

- The word is **"current"** (not "yours").
- **No dashed stroke.** Same clean solid-bordered tile as the takes, **gently dimmed** (~0.82 opacity) to read as "what you have" vs "proposals", set apart from the takes by a thin **divider**.
- A quiet **"current"** marker beneath it (small, uppercase, muted `#6b7280`) — the only text label in the strip.

### Description → styled tooltip

- On hover/focus of a take, a **styled, on-brand tooltip** floats **above that card**, pointing down to it (dark `#161a21`, hairline border `#2b313b`, muted text, soft shadow).
- Contains the **description only** — no name.
- **Weight is supplementary, not authoritative:** the description is the model's stated intent and may not match the rendered pixels 1:1, so it is glanceable-on-demand, never a fixed caption presented as truth.
- Positioned over its own card only — covers none of the sibling tiles it's being compared against.

### Labels/names

- **Removed from the UI entirely.** No on-tile label, no name in the tooltip.
- The name is **still captured as taste-data** when a take is kept (unchanged from today) — it just isn't shown.

### Actions — split by scope

Per-take actions live on the card; whole-strip actions live on the bar.

- **On the card (revealed on hover/focus/selected):** `≈ Variations` and `Keep`, in a bottom action row over a subtle dark scrim (bottom gradient so buttons stay legible over any gradient).
  - `Keep` — solid **action blue** (`#2563eb`), the single accent / the commit.
  - `≈ Variations` — translucent secondary (`rgba(255,255,255,.12)` + hairline).
- **On the bar (always):** `Cancel` (left) and `Re-roll` (right).
  - `Cancel` — quiet **text** only (`#7d8590`), the escape.
  - `Re-roll` — **white** button (`#f2f4f7` bg, dark text), bottom-right primary position.

### Visual hierarchy (deliberate)

1. **Keep** — action blue, the commit. The only color accent.
2. **Re-roll** — white. Prominent by *contrast, not color*, so it leads the bar without competing with Keep's accent. Bottom-right = where the thumb/eye lands for the action used most ("not quite — four more").
3. **Cancel** — text. Quiet exit, out of the way on the left.

## Interaction details (settled defaults)

- **Reveal trigger:** the on-card buttons and the tooltip appear on **hover, keyboard focus, OR when the card is the selected one.** This keeps touch and keyboard users able to act (tap/focus a card → its buttons show) — not hover-only.
- **Tooltip timing:** the on-card buttons appear immediately on hover; the **tooltip appears after a short pause (~350–400ms)** so it doesn't flash while the eye scans across tiles. On the selected card it may show without delay.
- **Re-roll intensity:** ships as the solid white shown in direction 4. If it reads too loud against the calm bar in the live build, soften to off-white or a subtle outline — a taste call to confirm on the real render, not a redesign.
- **Terminology mapping** (behavior unchanged, labels only): "different directions" → **Re-roll**; "Dismiss" → **Cancel**; "Variations of this" → **Variations** (now on the card); Keep unchanged.

## Non-goals

- No change to generation, the eye-pick, materialization, keep/log behavior, or the spread/variations logic.
- Not touching the compose loading/"reviewing" state in this pass (that was a separate friction option the owner did not pick).
- Not the node-card preview blur (separate tracked issue).

## Testing

- Component-level: the take strip renders takes with no on-tile text; the current cell shows the "current" marker and no dashed border; per-card Variations/Keep present on hover/focus/selected; bar shows Cancel (left) + Re-roll (right).
- Behavior parity: Keep still commits the same take and writes the same taste-log; Re-roll still re-composes; Variations still spreads; Cancel still closes — pinned so the visual rework can't silently change what the controls do.
- Keyboard/touch: buttons reachable without hover (focus/selected path).
