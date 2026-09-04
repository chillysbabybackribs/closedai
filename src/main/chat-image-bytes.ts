import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'

// Attachment bytes in the one shape every provider's wire format is built from. Deliberately
// free of any Electron import: the provider input builders that use this are unit-tested in
// plain Node, while the pasted-image shrinking next door needs `nativeImage` and is not.

export type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

export type ChatImageBytes = { mimeType: ImageMimeType; base64: string }

const IMAGE_MIME_TYPES: Record<string, ImageMimeType> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

/** Read a file the user attached by path; null when it is not an image format models accept. */
export async function imageBytesFromPath(path: string): Promise<ChatImageBytes | null> {
  const mimeType = IMAGE_MIME_TYPES[extname(path).toLowerCase()]
  if (!mimeType) return null
  try {
    return { mimeType, base64: (await readFile(path)).toString('base64') }
  } catch {
    return null
  }
}

/** Split a pasted `data:` URL; null when it is not one of the accepted image formats. */
export function imageBytesFromDataUrl(url: string): ChatImageBytes | null {
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/s.exec(url)
  return match ? { mimeType: match[1] as ImageMimeType, base64: match[2]! } : null
}
