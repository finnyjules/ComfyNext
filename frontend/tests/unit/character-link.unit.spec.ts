import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { linkDecision, linkTrainedCharacter, type LinkDecisionInput } from '~~/server/utils/characterLink'
import { __setResourceOwnersDbForTests } from '~~/server/utils/resourceOwners'

/**
 * Pure decision logic for character-link collisions.
 * Tests the four cases: claim-draft, update-same, create new, and collision.
 */

describe('linkDecision', () => {
  it('claim-draft: matched record with loraName === null flips to ready', () => {
    const existing: LinkDecisionInput = { loraName: null }
    expect(linkDecision(existing, 'weights-v1.safetensors')).toBe('claim-draft')
  })

  it('update-same: matched record already ready with the same loraName is idempotent', () => {
    const existing: LinkDecisionInput = { loraName: 'weights-v1.safetensors' }
    expect(linkDecision(existing, 'weights-v1.safetensors')).toBe('update-same')
  })

  it('collide-new: matched record already ready with a DIFFERENT loraName creates a new record', () => {
    const existing: LinkDecisionInput = { loraName: 'weights-v1.safetensors' }
    expect(linkDecision(existing, 'weights-v2.safetensors')).toBe('collide-new')
  })

  it('create: no existing record creates a fresh one', () => {
    expect(linkDecision(null, 'weights-v1.safetensors')).toBe('create')
  })
})

// C1 — linkTrainedCharacter must claim the character record it creates for the
// training's owner, else the auto-created record lands unowned = curated =
// visible to all, editable by none (including its creator). Ownership is keyed
// by slug (the filename stem), matching characters-local.get's listOwned.
describe('linkTrainedCharacter — records character ownership (hosted)', () => {
  const CLERK_KEY = 'NUXT_CLERK_SECRET_KEY'
  const savedClerk = process.env[CLERK_KEY]
  let tmp: string
  let cwd: string
  let owners: Map<string, string>

  beforeAll(() => { cwd = process.cwd() })
  afterAll(() => { process.chdir(cwd) })

  beforeEach(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'charlink-'))
    await fs.mkdir(path.join(tmp, 'models', 'characters'), { recursive: true })
    await fs.mkdir(path.join(tmp, 'frontend'), { recursive: true })
    process.chdir(path.join(tmp, 'frontend'))
    owners = new Map<string, string>()
    __setResourceOwnersDbForTests({
      query: vi.fn(async (sql: string, params: any[] = []) => {
        if (/INSERT INTO resource_owners/i.test(sql)) {
          const [kind, id, uid] = params
          const k = `${kind}:${id}`
          if (!owners.has(k)) owners.set(k, uid)
          return { rows: [] }
        }
        if (/SELECT user_id FROM resource_owners/i.test(sql)) {
          const [kind, id] = params
          const v = owners.get(`${kind}:${id}`)
          return { rows: v ? [{ user_id: v }] : [] }
        }
        return { rows: [] }
      }),
    })
  })
  afterEach(async () => {
    process.chdir(cwd)
    await fs.rm(tmp, { recursive: true, force: true })
    __setResourceOwnersDbForTests(null)
    if (savedClerk === undefined) delete process.env[CLERK_KEY]
    else process.env[CLERK_KEY] = savedClerk
  })

  it('hosted: creating a fresh record claims it for ownerUserId', async () => {
    process.env[CLERK_KEY] = 'sk_test_hosted'
    await linkTrainedCharacter({ displayName: 'Millie', weightsFilename: 'millie.safetensors', trigger: 'MIL', ownerUserId: 'u_owner' })
    const charsDir = path.join(tmp, 'models', 'characters')
    await fs.access(path.join(charsDir, 'millie.json'))
    expect(owners.get('character:millie')).toBe('u_owner')
  })

  it('local mode: no ownership row written', async () => {
    delete process.env[CLERK_KEY]
    await linkTrainedCharacter({ displayName: 'Local Char', weightsFilename: 'lc.safetensors', trigger: null, ownerUserId: 'u_owner' })
    expect(owners.size).toBe(0)
  })

  it('hosted with unknown owner: creates the record but records nothing', async () => {
    process.env[CLERK_KEY] = 'sk_test_hosted'
    await linkTrainedCharacter({ displayName: 'Orphan', weightsFilename: 'orphan.safetensors', trigger: null, ownerUserId: null })
    const charsDir = path.join(tmp, 'models', 'characters')
    await fs.access(path.join(charsDir, 'orphan.json'))
    expect(owners.size).toBe(0)
  })
})
