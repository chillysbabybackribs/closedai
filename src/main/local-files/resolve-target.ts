import path from 'node:path'
import { isWorkspaceFileHref, parseLocalFileTarget, splitLocalFileHref } from '../../shared/local-files.js'

export function resolveLocalFileOpenTarget(href: string, cwd?: string): { path: string; line?: number; endLine?: number } | null {
  const absolute = parseLocalFileTarget(href)
  if (absolute) return absolute
  const split = splitLocalFileHref(href)
  if (!split || !isWorkspaceFileHref(href)) return null
  if (!cwd?.trim()) return null
  const root = path.resolve(cwd)
  const resolved = path.isAbsolute(split.pathPart) ? path.resolve(split.pathPart) : path.resolve(root, split.pathPart)
  if (!path.isAbsolute(split.pathPart)) {
    const rel = path.relative(root, resolved)
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  }
  return {
    path: resolved,
    ...(split.line ? { line: split.line } : {}),
    ...(split.endLine ? { endLine: split.endLine } : {})
  }
}
