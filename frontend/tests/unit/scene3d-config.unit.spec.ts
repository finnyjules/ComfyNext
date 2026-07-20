import { describe, it, expect } from 'vitest'
import {
  defaultDoc, createPrimitive, createGlbObject, serializeDoc, parseDoc, PRIMITIVE_KINDS, MATERIAL_TYPES,
  gradientAngles, gradientDirection, gradientStopsOf, MATERIAL_DEFAULTS,
  createLight, LIGHT_KINDS, LIGHT_DEFAULTS, lightIntensityDefault, lightIntensityMax,
  type GradientStop, type SceneMaterial,
} from '~/lib/scene3d/config'
import { PRIM_GROUPS } from '~/lib/scene3d/primGroups'

describe('scene3d config', () => {
  it('round-trips a document through serialize/parse', () => {
    const doc = defaultDoc()
    doc.objects.push(createPrimitive('box', doc.objects))
    doc.objects.push(createGlbObject('https://example.com/m.glb', doc.objects))
    const back = parseDoc(serializeDoc(doc))
    expect(back).toEqual(doc)
  })

  it('parses empty/garbage input to the default document', () => {
    expect(parseDoc('')).toEqual(defaultDoc())
    expect(parseDoc('{not json')).toEqual(defaultDoc())
    expect(parseDoc('{"version":999}')).toEqual(defaultDoc())
  })

  it('creates unique ids and numbered names', () => {
    const objs = [createPrimitive('box', [])]
    const second = createPrimitive('box', objs)
    expect(second.id).not.toBe(objs[0]!.id)
    expect(objs[0]!.name).toBe('Box')
    expect(second.name).toBe('Box 2')
  })

  it('fills missing fields with defaults on parse', () => {
    const doc = defaultDoc()
    const raw = JSON.parse(serializeDoc(doc))
    delete raw.lighting.ambient
    const back = parseDoc(JSON.stringify(raw))
    expect(back.lighting.ambient).toBe(defaultDoc().lighting.ambient)
  })

  it('round-trips a document containing every primitive kind', () => {
    const doc = defaultDoc()
    for (const kind of PRIMITIVE_KINDS) doc.objects.push(createPrimitive(kind, doc.objects))
    expect(PRIMITIVE_KINDS).toHaveLength(14)
    const back = parseDoc(serializeDoc(doc))
    expect(back).toEqual(doc)
    expect(back.objects.map((o) => (o as any).primitive)).toEqual([...PRIMITIVE_KINDS])
  })

  it('drops objects with an unknown primitive kind instead of erroring', () => {
    const doc = defaultDoc()
    doc.objects.push(createPrimitive('box', doc.objects))
    const raw = JSON.parse(serializeDoc(doc))
    raw.objects.push({ ...raw.objects[0], id: 'obj_bad', primitive: 'blob' })
    const back = parseDoc(JSON.stringify(raw))
    expect(back.objects).toHaveLength(1)
    expect((back.objects[0] as any).primitive).toBe('box')
  })

  it('round-trips every material type with params', () => {
    const doc = defaultDoc()
    const boxFor = (patch: any) => {
      const o = createPrimitive('box', doc.objects)
      Object.assign(o.material, patch)
      doc.objects.push(o)
    }
    boxFor({ type: 'toon', toonSteps: 4 })
    boxFor({ type: 'matcap', matcap: 'gold' })
    boxFor({ type: 'glass', ior: 1.8, transmission: 0.9, thickness: 1.2, roughness: 0.1 })
    boxFor({ type: 'fresnel', fresnelColor: '#ff00aa', fresnelPower: 5 })
    boxFor({ type: 'gradient', gradientB: '#123456', gradientAxis: 'z', gradientShading: 'faceted' })
    boxFor({ type: 'image', image: 'scene3d_tex_1.png' })
    expect(MATERIAL_TYPES).toHaveLength(7)
    const back = parseDoc(serializeDoc(doc))
    expect(back).toEqual(doc)
  })

  it('migrates old materials (no type field) to standard', () => {
    const doc = defaultDoc()
    doc.objects.push(createPrimitive('box', doc.objects))
    const raw = JSON.parse(serializeDoc(doc))
    delete raw.objects[0].material.type
    const back = parseDoc(JSON.stringify(raw))
    expect((back.objects[0] as any).material.type).toBe('standard')
  })

  it('degrades an unknown material type to standard', () => {
    const doc = defaultDoc()
    doc.objects.push(createPrimitive('box', doc.objects))
    const raw = JSON.parse(serializeDoc(doc))
    raw.objects[0].material.type = 'hologram'
    const back = parseDoc(JSON.stringify(raw))
    expect((back.objects[0] as any).material.type).toBe('standard')
  })

  it('round-trips every physical surface field', () => {
    const doc = defaultDoc()
    const o = createPrimitive('box', doc.objects)
    Object.assign(o.material, {
      clearcoat: 0.8, clearcoatRoughness: 0.2, sheen: 0.5, sheenColor: '#ffddee',
      emissive: '#220044', emissiveIntensity: 2.5, opacity: 0.7, dispersion: 1.5,
      attenuationColor: '#88ffcc', attenuationDistance: 2, iridescence: 0.9,
      iridescenceIOR: 1.8, envMapIntensity: 2,
    })
    doc.objects.push(o)
    expect(parseDoc(serializeDoc(doc))).toEqual(doc)
  })

  it('round-trips primitive geometry params and drops junk ones', () => {
    const doc = defaultDoc()
    const sphere = createPrimitive('sphere', doc.objects)
    sphere.params = { detail: 12, arc: 180 }
    doc.objects.push(sphere)
    const box = createPrimitive('box', doc.objects)
    box.params = { cornerRadius: 0.2, cornerSides: 4 }
    doc.objects.push(box)
    const plain = createPrimitive('cone', doc.objects)
    doc.objects.push(plain)
    expect(parseDoc(serializeDoc(doc))).toEqual(doc)

    const raw = JSON.parse(serializeDoc(doc))
    raw.objects[0].params = { detail: 12, bogus: 5, arc: 9999 }
    const back = parseDoc(JSON.stringify(raw))
    expect((back.objects[0] as any).params).toEqual({ detail: 12, arc: 360 })
    expect((back.objects[2] as any).params).toBeUndefined()
  })

  it('round-trips modifiers and drops junk ones', () => {
    const doc = defaultDoc()
    const o = createPrimitive('box', doc.objects)
    o.modifiers = { twist: 120, subdivide: 2, cloneCount: 4 }
    doc.objects.push(o)
    expect(parseDoc(serializeDoc(doc))).toEqual(doc)

    const raw = JSON.parse(serializeDoc(doc))
    raw.objects[0].modifiers = { twist: 120, bogus: 7, bend: 9999 }
    const back = parseDoc(JSON.stringify(raw))
    expect((back.objects[0] as any).modifiers).toEqual({ twist: 120, bend: 180 })
  })

  it('menu groups cover every primitive kind exactly once, in canonical order', () => {
    const menuKinds = PRIM_GROUPS.flatMap((g) => g.kinds.map((k) => k.kind))
    expect(menuKinds).toEqual([...PRIMITIVE_KINDS])
  })
})

