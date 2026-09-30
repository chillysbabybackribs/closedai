import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'

export function shortContentHash(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

/** Repo-relative POSIX path under cwd, or null when outside the workspace root. */
export function normalizeRepoPath(cwd: string, path: string): string | null {
  const raw = path.trim()
  if (!raw) return null
  const rel = isAbsolute(raw) ? relative(cwd, raw) : raw.replace(/^\.\/+/, '')
  if (!rel || rel.startsWith('..')) return null
  return rel.split('\\').join('/')
}

export async function readWorkspaceFileHash(cwd: string, path: string): Promise<string | null> {
  const rel = normalizeRepoPath(cwd, path)
  if (!rel) return null
  try {
    const bytes = await readFile(join(cwd, rel), 'utf8')
    return shortContentHash(bytes)
  } catch {
    return null
  }
}
