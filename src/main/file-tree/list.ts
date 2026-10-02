import { opendir, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { FileTreeListing } from '../../shared/file-tree.js'

/** Read only one directory; never recursively walk dependencies or follow directory symlinks. */
export async function listDirectory(root: string, directory = '', limit = 5000): Promise<FileTreeListing> {
  if (typeof root !== 'string' || !isAbsolute(root) || typeof directory !== 'string' || isAbsolute(directory)) {
    throw new Error('An absolute working directory and a relative folder are required.')
  }
  const base = await realpath(root)
  const target = await realpath(resolve(base, directory))
  const rel = relative(base, target)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Folder is outside the working directory.')
  const entries: FileTreeListing['entries'] = []
  let truncated = false
  for await (const item of await opendir(target)) {
    if (entries.length === limit) { truncated = true; break }
    entries.push({ name: item.name, path: [directory, item.name].filter(Boolean).join('/'), directory: item.isDirectory(), symlink: item.isSymbolicLink() })
  }
  entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
  return { entries, truncated }
}