// ── Gradient ramp model ──────────────────────────────────────────────────────

const gmat = (patch: Partial<SceneMaterial> = {}): SceneMaterial =>
  ({ type: 'gradient', color: '#9aa3af', roughness: 0.6, metalness: 0, ...patch })

/** Parse one material through a full doc round-trip. */
function reparse(mat: SceneMaterial): SceneMaterial {
  const doc = defaultDoc()
  const o = createPrimitive('box', doc.objects)
  o.material = mat
  doc.objects.push(o)
  return parseDoc(serializeDoc(doc)).objects[0]!.material
}

/** Same, but starting from arbitrary (possibly malformed) raw material JSON. */
function reparseRaw(raw: any): SceneMaterial {
  const doc = defaultDoc()
  doc.objects.push(createPrimitive('box', doc.objects))
  const json: any = JSON.parse(serializeDoc(doc))
  json.objects[0].material = raw
  return parseDoc(JSON.stringify(json)).objects[0]!.material
}

describe('scene3d gradient ramp model', () => {
  it('round-trips stops and every new gradient field exactly', () => {
    const mat = gmat({
      gradientStops: [{ pos: 0, color: '#ff0000' }, { pos: 0.4, color: '#00ff00' }, { pos: 1, color: '#0000ff' }],
      gradientType: 'radial', gradientYaw: 37.5, gradientPitch: -12,
      gradientOffset: -0.25, gradientSpread: 1.75,
    })
    expect(reparse(mat)).toEqual(mat)
  })

  it('leaves absent gradient fields absent (round-trips stay exact)', () => {
    const back = reparse(gmat())
    expect('gradientStops' in back).toBe(false)
    expect('gradientType' in back).toBe(false)
    expect('gradientYaw' in back).toBe(false)
    expect('gradientPitch' in back).toBe(false)
    expect('gradientOffset' in back).toBe(false)
    expect('gradientSpread' in back).toBe(false)
  })

  it('clamps out-of-range stop positions and sorts unsorted input', () => {
    const back = reparseRaw({
      ...gmat(),
      gradientStops: [{ pos: 1.8, color: '#111111' }, { pos: -3, color: '#222222' }, { pos: 0.5, color: '#333333' }],
    })
    expect(back.gradientStops).toEqual([
      { pos: 0, color: '#222222' }, { pos: 0.5, color: '#333333' }, { pos: 1, color: '#111111' },
    ])
  })

  it('drops the array when fewer than two valid stops survive', () => {
    expect(reparseRaw({ ...gmat(), gradientStops: [{ pos: 0, color: '#fff' }] }).gradientStops).toBeUndefined()
    expect(reparseRaw({ ...gmat(), gradientStops: [] }).gradientStops).toBeUndefined()
    // one malformed entry drops that entry, leaving only one valid → array dropped
    expect(reparseRaw({
      ...gmat(),
      gradientStops: [{ pos: 0, color: '#fff' }, { pos: 'x', color: '#000' }],
    }).gradientStops).toBeUndefined()
  })

  it('drops the array when more than eight stops are given', () => {
    const nine = Array.from({ length: 9 }, (_, i) => ({ pos: i / 8, color: '#ffffff' }))
    expect(reparseRaw({ ...gmat(), gradientStops: nine }).gradientStops).toBeUndefined()
    const eight = nine.slice(0, 8)
    expect(reparseRaw({ ...gmat(), gradientStops: eight }).gradientStops).toHaveLength(8)
  })

  it('drops malformed entries and keeps the rest when two or more survive', () => {
    const back = reparseRaw({
      ...gmat(),
      gradientStops: [
        { pos: 0, color: '#ff0000' },
        null,
        { pos: 0.5 },                      // no colour
        { color: '#00ff00' },              // no pos
        { pos: NaN, color: '#123456' },    // non-finite
        { pos: 1, color: '#0000ff' },
      ],
    })
    expect(back.gradientStops).toEqual([{ pos: 0, color: '#ff0000' }, { pos: 1, color: '#0000ff' }])
  })

  it('drops a non-array gradientStops without touching other fields', () => {
    const back = reparseRaw({ ...gmat({ gradientType: 'radial' }), gradientStops: 'nope' })
    expect(back.gradientStops).toBeUndefined()
    expect(back.gradientType).toBe('radial')
  })

  it('rejects an unknown gradientType', () => {
    expect(reparseRaw({ ...gmat(), gradientType: 'conic' }).gradientType).toBeUndefined()
  })

  it('gradientStopsOf synthesizes the legacy two-colour pair when absent', () => {
    expect(gradientStopsOf(gmat({ color: '#abcdef' }))).toEqual([
      { pos: 0, color: '#abcdef' }, { pos: 1, color: MATERIAL_DEFAULTS.gradientB },
    ])
    expect(gradientStopsOf(gmat({ color: '#abcdef', gradientB: '#001122' }))).toEqual([
      { pos: 0, color: '#abcdef' }, { pos: 1, color: '#001122' },
    ])
    const stops: GradientStop[] = [{ pos: 0, color: '#000' }, { pos: 1, color: '#fff' }]
    expect(gradientStopsOf(gmat({ gradientStops: stops }))).toBe(stops)
  })

  it('gradientAngles derives from the axis and defers to stored angles', () => {
    expect(gradientAngles(gmat({ gradientAxis: 'x' }))).toEqual({ yaw: 90, pitch: 0 })
    expect(gradientAngles(gmat({ gradientAxis: 'y' }))).toEqual({ yaw: 0, pitch: 90 })
    expect(gradientAngles(gmat({ gradientAxis: 'z' }))).toEqual({ yaw: 0, pitch: 0 })
    // absent axis falls back to the default axis ('y')
    expect(gradientAngles(gmat())).toEqual({ yaw: 0, pitch: 90 })
    // stored angles win, including 0 (which must not be treated as absent)
    expect(gradientAngles(gmat({ gradientAxis: 'x', gradientYaw: 0, gradientPitch: 0 })))
      .toEqual({ yaw: 0, pitch: 0 })
  })

  it('maps the axis presets to exact unit direction vectors', () => {
    const dirOf = (axis: 'x' | 'y' | 'z') => {
      const { yaw, pitch } = gradientAngles(gmat({ gradientAxis: axis }))
      return gradientDirection(yaw, pitch)
    }
    // Exact, not approximate — see the projection-equivalence test in
    // scene3d-materials for why the zeros must be true zeros.
    expect(dirOf('x')).toEqual([1, 0, 0])
    expect(dirOf('y')).toEqual([0, 1, 0])
    expect(dirOf('z')).toEqual([0, 0, 1])
  })

  it('produces unit-length directions for arbitrary angles', () => {
    for (const [yaw, pitch] of [[33, 17], [-120, -45], [200, 89], [0, 0]] as const) {
      const [x, y, z] = gradientDirection(yaw, pitch)
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 12)
    }
  })
})

