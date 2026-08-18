/**
 * Shared owner-scoping for the flat JSON file stores (Stage 6). The files
 * stay files — ownership lives in resource_owners, keyed by the record id
 * (the filename stem). Local mode: no filtering, no registry writes, and
 * storeDir() returns the store's historical path — byte-identical.
 */
import { createError } from 'h3'
import { deployMode } from './deployMode'
import { hostedCanMutate, ownerOf, recordOwner, releaseOwner } from './resourceOwners'

export interface OwnedStoreOpts { kind: string, dir: string }

/**
 * List: local → all records. Hosted → records the caller owns PLUS records
 * with no owner row (curated/global), per the plan's ownership rule. A null
 * userId in hosted (shouldn't reach here behind auth) sees only curated.
 */
export async function listOwned<T>(
  opts: OwnedStoreOpts,
  userId: string | null,
  readAll: () => Promise<Array<{ id: string, record: T }>>,
): Promise<T[]> {
  const all = await readAll()
  if (deployMode() !== 'hosted') return all.map(e => e.record)
  const out: T[] = []
  for (const { id, record } of all) {
    const owner = await ownerOf(opts.kind, id)
    if (owner === null || owner === userId) out.push(record)
  }
  return out
}

/**
 * Guard a mutation (upsert/delete) on `id`. Local → always allowed. Hosted →
 * allowed iff the caller owns the id; a brand NEW id (no owner row AND no file
 * on disk — caller passes `exists`) is allowed (claimNew records it after).
 * Unowned-but-existing is curated/read-only → refused. A null userId in hosted
 * fails closed. Refusal is a 404 (no existence disclosure).
 */
export async function guardMutation(
  opts: OwnedStoreOpts,
  userId: string | null,
  id: string,
  exists: boolean,
): Promise<void> {
  if (deployMode() !== 'hosted') return
  if (userId === null) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const owner = await ownerOf(opts.kind, id)
  if (owner === null && !exists) return // brand-new id — claimNew records it
  if (hostedCanMutate(owner, userId)) return
  throw createError({ statusCode: 404, statusMessage: 'Not found' })
}

/** recordOwner in hosted, no-op local. Never guesses an owner for a null userId. */
export async function claimNew(opts: OwnedStoreOpts, userId: string | null, id: string): Promise<void> {
  if (deployMode() !== 'hosted') return
  if (userId === null) return
  await recordOwner(opts.kind, id, userId)
}

/** releaseOwner in hosted, no-op local. */
export async function releaseRecord(opts: OwnedStoreOpts, id: string): Promise<void> {
  if (deployMode() !== 'hosted') return
  await releaseOwner(opts.kind, id)
}
