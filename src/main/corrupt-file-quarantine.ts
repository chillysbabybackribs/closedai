import { readFile, rename } from 'node:fs/promises'

/**
 * Read and parse a JSON store. A missing file is the first-run case and reads as `null`. Any
 * other failure (permissions, truncation, malformed JSON) is a file the app must not overwrite
 * on its next save: it is moved aside as `<file>.corrupt-<ISO time>` for the user to inspect,
 * and the caller continues with its defaults.
 */
export async function readJsonOrQuarantine(filePath: string, label: string): Promise<unknown | null> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    await quarantine(filePath, label, error)
    return null
  }
  try {
    return JSON.parse(raw) as unknown
  } catch (error) {
    await quarantine(filePath, label, error)
    return null
  }
}

export function quarantinePath(filePath: string, now: Date = new Date()): string {
  return `${filePath}.corrupt-${now.toISOString()}`
}

async function quarantine(filePath: string, label: string, cause: unknown): Promise<void> {
  const target = quarantinePath(filePath)
  try {
    await rename(filePath, target)
    console.warn(`${label} unreadable (${messageOf(cause)}); moved to ${target} and continuing with defaults`)
  } catch (error) {
    // An unreadable file that also cannot be moved is left in place; the caller still uses
    // defaults, so the next save may overwrite it. Say so rather than fail startup.
    console.warn(`${label} unreadable (${messageOf(cause)}) and could not be moved aside: ${messageOf(error)}`)
  }
}

function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
