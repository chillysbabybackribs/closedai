import assert from 'node:assert/strict'
import test from 'node:test'
import { detectProviderAvailability, findOnPath, type AvailabilityProbe } from './provider-availability.js'
import { PROVIDER_INSTALL_HINTS, PROVIDER_SIGN_IN_HINTS } from './provider-binary.js'

function probe(present: string[], env: NodeJS.ProcessEnv = {}): AvailabilityProbe {
  const files = new Set(present)
  return { env: { PATH: '/usr/bin:/opt/tools/bin', ...env }, home: '/home/u', exists: (path) => files.has(path), platform: 'linux' }
}

test('claude is always installed; the others resolve from PATH', async () => {
  const result = await detectProviderAvailability(probe(['/usr/bin/codex', '/opt/tools/bin/agy']))
  assert.deepEqual(result.map((entry) => [entry.provider, entry.installed, entry.path]), [
    ['codex', true, '/usr/bin/codex'],
    ['claude', true, null],
    ['antigravity', true, '/opt/tools/bin/agy'],
    ['cursor', false, null]
  ])
  assert.equal(result[0]!.hint, PROVIDER_SIGN_IN_HINTS.codex)
  assert.equal(result[1]!.hint, PROVIDER_SIGN_IN_HINTS.claude)
  assert.equal(result[3]!.hint, PROVIDER_INSTALL_HINTS.cursor)
})

test('the installer\'s ~/.local/bin wins for agy and cursor-agent even when PATH lacks it', async () => {
  const result = await detectProviderAvailability(probe(['/home/u/.local/bin/agy', '/home/u/.local/bin/cursor-agent', '/usr/bin/agy']))
  const byProvider = Object.fromEntries(result.map((entry) => [entry.provider, entry]))
  assert.equal(byProvider.antigravity!.path, '/home/u/.local/bin/agy')
  assert.equal(byProvider.cursor!.path, '/home/u/.local/bin/cursor-agent')
  assert.equal(byProvider.codex!.installed, false)
})

test('env overrides are honoured: an existing path installs, a missing one does not, a bare name searches PATH', async () => {
  const env = { CLOSEDAI_CODEX_PATH: '/custom/codex', CLOSEDAI_ANTIGRAVITY_BIN: '/nowhere/agy', CLOSEDAI_CURSOR_BIN: 'cursor-nightly' }
  const result = await detectProviderAvailability(probe(['/custom/codex', '/usr/bin/agy', '/opt/tools/bin/cursor-nightly'], env))
  const byProvider = Object.fromEntries(result.map((entry) => [entry.provider, entry]))
  assert.deepEqual([byProvider.codex!.installed, byProvider.codex!.path], [true, '/custom/codex'])
  assert.deepEqual([byProvider.antigravity!.installed, byProvider.antigravity!.path], [false, null])
  assert.deepEqual([byProvider.cursor!.installed, byProvider.cursor!.path], [true, '/opt/tools/bin/cursor-nightly'])
})

test('findOnPath skips empty PATH entries and tries PATHEXT suffixes on Windows', () => {
  const linux = { env: { PATH: ':/a::/b' }, home: '/h', exists: (path: string) => path === '/b/codex', platform: 'linux' as const }
  assert.equal(findOnPath('codex', linux), '/b/codex')
  const windows = { env: { PATH: 'C:\\tools', PATHEXT: '.COM;.EXE;.CMD' }, home: 'C:\\u', exists: (path: string) => path.endsWith('codex.CMD'), platform: 'win32' as const }
  assert.match(findOnPath('codex', windows)!, /codex\.CMD$/)
  assert.equal(findOnPath('codex', { env: {}, home: '/h', exists: () => true, platform: 'linux' }), null)
})
