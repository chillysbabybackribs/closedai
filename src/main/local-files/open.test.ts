import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { openLocalFile } from './open.js'
import { isRenderableFile, isWorkspaceFileHref, localFilePath, parseLocalFileTarget, renderableFilePath } from '../../shared/local-files.js'
import { resolveLocalFileOpenTarget } from './resolve-target.js'

test('line targets read ranges from #L anchors and a line, never a range, from compiler suffixes', () => {
  assert.deepEqual(parseLocalFileTarget('/tmp/code.ts'), { path: '/tmp/code.ts' })
  assert.deepEqual(parseLocalFileTarget('/tmp/code.ts:12'), { path: '/tmp/code.ts', line: 12 })
  assert.deepEqual(parseLocalFileTarget('/tmp/code.ts:120:15'), { path: '/tmp/code.ts', line: 120 })
  assert.deepEqual(parseLocalFileTarget('file:///tmp/code.ts#L12-L15'), { path: '/tmp/code.ts', line: 12, endLine: 15 })
  assert.deepEqual(parseLocalFileTarget('/tmp/code.ts#L12-15'), { path: '/tmp/code.ts', line: 12, endLine: 15 })
  assert.deepEqual(parseLocalFileTarget('/tmp/code.ts#L15-L12'), { path: '/tmp/code.ts', line: 15 })
  assert.deepEqual(parseLocalFileTarget('/tmp/code.ts:0'), { path: '/tmp/code.ts' })
  assert.equal(parseLocalFileTarget('https://example.com/a.ts:12'), null)
})

test('local links accept encoded paths and line suffixes but reject remote and unsafe targets', () => {
  assert.equal(localFilePath('/tmp/my%20image.png'), '/tmp/my image.png')
  assert.equal(localFilePath('file:///tmp/my%20image.png'), '/tmp/my image.png')
  assert.equal(localFilePath('/tmp/code.ts:12:4'), '/tmp/code.ts')
  assert.equal(localFilePath('file:///tmp/code.ts#L12-L15'), '/tmp/code.ts')
  for (const value of ['https://example.com/a', '//server/a', 'file://server/a', 'javascript:alert(1)', '/tmp/%00a', 'relative.png']) {
    assert.equal(localFilePath(value), null, value)
  }
})

test('images return preview bytes; files return path; directories reveal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'closedai-local-file-'))
  try {
    const image = join(root, 'mockup.png')
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
    await writeFile(image, bytes)
    const revealed: string[] = []
    const reveal = (path: string) => { revealed.push(path) }
    const preview = await openLocalFile(image, reveal)
    assert.deepEqual(preview, { kind: 'image', name: 'mockup.png', path: image, src: `data:image/png;base64,${bytes.toString('base64')}` })
    assert.deepEqual(revealed, [])
    const script = join(root, 'run.sh')
    await writeFile(script, 'exit 1')
    assert.deepEqual(await openLocalFile(`${script}:10`, reveal), { kind: 'file', path: script, line: 10 })
    assert.deepEqual(revealed, [])
    const folder = join(root, 'subfolder')
    await mkdir(folder)
    assert.deepEqual(await openLocalFile(folder, reveal), { kind: 'revealed' })
    assert.deepEqual(revealed, [folder])
    await assert.rejects(openLocalFile(join(root, 'missing.png'), reveal), { message: 'missing.png no longer exists.' })
    await assert.rejects(openLocalFile('https://example.com/a.png', reveal), /workspace/)
    const nested = join(root, 'src', 'app.ts')
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(nested, 'export {}')
    assert.deepEqual(
      await openLocalFile('src/app.ts:3', reveal, { cwd: root }),
      { kind: 'file', path: nested, line: 3, cwd: root }
    )
    assert.ok(isWorkspaceFileHref('src/app.ts'))
    assert.equal(resolveLocalFileOpenTarget('src/app.ts', root)?.path, nested)
    const oversized = join(root, 'large.png')
    await writeFile(oversized, Buffer.alloc(32 * 1024 * 1024 + 1))
    await assert.rejects(openLocalFile(oversized, reveal), /32 MB/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('only local HTML and SVG pages offer a page view beside their code', () => {
  assert.equal(isRenderableFile('/tmp/mock.html'), true)
  assert.equal(isRenderableFile('/tmp/MOCK.HTM'), true)
  assert.equal(isRenderableFile('/tmp/icon.svg'), true)
  assert.equal(isRenderableFile('/tmp/page.tsx'), false)
  assert.equal(renderableFilePath('file:///tmp/design%20mocks/a.html#step-2'), '/tmp/design mocks/a.html')
  assert.equal(renderableFilePath('file:///tmp/notes.md'), null)
  assert.equal(renderableFilePath('file://host/share/a.html'), null)
  assert.equal(renderableFilePath('https://example.com/a.html'), null)
})

test('a missing relative link opens the one project file whose trailing path matches it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'closedai-local-find-'))
  try {
    const reveal = () => {}
    const mock = join(root, 'work', 'mockups', 'task-visuals.html')
    await mkdir(join(root, 'work', 'mockups'), { recursive: true })
    await writeFile(mock, '<p>mock</p>')
    // Generated and hidden folders never count, so their copies do not make the link ambiguous.
    for (const skipped of ['node_modules', 'out', '.git']) {
      await mkdir(join(root, skipped), { recursive: true })
      await writeFile(join(root, skipped, 'task-visuals.html'), '')
    }
    assert.deepEqual(await openLocalFile('task-visuals.html', reveal, { cwd: root }), { kind: 'file', path: mock, cwd: root })
    assert.deepEqual(await openLocalFile('mockups/task-visuals.html:4', reveal, { cwd: root }), { kind: 'file', path: mock, line: 4, cwd: root })
    // Whole segments only: `visuals.html` is not a suffix match for `task-visuals.html`.
    await assert.rejects(openLocalFile('visuals.html', reveal, { cwd: root }), { message: `Couldn't find visuals.html in ${basename(root)}.` })
    await mkdir(join(root, 'docs'), { recursive: true })
    await writeFile(join(root, 'docs', 'task-visuals.html'), '')
    await assert.rejects(openLocalFile('task-visuals.html', reveal, { cwd: root }), { message: `Several files are named task-visuals.html in ${basename(root)}.` })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
