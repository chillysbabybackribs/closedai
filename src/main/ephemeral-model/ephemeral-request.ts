import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bareChatId, chatProviderOfId } from '../../shared/chat-providers.js'
import { antigravityBinary } from '../antigravity/antigravity-cli.js'
import { loadClaudeSdk } from '../claude/claude-sdk.js'
import { cursorBinary } from '../cursor/cursor-cli.js'
import { ephemeralProcess } from './ephemeral-process.js'

// One question, one answer, nothing kept: a request to the provider a model id names, through
// that provider's CLI or SDK and its existing sign-in, with no tools, no session on disk, and an
// empty scratch folder as its working directory. Chat titles and the agent builder's prompt
// optimizer both go through here; they differ only in instructions, effort, and output size.

export type EphemeralEffort = 'low' | 'high'

export type EphemeralModelRequest = {
  /** A chat model id; its provider prefix picks the CLI or SDK. */
  modelId: string
  /** System-level instructions, for the providers that take them apart from the prompt. */
  instructions: string
  prompt: string
  /**
   * The prompt already carries the instructions. Antigravity and Cursor have no separate channel
   * and are sent the instructions ahead of the prompt unless this is set.
   */
  promptCarriesInstructions?: boolean
  effort: EphemeralEffort
  /** What the request is for, as the subject of a failure message: "Title generation". */
  label: string
  /** Stops a runaway answer; defaults to a size fit for a short one. */
  maxOutputChars?: number
}

export type EphemeralModelRequester = (request: EphemeralModelRequest, signal: AbortSignal) => Promise<string>

/** Ephemeral requests use the active provider CLI / SDK and existing authentication. */
export const ephemeralModelRequest: EphemeralModelRequester = async (request, signal) => {
  const provider = chatProviderOfId(request.modelId)
  const process_ = { label: request.label, maxOutputChars: request.maxOutputChars }
  signal.throwIfAborted()
  const cwd = await mkdtemp(join(tmpdir(), 'closedai-ephemeral-'))
  try {
    signal.throwIfAborted()
    if (provider === 'claude') {
      const sdk = await loadClaudeSdk()
      signal.throwIfAborted()
      const abortController = new AbortController()
      const abort = (): void => abortController.abort()
      signal.addEventListener('abort', abort, { once: true })
      const query = sdk.query({ prompt: request.prompt, options: {
        cwd, model: bareChatId('claude', request.modelId)!, systemPrompt: request.instructions,
        tools: [], mcpServers: {}, strictMcpConfig: true, settingSources: [],
        persistSession: false, maxTurns: 1, effort: request.effort, abortController
      } })
      try {
        for await (const message of query) {
          if (message.type === 'result' && message.subtype === 'success') return message.result
        }
        throw new Error(`${request.label} returned nothing`)
      } finally {
        signal.removeEventListener('abort', abort)
        query.close()
      }
    }
    const inline = request.promptCarriesInstructions ? request.prompt : `${request.instructions}\n\n${request.prompt}`
    if (provider === 'antigravity') {
      const output = await ephemeralProcess(antigravityBinary(), antigravityEphemeralArgs(request.modelId, inline, request.effort), cwd, '', signal, process_)
      return output.trim()
    }
    if (provider === 'cursor') {
      const output = await ephemeralProcess(cursorBinary(), cursorEphemeralArgs(request.modelId, inline), cwd, '', signal, process_)
      return output.trim()
    }
    const instructions = join(cwd, 'instructions.txt')
    await writeFile(instructions, request.instructions)
    const output = await ephemeralProcess(process.env.CLOSEDAI_CODEX_PATH?.trim() || 'codex',
      codexEphemeralArgs(request.modelId, instructions, request.effort), cwd, request.prompt, signal, process_)
    return codexEphemeralOutput(output, request.label)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}

export function antigravityEphemeralArgs(modelId: string, prompt: string, effort: EphemeralEffort): string[] {
  const model = bareChatId('antigravity', modelId)
  const args = [
    `--print=${prompt}`,
    '--output-format', 'text',
    '--dangerously-skip-permissions',
    '--disable-slash-commands',
    '--effort', effort
  ]
  if (model) args.push('--model', model)
  return args
}

/** Cursor's ask mode is read-only and takes no effort flag; the model id carries its own tier. */
export function cursorEphemeralArgs(modelId: string, prompt: string): string[] {
  const model = bareChatId('cursor', modelId)
  const args = [
    '--trust',
    '--print',
    '--output-format', 'text',
    '--mode', 'ask'
  ]
  if (model) args.push('--model', model)
  args.push(prompt)
  return args
}

export function codexEphemeralArgs(model: string, instructions: string, effort: EphemeralEffort): string[] {
  const disabled = ['shell_tool', 'unified_exec', 'multi_agent', 'hooks', 'apps', 'browser_use',
    'in_app_browser', 'image_generation', 'view_image', 'skill_search', 'tool_suggest', 'sleep_tool']
  return ['exec', '--ignore-user-config', '--strict-config', '--ephemeral', '--skip-git-repo-check',
    '--sandbox', 'read-only', '--model', model, '--json',
    ...disabled.flatMap((name) => ['-c', `features.${name}=false`]),
    '-c', 'web_search="disabled"', '-c', 'project_doc_max_bytes=0',
    '-c', `model_reasoning_effort="${effort}"`, '-c', `model_instructions_file=${JSON.stringify(instructions)}`, '-']
}

/** The last agent message of a completed `codex exec --json` run; anything short of that throws. */
export function codexEphemeralOutput(output: string, label: string): string {
  let text = ''
  let completed = false
  for (const line of output.split('\n').filter(Boolean)) {
    const event = JSON.parse(line)
    if (event.type === 'turn.failed' || event.type === 'error') throw new Error(`${label} failed`)
    if (event.type === 'item.completed' && event.item?.type === 'agent_message') text = event.item.text
    if (event.type === 'turn.completed') completed = true
  }
  if (!completed || typeof text !== 'string' || !text.trim()) throw new Error(`${label} returned nothing`)
  return text
}
