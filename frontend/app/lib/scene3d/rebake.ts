/**
 * 3D Studio pass-rebake registry.
 *
 * Unlike the frontend-only studios (Gradient/Space Type/Shape/…) that plug into
 * the studio *cascade* with a single-blob `StudioBaker`, 3D Studio is a real
 * backend node whose output is THREE baked passes (beauty/depth/normal) written
 * into hidden widgets — there is no server-side renderer (see
 * comfy_extras/nodes_scene3d.py), so a Run just replays the last client bake.
 *
 * The card's footer "Render" therefore needs its own action: re-bake the three
 * passes headlessly from the persisted scene, upload them, and stamp the widgets
 * — then let the normal downstream backend run replay the fresh files. The node
 * owns that logic (it holds the headless SceneEngine + reactive doc), so it
 * registers a rebaker here and VueNodeCanvas's studio-render handler invokes it
 * for Scene3DStudio nodes instead of routing them through `runStudioCascade`.
 */
export type Scene3DRebaker = () => Promise<void>

const _rebakers = new Map<string, Scene3DRebaker>()
export function registerScene3DRebaker(id: string, fn: Scene3DRebaker): void { _rebakers.set(id, fn) }
export function unregisterScene3DRebaker(id: string): void { _rebakers.delete(id) }
export function getScene3DRebaker(id: string): Scene3DRebaker | undefined { return _rebakers.get(id) }
