import { chmod, mkdir, open, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

export async function writeAtomic(filePath: string, contents: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  // Never share a fixed sibling temp path: another store instance (or another
  // process during restart) can otherwise rename it away between writeFile and
  // chmod, producing ENOENT and leaving the scheduled flush unhandled.
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`
  try {
    const handle = await open(temporaryPath, 'w', 0o600)
    try {
      await handle.writeFile(contents, 'utf8')
      // The bytes reach the disk before the rename does: a crash in between must leave the
      // previous file under the real name, never an empty or half-written one.
      await handle.sync()
    } finally {
      await handle.close()
    }
    await chmod(temporaryPath, 0o600)
    await rename(temporaryPath, filePath)
  } finally {
    // rename removes the temp path on success; this is only cleanup after a
    // failed write, and must not hide the original persistence error.
    await unlink(temporaryPath).catch(() => {})
  }
}
