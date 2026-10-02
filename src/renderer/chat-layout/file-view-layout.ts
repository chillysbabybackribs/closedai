import { useSyncExternalStore } from 'react'
import { viewTabId } from './layout-views.js'

/** Workspace file previews use view tabs, not browser strip tabs: one per path. */
export function fileViewKey(path: string): string {
  return encodeURIComponent(path)
}

export function fileViewTabId(path: string): string {
  return viewTabId('file', fileViewKey(path))
}

export function filePathFromViewTab(id: string): string | null {
  const prefix = viewTabId('file', '')
  if (!id.startsWith(prefix)) return null
  try { return decodeURIComponent(id.slice(prefix.length)) || null } catch { return null }
}

export function fileViewTitle(path: string): string {
  const name = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop()
  return name || path
}

/**
 * What the last open asked a file view to show: a line range or a diff. The tab id carries only the
 * path, so a restored layout reopens the plain file; reopening an open file bumps `revision` so the
 * view re-reads and scrolls to the new line.
 */
export type FileViewTarget = { line?: number; endLine?: number; cwd?: string; diff?: string; revision: number }

const targets = new Map<string, FileViewTarget>()
const listeners = new Set<() => void>()
const NO_TARGET: FileViewTarget = { revision: 0 }

export function setFileViewTarget(id: string, target: Omit<FileViewTarget, 'revision'>): void {
  targets.set(id, { ...target, revision: (targets.get(id)?.revision ?? 0) + 1 })
  for (const listener of listeners) listener()
}

export function useFileViewTarget(id: string): FileViewTarget {
  return useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, () => targets.get(id) ?? NO_TARGET)
}
