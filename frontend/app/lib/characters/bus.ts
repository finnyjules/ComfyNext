/**
 * Typed in-process event bus for character/cast wiring (Task 5) — replaces
 * the five `window.dispatchEvent(new CustomEvent('sailor:...'))` /
 * `addEventListener` pairs. Module-level Map<event, Set<listener>>, no deps,
 * no DOM: subscribe/emit happen synchronously within the same JS realm, so
 * there's no cross-iframe/postMessage concern the old window events had.
 */
export interface CharacterBusEvents {
  castEdgesChanged: undefined
  uncastCharacter: { nodeId: string; slug: string }
  addCharacterImageGen: { slug: string; use: 'sheet' | 'lora' }
  addCharacterCastNode: { slug: string; name: string; stateId: string | null }
}

type Listener<K extends keyof CharacterBusEvents> = (payload: CharacterBusEvents[K]) => void

const listeners = new Map<keyof CharacterBusEvents, Set<Listener<any>>>()

export function onCharacterEvent<K extends keyof CharacterBusEvents>(
  key: K,
  fn: Listener<K>,
): () => void {
  let set = listeners.get(key)
  if (!set) { set = new Set(); listeners.set(key, set) }
  set.add(fn)
  return () => { set!.delete(fn) }
}

export function emitCharacterEvent<K extends keyof CharacterBusEvents>(
  key: K,
  ...payload: CharacterBusEvents[K] extends undefined ? [] : [CharacterBusEvents[K]]
): void {
  const set = listeners.get(key)
  if (!set || !set.size) return
  const value = payload[0] as CharacterBusEvents[K]
  for (const fn of set) fn(value)
}
