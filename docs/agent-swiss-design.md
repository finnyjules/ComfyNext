# The agent's Swiss design system

Smart Layout is a Swiss grid engine, so the in-product agent **composes in the
International Typographic Style by default** — these are the house rules, applied
unless the user explicitly asks for a different look.

Codified in two enforceable places:
- **Generative behaviour** — `app/lib/agent/designPrinciples.ts` → `SWISS_DESIGN_PROMPT`, injected into every plan prompt (`protocol.ts`).
- **Verification** — `app/lib/agent/verify.ts` runs deterministic postconditions on every preview and flags clear violations (thresholds in `SWISS_LIMITS`).

## The principles (what the agent does)

**Grid & structure** — everything snaps to the grid. Reuse a consistent column
structure; related elements share a left edge (a common column) and equal
gutters so edges line up. Sizes and gaps are simple multiples (modular).

**Composition & balance** — asymmetric balance over centred symmetry; anchor to
a strong left column (flush-left); active, generous negative space (wide margins,
don't fill the canvas); fewer/larger/aligned beats many/small/crowded.

**Typography** — neutral sans-serif (Helvetica/Univers/Akzidenz; Inter/Neue Haas
as web equivalents). Flush-left, ragged-right; never justified or centred body
copy; valign top. Hierarchy through **scale and weight only** — a small set of
sizes, a large headline against small body with a decisive jump. Limited weights.
Tight leading on headlines. Uppercase only for short labels.

**Colour** — restraint: background + foreground + **at most one accent** (classic
Swiss often a single red). High contrast. Flat solid fields (no decorative
gradients unless asked). Bind to `{{ brand.* }}` tokens. Always legible.

**Imagery** — objective, clean; grid-aligned or full-bleed; no shadows/glows/
filters.

**Restraint** — function over ornament. When in doubt: align it, enlarge the
hierarchy, remove the clutter, add space.

**Mechanics reminder** — element-to-element alignment is set by region columns
(`setElementProps`), not just `style.align` (which only positions text inside its
own box). "Full width" = span the whole grid.

## What verification flags (un-Swiss tells)

| Check | Fires when |
|---|---|
| Off-canvas | a non-bleed element falls outside the grid |
| Low contrast | text vs. its backdrop is below ~2.5:1 (brand tokens resolved; gradients skipped) |
| Narrow headline | a `display`/`headline` spans < 40% of the grid width |
| Busy palette | more than `SWISS_LIMITS.maxColours` (4) distinct solid colours |
| Too many sizes | more than `SWISS_LIMITS.maxTypeSizes` (3) distinct text sizes/levels |
| No hierarchy | ≥2 text elements all at the same size |
| All centred | ≥2 text elements, every one `align: center` |

Thresholds are deliberately lenient — the generative principles do the heavy
lifting; verification only catches clear violations so it doesn't nag.
