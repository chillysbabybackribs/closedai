import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileTab } from './file-tab.js'
import { openLocalFile } from './open.js'

test('source links produce inert text previews and update line targets and reloads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'closedai-file-tab-'))
  try {
    const path = join(root, 'source #1.tsx')
    const source = '<script>throw new Error("must not execute")</script>\nexport const value = 1'
    await writeFile(path, source)
    const preview = await openLocalFile(`${path}:2`, () => assert.fail('must not reveal source'))
    assert.equal(preview.kind, 'file')
    if (preview.kind !== 'file') return
    const tab = new FileTab('file-1', path, { ...preview, name: 'source #1.tsx' }, 'web-1')
    assert.equal(tab.getState().navigationError, null)
    assert.equal(tab.getState().file?.line, 2)
    assert.ok(tab.getState().url.includes('source%20%231.tsx#L2'))
    assert.ok(!JSON.stringify(tab.getState()).includes(source))
    assert.equal((await tab.readContent()).content, source)
    tab.updateLine(1)
    assert.equal((await tab.readContent()).line, 1)
    tab.updateLine()
    assert.equal((await tab.readContent()).line, undefined)
    await writeFile(path, 'updated')
    tab.reload()
    assert.equal(tab.getState().file?.revision, 1)
    assert.equal((await tab.readContent()).content, 'updated')
    assert.equal(tab.exportNavigationStack(), null)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('file previews reject binary, oversized, and missing files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'closedai-file-tab-'))
  try {
    const path = join(root, 'data')
    const tab = new FileTab('file-1', path, { path, name: 'data' }, null)
    await assert.rejects(tab.readContent(), /ENOENT/)
    await writeFile(path, Buffer.from([0, 1, 2]))
    await assert.rejects(tab.readContent(), /Binary file/)
    await writeFile(path, Buffer.alloc(5 * 1024 * 1024 + 1, 65))
    await assert.rejects(tab.readContent(), /5 MB/)
    await writeFile(path, '')
    assert.equal((await tab.readContent()).content, '')
  } finally { await rm(root, { recursive: true, force: true }) }
})
