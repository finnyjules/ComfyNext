/**
 * Pure Surface-B orchestrator: price → preflight → forward → register → settle.
 * All I/O is injected (MeterDeps) so it unit-tests with fakes and the route
 * stays a thin adapter. The invariant that matters: the available-balance
 * check happens BEFORE forward(), so an underfunded run never reaches the GPU.
 */
export type MeterErrorCode = 'unauthorized' | 'insufficient' | 'bad_request'

export class MeterError extends Error {
  code: MeterErrorCode
  available?: number
  required?: number
  constructor(code: MeterErrorCode, message?: string, extra?: { available?: number; required?: number }) {
    super(message ?? code)
    this.code = code
    this.available = extra?.available
    this.required = extra?.required
  }
}

export interface MeterDeps {
  priceGraph: (prompt: any) => { credits: number; version: string; breakdown: any[] }
  getAvailable: (userId: string) => number
  register: (promptId: string, charge: { userId: string; credits: number; version: string }) => void
  forward: (body: any) => Promise<{ prompt_id: string }>
  settle: (promptId: string, userId: string, credits: number, version: string) => void
}

export interface MeterResult { promptId: string; credits: number; version: string }

export async function meterPrompt(userId: string | null, body: any, deps: MeterDeps): Promise<MeterResult> {
  if (!userId) throw new MeterError('unauthorized', 'Sign in to run graphs')
  if (!body || typeof body.prompt !== 'object' || body.prompt === null) {
    throw new MeterError('bad_request', 'Missing prompt graph')
  }

  const price = deps.priceGraph(body.prompt)
  const available = deps.getAvailable(userId)
  if (price.credits > available) {
    throw new MeterError('insufficient', 'Not enough credits', { available, required: price.credits })
  }

  const { prompt_id } = await deps.forward(body)
  deps.register(prompt_id, { userId, credits: price.credits, version: price.version })
  deps.settle(prompt_id, userId, price.credits, price.version)
  return { promptId: prompt_id, credits: price.credits, version: price.version }
}
