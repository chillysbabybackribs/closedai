import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLocalFile } from './open.js'
import { localFilePath } from '../../shared/local-files.js'

test('local links accept encoded paths and line suffixes but reject remote and unsafe targets', () => {
  assert.equal(localFilePath('/tmp/my%20image.png'), '/tmp/my image.png')
  assert.equal(localFilePath('file:///tmp/my%20image.png'), '/tmp/my image.png')
  assert.equal(localFilePath('/tmp/code.ts:12:4'), '/tmp/code.ts')
  assert.equal(localFilePath('file:///tmp/code.ts#L12-L15'), '/tmp/code.ts')
  for (const value of ['https://example.com/a', '//server/a', 'file://server/a', 'javascript:alert(1)', '/tmp/%00a', 'relative.png']) {
    assert.equal(localFilePath(value), null, value)
  }
})

test('images return bounded preview bytes; other files reveal without executing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'closedai-local-file-'))
  try {
    const image = join(root, 'mockup.png')
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
    await writeFile(image, bytes)
    const revealed: string[] = []
    const reveal = (path: string) => { revealed.push(path) }
    const preview = await openLocalFile(image, reveal)
    assert.deepEqual(preview, { kind: 'image', name: 'mockup.png', src: `data:image/png;base64,${bytes.toString('base64')}` })
    assert.deepEqual(revealed, [])
    const script = join(root, 'run.sh')
    await writeFile(script, 'exit 1')
    assert.deepEqual(await openLocalFile(`${script}:10`, reveal), { kind: 'revealed' })
    assert.deepEqual(revealed, [script])
    await assert.rejects(openLocalFile(join(root, 'missing.png'), reveal), /ENOENT/)
    await assert.rejects(openLocalFile('https://example.com/a.png', reveal), /absolute local/)
    const oversized = join(root, 'large.png')
    await writeFile(oversized, Buffer.alloc(32 * 1024 * 1024 + 1))
    await assert.rejects(openLocalFile(oversized, reveal), /32 MB/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
