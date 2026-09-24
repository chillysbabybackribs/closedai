import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import type { ChatProvider } from '../shared/chat.js'
import { antigravityBinary } from './antigravity/antigravity-cli.js'
import { cursorBinary } from './cursor/cursor-cli.js'
import { codexExecutable } from './codex-workspace-runtime.js'

const TIMEOUT_MS = 45_000
const MAX_ANSWER_CHARS = 8_000

/** Ask a provider for one short follow-up draft, in an isolated read-only invocation. */
export function generatePromptSuggestion(
  provider: Exclude<ChatProvider, 'claude'>,
  model: string | null,
  answer: string
): Promise<string | null> {
  const trimmed = answer.trim().slice(-MAX_ANSWER_CHARS)
  if (!trimmed) return Promise.resolve(null)
  const prompt = [
    'Suggest one concise follow-up prompt the user could send next, based only on the assistant response below.',
    'Return only the prompt text, with no quotes, labels, explanation, or markdown. If no useful follow-up exists, return an empty response.',
    '',
    '<assistant_response>', trimmed, '</assistant_response>'
  ].join('\n')
  const isolatedCwd = tmpdir()
  const invocation = provider === 'codex'
    ? { binary: codexExecutable(), args: ['exec', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check', '-C', isolatedCwd, ...(model ? ['--model', model] : []), prompt] }
    : provider === 'cursor'
      ? { binary: cursorBinary(), args: ['--print', '--mode', 'ask', '--sandbox', 'enabled', '--workspace', isolatedCwd, ...(model ? ['--model', model] : []), prompt] }
      : { binary: antigravityBinary(), args: ['--print', '--mode', 'plan', '--sandbox', ...(model ? ['--model', model] : []), prompt] }
  return new Promise((resolve) => {
    const child = spawn(invocation.binary, invocation.args, {
      cwd: isolatedCwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true
    })
    let stdout = ''
    let settled = false
    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout = (stdout + chunk).slice(-4_000) })
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(null) }, TIMEOUT_MS)
    timer.unref?.()
    child.on('error', () => finish(null))
    child.on('close', (code) => {
      if (code !== 0) return finish(null)
      const suggestion = stdout.trim().replace(/^```\w*\s*|\s*```$/g, '').trim()
      finish(suggestion && suggestion.length <= 240 ? suggestion : null)
    })
  })
}
