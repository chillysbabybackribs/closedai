import { chmod, mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export async function writeAtomic(filePath: string, contents: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  // Never share a fixed sibling temp path: another store instance (or another
  // process during restart) can otherwise rename it away between writeFile and
  // chmod, producing ENOENT and leaving the scheduled flush unhandled.
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, contents, { encoding: 'utf8', mode: 0o600 })
    await chmod(temporaryPath, 0o600)
    await rename(temporaryPath, filePath)
  } finally {
    // rename removes the temp path on success; this is only cleanup after a
    // failed write, and must not hide the original persistence error.
    await unlink(temporaryPath).catch(() => {})
  }
}
