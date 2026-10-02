import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { searchVideoLibrary } from './video-library.js'

test('searchVideoLibrary finds playable videos and filters by query', async () => {
  const root = await mkdtemp(join(tmpdir(), 'closedai-video-lib-'))
  await writeFile(join(root, 'clip-a.mp4'), 'x')
  await writeFile(join(root, 'notes.txt'), 'n')
  const nested = join(root, 'nested')
  await mkdir(nested)
  await writeFile(join(nested, 'clip-b.webm'), 'y')
  const all = await searchVideoLibrary([root], '')
  assert.equal(all.length, 2)
  const filtered = await searchVideoLibrary([root], 'clip-b')
  assert.equal(filtered.length, 1)
  assert.equal(filtered[0]?.name, 'clip-b.webm')
})
