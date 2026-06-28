/**
 * Smart Layout agent surface (F1). Wraps the pure `shared/template-grid`
 * functions so an agent can read a layout and change it through named,
 * invertible commands. Pure: every function takes a template and returns data
 * or a fresh template — no Vue, no editor state.
 */
import type { ElementV2, Region, TemplateV2, TemplateV3 } from '~~/shared/template-grid/types'
import { ARCHETYPES, applyArchetype as applyArchetypePure } from '~~/shared/template-grid/archetypes'
import { allElements, groupIntoSection, ungroupSection } from '~~/shared/template-grid/sections'
import type { Command, CommandResult, CommandSpec, SurfaceSnapshot } from '~/lib/agent/commandSurface'

// JSON clone — templates are plain JSON; guards undefined (JSON.parse(undefined) throws).
function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T)
}

/** Deep-clone the named template fields — used to capture an inverse snapshot
 *  for the generic `restore` command. */
function pick(t: TemplateV3, keys: (keyof TemplateV3)[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of keys) out[k as string] = clone(t[k])
  return out
}

/** Document fields the internal `restore` op may overwrite — never structural
 *  fields like version/id/master (defence against a malformed restore). */
const RESTORABLE = new Set(['elements', 'sections', 'background', 'brand'])

/** The agent-facing command menu (F3 hints map qualitative intent → command).
 *  `restore` is intentionally omitted — it's the internal inverse mechanism. */
const SMART_LAYOUT_COMMANDS: CommandSpec[] = [
  { op: 'setSectionRegion', hint: 'Move or resize a section: set its grid region {col,colSpan,row,rowSpan} (1-based, inclusive). e.g. "put the title in the top third".' },
  { op: 'setText', hint: 'Change the copy of a text element. target = element id; args: { text }. The text may be literal or model-written (e.g. "make the headline punchier" → set the rewritten string). Note: content can be a {{ props.* }} token bound to a variable — setting literal text replaces that binding.' },
  { op: 'group', hint: 'Group existing ungrouped elements into a new named section (a lockup/block). args: { name, elementIds }.' },
  { op: 'ungroup', hint: 'Dissolve a section back into ungrouped elements. args: { sectionId }.' },
  { op: 'applyArchetype', hint: 'Replace the composition with a built-in layout template. args.id ∈ hero-band | split | type-poster | editorial.' },
  { op: 'setBrand', hint: 'Apply brand colours/fonts (primary, secondary, accent, foreground, background, fontDisplay, fontBody). args: { patch }.' },
  { op: 'addChildToSection', hint: 'Add a text/image/shape element into an existing section, e.g. "put the product photo in the hero section". args: { sectionId, element }.' },
]

/** Read a Smart Layout template as an agent-readable snapshot: each section
 *  becomes an addressable object carrying its current grid region. */
export function describeSmartLayout(template: TemplateV3): SurfaceSnapshot {
  return {
    surface: 'smart-layout',
    objects: [
      ...template.sections.map(s => ({
        id: s.id,
        label: s.name,
        type: 'section',
        current: clone(s.region),
      })),
      // Elements (ungrouped + section children) so the agent can see the copy
      // it is asked to change. `current` is the element's content (or null).
      ...allElements(template).map(e => ({
        id: e.id,
        label: e.role ?? e.id,
        type: e.type,
        current: 'content' in e ? clone((e as { content: unknown }).content) : null,
      })),
    ],
    commands: SMART_LAYOUT_COMMANDS,
  }
}

/** Apply one command to a Smart Layout template, returning the new template and
 *  an inverse command. Pure — the input is never mutated. */
