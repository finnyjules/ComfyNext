/** True when the browser can create a WebGL context. Cached after the first probe
 *  (a failed probe is permanent for the session; a success won't regress). */
let _cached: boolean | null = null

export function detectWebGL(): boolean {
  if (_cached !== null) return _cached
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
    _cached = !!gl
  } catch {
    _cached = false
  }
  return _cached
}
