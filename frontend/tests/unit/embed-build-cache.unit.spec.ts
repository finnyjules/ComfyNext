import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  decideRebuild,
  hashInputs,
  listFilesRecursive,
  readStamp,
  writeStamp,
} from '../../scripts/embed-build-cache.mjs'

// Covers the "should we rebuild?" decision in isolation from the real
// build:embed run (32s of `vite build` invocations — not something a unit
// test should pay for). decideRebuild() takes plain data (a hash string, a
// stamp object, a list of missing output names) so every branch below is a
// fabricated-input test with no filesystem access. hashInputs()/readStamp()/
// writeStamp() do touch real files, exercised here against a throwaway temp
// directory rather than the real repo, so these tests stay independent of
// whatever app/lib/embed happens to contain today.

describe('decideRebuild', () => {
  it('rebuilds when there is no stamp', () => {
    const decision = decideRebuild({ force: false, currentHash: 'abc', stamp: null, missingOutputs: [] })
    expect(decision.rebuild).toBe(true)
    expect(decision.reason).toMatch(/no previous build stamp/)
  })

  it('skips when the stamp hash matches and every output is present', () => {
    const decision = decideRebuild({
      force: false,
      currentHash: 'abc',
      stamp: { hash: 'abc' },
      missingOutputs: [],
    })
    expect(decision.rebuild).toBe(false)
  })

  it('rebuilds when the stamp matches but an output file is missing', () => {
    const decision = decideRebuild({
      force: false,
      currentHash: 'abc',
      stamp: { hash: 'abc' },
      missingOutputs: ['spacetype-ball.js'],
    })
    expect(decision.rebuild).toBe(true)
    expect(decision.reason).toMatch(/missing output/)
    expect(decision.reason).toContain('spacetype-ball.js')
  })

  it('rebuilds when the current hash differs from the stored stamp (source changed)', () => {
    const decision = decideRebuild({
      force: false,
      currentHash: 'new-hash',
      stamp: { hash: 'old-hash' },
      missingOutputs: [],
    })
    expect(decision.rebuild).toBe(true)
    expect(decision.reason).toMatch(/source inputs changed/)
  })

  it('rebuilds when a dependency version bump changes the hash (same mechanism as a source change)', () => {
    // getThreeVersion/getViteVersion feed into the same currentHash string
    // computeEmbedInputHash produces — a version bump changes that string
    // exactly like an edited source file would, so from decideRebuild's
    // point of view it's indistinguishable from "source inputs changed".
    // This test documents that a version bump is NOT invisible to the hash.
    const beforeHash = hashInputs([], { threeVersion: '0.171.0', viteVersion: '7.3.1' })
    const afterHash = hashInputs([], { threeVersion: '0.172.0', viteVersion: '7.3.1' })
    expect(beforeHash).not.toBe(afterHash)
    const decision = decideRebuild({
      force: false,
      currentHash: afterHash,
      stamp: { hash: beforeHash },
      missingOutputs: [],
    })
    expect(decision.rebuild).toBe(true)
    expect(decision.reason).toMatch(/source inputs changed/)
  })

  it('forces a rebuild regardless of matching hash and present outputs', () => {
    const decision = decideRebuild({
      force: true,
      currentHash: 'abc',
      stamp: { hash: 'abc' },
      missingOutputs: [],
    })
    expect(decision.rebuild).toBe(true)
    expect(decision.reason).toMatch(/forced/)
  })

  it('treats a stamp with no hash field as absent', () => {
    const decision = decideRebuild({ force: false, currentHash: 'abc', stamp: {}, missingOutputs: [] })
    expect(decision.rebuild).toBe(true)
    expect(decision.reason).toMatch(/no previous build stamp/)
  })
})

describe('hashInputs', () => {
  const tmpDirs: string[] = []
  function makeTmpDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'embed-hash-test-'))
    tmpDirs.push(dir)
    return dir
  }
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  })

  it('changes when a hashed file\'s content changes', () => {
    const dir = makeTmpDir()
    const file = path.join(dir, 'a.ts')
    fs.writeFileSync(file, 'export const x = 1\n')
    const before = hashInputs([file])
    fs.writeFileSync(file, 'export const x = 2\n')
    const after = hashInputs([file])
    expect(before).not.toBe(after)
  })

  it('is stable across a content-preserving touch (mtime-only change)', () => {
    const dir = makeTmpDir()
    const file = path.join(dir, 'a.ts')
    fs.writeFileSync(file, 'export const x = 1\n')
    const before = hashInputs([file])
    // Bump mtime without touching bytes — simulates what `git checkout` /
    // branch switches do. The hash must not depend on this.
    const future = new Date(Date.now() + 60_000)
    fs.utimesSync(file, future, future)
    const after = hashInputs([file])
    expect(before).toBe(after)
  })

  it('changes when an extra key/value (e.g. a dependency version) changes', () => {
    const before = hashInputs([], { threeVersion: '0.171.0' })
    const after = hashInputs([], { threeVersion: '0.172.0' })
    expect(before).not.toBe(after)
  })

  it('is insensitive to the order files are passed in', () => {
    const dir = makeTmpDir()
    const fileA = path.join(dir, 'a.ts')
    const fileB = path.join(dir, 'b.ts')
    fs.writeFileSync(fileA, 'export const a = 1\n')
    fs.writeFileSync(fileB, 'export const b = 2\n')
    expect(hashInputs([fileA, fileB])).toBe(hashInputs([fileB, fileA]))
  })
})

describe('listFilesRecursive', () => {
  it('returns [] for a directory that does not exist', () => {
    expect(listFilesRecursive('/definitely/not/a/real/path/xyz')).toEqual([])
  })

  it('walks nested directories and returns a sorted, flat file list', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'embed-list-test-'))
    try {
      fs.mkdirSync(path.join(dir, 'nested'))
      fs.writeFileSync(path.join(dir, 'b.ts'), '')
      fs.writeFileSync(path.join(dir, 'nested', 'a.ts'), '')
      const files = listFilesRecursive(dir)
      expect(files).toEqual([path.join(dir, 'b.ts'), path.join(dir, 'nested', 'a.ts')].sort())
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('readStamp / writeStamp round-trip', () => {
  it('reads back exactly what was written', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'embed-stamp-test-'))
    try {
      const stampPath = path.join(dir, 'nested-dir', '.build-stamp.json')
      writeStamp(stampPath, 'deadbeef')
      const stamp = readStamp(stampPath)
      expect(stamp?.hash).toBe('deadbeef')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns null for a missing stamp file', () => {
    expect(readStamp('/definitely/not/a/real/path/.build-stamp.json')).toBeNull()
  })

  it('returns null (not a throw) for an unparseable stamp file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'embed-stamp-bad-'))
    try {
      const stampPath = path.join(dir, '.build-stamp.json')
      fs.writeFileSync(stampPath, 'not json{{{')
      expect(readStamp(stampPath)).toBeNull()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
