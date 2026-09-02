import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ANTIGRAVITY_DENIED_TOOLS, ANTIGRAVITY_GRANTED_TOOLS, deniedToolMatcher, ensureAntigravityProfile, hookCommand, renderAgent } from './antigravity-profile.js'

test('the agent declares exactly the granted native tools and keeps MCP', () => {
  const agent = renderAgent('/w')
  assert.ok(agent.startsWith('---\nname: closedai\n'))
  for (const tool of ANTIGRAVITY_GRANTED_TOOLS) assert.ok(agent.includes(`  - ${tool}\n`), tool)
  assert.ok(!agent.includes('- finish\n'))
  assert.ok(agent.includes('inheritMcp: true'))
  assert.ok(agent.includes('# Agent System Instructions'))
})

test('the deny matcher is anchored so ClosedAI\'s own browser tools are not caught', () => {
  const matcher = new RegExp(deniedToolMatcher())
  for (const tool of ANTIGRAVITY_DENIED_TOOLS) assert.ok(matcher.test(tool), tool)
  assert.equal(matcher.test('mcp_embedded_browser_page'), false)
  assert.equal(matcher.test('run_command'), false)
})

test('the hook runs the script with Electron as Node, quoted for the platform', () => {
  assert.equal(hookCommand("/opt/it's/electron", { execPath: "/opt/it's/electron", platform: 'linux' }).startsWith("ELECTRON_RUN_AS_NODE=1 '/opt/it'\"'\"'s/electron'"), true)
  assert.equal(hookCommand('C:\\s.cjs', { execPath: 'C:\\electron.exe', platform: 'win32' }), 'set "ELECTRON_RUN_AS_NODE=1" && "C:\\electron.exe" "C:\\s.cjs"')
})

test('the profile materializes under the state dir and is idempotent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agy-profile-'))
  try {
    const profile = await ensureAntigravityProfile(dir, { cwd: '/w', execPath: '/usr/bin/electron', platform: 'linux' })
    assert.equal(profile.agentName, 'closedai')
    assert.equal(profile.root, join(dir, 'profile'))
    const plugin = join(profile.root, '.agents', 'plugins', 'closedai')
    const hooks = JSON.parse(await readFile(join(plugin, 'hooks.json'), 'utf8')) as Record<string, { PreToolUse: Array<{ matcher: string; hooks: Array<{ command: string }> }> }>
    assert.equal(hooks['closedai-native-browser']!.PreToolUse[0]!.hooks[0]!.command, `ELECTRON_RUN_AS_NODE=1 '/usr/bin/electron' '${join(plugin, 'scripts', 'deny-native-browser.cjs')}'`)
    const script = await stat(join(plugin, 'scripts', 'deny-native-browser.cjs'))
    assert.equal(script.mode & 0o111, 0o111)
    const before = await stat(join(plugin, 'agents', 'closedai', 'agent.md'))
    await ensureAntigravityProfile(dir, { cwd: '/w', execPath: '/usr/bin/electron', platform: 'linux' })
    assert.equal((await stat(join(plugin, 'agents', 'closedai', 'agent.md'))).mtimeMs, before.mtimeMs)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