// ── Lights ────────────────────────────────────────────────────────────────

describe('scene3d lights model', () => {
  it('creates each light kind with sane defaults and a unique id/name', () => {
    for (const kind of LIGHT_KINDS) {
      const l = createLight(kind, [])
      expect(l.kind).toBe('light')
      expect(l.light).toBe(kind)
      expect(l.id).toMatch(/^obj_/)
      expect(typeof l.name).toBe('string')
      expect(l.color).toBe(LIGHT_DEFAULTS.color)
      expect(l.intensity).toBeGreaterThan(0)
      // dummy material present (type uniformity), position off the origin
      expect(l.material).toBeTruthy()
      expect(l.position.some((c) => c !== 0)).toBe(true)
    }
  })

  it('scales point/spot intensity higher than area (physical candela falloff)', () => {
    // point/spot use inverse-square decay, so they need far larger values than a
    // no-decay area light to read bright — spawn defaults and slider ceilings reflect that.
    expect(lightIntensityDefault('point')).toBeGreaterThan(lightIntensityDefault('rect'))
    expect(lightIntensityDefault('spot')).toBeGreaterThan(lightIntensityDefault('rect'))
    expect(lightIntensityMax('point')).toBeGreaterThan(lightIntensityMax('rect'))
    expect(createLight('spot', []).intensity).toBe(lightIntensityDefault('spot'))
    expect(createLight('rect', []).intensity).toBe(lightIntensityDefault('rect'))
  })

  it('numbers duplicate light names', () => {
    const a = createLight('point', [])
    const b = createLight('point', [a])
    expect(b.name).not.toBe(a.name)
  })

  it('round-trips a light through parse/serialize with clamped fields', () => {
    const l = createLight('spot', [])
    l.intensity = 5; l.angle = 0.7; l.penumbra = 0.5; l.color = '#ff8800'; l.castShadow = true
    const doc = { ...defaultDoc(), objects: [l] }
    const back = parseDoc(serializeDoc(doc))
    const r = back.objects[0] as any
    expect(r.kind).toBe('light')
    expect(r.light).toBe('spot')
    expect(r.intensity).toBe(5)
    expect(r.color).toBe('#ff8800')
    expect(r.castShadow).toBe(true)
  })

  it('drops an unknown light kind and keeps old docs unchanged', () => {
    const doc = parseDoc(JSON.stringify({ version: 1, objects: [{ kind: 'light', light: 'laser', id: 'x', name: 'x' }] }))
    expect(doc.objects.length).toBe(0)
  })
})
