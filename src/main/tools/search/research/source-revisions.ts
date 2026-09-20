import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** A single pointer publishes text and bytes together. Old revisions live until run eviction. */
export async function sourceBase(root: string, runId: string, sourceId: string): Promise<string> {
  const base = join(root, runId, sourceId)
  try {
    const revision = await readFile(`${base}.current`, 'utf8')
    if (!/^[a-f0-9-]{36}$/.test(revision)) throw new Error('Invalid source revision')
    return join(`${base}.versions`, revision, 'source')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return base
    throw error
  }
}

export async function replaceSource(root: string, runId: string, sourceId: string, stagedId: string): Promise<void> {
  const base = join(root, runId, sourceId)
  const staged = join(root, runId, stagedId)
  const revision = randomUUID()
  const directory = join(`${base}.versions`, revision)
  await mkdir(directory, { recursive: true })
  let committed = false
  try {
    await rename(`${staged}.txt`, join(directory, 'source.txt'))
    // Provider text has no original bytes. Never inherit an older revision's raw file.
    await rename(`${staged}.raw`, join(directory, 'source.raw')).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
    await writeFile(`${base}.current.tmp`, revision)
    await rename(`${base}.current.tmp`, `${base}.current`)
    committed = true
  } finally {
    await rm(`${base}.current.tmp`, { force: true })
    if (!committed) await rm(directory, { recursive: true, force: true })
  }
}
