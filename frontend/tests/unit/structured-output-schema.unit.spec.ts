/**
 * Guard against the class of bug that broke /api/vibe's first real four-takes
 * call: Anthropic structured outputs (output_config.format: json_schema)
 * rejects several ordinary-looking JSON-schema keywords outright, and the
 * rejection is a 400 the route forwards verbatim — it only shows up on a
 * LIVE call, never in a schema-shape unit test that doesn't hit the wire.
 *
 * This walks every schema this codebase actually sends as
 * `output_config.format.schema` and asserts none of them contain an
 * unsupported keyword anywhere in the tree, so a future edit (a new field
 * with `maxLength`, a `minItems: 2` "obviously fine" bound, etc.) fails a
 * fast local test instead of a paid live call.
 *
 * Unsupported list per the structured-outputs docs, current as of the
 * TAKES_SCHEMA fix (2026-08):
 * https://platform.claude.com/docs/en/build-with-claude/structured-outputs
 * — "Not supported": recursive schemas, complex types within enums, external
 *   `$ref`, numerical constraints (minimum/maximum/multipleOf), string
 *   constraints (minLength/maxLength), `allOf` with `$ref`, array `maxItems`,
 *   `pattern`.
 * — "Restricted": array `minItems` (only 0 or 1 supported); `enum` (strings/
 *   numbers/bools/nulls only); every object MUST set `additionalProperties:
 *   false`.
 *
 * If Anthropic's docs relax one of these later, that's a deliberate edit to
 * UNSUPPORTED_STRUCTURED_OUTPUT_KEYWORDS with a fresh doc citation — not a
 * reason to delete the guard.
 */
import { describe, it, expect } from 'vitest'
import { VIBE_SCHEMA, TAKES_SCHEMA } from '~/lib/vibePrompt'
import { TAKE_REVIEW_SCHEMA } from '~/lib/vibeReview'
import { RECIPES_SCHEMA } from '~/lib/gradientfx/recipes'
import { EYE_PICK_SCHEMA } from '~/lib/gradientfx/eyePick'

/** Keywords that must never appear anywhere in a schema sent as
 *  output_config.format.schema. `minItems` is handled separately below
 *  because it's restricted, not banned outright (0 and 1 are legal). */
const UNSUPPORTED_STRUCTURED_OUTPUT_KEYWORDS = [
  'maxItems',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'multipleOf',
  'pattern',
  'allOf',
  '$ref',
] as const

/** Schemas this codebase actually wires into output_config.format.schema for
 *  a fixed (non-caller-supplied) request — see buildVibeRequestBody in
 *  server/api/vibe.post.ts, the only production call site for these two.
 *  (agent-plan.post.ts and agent-review.post.ts forward a caller-supplied
 *  `schema` and aren't statically auditable this way; out of scope here.) */
const WIRED_SCHEMAS: Record<string, unknown> = {
  VIBE_SCHEMA,
  TAKES_SCHEMA,
  TAKE_REVIEW_SCHEMA,
  RECIPES_SCHEMA,
  EYE_PICK_SCHEMA,
}

type Json = Record<string, unknown> | Json[] | string | number | boolean | null

/** Collects every (path, node) pair in the schema tree, so a violation can be
 *  reported with a precise location instead of just "somewhere in there". */
function walk(node: Json, path: string, out: Array<{ path: string, node: Record<string, unknown> }>): void {
  if (Array.isArray(node)) {
    node.forEach((child, i) => walk(child as Json, `${path}[${i}]`, out))
    return
  }
  if (node === null || typeof node !== 'object') return
  out.push({ path, node: node as Record<string, unknown> })
  for (const [key, value] of Object.entries(node)) {
    walk(value as Json, path ? `${path}.${key}` : key, out)
  }
}

describe('structured-output schemas never carry an unsupported keyword', () => {
  for (const [name, schema] of Object.entries(WIRED_SCHEMAS)) {
    describe(name, () => {
      const nodes: Array<{ path: string, node: Record<string, unknown> }> = []
      walk(schema as Json, name, nodes)

      it.each(UNSUPPORTED_STRUCTURED_OUTPUT_KEYWORDS)('never uses "%s"', (keyword) => {
        const offenders = nodes.filter(({ node }) => keyword in node).map(({ path }) => path)
        expect(offenders, `${keyword} found at: ${offenders.join(', ')}`).toEqual([])
      })

      it('never uses minItems > 1 (only 0 or 1 are supported)', () => {
        const offenders = nodes
          .filter(({ node }) => typeof node.minItems === 'number' && node.minItems > 1)
          .map(({ path }) => `${path} (minItems: ${(nodes.find(n => n.path === path)!.node as any).minItems})`)
        expect(offenders).toEqual([])
      })

      it('every object node sets additionalProperties: false', () => {
        const offenders = nodes
          .filter(({ node }) => node.type === 'object')
          .filter(({ node }) => node.additionalProperties !== false)
          .map(({ path }) => path)
        expect(offenders).toEqual([])
      })

      it('every enum is simple-typed (string/number/boolean/null), never nested objects/arrays', () => {
        const offenders: string[] = []
        for (const { path, node } of nodes) {
          if (!Array.isArray(node.enum)) continue
          for (const v of node.enum) {
            if (v !== null && typeof v === 'object') offenders.push(path)
          }
        }
        expect(offenders).toEqual([])
      })
    })
  }
})


/**
 * The one HARD requirement, re-read from the docs 2026-08-26 while auditing why
 * the compose flow never ran:
 *
 *   > `required` and `additionalProperties` (must be set to `false` for objects)
 *   > Not supported: `additionalProperties` set to anything other than `false`
 *
 * A partial or empty `required` IS allowed — the docs' own SDK examples show
 * optional fields — so the guard is only about `additionalProperties`. Checked
 * per NODE rather than per schema, because the object that goes missing one is
 * always a nested one nobody was looking at.
 */
describe('every object in a wired schema closes itself', () => {
  for (const [name, schema] of Object.entries(WIRED_SCHEMAS)) {
    it(`${name}: every type:"object" node sets additionalProperties:false`, () => {
      const open: string[] = []
      const walk = (node: unknown, path: string) => {
        if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`))
        if (!node || typeof node !== 'object') return
        const o = node as Record<string, unknown>
        if (o.type === 'object' && o.additionalProperties !== false) open.push(path)
        for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`)
      }
      walk(schema, name)
      expect(open, 'structured outputs rejects an object that does not close itself').toEqual([])
    })
  }

  it('the walker would notice an open object', () => {
    const open: string[] = []
    const walk = (node: unknown, path: string) => {
      if (!node || typeof node !== 'object') return
      const o = node as Record<string, unknown>
      if (o.type === 'object' && o.additionalProperties !== false) open.push(path)
      for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`)
    }
    walk({ type: 'object', properties: { a: { type: 'object', properties: {} } }, additionalProperties: false }, 'x')
    expect(open).toEqual(['x.properties.a'])
  })
})
