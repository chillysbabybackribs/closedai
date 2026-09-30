import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { appTools } from '../tools/app/index.ts'
import { browserTools } from '../tools/browser/index.ts'
import { createToolRegistry } from '../tools/index.ts'
import type { ToolRegistry } from '../tools/registry.ts'
import { applyToolSliceById, loadToolSliceCatalog, resetToolSliceCatalogCache } from '../tools/tool-slice.ts'
import { AntigravityToolBridge } from './antigravity-mcp.ts'

function stubHost(): null {
  return null
}

const registry = createToolRegistry([
  browserTools(() => stubHost(), () => stubHost(), () => stubHost()),
  appTools(stubHost, stubHost)
]) as ToolRegistry

type Config = { mcpServers: Record<string, { serverUrl: string; tools: Record<string, unknown> }> } & Record<string, unknown>

async function withConfig(initial: string | null, run: (path: string, dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'agy-mcp-'))
  const path = join(dir, 'mcp_config.json')
  if (initial !== null) await writeFile(path, initial)
  try {
    await run(path, dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function readConfig(path: string): Promise<Config> {
  return JSON.parse(await readFile(path, 'utf8')) as Config
}

test('task slice advertisement limits eager tools in the CLI config', async () => {
  resetToolSliceCatalogCache()
  const catalog = await loadToolSliceCatalog()
  const applied = applyToolSliceById(registry, catalog, 'core')
  await withConfig(null, async (path) => {
    const bridge = new AntigravityToolBridge(registry, { configPath: path })
    bridge.setToolAdvertisement(applied.registry)
    await bridge.start()
    try {
      const config = await readConfig(path)
      assert.deepEqual(config.mcpServers.embedded_browser.tools, {})
      assert.deepEqual(config.mcpServers.closedai_app.tools, { state: { eager: true } })
    } finally {
      await bridge.stop()
    }
  })
})

test('registers every enabled namespace with its eager tools and keeps foreign entries', async () => {
  const foreign = { mcpServers: { github: { serverUrl: 'https://example.test/mcp' } }, other: true }
  await withConfig(JSON.stringify(foreign), async (path) => {
    const bridge = new AntigravityToolBridge(registry, { configPath: path })
    await bridge.start()
    try {
      const config = await readConfig(path)
      assert.equal(config.other, true)
      assert.deepEqual(config.mcpServers.github, foreign.mcpServers.github)
      assert.match(config.mcpServers.embedded_browser.serverUrl, /^http:\/\/127\.0\.0\.1:\d+\/mcp\/[^/]+\/embedded_browser$/)
      assert.deepEqual(config.mcpServers.embedded_browser.tools, { page: { eager: true } })
      assert.deepEqual(bridge.servers().map((server) => server.server), ['embedded_browser', 'closedai_app'])
    } finally {
      await bridge.stop()
    }
    const after = await readConfig(path)
    assert.deepEqual(Object.keys(after.mcpServers), ['github'])
  })
})

test('a zero-byte config left by an interrupted write is treated as empty, not as a failure', async () => {
  await withConfig('', async (path) => {
    const bridge = new AntigravityToolBridge(registry, { configPath: path })
    await bridge.start()
    try {
      assert.deepEqual(Object.keys((await readConfig(path)).mcpServers), ['embedded_browser', 'closedai_app'])
      assert.equal(bridge.servers().length, 2)
    } finally {
      await bridge.stop()
    }
  })
})

test('an unparseable config is moved aside and replaced', async () => {
  await withConfig('{"mcpServers": {', async (path, dir) => {
    const bridge = new AntigravityToolBridge(registry, { configPath: path })
    await bridge.start()
    try {
      assert.equal(bridge.servers().length, 2)
      const aside = (await readdir(dir)).find((name) => name.startsWith('mcp_config.json.corrupt-'))
      assert.ok(aside)
      assert.equal(await readFile(join(dir, aside), 'utf8'), '{"mcpServers": {')
    } finally {
      await bridge.stop()
    }
  })
})

test('ensureRegistered restores entries another writer dropped and is a no-op when current', async () => {
  await withConfig(null, async (path) => {
    const bridge = new AntigravityToolBridge(registry, { configPath: path, profileKey: 'abc123' })
    await bridge.ensureRegistered()
    await assert.rejects(readFile(path, 'utf8'), { code: 'ENOENT' })
    await bridge.start()
    try {
      const registered = await readFile(path, 'utf8')
      assert.deepEqual(Object.keys((await readConfig(path)).mcpServers), ['embedded_browser_abc123', 'closedai_app_abc123'])
      await writeFile(path, JSON.stringify({ mcpServers: {} }))
      await bridge.ensureRegistered()
      assert.equal(await readFile(path, 'utf8'), registered)
      await bridge.ensureRegistered()
      assert.equal(await readFile(path, 'utf8'), registered)
    } finally {
      await bridge.stop()
    }
  })
})
