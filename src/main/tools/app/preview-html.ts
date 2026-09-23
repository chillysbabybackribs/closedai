import { access, stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const HTML_EXT = new Set(['.html', '.htm'])

/** Resolve a workspace HTML mock to an absolute path and file URL, confined to cwd. */
export async function resolveHtmlPreview(input: string, cwd: string): Promise<{ path: string; fileUrl: string }> {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('path is required')
  const root = path.resolve(cwd)
  const absolute = path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(root, trimmed)
  assertInsideRoot(absolute, root)
  if (!HTML_EXT.has(path.extname(absolute).toLowerCase())) {
    throw new Error('preview_html only opens .html or .htm files')
  }
  const info = await stat(absolute)
  if (!info.isFile()) throw new Error('preview_html needs a file path')
  await access(absolute)
  return { path: absolute, fileUrl: pathToFileURL(absolute).href }
}

function assertInsideRoot(absolute: string, root: string): void {
  const rel = path.relative(root, absolute)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path must stay inside the chat working directory (${root})`)
  }
}
