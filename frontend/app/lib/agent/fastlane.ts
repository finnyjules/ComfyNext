/**
 * Fast-lane eligibility for the canvas agent: is this plan a trivially-safe
 * single node placement that deserves to skip the ghost/Keep&Run ceremony?
 *
 * True iff the plan is exactly one addNode that CREATES a generator or a
 * (frontend-only) studio — free to place, free to run, nothing to wire, and
 * nothing existing to modify. Effects are excluded: a lone unwired EditImage
 * is a half-plan whose intent the ghost preview should show. Pure: commands
 * in, boolean out — no Vue, no I/O.
 */
import type { Command } from '~/lib/agent/commandSurface'
import { capabilityByType } from '~/lib/agent/capabilities'

export function isFastLanePlacement(commands: Command[]): boolean {
  if (commands.length !== 1) return false
  const cmd = commands[0]!
  if (cmd.op !== 'addNode') return false
  if (cmd.target) return false // creates, doesn't modify anything existing
  const nodeType = cmd.args?.nodeType
  if (typeof nodeType !== 'string') return false
  const cap = capabilityByType(nodeType)
  if (!cap) return false
  return cap.kind === 'generator' || (cap.kind === 'studio' && cap.frontendOnly === true)
}
