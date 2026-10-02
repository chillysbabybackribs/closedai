import { readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { isPlayableVideoFile } from '../../shared/local-files.js'
import type { VideoLibraryEntry } from '../../shared/video-library.js'

export type { VideoLibraryEntry } from '../../shared/video-library.js'

const MAX_SCAN_FILES = 800
const MAX_DEPTH = 4
const MAX_RESULTS = 80

async function collectVideos(root: string, depth: number, out: VideoLibraryEntry[], budget: { left: number }): Promise<void> {
  if (depth > MAX_DEPTH || budget.left <= 0) return
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (budget.left <= 0) return
    if (entry.name.startsWith('.')) continue
    const path = join(root, entry.name)
    if (entry.isFile()) {
      if (!isPlayableVideoFile(path)) continue
      try {
        const info = await stat(path)
        if (!info.isFile()) continue
        out.push({ path, name: basename(path), bytes: info.size, modifiedMs: info.mtimeMs })
        budget.left -= 1
      } catch { /* skip unreadable */ }
      continue
    }
    if (entry.isDirectory()) await collectVideos(path, depth + 1, out, budget)
  }
}

/** Scan common video folders (Downloads first), newest first. */
export async function searchVideoLibrary(roots: string[], query: string): Promise<VideoLibraryEntry[]> {
  const collected: VideoLibraryEntry[] = []
  const budget = { left: MAX_SCAN_FILES }
  for (const root of roots) {
    await collectVideos(root, 0, collected, budget)
    if (budget.left <= 0) break
  }
  const needle = query.trim().toLowerCase()
  const filtered = needle
    ? collected.filter((entry) => entry.name.toLowerCase().includes(needle) || entry.path.toLowerCase().includes(needle))
    : collected
  filtered.sort((a, b) => b.modifiedMs - a.modifiedMs)
  return filtered.slice(0, MAX_RESULTS)
}
