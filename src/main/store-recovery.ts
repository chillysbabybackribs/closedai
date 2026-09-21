import { readFile, rename } from 'node:fs/promises'

// Reading a JSON store the app owns. Only a missing file means "start empty". Anything else —
// unreadable bytes, a write cut short, text the parser rejects — is the user's data in a shape
// the app cannot use, and the store's next debounced write would replace it with defaults. So
// the file is moved aside first, under a name a person or a later repair can find, and only
// then does the store start from defaults.

/** A damaged store's new name: the original plus `.corrupt-` and the moment it was set aside. */
export function corruptStorePath(filePath: string, at: Date = new Date()): string {
  return `${filePath}.corrupt-${at.toISOString().replace(/:/g, '-')}`
}

/** Move a damaged store aside. Best effort: the new path, or null when the rename itself failed. */
export async function preserveCorruptFile(filePath: string): Promise<string | null> {
  const preservedPath = corruptStorePath(filePath)
  try {
    await rename(filePath, preservedPath)
    return preservedPath
  } catch {
    return null
  }
}

/**
 * Read and parse a store file. A missing file is null and silent. A file that cannot be read or
 * that `parse` rejects is set aside, reported once with the preserved path under `label`, and
 * also null, so every store that starts from defaults leaves the original where it was found.
 */
export async function readStoreFile<T>(filePath: string, label: string, parse: (text: string) => T): Promise<T | null> {
  let text: string
  try {
    text = await readFile(filePath, 'utf8')
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return null
    await reportCorrupt(filePath, label, error)
    return null
  }
  try {
    return parse(text)
  } catch (error) {
    await reportCorrupt(filePath, label, error)
    return null
  }
}

async function reportCorrupt(filePath: string, label: string, error: unknown): Promise<void> {
  const preservedPath = await preserveCorruptFile(filePath)
  const reason = error instanceof Error ? error.message : String(error)
  console.warn(
    preservedPath
      ? `${label} unreadable (${reason}); kept the original at ${preservedPath} and starting from defaults`
      : `${label} unreadable (${reason}) and could not be set aside; starting from defaults`
  )
}

function codeOf(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
}
