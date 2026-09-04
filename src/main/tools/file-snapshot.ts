import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'

export type FileSnapshot = {
  path: string
  hash: string
  source: string
  lines: readonly string[]
}

const MAX_FILE_BYTES = 2_000_000

/** Hash and text come from one buffer, never a second read of a potentially changed file. */
export async function readFileSnapshot(path: string, signal?: AbortSignal): Promise<FileSnapshot> {
  signal?.throwIfAborted()
  const canonical = await realpath(path)
  signal?.throwIfAborted()
  // A previously regular source file can be replaced by a FIFO; do not block opening it.
  const handle = await open(canonical, constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error('Source reads require a regular file of at most 2 MB')
    signal?.throwIfAborted()
    const bytes = await handle.readFile({ signal })
    if (bytes.length > MAX_FILE_BYTES) throw new Error('Source file grew beyond the 2 MB read limit')
    const source = bytes.toString('utf8')
    if (source.includes('\0') || !Buffer.from(source).equals(bytes)) throw new Error('Source reads require UTF-8 text')
    const lines = source.split('\n')
    if (source.endsWith('\n')) lines.pop()
    return { path: canonical, hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, source, lines }
  } finally {
    await handle.close()
  }
}
