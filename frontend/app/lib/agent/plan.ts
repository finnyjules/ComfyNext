/**
 * Plan execution (F1). Applies an ordered list of commands as ONE reversible
 * batch: it threads the template through each command, collects the inverses,
 * and returns a single batched inverse that undoes the whole plan in order.
 * This is what lets the agent make several edits the user accepts/rejects (and
 * undoes) as one unit. Generic over the surface via the injected `apply`.
 */
import type { Command, CommandFailure, CommandResult } from '~/lib/agent/commandSurface'

export type PlanResult<T> =
  | { ok: true; template: T; inverse: Command[] }
  | { ok: false; failedAt: number; reason: CommandFailure; detail: string; template: T; inverse: Command[] }

export function applyPlan<T>(
  template: T,
  commands: Command[],
  apply: (t: T, cmd: Command) => CommandResult<T>,
): PlanResult<T> {
  let current = template
  const inverses: Command[] = []
  for (let i = 0; i < commands.length; i++) {
    const r = apply(current, commands[i]!)
    if (!r.ok) {
      // Roll-back plan for the commands that DID succeed, in reverse order.
      return { ok: false, failedAt: i, reason: r.reason, detail: r.detail, template: current, inverse: inverses.slice().reverse() }
    }
    current = r.template
    inverses.push(r.inverse)
  }
  // Undo the whole plan by applying the collected inverses in reverse order.
  return { ok: true, template: current, inverse: inverses.slice().reverse() }
}
