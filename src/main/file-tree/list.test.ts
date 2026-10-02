import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listDirectory } from './list.js'

test('lists one level, directories first, including hidden files and inert symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'closedai-tree-'))
  try {
    await mkdir(join(root, 'src')); await writeFile(join(root, 'src', 'nested.ts'), '')
    await writeFile(join(root, 'z.ts'), ''); await writeFile(join(root, '.gitignore'), '')
    await symlink('src', join(root, 'link'))
    const result = await listDirectory(root)
    assert.deepEqual(result.entries.map(entry => entry.name), ['src', '.gitignore', 'link', 'z.ts'])
    assert.equal(result.entries.find(entry => entry.name === 'link')?.directory, false)
    assert.equal(result.entries.find(entry => entry.name === 'link')?.symlink, true)
    assert.deepEqual((await listDirectory(root, 'src')).entries.map(entry => entry.path), ['src/nested.ts'])
    assert.equal((await listDirectory(root, '', 2)).truncated, true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('rejects traversal, escaping symlinks, missing and non-directory paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'closedai-tree-'))
  try {
    await symlink(tmpdir(), join(root, 'escape'))
    await writeFile(join(root, 'file'), '')
    for (const path of ['..', 'escape', '/tmp', 'missing', 'file']) await assert.rejects(listDirectory(root, path))
    await assert.rejects(listDirectory('relative'))
  } finally { await rm(root, { recursive: true, force: true }) }
})
