/**
 * Swiss / International Typographic Style — the agent's native design system.
 *
 * Codified from the canon (Müller-Brockmann's grid systems, Ruder's typography,
 * Hofmann, Univers/Helvetica/Akzidenz-Grotesk). Two consumers:
 *   • SWISS_DESIGN_PROMPT — generative behaviour, injected into the model prompt
 *     so the agent COMPOSES in this style by default.
 *   • the thresholds below — verification (lib/agent/verify.ts) flags clear
 *     violations (busy palette, too many type sizes, no hierarchy, all-centred).
 *
 * House style: Smart Layout is a Swiss grid engine, so these are defaults, not
 * an optional mode — applied unless the user explicitly asks for something else.
 */

export const SWISS_DESIGN_PROMPT = [
  'DESIGN SYSTEM — you compose in the SWISS / International Typographic Style. Apply these by default (only break them if the user explicitly asks for a different look):',

  'GRID & STRUCTURE — everything sits on the grid. Snap every region to grid lines; never place things arbitrarily. Reuse a consistent column structure: related elements SHARE a left edge (a common column) and the same gutters, so edges line up across the composition. Sizes and gaps should be simple multiples of one another (mathematical, modular).',

  'COMPOSITION & BALANCE — prefer ASYMMETRIC balance over centred symmetry; avoid dead-centring everything. Anchor content to a strong left column (flush-left) and create tension with deliberate asymmetry, balanced by space. NEGATIVE SPACE is active and generous: keep wide margins, do not fill the canvas, let a few elements breathe. Fewer, larger, well-aligned elements beat many small crowded ones.',

  'TYPOGRAPHY — neutral SANS-SERIF (Helvetica / Univers / Akzidenz-Grotesk; Inter or Neue Haas Grotesk as web equivalents); avoid serif or decorative faces for primary text. Text is FLUSH-LEFT, ragged-right (align:left) — never justified, never centred body copy; valign:top by default. Build clear HIERARCHY through SCALE and WEIGHT only (not ornament): a SMALL number of sizes — a large display/headline against small body/caption, with a decisive jump between them. Limited weights (regular + bold). Tight leading on big headlines, comfortable leading on body. Uppercase only for short labels/eyebrows, never long text.',

  'COLOUR — restraint: BACKGROUND + FOREGROUND + AT MOST ONE accent (classic Swiss often a single red). High contrast, usually near-black on white or white on a saturated/dark field. Flat solid fields — avoid decorative gradients unless asked. Bind colours to {{ brand.* }} tokens so the palette stays coherent. Always keep text legible against its ground.',

  'IMAGERY — objective and clean: align images to the grid or run them full-bleed; no drop shadows, glows, or decorative filters.',

  'RESTRAINT — function over ornament. No decoration for its own sake. The result should read as clear, objective, ordered and legible. When in doubt: align it, enlarge the hierarchy, remove the clutter, add space.',

  'MECHANICS REMINDER — alignment of elements to each other/the canvas is done by their region columns (setElementProps), not just style.align (which only positions text inside its own box). "Full width" = span the whole grid. Make headlines span a generous width so they read as headlines.',
].join('\n\n')

/** Verification thresholds — clear violations only, tuned to avoid nagging. */
export const SWISS_LIMITS = {
  /** bg + fg + one accent (+ a little slack). More distinct colours → "busy". */
  maxColours: 4,
  /** A tight scale: more distinct text sizes/levels than this reads as noise. */
  maxTypeSizes: 3,
}
