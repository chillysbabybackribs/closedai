import { join } from 'node:path'

// Naming half of the download pipeline, kept pure so the rules that decide what a remote
// server is allowed to call a file on this disk are unit-testable without Electron or fs.
//
// Unlike sanitizeCaptureName in browser-capture-store.ts, this one REWRITES rather than
// rejects. A capture name is our own input and a bad one is a caller bug; a download name is
// attacker-controlled and arrives mid-`will-download`, where the only alternatives to fixing
// it up are dropping the user's file or handing a hostile string to setSavePath.

/** Windows reserved device names: legal on Linux, catastrophic on a synced/exported folder. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
/** Path separators, characters Windows/macOS reject outright, and C0 control codes. */
const ILLEGAL_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*'])
/** Leaves room for a " (999)" suffix and a long extension inside a 255-byte name limit. */
const MAX_STEM = 120
const MAX_EXTENSION = 16

/**
 * Turn a server-supplied filename into one that is safe to write. Always returns a non-empty
 * name with no directory component.
 */
export function safeDownloadFilename(raw: unknown): string {
  const input = typeof raw === 'string' ? raw : ''
  // Take the last path component so "../../.ssh/authorized_keys" cannot climb, and so a
  // Windows-style "C:\evil\x.exe" collapses to "x.exe" rather than keeping its drive letter.
  const base = lastPathSegment(input)
  const cleaned = [...base]
    .map((char) => (ILLEGAL_CHARS.has(char) || char.charCodeAt(0) < 0x20 ? '-' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  // Leading dots would hide the file (and ".."/"." are not names at all).
  const visible = cleaned.replace(/^[.]+/, '').trim()
  if (!visible) return 'download'
  const { stem, extension } = splitExtension(visible)
  const safeStem = RESERVED.test(stem) ? `_${stem}` : stem
  return `${safeStem.slice(0, MAX_STEM)}${extension}`
}

/**
 * First free path for `filename` in `dir`, disambiguating the way a browser does:
 * report.pdf, report (1).pdf, report (2).pdf. `exists` is injected so this stays pure.
 */
export function uniqueDownloadPath(
  dir: string,
  filename: string,
  exists: (path: string) => boolean
): string {
  const direct = join(dir, filename)
  if (!exists(direct)) return direct
  const { stem, extension } = splitExtension(filename)
  for (let counter = 1; counter <= 999; counter += 1) {
    const candidate = join(dir, `${stem} (${counter})${extension}`)
    if (!exists(candidate)) return candidate
  }
  // 999 collisions means something is looping; a distinct name beats overwriting the user's file.
  return join(dir, `${stem} (${Date.now().toString(36)})${extension}`)
}

/** Split on both separators so a Windows-shaped name is stripped on Linux too. */
function lastPathSegment(input: string): string {
  const parts = input.split('/').flatMap((part) => part.split('\\'))
  return parts[parts.length - 1] ?? ''
}

/**
 * Split a trailing extension off a filename. A dot-run in the middle of a long name (or an
 * "extension" longer than any real one) is treated as part of the stem, so "v1.2.3-notes"
 * keeps its shape instead of gaining a bogus ".3-notes" extension.
 */
function splitExtension(filename: string): { stem: string; extension: string } {
  const dot = filename.lastIndexOf('.')
  if (dot <= 0 || dot === filename.length - 1) return { stem: filename, extension: '' }
  const extension = filename.slice(dot)
  if (extension.length > MAX_EXTENSION || /\s/.test(extension)) return { stem: filename, extension: '' }
  return { stem: filename.slice(0, dot), extension }
}
