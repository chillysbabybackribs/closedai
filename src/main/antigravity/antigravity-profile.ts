import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { antigravityAgentInstructions } from './antigravity-instructions.js'

// The app-private Antigravity plugin supplies product context and native tool declarations.
// Browser routing is guidance, not an app-authored tool denial. The profile is written
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

/** Declarable native tools, including the browser/web/image capabilities previously denied. */
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
  'notebook_edit',
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
}

/** Materialize (or refresh) the plugin under `stateDir`; returns what the spawn needs. */
export async function ensureAntigravityProfile(stateDir: string, options: AntigravityProfileOptions): Promise<AntigravityProfile> {
  const root = join(stateDir, 'profile')
  const plugin = join(root, '.agents', 'plugins', PLUGIN_NAME)
  await Promise.all([
    writeIfChanged(join(plugin, 'plugin.json'), `${JSON.stringify({ name: PLUGIN_NAME, description: 'ClosedAI agent profile: native tool grant and browser routing.' }, null, 2)}\n`),
    writeIfChanged(join(plugin, 'agents', ANTIGRAVITY_AGENT_NAME, 'agent.md'), renderAgent(options.cwd)),
    // Remove the old app-owned deny hook on upgrade as well as from new profiles.
    rm(join(plugin, 'hooks.json'), { force: true }),
    rm(join(plugin, 'scripts', 'deny-native-browser.cjs'), { force: true })
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

async function writeIfChanged(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const current = await readFile(path, 'utf8').catch(() => null)
  if (current !== content) await writeFile(path, content)
}
