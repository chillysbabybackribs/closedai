import { open, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { localFilePath, type LocalFilePreview } from '../../shared/local-files.js'

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp'
}
const MAX_IMAGE_BYTES = 32 * 1024 * 1024

/** User-clicked files are previewed as inert raster images or revealed, never executed. */
export async function openLocalFile(href: string, reveal: (path: string) => void): Promise<LocalFilePreview> {
  const path = typeof href === 'string' ? localFilePath(href) : null
  if (!path) throw new Error('This is not an absolute local file link.')
  const info = await stat(path)
  if (!info.isFile() && !info.isDirectory()) throw new Error('This file type cannot be opened.')
  const mime = IMAGE_TYPES[extname(path).toLowerCase()]
  if (info.isFile() && mime) {
    const file = await open(path, 'r')
    try {
      const current = await file.stat()
      if (!current.isFile() || current.size > MAX_IMAGE_BYTES) throw new Error('Image preview supports files up to 32 MB.')
      const bytes = Buffer.alloc(current.size + 1)
      let length = 0
      while (length < bytes.length) {
        const read = await file.read(bytes, length, bytes.length - length, null)
        if (!read.bytesRead) break
        length += read.bytesRead
      }
      if (length > current.size) throw new Error('The image changed while opening. Try again.')
      return { kind: 'image', name: basename(path), src: `data:${mime};base64,${bytes.subarray(0, length).toString('base64')}` }
    } finally { await file.close() }
  }
  reveal(path)
  return { kind: 'revealed' }
}
