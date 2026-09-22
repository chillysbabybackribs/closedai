import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ANTIGRAVITY_GRANTED_TOOLS, ensureAntigravityProfile, readUndeclarableTools, recordUndeclarableTools, renderAgent, undeclarableToolsFrom } from './antigravity-profile.js'

test('the agent declares exactly the granted native tools and keeps MCP', () => {
  const agent = renderAgent('/w')
  assert.ok(agent.startsWith('---\nname: closedai\n'))
  for (const tool of ANTIGRAVITY_GRANTED_TOOLS) assert.ok(agent.includes(`  - ${tool}\n`), tool)
  assert.ok(!agent.includes('- finish\n'))
  assert.ok(agent.includes('inheritMcp: true'))
  assert.ok(agent.includes('# Agent System Instructions'))
})

test('file, shell, and image tools are granted; no native web or browser tool is declared', () => {
  const agent = renderAgent('/w')
  for (const tool of ['grep_search', 'view_file', 'generate_image', 'run_command']) {
    assert.ok(agent.includes(`  - ${tool}\n`), tool)
  }
  // agy 1.2.7 aborts the executor for a custom agent that declares any of these.
  assert.doesNotMatch(agent, /- (open_browser_url|read_browser_page|browser_\w+|capture_browser_\w+)\n/)
  // The web belongs to the app's mcp_ tools, so the visible browser shows the work.
  assert.doesNotMatch(agent, /- (search_web|read_url_content)\n/)
  assert.doesNotMatch(agent, /tools are blocked|PreToolUse/)
})

test('a registry rejection names the tools to drop, and the profile drops them once recorded', async () => {
  const error = 'failed to construct executor: failed to resolve components: unknown component: tool "notebook_edit" not found in registry unknown component: tool "generate_image" not found in registry unknown component: tool "notebook_edit" not found in registry'
  assert.deepEqual(undeclarableToolsFrom(error), ['notebook_edit', 'generate_image'])
  assert.deepEqual(undeclarableToolsFrom('Antigravity stopped'), [])
  assert.ok(!renderAgent('/w', ['notebook_edit']).includes('- notebook_edit\n'))
  const dir = await mkdtemp(join(tmpdir(), 'agy-profile-'))
  try {
    assert.deepEqual(await readUndeclarableTools(dir), [])
    assert.deepEqual(await recordUndeclarableTools(dir, ['notebook_edit']), ['notebook_edit'])
    // A second rejection of the same name is not new, so the caller knows a rewrite cannot help.
    assert.deepEqual(await recordUndeclarableTools(dir, ['notebook_edit', 'generate_image']), ['generate_image'])
    assert.deepEqual(await readUndeclarableTools(dir), ['notebook_edit', 'generate_image'])
    const profile = await ensureAntigravityProfile(dir, { cwd: '/w' })
    const agent = await readFile(join(profile.root, '.agents', 'plugins', 'closedai', 'agents', 'closedai', 'agent.md'), 'utf8')
    assert.ok(!agent.includes('- notebook_edit\n'))
    assert.ok(!agent.includes('- generate_image\n'))
    assert.ok(agent.includes('- run_command\n'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the profile materializes under the state dir and is idempotent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agy-profile-'))
  try {
    const profile = await ensureAntigravityProfile(dir, { cwd: '/w' })
    assert.equal(profile.agentName, 'closedai')
    assert.equal(profile.root, join(dir, 'profile'))
    const plugin = join(profile.root, '.agents', 'plugins', 'closedai')
    await assert.rejects(readFile(join(plugin, 'hooks.json')), { code: 'ENOENT' })
    await assert.rejects(stat(join(plugin, 'scripts', 'deny-native-browser.cjs')), { code: 'ENOENT' })
    const before = await stat(join(plugin, 'agents', 'closedai', 'agent.md'))
    // A profile from an older build must lose its generated hook on refresh.
    await mkdir(join(plugin, 'scripts'), { recursive: true })
    await writeFile(join(plugin, 'hooks.json'), '{"old":"deny"}')
    await writeFile(join(plugin, 'scripts', 'deny-native-browser.cjs'), 'old hook')
    await ensureAntigravityProfile(dir, { cwd: '/w' })
    await assert.rejects(readFile(join(plugin, 'hooks.json')), { code: 'ENOENT' })
    await assert.rejects(stat(join(plugin, 'scripts', 'deny-native-browser.cjs')), { code: 'ENOENT' })
    assert.equal((await stat(join(plugin, 'agents', 'closedai', 'agent.md'))).mtimeMs, before.mtimeMs)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
