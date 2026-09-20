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
//
// The CLI self-updates, and its registry moves: agy 1.2.7 (2026-09-20) still advertises the
// native browser tools in `init.tools` but refuses them in a custom agent, failing every turn with
// `failed to construct executor: ... unknown component: tool "open_browser_url" not found in
// registry`. The browser grant is therefore gone from the static list (the app's mcp_ browser
// tools own the visible browser anyway), and any name a future build rejects is parsed from that
// error, remembered under the state dir, and dropped from the next profile write.

export const ANTIGRAVITY_AGENT_NAME = 'closedai'
const PLUGIN_NAME = 'closedai'

/** Native tools verified declarable on agy 1.2.7: files, shell, tasks, web research, and images. */
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
  'read_url_content',
  'search_web',
  'generate_image'
] as const

const UNDECLARABLE_FILE = 'undeclarable-tools.json'
const UNDECLARABLE_TOOL_PATTERN = /unknown component: tool "([^"]+)" not found in registry/g

export type AntigravityProfile = { agentName: string; root: string }

export type AntigravityProfileOptions = {
  cwd: string
}

/** Materialize (or refresh) the plugin under `stateDir`; returns what the spawn needs. */
export async function ensureAntigravityProfile(stateDir: string, options: AntigravityProfileOptions): Promise<AntigravityProfile> {
  const root = join(stateDir, 'profile')
  const plugin = join(root, '.agents', 'plugins', PLUGIN_NAME)
  const excluded = await readUndeclarableTools(stateDir)
  await Promise.all([
    writeIfChanged(join(plugin, 'plugin.json'), `${JSON.stringify({ name: PLUGIN_NAME, description: 'ClosedAI agent profile: native tool grant and browser routing.' }, null, 2)}\n`),
    writeIfChanged(join(plugin, 'agents', ANTIGRAVITY_AGENT_NAME, 'agent.md'), renderAgent(options.cwd, excluded)),
    // Remove the old app-owned deny hook on upgrade as well as from new profiles.
    rm(join(plugin, 'hooks.json'), { force: true }),
    rm(join(plugin, 'scripts', 'deny-native-browser.cjs'), { force: true })
  ])
  return { agentName: ANTIGRAVITY_AGENT_NAME, root }
}

/** Tool names the CLI's executor error names as missing from its registry, in order, deduplicated. */
export function undeclarableToolsFrom(error: string): string[] {
  return [...new Set([...error.matchAll(UNDECLARABLE_TOOL_PATTERN)].map((match) => match[1]))]
}

/** Grants a previous CLI build rejected; consulted on every profile write. */
export async function readUndeclarableTools(stateDir: string): Promise<string[]> {
  const raw = await readFile(join(stateDir, 'profile', UNDECLARABLE_FILE), 'utf8').catch(() => null)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((tool): tool is string => typeof tool === 'string') : []
  } catch {
    return []
  }
}

/**
 * Remember tools the running CLI refuses to declare. Returns the names that were new, so a caller
 * can tell a first rejection (rewrite the profile and retry) from one already excluded (give up).
 */
export async function recordUndeclarableTools(stateDir: string, tools: readonly string[]): Promise<string[]> {
  const known = await readUndeclarableTools(stateDir)
  const added = tools.filter((tool) => !known.includes(tool))
  if (added.length === 0) return []
  const path = join(stateDir, 'profile', UNDECLARABLE_FILE)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify([...known, ...added], null, 2)}\n`)
  return added
}

export function renderAgent(cwd: string, excluded: readonly string[] = []): string {
  const tools = ANTIGRAVITY_GRANTED_TOOLS.filter((tool) => !excluded.includes(tool)).map((tool) => `  - ${tool}`).join('\n')
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
