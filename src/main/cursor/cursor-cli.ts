import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Everything about invoking the Cursor CLI (`cursor-agent`). Verified live against
// 2026.09.02-c22c1a3 on 2026-09-03:
// - `cursor-agent acp` starts an Agent Client Protocol server: one long-lived process speaking
//   newline-delimited JSON-RPC 2.0 on stdio, the same shape as `codex app-server`. The
//   subcommand is marked hidden in the CLI's own help, so a version bump is the thing that can
//   take it away; `cursorAcpAvailable` probes for it rather than assuming.
// - ACP carries sessions, models, modes, permissions, and MCP servers in-protocol, so none of
//   the one-shot `--print` flags (`--force`, `--model`, `--resume`) are used here.
// - `cursor-agent about` is the only place the signed-in account's email is printed; `status`
//   reports a login line that stays optimistic even when the token cannot fetch user details,
//   so the email from `about` is what decides whether the account is really usable.
// - The installed binary is a bash wrapper on ~/.local/bin that a desktop-launched Electron
//   often does not have on PATH.

export const CURSOR_BINARY_ENV = 'CLOSEDAI_CURSOR_BIN'
const COMMAND_TIMEOUT_MS = 30_000

export function cursorBinary(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[CURSOR_BINARY_ENV]?.trim()
  if (configured) return configured
  const installed = join(homedir(), '.local', 'bin', 'cursor-agent')
  return existsSync(installed) ? installed : 'cursor-agent'
}

/** argv for the long-lived ACP server. */
export function cursorAcpArgs(): string[] {
  return ['acp']
}

export type CursorCommandResult = { ok: boolean; stdout: string; stderr: string; code: number | null }

/** Run a one-shot CLI command (`about`) with stdin closed, bounded in time. */
export function runCursorCommand(
  args: string[],
  options: { binary?: string; cwd?: string } = {}
): Promise<CursorCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(options.binary ?? cursorBinary(), args, {
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
      const detail = error.code === 'ENOENT'
        ? `The Cursor CLI (${cursorBinary()}) was not found. Install it or set ${CURSOR_BINARY_ENV}.`
        : error.message
      resolve({ ok: false, stdout, stderr: detail, code: null })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, stdout, stderr, code })
    })
  })
}

/** The signed-in account's email, or null when `about` reports none. */
export function parseCursorAccountEmail(stdout: string): string | null {
  const match = /^\s*User Email\s{2,}(.+?)\s*$/mi.exec(stdout)
  const value = match?.[1]?.trim()
  if (!value || /^not logged in$/i.test(value)) return null
  return value
}

/** The plan tier `about` names, e.g. `Ultra`; null when it is unknown. */
export function parseCursorPlan(stdout: string): string | null {
  const match = /^\s*Subscription Tier\s{2,}(.+?)\s*$/mi.exec(stdout)
  const value = match?.[1]?.trim()
  if (!value || /^unknown$/i.test(value)) return null
  return value
}

/** Whether a CLI or protocol failure reads as "not signed in" rather than "broken". */
export function isCursorAuthFailure(text: string): boolean {
  return /log ?in|sign ?in|authenticat|not authorized|unauthorized|unauthenticated|credential|api ?key/i.test(text)
}
