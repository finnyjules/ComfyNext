// ZIP download for a BatchGrid payload — shared by the gallery modal's
// "Download all" and the node's download button.

import JSZip from 'jszip'
import type { BatchGridPayload } from './matrix'

export async function downloadBatchZip(payload: BatchGridPayload): Promise<void> {
  const zip = new JSZip()
  for (const item of payload.items) {
    const blob = await fetch(item.url).then(r => r.blob())
    zip.file(item.filename, blob)
  }
  const out = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(out)
  const a = document.createElement('a')
  a.href = url
  a.download = `${payload.layoutName || 'batch'}_export.zip`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
