import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { locate, readRange, scopedPath, search } from './retrieval.js'
import { repositoryTools } from './index.js'
import { ToolRegistry } from '../registry.js'
import { resolveCodexToolCatalog } from '../codex-tool-catalog.js'
import { resolveCursorToolCatalog } from '../cursor-tool-catalog.js'
import { claudeMcpServers } from '../../claude/claude-tools.js'
import { CursorToolBridge } from '../../cursor/cursor-mcp.js'
import { AntigravityToolBridge } from '../../antigravity/antigravity-mcp.js'
import { DEFAULT_APP_SETTINGS } from '../../app-settings-store.js'

const signal = () => new AbortController().signal
async function fixture(fn: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'retrieval-test-'))
  try {
    await mkdir(join(root, 'src'))
    await writeFile(join(root, '.ignore'), 'ignored.txt\n')
    await writeFile(join(root, 'ignored.txt'), 'dock launch hidden')
    await writeFile(join(root, 'src', 'dock-launch.ts'), 'export function launchDock() {\n  return "hidden chat"\n}\n')
    await fn(root)
  } finally { await rm(root, { recursive: true, force: true }) }
}

test('locates current code with evidence; honors ignore rules and observes edits', () => fixture(async root => {
  const result = await locate(root, 'dock launch hidden', signal())
  assert.equal(result.files[0].path, 'src/dock-launch.ts')
  assert.ok(result.files[0].score > 0)
  assert.ok(!result.files.some(file => file.path === 'ignored.txt'))
  await writeFile(join(root, 'src', 'dock-launch.ts'), 'export const revised = "new marker"')
  assert.equal((await search(root, { pattern: 'new marker' }, signal())).matches.length, 1)
  assert.equal((await search(root, { pattern: 'hidden' }, signal())).matches.length, 0)
}))

test('range reads preserve numbering, hashes and continuation without changing files', () => fixture(async root => {
  const path = 'src/dock-launch.ts'
  const original = await readFile(join(root, path), 'utf8')
  const result = await readRange(root, { path, from_line: 2, to_line: 3 }, signal(), 26)
  assert.match(result.text, /^2\|/)
  assert.equal(result.nextFromLine, 3)
  assert.match(result.sha256, /^[a-f0-9]{64}$/)
  assert.equal(await readFile(join(root, path), 'utf8'), original)
  await assert.rejects(readRange(root, { path, from_line: 100 }, signal()), /range/)
}))

test('rejects escaping paths, outside symlinks, binary files, and cancelled reads', () => fixture(async root => {
  await assert.rejects(scopedPath(root, '../'), /leaves/)
  await assert.rejects(scopedPath(root, '/etc/passwd'), /relative/)
  await symlink(tmpdir(), join(root, 'outside'))
  await assert.rejects(scopedPath(root, 'outside'), /leaves/)
  await writeFile(join(root, 'binary'), Buffer.from([1, 0, 2]))
  await assert.rejects(readRange(root, { path: 'binary' }, signal()), /binary/)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(readRange(root, { path: 'src/dock-launch.ts' }, controller.signal))
}))

test('batched searches retain per-query errors and literal patterns never execute shell text', () => fixture(async root => {
  const registry = new ToolRegistry([repositoryTools({ root: () => root })])
  const result = await registry.call({ namespace: 'repository', tool: 'search_many', arguments: { queries: [
    { pattern: 'hidden' }, { pattern: '[', regex: true }, { pattern: '$(touch exploited)' }
  ] } }, { threadId: null, turnId: null, callId: 'test' })
  const rows = JSON.parse((result.content[0] as { text: string }).text)
  assert.equal(rows[0].matches.length, 1)
  assert.match(rows[1].error, /regex/)
  assert.deepEqual(rows[2].matches, [])
  const bad = await registry.call({ namespace: 'repository', tool: 'read_many', arguments: { files: [] } }, { threadId: null, turnId: null, callId: 'bad' })
  assert.equal(bad.isError, true)
}))

test('flag defaults off; enabled registry reaches Codex and Claude but is excluded from Cursor', async () => {
  assert.equal(DEFAULT_APP_SETTINGS.chatRepositoryRetrievalEnabled, false)
  const registry = new ToolRegistry([repositoryTools({ root: () => '/tmp' })])
  const codex = await resolveCodexToolCatalog(registry, { chatToolSliceEnabled: false }, { prompt: 'repair launch', surface: null })
  assert.equal(codex.dynamicTools[0].tools.length, 3)
  const sdk = { tool: (...args: unknown[]) => args, createSdkMcpServer: (config: unknown) => config }
  const claude = claudeMcpServers(sdk as never, registry, () => ({ threadId: null, turnId: null }))
  assert.ok(claude.repository)
  const cursor = await resolveCursorToolCatalog(registry, { chatToolSliceEnabled: false }, { prompt: 'repair launch', surface: null })
  assert.deepEqual(cursor.namespaces, [])
  const bridge = new CursorToolBridge(registry)
  try {
    await bridge.start()
    assert.deepEqual(bridge.servers('warm-pane'), [])
  } finally { await bridge.stop() }
})


test('Antigravity HTTP registration exposes the same read-only tools and cleans up', () => fixture(async root => {
  const configPath = join(root, 'mcp.json')
  const registry = new ToolRegistry([repositoryTools({ root: () => root })])
  const bridge = new AntigravityToolBridge(registry, { configPath, profileKey: 'test' })
  try {
    await bridge.start()
    const config = JSON.parse(await readFile(configPath, 'utf8'))
    assert.ok(config.mcpServers.repository_test.serverUrl.includes('/repository'))
    assert.deepEqual(registry.names(), ['repository.locate', 'repository.search_many', 'repository.read_many'])
  } finally { await bridge.stop() }
  assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')).mcpServers, {})
}))
