import assert from 'node:assert/strict'
import test from 'node:test'
import { safeDownloadFilename, uniqueDownloadPath } from './browser-download-names.ts'

const TAB = String.fromCharCode(9)
const NEWLINE = String.fromCharCode(10)
const NUL = String.fromCharCode(0)

test('a plain server filename survives untouched', () => {
  assert.equal(safeDownloadFilename('quarterly-report.pdf'), 'quarterly-report.pdf')
})

test('ordinary spaces are preserved the way a real browser preserves them', () => {
  assert.equal(safeDownloadFilename('My Notes v2.docx'), 'My Notes v2.docx')
})

test('directory components are stripped so a name cannot climb out of the download folder', () => {
  assert.equal(safeDownloadFilename('../../.ssh/authorized_keys'), 'authorized_keys')
  assert.equal(safeDownloadFilename('/etc/passwd'), 'passwd')
  assert.equal(safeDownloadFilename('C:\\Windows\\System32\\evil.exe'), 'evil.exe')
  assert.equal(safeDownloadFilename('..'), 'download')
  assert.equal(safeDownloadFilename('../..'), 'download')
})

test('filesystem-illegal characters are replaced, not dropped', () => {
  assert.equal(safeDownloadFilename('re:port<1>.txt'), 're-port-1-.txt')
  assert.equal(safeDownloadFilename('pipe|star*.txt'), 'pipe-star-.txt')
})

test('control characters never reach disk', () => {
  // A name that spans lines or embeds a NUL corrupts every log, shell paste, and syscall.
  assert.equal(safeDownloadFilename(`one${NEWLINE}two.txt`), 'one-two.txt')
  assert.equal(safeDownloadFilename(`one${TAB}two.txt`), 'one-two.txt')
  assert.equal(safeDownloadFilename(`evil${NUL}.txt`), 'evil-.txt')
})

test('a hidden-file name is made visible', () => {
  assert.equal(safeDownloadFilename('.bashrc'), 'bashrc')
  assert.equal(safeDownloadFilename('...hidden.txt'), 'hidden.txt')
})

test('empty and non-string inputs fall back to a usable name', () => {
  for (const input of ['', '   ', null, undefined, 42, {}]) {
    assert.equal(safeDownloadFilename(input), 'download')
  }
})

test('windows reserved device names are prefixed rather than written verbatim', () => {
  assert.equal(safeDownloadFilename('CON'), '_CON')
  assert.equal(safeDownloadFilename('nul.txt'), '_nul.txt')
  assert.equal(safeDownloadFilename('COM4.log'), '_COM4.log')
  // Only the exact device name is reserved — a longer stem is fine.
  assert.equal(safeDownloadFilename('console.log'), 'console.log')
})

test('an overlong stem is capped while its extension is preserved', () => {
  const name = safeDownloadFilename(`${'a'.repeat(400)}.tar.gz`)
  assert.equal(name.endsWith('.gz'), true)
  assert.equal(name.length, 123)
})

test('a dotted version string does not gain a bogus extension', () => {
  assert.equal(safeDownloadFilename('release-v1.2.3-notes'), 'release-v1.2.3-notes')
  assert.equal(safeDownloadFilename('archive.tar.gz'), 'archive.tar.gz')
})

test('a free path is returned unchanged', () => {
  assert.equal(uniqueDownloadPath('/tmp/dl', 'a.png', () => false), '/tmp/dl/a.png')
})

test('collisions disambiguate with a browser-style counter and never overwrite', () => {
  const taken = new Set(['/tmp/dl/a.png', '/tmp/dl/a (1).png', '/tmp/dl/a (2).png'])
  assert.equal(uniqueDownloadPath('/tmp/dl', 'a.png', (path) => taken.has(path)), '/tmp/dl/a (3).png')
})

test('an extensionless collision still disambiguates', () => {
  const taken = new Set(['/tmp/dl/LICENSE'])
  assert.equal(uniqueDownloadPath('/tmp/dl', 'LICENSE', (path) => taken.has(path)), '/tmp/dl/LICENSE (1)')
})

test('a saturated counter still yields a path that does not overwrite an existing file', () => {
  // Every counter taken: the fallback must be something OTHER than the occupied names.
  const result = uniqueDownloadPath('/tmp/dl', 'a.png', (path) => !path.includes('('))
  assert.equal(result.startsWith('/tmp/dl/a ('), true)
  assert.equal(result.endsWith('.png'), true)
})
