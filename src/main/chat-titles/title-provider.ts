import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bareChatId, chatProviderOfId } from '../../shared/chat-providers.js'
import { loadClaudeSdk } from '../claude/claude-sdk.js'
import { titleProcess } from './title-process.js'
import { TITLE_INSTRUCTIONS, type TitleGenerator } from './title-policy.js'

/** Separate ephemeral requests use the selected model and existing provider authentication. */
export const generateChatTitle: TitleGenerator = async (request, signal) => {
  const provider = chatProviderOfId(request.modelId)
  if (provider !== 'codex' && provider !== 'claude') throw new Error('Isolated title generation is unavailable for this provider')
  signal.throwIfAborted()
  const cwd = await mkdtemp(join(tmpdir(), 'closedai-title-'))
  try {
    signal.throwIfAborted()
    if (provider === 'claude') {
      const sdk = await loadClaudeSdk()
      signal.throwIfAborted()
      const abortController = new AbortController()
      const abort = (): void => abortController.abort()
      signal.addEventListener('abort', abort, { once: true })
      const query = sdk.query({ prompt: request.prompt, options: {
        cwd, model: bareChatId('claude', request.modelId)!, systemPrompt: TITLE_INSTRUCTIONS,
        tools: [], mcpServers: {}, strictMcpConfig: true, settingSources: [],
        persistSession: false, maxTurns: 1, effort: 'low', abortController
      } })
      try {
        for await (const message of query) {
          if (message.type === 'result' && message.subtype === 'success') return message.result
        }
        throw new Error('No title returned')
      } finally {
        signal.removeEventListener('abort', abort)
        query.close()
      }
    }
    const instructions = join(cwd, 'instructions.txt')
    await writeFile(instructions, TITLE_INSTRUCTIONS)
    const output = await titleProcess(process.env.CLOSEDAI_CODEX_PATH?.trim() || 'codex', codexTitleArgs(request.modelId, instructions), cwd, request.prompt, signal)
    return codexTitleOutput(output)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}

export function codexTitleArgs(model: string, instructions: string): string[] {
  const disabled = ['shell_tool', 'unified_exec', 'multi_agent', 'hooks', 'apps', 'browser_use',
    'in_app_browser', 'image_generation', 'view_image', 'skill_search', 'tool_suggest', 'sleep_tool']
  return ['exec', '--ignore-user-config', '--strict-config', '--ephemeral', '--skip-git-repo-check',
    '--sandbox', 'read-only', '--model', model, '--json',
    ...disabled.flatMap((name) => ['-c', `features.${name}=false`]),
    '-c', 'web_search="disabled"', '-c', 'project_doc_max_bytes=0',
    '-c', 'model_reasoning_effort="low"', '-c', `model_instructions_file=${JSON.stringify(instructions)}`, '-']
}

export function codexTitleOutput(output: string): string {
  let text = ''
  let completed = false
  for (const line of output.split('\n').filter(Boolean)) {
    const event = JSON.parse(line)
    if (event.type === 'turn.failed' || event.type === 'error') throw new Error('Title generation failed')
    if (event.type === 'item.completed' && event.item?.type === 'agent_message') text = event.item.text
    if (event.type === 'turn.completed') completed = true
  }
  if (!completed || typeof text !== 'string' || !text.trim()) throw new Error('No completed title returned')
  return text
}
