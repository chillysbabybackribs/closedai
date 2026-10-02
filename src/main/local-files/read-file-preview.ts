import { open } from 'node:fs/promises'
import type { FileTabContent } from '../../shared/local-files.js'

const MAX_FILE_BYTES = 5 * 1024 * 1024 // 5 MB preview limit

export async function readFilePreview(content: {
  path: string
  name: string
  line?: number
  endLine?: number
  cwd?: string
  diff?: string
}): Promise<FileTabContent> {
  const { path, name, line, endLine, cwd, diff } = content
  if (diff) {
    return {
      path, name, content: '',
      ...(line ? { line } : {}),
      ...(endLine ? { endLine } : {}),
      ...(cwd ? { cwd } : {}),
      diff
    }
  }
  const file = await open(path, 'r')
  let buffer: Buffer
  try {
    const info = await file.stat()
    if (!info.isFile()) throw new Error('This file type cannot be previewed.')
    if (info.size > MAX_FILE_BYTES) throw new Error('File is too large to preview. Max supported is 5 MB.')
    const bytes = Buffer.alloc(info.size + 1)
    let length = 0
    while (length < bytes.length) {
      const read = await file.read(bytes, length, bytes.length - length, null)
      if (!read.bytesRead) break
      length += read.bytesRead
    }
    if (length > info.size) throw new Error('The file changed while opening. Try again.')
    buffer = bytes.subarray(0, length)
  } finally { await file.close() }
  const sample = buffer.subarray(0, Math.min(8000, buffer.length))
  if (sample.includes(0)) {
    throw new Error('Binary file cannot be previewed as text.')
  }
  return {
    path, name, content: buffer.toString('utf8'),
    ...(line ? { line } : {}),
    ...(endLine ? { endLine } : {}),
    ...(cwd ? { cwd } : {})
  }
}
