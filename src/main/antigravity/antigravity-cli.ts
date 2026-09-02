import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Everything about invoking Google's Antigravity CLI (`agy`). Verified live against agy 1.1.24
// on 2026-09-02:
// - `--print=` (an EMPTY value) with `--input-format stream-json` reads one JSON turn per stdin
//   line and keeps the process alive across turns on one conversation. A bare `--print` swallows
//   the next flag as its prompt, and any other value is taken as a prompt and rejected.
// - `--dangerously-skip-permissions` is required: without it the init event reports
//   `permission_mode: request-review` and a headless turn stalls waiting on a prompt.
// - `--disable-slash-commands` keeps a message that starts with `/` from expanding as a CLI
//   command.
// - The default `--print-timeout` is 5 minutes, far below a real agentic turn.
// - `--add-dir <workspace>` must be passed and must come first: the spawn cwd alone does not
//   reach the model's shell (it starts in the CLI's own state dir); the first `--add-dir` does.
// - Custom agents are discovered from any added directory; `--agent <name>` selects one.

export const ANTIGRAVITY_BINARY_ENV = 'CLOSEDAI_ANTIGRAVITY_BIN'
export const ANTIGRAVITY_STATE_DIR = join(homedir(), '.gemini', 'antigravity-cli')
export const ANTIGRAVITY_MCP_CONFIG_PATH = join(homedir(), '.gemini', 'config', 'mcp_config.json')
const PRINT_TIMEOUT = '60m'
const COMMAND_TIMEOUT_MS = 30_000

/** The binary: the official installer's ~/.local/bin/agy, which a desktop-launched Electron often lacks on PATH. */
export function antigravityBinary(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[ANTIGRAVITY_BINARY_ENV]?.trim()
  if (configured) return configured
  const installed = join(homedir(), '.local', 'bin', 'agy')
  return existsSync(installed) ? installed : 'agy'
}

export type AntigravitySpawnConfig = {
  workspace: string
  /** CLI wire model name (effort suffix included), or null for the CLI default. */
  model: string | null
  /** Conversation to continue, or null to start a new one. */
  resume: string | null
  /** Custom agent name and the directory its plugin lives under. */
  agent: { name: string; root: string } | null
}

/** argv for one persistent chat process on a conversation. */
export function antigravityChatArgs(config: AntigravitySpawnConfig): string[] {
  const args = [
    '--print=',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--dangerously-skip-permissions',
    '--disable-slash-commands',
    '--print-timeout', PRINT_TIMEOUT
  ]
  if (config.model) args.push('--model', config.model)
  if (config.resume) args.push('--conversation', config.resume)
  if (config.agent) args.push('--agent', config.agent.name)
  args.push('--add-dir', config.workspace)
  if (config.agent && config.agent.root !== config.workspace) args.push('--add-dir', config.agent.root)
  return args
}

/** One stdin line starting a turn; the shape the CLI accepts (others warn and are ignored). */
export function antigravityTurnLine(content: string): string {
  return `${JSON.stringify({ event: 'user', message: { role: 'user', content } })}\n`
}

export type AntigravityCommandResult = { ok: boolean; stdout: string; stderr: string; code: number | null }

/** Run a one-shot CLI command (`models`, `mcp …`) with stdin closed, bounded in time. */
export function runAntigravityCommand(args: string[], options: { binary?: string; cwd?: string } = {}): Promise<AntigravityCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(options.binary ?? antigravityBinary(), args, {
      cwd: options.cwd ?? homedir(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-4_000) })
    const timer = setTimeout(() => child.kill('SIGKILL'), COMMAND_TIMEOUT_MS)
    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      const detail = error.code === 'ENOENT' ? `The Antigravity CLI (${antigravityBinary()}) was not found. Install it or set ${ANTIGRAVITY_BINARY_ENV}.` : error.message
      resolve({ ok: false, stdout, stderr: detail, code: null })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, stdout, stderr, code })
    })
  })
}

/** Whether a CLI failure reads as "not signed in" rather than "broken". */
export function isAntigravityAuthFailure(text: string): boolean {
  return /log ?in|sign ?in|authenticat|not authorized|unauthenticated|credential/i.test(text)
}
