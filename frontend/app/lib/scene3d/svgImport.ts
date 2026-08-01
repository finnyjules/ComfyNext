// frontend/app/lib/scene3d/svgImport.ts
// Turns already-parsed SVG leaf paths into scene objects. Deliberately pure —
// no paper, no DOM, no WebGL — so the object-shaping rules (grouping, colour
// seeding, merge) are unit-testable. Parsing lives in useVectorSvg.ts and
// geometry lives in svgPath.ts; this module only decides what lands in the doc.
import { createGroup, createSvgPathObject, type SceneObject, type Vec3 } from './config'
import type { SvgLeafPath } from '~/composables/useVectorSvg'

/** `createGroup` numbers a 'Group' base, but the caller wants ITS name (the
 *  file's basename) numbered instead. Duplicated in miniature rather than
 *  exporting config.ts's private `numberedName`, to keep this module's only
 *  coupling to config.ts the two factory calls it already makes. */
function uniqueName(base: string, existing: readonly SceneObject[]): string {
  const taken = new Set(existing.map((o) => o.name))
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`
}

/** Above this many paths, import ASKS whether to split or merge rather than
 *  silently creating hundreds of meshes and hundreds of object rows. A starting
 *  value, not a measured one — it lives here alone so moving it is one line. */
export const SVG_SPLIT_THRESHOLD = 40

export interface BuildOpts {
  /** Group name — the file's basename, or 'SVG' for a paste. */
  name: string
  /** Concatenate every path into ONE object. Same primitive, same extruder:
   *  createShapes still resolves holes across the whole set, which is what makes
   *  a merged import read as one solid rather than overlapping pieces. */
  merged?: boolean
  /** Parent for the new group, so importing inside a group nests. */
  parentId?: string
}

/** Returns the group FIRST, then its children. The caller appends the whole
 *  array to doc.objects; the engine sorts with orderParentsFirst anyway, but
 *  returning them in order keeps the object list reading top-down. */
export function buildSvgObjects(
  paths: readonly SvgLeafPath[],
  existing: readonly SceneObject[],
  opts: BuildOpts,
): SceneObject[] {
  // Accumulate every object created so far (existing scene + group + each new
  // child) so numberedName sees the whole batch, not a pre-batch snapshot —
  // otherwise every child is numbered against the same array and two children
  // collide on one name (the bug duplicateObject hit before it did this).
  const scope = [...existing]
  const group = createGroup(scope)
  // createGroup already numbered a 'Group' name against scope; renumber
  // against the CALLER's requested name instead, or two SVG imports named
  // 'Logo' in the same session collide (this is what the naming test below
  // guards, alongside the per-child accumulation).
  group.name = uniqueName(opts.name, scope)
  if (opts.parentId) group.parentId = opts.parentId
  scope.push(group)

  const usable = paths.filter((p) => p.d)
  if (!usable.length) return [group]

  const make = (d: string, fill: string, fillRule: SvgLeafPath['fillRule'], position?: Vec3): SceneObject => {
    // A merged object can only carry one material, so it takes the first real
    // fill; 'none' leaves DEFAULT_MATERIAL's colour rather than writing 'none'.
    const o = createSvgPathObject(d, scope, {
      name: 'Path',
      fillRule,
      ...(fill && fill !== 'none' ? { color: fill } : {}),
      ...(position ? { position } : {}),
    })
    o.parentId = group.id
    scope.push(o)
    return o
  }

  if (opts.merged) {
    const d = usable.map((p) => p.d).join(' ')
    const fill = usable.find((p) => p.fill && p.fill !== 'none')?.fill ?? 'none'
    // LIMITATION: one concatenated `d` can carry only ONE fill-rule, so a source
    // mixing rules across its paths loses that distinction when merged — the
    // first path's rule wins for all of them. Split mode keeps each path's own
    // rule, which is why the choice dialog exists; noted rather than papered
    // over, since the alternative (splitting by rule) contradicts "one object".
    // Position stays [0,0,0]: there is ONE object here, and the extruder
    // recentres its (whole-set) geometry on its own bbox — so the import
    // centre already IS this object's centre. A per-path offset would be
    // wrong here, not just redundant.
    return [group, make(d, fill, usable[0]!.fillRule)]
  }
  // Each child gets its own centre so it lands where it was drawn instead of
  // stacking on the origin (extrudeShapes recentres every geometry on its own
  // bbox — see that function's doc in engine.ts). `cy` is NEGATED: `d` stays in
  // SVG convention (Y DOWN — see PrimitiveContent.path's doc) and pathToShapes
  // flips it at geometry build, so a path sitting BELOW the import centre in
  // SVG space must sit at NEGATIVE y in scene space. Get this backwards and the
  // whole import mirrors vertically about its centre — plausible-looking on a
  // symmetric mark, wrong on everything else.
  return [group, ...usable.map((p) => make(p.d, p.fill, p.fillRule, [p.cx, -p.cy, 0]))]
}
