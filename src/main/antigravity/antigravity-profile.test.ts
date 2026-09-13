import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ANTIGRAVITY_GRANTED_TOOLS, ensureAntigravityProfile, renderAgent } from './antigravity-profile.js'

test('the agent declares exactly the granted native tools and keeps MCP', () => {
  const agent = renderAgent('/w')
  assert.ok(agent.startsWith('---\nname: closedai\n'))
  for (const tool of ANTIGRAVITY_GRANTED_TOOLS) assert.ok(agent.includes(`  - ${tool}\n`), tool)
  assert.ok(!agent.includes('- finish\n'))
  assert.ok(agent.includes('inheritMcp: true'))
  assert.ok(agent.includes('# Agent System Instructions'))
})

test('native browser, research, and image tools are available alongside file tools', () => {
  for (const tool of ['open_browser_url', 'search_web', 'generate_image', 'run_command']) {
    assert.ok(renderAgent('/w').includes(`  - ${tool}\n`))
  }
  assert.doesNotMatch(renderAgent('/w'), /tools are blocked|PreToolUse/)
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
