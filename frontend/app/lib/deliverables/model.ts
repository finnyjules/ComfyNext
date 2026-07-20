export interface ArtifactRef {
  filename: string
  subfolder: string
  media: 'image' | 'video' | 'audio'
  sourceNodeId?: string | null
  meta?: { w?: number; h?: number; durationMs?: number; ext?: string }
}

export type DeliverableItem =
  | { id: string; kind: 'single'; name: string; ref: ArtifactRef }
  | { id: string; kind: 'set'; name: string; items: ArtifactRef[]; coverIndex?: number }

export function makeDeliverableId(seq: number): string {
  return `dlv_${seq.toString(36)}`
}

export function refKey(ref: ArtifactRef): string {
  return `${ref.subfolder}/${ref.filename}`
}

function nameFor(ref: ArtifactRef, name: string): string {
  return name.trim() || ref.filename
}

export function isPresent(list: DeliverableItem[], ref: ArtifactRef): boolean {
  const k = refKey(ref)
  return list.some(item =>
    item.kind === 'single'
      ? refKey(item.ref) === k
      : item.items.some(r => refKey(r) === k),
  )
}

export function addSingle(list: DeliverableItem[], ref: ArtifactRef, name: string): DeliverableItem[] {
  if (isPresent(list, ref)) return list
  const id = makeDeliverableId(list.length + 1 + Math.floor(performanceNow()))
  return [...list, { id, kind: 'single', name: nameFor(ref, name), ref }]
}

// Deterministic-enough monotonic-ish counter without Date.now in pure code paths
// that tests call; real callers pass explicit ids where determinism matters.
let _tick = 0
function performanceNow(): number { return (_tick += 1) }

export function rename(list: DeliverableItem[], id: string, name: string): DeliverableItem[] {
  if (!list.some(i => i.id === id)) return list
  return list.map(i => (i.id === id ? { ...i, name } : i))
}

export function remove(list: DeliverableItem[], id: string): DeliverableItem[] {
  if (!list.some(i => i.id === id)) return list
  return list.filter(i => i.id !== id)
}

export function reorder(list: DeliverableItem[], from: number, to: number): DeliverableItem[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved!)
  return next
}

export function group(
  list: DeliverableItem[], ids: string[], name: string, makeId: () => string,
): DeliverableItem[] {
  const picked = ids
    .map(id => list.find(i => i.id === id))
    .filter((i): i is Extract<DeliverableItem, { kind: 'single' }> => !!i && i.kind === 'single')
  if (picked.length < 2) return list
  const pickedIds = new Set(picked.map(p => p.id))
  const firstIdx = list.findIndex(i => pickedIds.has(i.id))
  const set: DeliverableItem = {
    id: makeId(), kind: 'set', name: name.trim() || 'Set',
    items: picked.map(p => p.ref), coverIndex: 0,
  }
  const rest = list.filter(i => !pickedIds.has(i.id))
  rest.splice(Math.min(firstIdx, rest.length), 0, set)
  return rest
}

export function ungroup(list: DeliverableItem[], id: string): DeliverableItem[] {
  const idx = list.findIndex(i => i.id === id)
  const item = list[idx]
  if (!item || item.kind !== 'set') return list
  const singles: DeliverableItem[] = item.items.map((ref, n) => ({
    id: `${item.id}_m${n}`, kind: 'single', name: ref.filename, ref,
  }))
  const next = [...list]
  next.splice(idx, 1, ...singles)
  return next
}

export function reorderWithinSet(
  list: DeliverableItem[], id: string, from: number, to: number,
): DeliverableItem[] {
  const idx = list.findIndex(i => i.id === id && i.kind === 'set')
  const target = list[idx]
  if (idx === -1 || !target || target.kind !== 'set') return list
  if (from === to || from < 0 || to < 0 || from >= target.items.length || to >= target.items.length) return list
  const items = [...target.items]
  const [m] = items.splice(from, 1)
  items.splice(to, 0, m!)
  const next = [...list]
  next.splice(idx, 1, { ...target, items })
  return next
}

export function dissolveIfUnderTwo(item: DeliverableItem): DeliverableItem {
  if (item.kind === 'set' && item.items.length <= 1) {
    const ref = item.items[0]
    if (ref) return { id: item.id, kind: 'single', name: item.name || ref.filename, ref }
  }
  return item
}

export function removeFromSet(
  list: DeliverableItem[], setId: string, memberIndex: number, _makeId: () => string,
): DeliverableItem[] {
  const idx = list.findIndex(i => i.id === setId && i.kind === 'set')
  const target = list[idx]
  if (idx === -1 || !target || target.kind !== 'set') return list
  if (memberIndex < 0 || memberIndex >= target.items.length) return list
  const items = target.items.filter((_, n) => n !== memberIndex)
  const next = [...list]
  next.splice(idx, 1, dissolveIfUnderTwo({ ...target, items }))
  return next
}
