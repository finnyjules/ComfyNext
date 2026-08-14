import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { BODY_SLIDERS } from '../../shared/characters/types'

// Task 4 of the body-reference-builder plan: verifies the baked preview GLB
// (scripts/bake-body-model/bake.py -> frontend/public/models/body-reference.glb)
// without needing a glTF loader — parses the raw GLB binary header + JSON
// chunk directly. DISPLAY-ONLY asset (fail-soft) — see .superpowers/sdd/task-4-brief.md.

const GLB_PATH = resolve(__dirname, '../../public/models/body-reference.glb')
const MAX_BYTES = 5 * 1024 * 1024

describe('body-reference.glb', () => {
  it('exists', () => {
    expect(existsSync(GLB_PATH)).toBe(true)
  })

  it('is under 5MB', () => {
    const size = statSync(GLB_PATH).size
    expect(size).toBeGreaterThan(0)
    expect(size).toBeLessThan(MAX_BYTES)
  })

  it('has a valid GLB header and JSON chunk', () => {
    const buf = readFileSync(GLB_PATH)

    // 12-byte GLB header: magic (uint32 LE), version (uint32 LE), length (uint32 LE)
    const magic = buf.readUInt32LE(0)
    expect(magic).toBe(0x46546c67) // 'glTF'
    const version = buf.readUInt32LE(4)
    expect(version).toBe(2)

    // First chunk header starts at byte 12: chunkLength (uint32 LE), chunkType (uint32 LE)
    const jsonChunkLength = buf.readUInt32LE(12)
    const jsonChunkType = buf.readUInt32LE(16)
    expect(jsonChunkType).toBe(0x4e4f534a) // 'JSON'

    const jsonBytes = buf.subarray(20, 20 + jsonChunkLength)
    const json = JSON.parse(jsonBytes.toString('utf-8'))

    expect(json.meshes).toBeDefined()
    expect(json.meshes.length).toBeGreaterThan(0)

    const mesh = json.meshes[0]
    expect(mesh.extras).toBeDefined()
    expect(mesh.extras.targetNames).toEqual([...BODY_SLIDERS])

    const primitive = mesh.primitives[0]
    expect(primitive.targets).toBeDefined()
    expect(primitive.targets.length).toBe(8)
  })
})
