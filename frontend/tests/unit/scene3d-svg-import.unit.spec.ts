import { describe, it, expect } from 'vitest'
import { buildSvgObjects, SVG_SPLIT_THRESHOLD } from '~/lib/scene3d/svgImport'
import type { SvgLeafPath } from '~/composables/useVectorSvg'
import type { PrimitiveObject } from '~/lib/scene3d/config'

function leaf(d: string, fill = '#ff0000'): SvgLeafPath {
  return { d, fill, stroke: 'none', strokeWidth: 0, fillRule: 'nonzero' }
}

describe('scene3d svg import', () => {
  it('returns a group followed by one svgPath per path', () => {
    const objs = buildSvgObjects([leaf('M0 0 L1 0 Z'), leaf('M2 0 L3 0 Z')], [], { name: 'Logo' })
    expect(objs).toHaveLength(3)
    const group = objs.find((o) => o.kind === 'group')!
    expect(group.name).toBe('Logo')
    const kids = objs.filter((o) => o.id !== group.id)
    expect(kids).toHaveLength(2)
    for (const k of kids) {
      expect(k.parentId).toBe(group.id)
      expect((k as PrimitiveObject).primitive).toBe('svgPath')
    }
    // Same-batch accumulation: if every child were numbered against the same
    // pre-batch snapshot instead of the growing scope, both would land 'Path'.
    expect(new Set(kids.map((k) => k.name)).size).toBe(kids.length)
  })

  it('seeds each object colour from its fill', () => {
    const objs = buildSvgObjects([leaf('M0 0 L1 0 Z', '#00ff00')], [], { name: 'X' })
    const kid = objs.find((o) => o.kind === 'primitive') as PrimitiveObject
    expect(kid.material.color).toBe('#00ff00')
  })

  it('leaves the default colour alone when a path has no fill', () => {
    const p: SvgLeafPath = { d: 'M0 0 L1 0 Z', fill: 'none', stroke: 'none', strokeWidth: 0, fillRule: 'nonzero' }
    const objs = buildSvgObjects([p], [], { name: 'X' })
    const kid = objs.find((o) => o.kind === 'primitive') as PrimitiveObject
    expect(kid.material.color).toBeTruthy()
  })

  it('merged mode yields exactly one object whose d holds every subpath', () => {
    const objs = buildSvgObjects([leaf('M0 0 L1 0 Z'), leaf('M2 0 L3 0 Z')], [], { name: 'X', merged: true })
    const kids = objs.filter((o) => o.kind === 'primitive') as PrimitiveObject[]
    expect(kids).toHaveLength(1)
    expect(kids[0]!.content?.path).toContain('M0 0 L1 0 Z')
    expect(kids[0]!.content?.path).toContain('M2 0 L3 0 Z')
  })

  it('merged mode still produces a group, so the import is one movable unit', () => {
    const objs = buildSvgObjects([leaf('M0 0 L1 0 Z')], [], { name: 'X', merged: true })
    expect(objs.some((o) => o.kind === 'group')).toBe(true)
  })

  it('parents the group under an existing parent when asked', () => {
    const objs = buildSvgObjects([leaf('M0 0 L1 0 Z')], [], { name: 'X', parentId: 'outer' })
    expect(objs.find((o) => o.kind === 'group')!.parentId).toBe('outer')
  })

  it('names children uniquely against the existing scene', () => {
    const first = buildSvgObjects([leaf('M0 0 L1 0 Z')], [], { name: 'Logo' })
    const second = buildSvgObjects([leaf('M0 0 L1 0 Z')], first, { name: 'Logo' })
    const names = [...first, ...second].map((o) => o.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('exports a split threshold', () => {
    expect(SVG_SPLIT_THRESHOLD).toBe(40)
  })
})
