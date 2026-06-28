/**
 * Translation protocol (F1). Turns a surface snapshot + a user phrase into the
 * model request, and the model's reply back into validated commands:
 *
 *   describe() ─▶ buildAgentPrompt + buildCommandSchema ─▶ model ─▶ parseAgentResponse ─▶ applyPlan
 *
 * The schema constrains `op` to the surface's command catalog, so the model
 * structurally cannot emit an out-of-vocabulary command. Args ride as a
 * JSON-encoded string (strict JSON-schema output forbids open objects).
 */
import type { Command, CommandSpec, SurfaceSnapshot } from '~/lib/agent/commandSurface'

/** JSON schema for the model's structured output: an ordered command list
 *  (op restricted to the catalog) plus a one-sentence rationale. */
export function buildCommandSchema(specs: CommandSpec[]): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      rationale: { type: 'string', description: 'One short sentence explaining the plan.' },
      commands: {
        type: 'array',
        description: 'Ordered commands to apply. Empty if nothing in the request fits.',
        items: {
          type: 'object',
          properties: {
            op: { type: 'string', enum: specs.map(s => s.op) },
            target: { type: 'string', description: 'Id of the object to act on (omit when not needed).' },
            args: { type: 'string', description: "JSON-encoded arguments object, e.g. '{\"text\":\"SUMMER\"}'." },
          },
          required: ['op'],
          additionalProperties: false,
        },
      },
    },
    required: ['commands', 'rationale'],
    additionalProperties: false,
  }
}

/** The user-facing prompt: what's on the surface, what can be done to it, and
 *  the request. Object ids + current values let the model target the right
 *  thing; command hints map qualitative phrasing onto real operations. */
export function buildAgentPrompt(snapshot: SurfaceSnapshot, phrase: string): string {
  const objects = snapshot.objects.map((o) => {
    const cur = o.current !== null && o.current !== undefined ? ` — current ${JSON.stringify(o.current)}` : ''
    return `- ${o.id} ("${o.label}", ${o.type})${cur}`
  }).join('\n')
  const commands = snapshot.commands.map(c => `- ${c.op}${c.hint ? `: ${c.hint}` : ''}`).join('\n')
  return [
    `You are a layout copilot for the "${snapshot.surface}" surface.`,
    `Objects (id, label, kind, current value):\n${objects}`,
    `Available commands:\n${commands}`,
    `USER REQUEST: ${phrase}`,
    'Return a JSON plan: an ordered "commands" list to satisfy the request, and a one-sentence "rationale".',
    'Rules: only use the command ops and object ids listed above; put each command\'s arguments as a JSON-encoded string in "args"; if nothing fits, return an empty commands list. Do not invent ids or ops.',
  ].join('\n\n')
}

/** Parse the model's JSON reply into commands, decoding each `args` string back
 *  into an object. Tolerant: bad args decode to undefined (apply() will reject
 *  them), and a non-array `commands` becomes an empty plan. */
export function parseAgentResponse(text: string): { commands: Command[]; rationale: string } {
  let data: { commands?: unknown; rationale?: unknown }
  try {
    data = JSON.parse(text)
  } catch {
    return { commands: [], rationale: '' }
  }
  const rationale = typeof data.rationale === 'string' ? data.rationale : ''
  const raw = Array.isArray(data.commands) ? data.commands : []
  const commands: Command[] = raw.map((c) => {
    const cc = (c ?? {}) as { op?: unknown; target?: unknown; args?: unknown }
    let args: Record<string, unknown> | undefined
    if (typeof cc.args === 'string' && cc.args.trim()) {
      try { args = JSON.parse(cc.args) as Record<string, unknown> } catch { args = undefined }
    } else if (cc.args && typeof cc.args === 'object') {
      args = cc.args as Record<string, unknown>
    }
    return { op: String(cc.op), target: typeof cc.target === 'string' ? cc.target : undefined, args }
  })
  return { commands, rationale }
}
