import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import {
  imagePathHintsFromValue,
  resolveGeneratedImageEvidence,
  resolveGeneratedImageToolOutcome
} from '../generated-image-transcript.js'

const IMAGE_NAME = /\.(png|jpe?g|gif|webp)$/i

/** Cursor stores GenerateImage output under ~/.cursor/projects/<cwd-slug>/assets/. */
export function cursorProjectAssetsDir(cwd: string): string {
  const slug = cwd.replace(/^\/+/, '').replace(/\//g, '-')
  return join(homedir(), '.cursor', 'projects', slug, 'assets')
}

/** Expand bare filenames from tool input into Cursor asset paths, plus other string hints. */
export function cursorGenerateImageHintPaths(cwd: string, rawInput: Record<string, unknown>): string[] {
  const hints = imagePathHintsFromValue(rawInput)
  const assetsDir = cursorProjectAssetsDir(cwd)
  const paths = new Set(hints)
  for (const hint of hints) {
    const name = basename(hint)
    if (name === hint && IMAGE_NAME.test(name)) paths.add(join(assetsDir, name))
  }
  return [...paths]
}

/** When ACP omits tool output, bind to the newest asset image written since the call started. */
export function latestRecentCursorAssetImage(cwd: string, sinceMs: number): string | null {
  const assetsDir = cursorProjectAssetsDir(cwd)
  if (!existsSync(assetsDir)) return null
  let best: { path: string; mtime: number } | null = null
  try {
    for (const entry of readdirSync(assetsDir)) {
      if (!IMAGE_NAME.test(entry)) continue
      const path = join(assetsDir, entry)
      const mtime = statSync(path).mtimeMs
      if (mtime < sinceMs) continue
      if (!best || mtime > best.mtime) best = { path, mtime }
    }
  } catch {
    return null
  }
  return best?.path ?? null
}

export function resolveCursorGeneratedImageEvidence(input: {
  cwd: string
  rawInput: Record<string, unknown>
  text: string
  content?: unknown
  rawOutput?: unknown
  startedAtMs: number
}): ReturnType<typeof resolveGeneratedImageEvidence> {
  const hints = cursorGenerateImageHintPaths(input.cwd, input.rawInput)
  const fromOutput = resolveGeneratedImageToolOutcome({
    text: input.text,
    content: input.content,
    rawOutput: input.rawOutput,
    hints
  })
  if (fromOutput || input.text.trim()) return fromOutput
  const recent = latestRecentCursorAssetImage(input.cwd, input.startedAtMs - 2_000)
  return recent ? resolveGeneratedImageEvidence('', undefined, [recent]) : null
}
