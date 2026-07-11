// frontend/shared/brand/assets.ts
/** Extract the ComfyUI input filename from a `/view?filename=…&type=input`
 *  URL (the format brand logos/assets store). Returns null for external URLs
 *  and non-input views — callers must upload those before use as a layer. */
export function inputNameFromViewUrl(url: string): string | null {
  if (!url.startsWith('/view?')) return null
  const params = new URLSearchParams(url.slice('/view?'.length))
  if ((params.get('type') ?? 'input') !== 'input') return null
  return params.get('filename')
}
