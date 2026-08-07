import type { H3Event } from 'h3'
import { createError, readFormData } from 'h3'

export interface UploadedFile {
  /** Raw bytes of the uploaded part. */
  data: Buffer
  /** Client-supplied filename, if the part carried one. */
  filename?: string
  /** Client-supplied content type, if the part carried one. */
  type?: string
}

export interface UploadForm {
  /** Bytes of a file field, or null if absent/empty/not-a-file. */
  file(field: string): Promise<UploadedFile | null>
  /** Every file part under a field, in order, skipping empty/non-file parts. */
  files(field: string): Promise<UploadedFile[]>
  /** Trimmed value of a text field, or '' if absent. */
  text(field: string): string
}

/**
 * Read a multipart/form-data request body.
 *
 * Deliberately NOT h3's readMultipartFormData: that one parses the body a byte
 * at a time into a plain JS array (`buffer.push(currByte)`), and V8 caps a
 * fast-elements array at 2^26 entries — so every upload over 64 MiB died with
 * "RangeError: Invalid array length" before the route ever ran, and everything
 * under it still cost ~8 bytes of heap per byte of file. readFormData hands the
 * body to undici's native parser instead, which streams and has no such cap.
 *
 * The body can only be consumed once, so call this once per request and pull
 * every field off the returned form.
 */
export async function readUploadForm(event: H3Event): Promise<UploadForm> {
  let form: FormData
  try {
    form = await readFormData(event)
  }
  catch {
    // A body that isn't form data is the caller's mistake, not a server fault.
    throw createError({ statusCode: 400, statusMessage: 'Expected multipart form data' })
  }
  return {
    async file(field) {
      const part = form.get(field)
      if (!part || typeof part === 'string') return null

      const data = Buffer.from(await part.arrayBuffer())
      if (data.byteLength === 0) return null

      // `File` carries name/type; a bare `Blob` part leaves them blank.
      return {
        data,
        filename: (part as File).name || undefined,
        type: part.type || undefined,
      }
    },
    async files(field) {
      const out: UploadedFile[] = []
      for (const part of form.getAll(field)) {
        if (typeof part === 'string') continue
        const data = Buffer.from(await part.arrayBuffer())
        if (data.byteLength === 0) continue
        out.push({
          data,
          filename: (part as File).name || undefined,
          type: part.type || undefined,
        })
      }
      return out
    },
    text(field) {
      const part = form.get(field)
      return typeof part === 'string' ? part.trim() : ''
    },
  }
}

/** Convenience for routes whose body is a single file field. */
export async function readUploadedFile(
  event: H3Event,
  field = 'file',
): Promise<UploadedFile | null> {
  return (await readUploadForm(event)).file(field)
}
