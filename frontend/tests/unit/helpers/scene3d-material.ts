export { rampStopsOf } from '~/lib/scene3d/config'
// parseMaterial is module-private in config.ts; expose a thin test shim via serializeDoc/parseDoc.
import { parseDoc, serializeDoc, defaultDoc, createPrimitive } from '~/lib/scene3d/config'
import type { SceneMaterial } from '~/lib/scene3d/config'
export function parseMaterialForTest(raw: any): SceneMaterial {
  const doc = defaultDoc()
  const obj = createPrimitive('box')
  obj.material = raw
  doc.objects = [obj as any]
  const round = parseDoc(serializeDoc(doc))
  return (round.objects[0] as any).material
}
