import { readdir } from 'node:fs/promises'
import path from 'node:path'

// Build output, dependencies and VCS data never hold the file a chat link means.
const SKIP_DIRS = new Set(['node_modules', 'out', 'dist', 'build', 'release', 'coverage'])
const MAX_ENTRIES = 40_000

export type WorkspaceFileMatch = { kind: 'one'; path: string } | { kind: 'none' } | { kind: 'many' }

/**
 * Finds the file a relative chat link most likely means when it does not exist under the chat
 * folder: models often write a bare name (`task-visuals.html`) or a shortened path
 * (`mockups/task-visuals.html`) for a file deeper in the project. Matches whole trailing path
 * segments, skips hidden and generated folders, and stops after a bounded walk or a second match,
 * because an ambiguous link should not silently open the wrong file.
 */
export async function findInWorkspace(root: string, relative: string): Promise<WorkspaceFileMatch> {
  const wanted = relative.replace(/\\/g, '/').replace(/^(\.\/)+/, '')
  if (!wanted || wanted.startsWith('../')) return { kind: 'none' }
  const suffix = `/${wanted}`
  const found: string[] = []
  const queue = [root]
  let seen = 0
  while (queue.length && seen < MAX_ENTRIES) {
    const dir = queue.shift()!
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (++seen > MAX_ENTRIES) break
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) queue.push(full)
      } else if (entry.isFile() && `/${path.relative(root, full).split(path.sep).join('/')}`.endsWith(suffix)) {
        found.push(full)
        if (found.length > 1) return { kind: 'many' }
      }
    }
  }
  return found.length === 1 ? { kind: 'one', path: found[0] } : { kind: 'none' }
}
