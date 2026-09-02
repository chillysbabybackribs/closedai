import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { antigravityAgentInstructions } from './antigravity-instructions.js'

// The app-private Antigravity plugin: a custom agent whose frontmatter grants exactly the
// native tools ClosedAI wants the model to have, plus a PreToolUse hook that denies the CLI's
// own browser, web, and image tools with a steer to the ClosedAI equivalents. It is written
// under the app's state dir and reaches agy as an extra `--add-dir`, so nothing lands in the
// user's project or global config.
//
// Both frontmatter facts were measured on agy 1.1.23 and re-verified on 1.1.24 (2026-09-02):
// `tools:` IS the agent's built-in grant (omit it and every write or shell call fails with
// "unknown tool"), and `inheritMcp: true` keeps the ClosedAI MCP servers. `init.tools` is not a
// safe source for the grant: it advertises names the build cannot declare (read_resource,
// sed_file, send_command_input, command_status, notebook_execution, wait_5_seconds), and one
// undeclarable name aborts the whole agent. `finish` is declarable but leaks its step envelope
// into the final response; the ask_* and wait tools have nobody to answer them headlessly.

export const ANTIGRAVITY_AGENT_NAME = 'closedai'
const PLUGIN_NAME = 'closedai'

/** Native tools the agent may use: local files, search, shell, tasks. */
export const ANTIGRAVITY_GRANTED_TOOLS = [
  'find_by_name',
  'grep_search',
  'list_dir',
  'view_file',
  'write_to_file',
  'replace_file_content',
  'multi_replace_file_content',
  'run_command',
  'manage_task',
  'notebook_edit'
] as const

/** Native tools denied before execution: an invisible browser and server-side fetches bypass ClosedAI. */
export const ANTIGRAVITY_DENIED_TOOLS = [
  'open_browser_url', 'read_browser_page', 'read_url_content', 'search_web', 'list_browser_pages',
  'capture_browser_screenshot', 'capture_browser_console_logs', 'click_browser_pixel',
  'execute_browser_javascript', 'browser_click_element', 'browser_drag_pixel_to_pixel',
  'browser_get_dom', 'browser_get_network_request', 'browser_input', 'browser_list_network_requests',
  'browser_mouse_down', 'browser_mouse_up', 'browser_move_mouse', 'browser_press_key',
  'browser_refresh_page', 'browser_resize_window', 'browser_scroll', 'browser_scroll_dom',
  'browser_select_option', 'browser_subagent', 'generate_image'
] as const

export type AntigravityProfile = { agentName: string; root: string }

export type AntigravityProfileOptions = {
  cwd: string
  execPath?: string
  platform?: NodeJS.Platform
}

/** Materialize (or refresh) the plugin under `stateDir`; returns what the spawn needs. */
export async function ensureAntigravityProfile(stateDir: string, options: AntigravityProfileOptions): Promise<AntigravityProfile> {
  const root = join(stateDir, 'profile')
  const plugin = join(root, '.agents', 'plugins', PLUGIN_NAME)
  const script = join(plugin, 'scripts', 'deny-native-browser.cjs')
  await Promise.all([
    writeIfChanged(join(plugin, 'plugin.json'), `${JSON.stringify({ name: PLUGIN_NAME, description: 'ClosedAI agent profile: native tool grant and browser routing.' }, null, 2)}\n`),
    writeIfChanged(join(plugin, 'agents', ANTIGRAVITY_AGENT_NAME, 'agent.md'), renderAgent(options.cwd)),
    writeIfChanged(join(plugin, 'hooks.json'), renderHooks(hookCommand(script, options))),
    writeIfChanged(script, DENY_SCRIPT, 0o755)
  ])
  return { agentName: ANTIGRAVITY_AGENT_NAME, root }
}

export function renderAgent(cwd: string): string {
  const tools = ANTIGRAVITY_GRANTED_TOOLS.map((tool) => `  - ${tool}`).join('\n')
  return `---
name: ${ANTIGRAVITY_AGENT_NAME}
description: ClosedAI coding agent on the Antigravity subscription
tools:
${tools}
inheritMcp: true
---

# Agent System Instructions

${antigravityAgentInstructions(cwd)}
`
}

/** Anchored alternation: a broad `.*browser.*` would also catch ClosedAI's `mcp_embedded_browser_*` tools. */
export function deniedToolMatcher(): string {
  return `^(?:${ANTIGRAVITY_DENIED_TOOLS.map((tool) => tool.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`
}

function renderHooks(command: string): string {
  return `${JSON.stringify({
    'closedai-native-browser': {
      PreToolUse: [{ matcher: deniedToolMatcher(), hooks: [{ type: 'command', command, timeout: 5 }] }]
    }
  }, null, 2)}\n`
}

const DENY_REASON = 'This Antigravity-native browser/web/image tool is blocked: it drives a browser the user cannot see and carries none of their signed-in sessions. Use the ClosedAI MCP tools instead (names starting with mcp_): embedded_browser for pages, browser_cdp for protocol access, closedai_ui for captures, search for public research. Image generation has no ClosedAI tool; say so instead of retrying.'

const DENY_SCRIPT = `#!/usr/bin/env node
'use strict'
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { input += chunk })
process.stdin.on('end', () => {
  let toolName = 'native tool'
  try {
    const payload = JSON.parse(input || '{}')
    if (payload && payload.toolCall && typeof payload.toolCall.name === 'string') toolName = payload.toolCall.name
  } catch {}
  process.stdout.write(JSON.stringify({ decision: 'deny', reason: toolName + ': ' + ${JSON.stringify(DENY_REASON)} }))
})
`

/** The hook runs the script with this Electron binary as Node, so no separate runtime is assumed. */
export function hookCommand(script: string, options: Pick<AntigravityProfileOptions, 'execPath' | 'platform'>): string {
  const execPath = options.execPath ?? process.execPath
  if ((options.platform ?? process.platform) === 'win32') {
    return `set "ELECTRON_RUN_AS_NODE=1" && "${execPath.replaceAll('"', '""')}" "${script.replaceAll('"', '""')}"`
  }
  return `ELECTRON_RUN_AS_NODE=1 ${quotePosix(execPath)} ${quotePosix(script)}`
}

function quotePosix(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

async function writeIfChanged(path: string, content: string, mode?: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const current = await readFile(path, 'utf8').catch(() => null)
  if (current !== content) await writeFile(path, content, mode === undefined ? undefined : { mode })
  if (mode !== undefined) await chmod(path, mode)
}
