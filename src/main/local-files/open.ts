import { open, stat } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { basename, extname, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { LocalFileOpenOptions, LocalFilePreview } from '../../shared/local-files.js'
import { isVideoFile, splitLocalFileHref } from '../../shared/local-files.js'
import { findInWorkspace } from './find-in-workspace.js'
import { resolveLocalFileOpenTarget } from './resolve-target.js'

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp'
}
const MAX_IMAGE_BYTES = 32 * 1024 * 1024

/** User-clicked files are previewed in browser tabs (inert raster images or files); directories are revealed. */
export async function openLocalFile(href: string, reveal: (path: string) => void, options?: LocalFileOpenOptions): Promise<LocalFilePreview> {
  const target: { path: string; line?: number; endLine?: number } | null = typeof href !== 'string' ? null
    : options?.literalPath === true
      ? isAbsolute(href) && !href.includes('\0') ? { path: href } : null
      : resolveLocalFileOpenTarget(href, options?.cwd)
  if (!target) throw new Error('This is not a local file link in the workspace.')
  const { line, endLine } = target
  const { path, info } = await locate(href, target.path, options)
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
      return { kind: 'image', name: basename(path), path, src: `data:${mime};base64,${bytes.subarray(0, length).toString('base64')}` }
    } finally { await file.close() }
  }
  if (info.isFile() && isVideoFile(path)) {
    return { kind: 'video', name: basename(path), path, src: pathToFileURL(path).href }
  }
  if (info.isFile()) {
    return {
      kind: 'file',
      path,
      ...(line ? { line } : {}),
      ...(endLine ? { endLine } : {}),
      ...(options?.cwd ? { cwd: options.cwd } : {}),
      ...(options?.diff ? { diff: options.diff } : {})
    }
  }
  reveal(path)
  return { kind: 'revealed' }
}

/**
 * Stats the resolved target. A missing workspace-relative link falls back to the one project file
 * whose trailing path matches it; otherwise the error names the file in words a user can act on.
 */
async function locate(href: string, resolved: string, options?: LocalFileOpenOptions): Promise<{ path: string; info: Stats }> {
  try {
    return { path: resolved, info: await stat(resolved) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const relative = options?.literalPath === true ? null : splitLocalFileHref(href)?.pathPart
  const root = options?.cwd?.trim()
  if (relative && root && !isAbsolute(relative)) {
    const match = await findInWorkspace(root, relative)
    if (match.kind === 'one') return { path: match.path, info: await stat(match.path) }
    if (match.kind === 'many') throw new Error(`Several files are named ${relative} in ${basename(root)}.`)
    throw new Error(`Couldn't find ${relative} in ${basename(root)}.`)
  }
  throw new Error(`${basename(resolved)} no longer exists.`)
}