export function applySmartLayoutCommand(
  input: TemplateV3, cmd: Command,
): CommandResult<TemplateV3> {
  // Operate on a deep clone: the input is never mutated, and every returned
  // template is fully independent of it (so callers can't corrupt the original
  // by mutating the result). Mirrors the shared/template-grid pure-function
  // convention, and de-proxies a Vue-reactive input.
  const template = clone(input)
  switch (cmd.op) {
    case 'setSectionRegion': {
      const section = template.sections.find(s => s.id === cmd.target)
      if (!section) return { ok: false, reason: 'invalid', detail: `no section '${cmd.target}'` }
      const region = cmd.args?.region as Region | undefined
      if (!region) return { ok: false, reason: 'invalid', detail: 'missing args.region' }
      const before = section.region
      const next: TemplateV3 = {
        ...template,
        sections: template.sections.map(s => (s.id === cmd.target ? { ...s, region } : s)),
      }
      return {
        ok: true,
        template: next,
        inverse: { op: 'setSectionRegion', target: cmd.target, args: { region: before } },
      }
    }
    case 'setText': {
      const text = cmd.args?.text
      if (typeof text !== 'string') return { ok: false, reason: 'invalid', detail: 'missing args.text (string)' }
      const el = template.elements.find(e => e.id === cmd.target)
        ?? template.sections.flatMap(s => s.children).find(e => e.id === cmd.target)
      if (!el) return { ok: false, reason: 'invalid', detail: `no element '${String(cmd.target)}'` }
      if (el.type !== 'text') return { ok: false, reason: 'invalid', detail: `element '${String(cmd.target)}' is not a text element` }
      const before = el.content
      el.content = text // safe: `template` is a deep clone of the input
      return { ok: true, template, inverse: { op: 'setText', target: cmd.target, args: { text: before } } }
    }
    case 'group': {
      const elementIds = cmd.args?.elementIds
      const name = (cmd.args?.name as string | undefined)?.trim() || 'Section'
      if (!Array.isArray(elementIds) || elementIds.length === 0
        || !elementIds.every(id => template.elements.some(e => e.id === id)))
        return { ok: false, reason: 'invalid', detail: 'group requires a non-empty list of existing element ids' }
      const before = pick(template, ['elements', 'sections'])
      const next = groupIntoSection(template, elementIds as string[], name)
      return { ok: true, template: next, inverse: { op: 'restore', args: before } }
    }
    case 'ungroup': {
      const sectionId = cmd.args?.sectionId as string | undefined
      const section = template.sections.find(s => s.id === sectionId)
      if (!section || section.children.length === 0)
        return { ok: false, reason: 'invalid', detail: `section '${String(sectionId)}' is missing or empty` }
      const before = pick(template, ['elements', 'sections'])
      const next = ungroupSection(template, sectionId!)
      return { ok: true, template: next, inverse: { op: 'restore', args: before } }
    }
    case 'applyArchetype': {
      const arch = ARCHETYPES.find(a => a.id === cmd.args?.id)
      if (!arch) return { ok: false, reason: 'invalid', detail: `no archetype '${String(cmd.args?.id)}'` }
      const before = pick(template, ['elements', 'background', 'brand'])
      // applyArchetype spreads the input, preserving version:3 + sections, and
      // only overwrites elements/background/brand. The casts bridge its
      // V2-typed signature — safe as long as that preservation holds.
      const applied = applyArchetypePure(template as unknown as TemplateV2, arch) as unknown as TemplateV3
      return { ok: true, template: applied, inverse: { op: 'restore', args: before } }
    }
    case 'setBrand': {
      const patch = cmd.args?.patch
      if (!patch || typeof patch !== 'object') return { ok: false, reason: 'invalid', detail: 'missing args.patch' }
      const before = pick(template, ['brand'])
      const next = { ...template, brand: { ...(template.brand ?? {}), ...(patch as Record<string, unknown>) } } as TemplateV3
      return { ok: true, template: next, inverse: { op: 'restore', args: before } }
    }
    case 'addChildToSection': {
      const sectionId = cmd.args?.sectionId as string | undefined
      const element = cmd.args?.element as ElementV2 | undefined
      if (!element || !element.id || !element.type || !element.region)
        return { ok: false, reason: 'invalid', detail: 'element missing required fields (id, type, region)' }
      if (!template.sections.some(s => s.id === sectionId))
        return { ok: false, reason: 'invalid', detail: `no section '${String(sectionId)}'` }
      const before = pick(template, ['sections'])
      const next: TemplateV3 = {
        ...template,
        sections: template.sections.map(s =>
          (s.id === sectionId ? { ...s, children: [...s.children, clone(element)] } : s)),
      }
      return { ok: true, template: next, inverse: { op: 'restore', args: before } }
    }
    case 'restore': {
      const args = cmd.args ?? {}
      const keys = (Object.keys(args) as (keyof TemplateV3)[]).filter(k => RESTORABLE.has(k as string))
      const before = pick(template, keys)
      const next = { ...template } as TemplateV3
      const sink = next as unknown as Record<string, unknown>
      for (const k of keys) sink[k as string] = (args as Record<string, unknown>)[k as string]
      return { ok: true, template: next, inverse: { op: 'restore', args: before } }
    }
    default:
      return { ok: false, reason: 'out-of-vocabulary', detail: `unknown op '${cmd.op}'` }
  }
}
