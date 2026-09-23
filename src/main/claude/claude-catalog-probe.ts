import { randomUUID } from 'node:crypto'
import type { AccountInfo, ModelInfo } from '@anthropic-ai/claude-agent-sdk'
import type { ClaudeCatalog } from './claude-catalog.js'
import { claudeQueryOptions } from './claude-options.js'
import { ClaudeRuntime } from './claude-runtime.js'
import type { ClaudeSdk } from './claude-sdk.js'

/**
 * Read models and account from a short-lived CLI process with no MCP servers attached.
 * Used when the workspace catalog cache is cold and the pane is not warming a session yet,
 * so a full tool advertisement pass is not paid just to populate the picker.
 */
export async function probeClaudeCatalog(sdk: Pick<ClaudeSdk, 'query'>, cwd: string): Promise<ClaudeCatalog> {
  const runtimeId = randomUUID()
  const runtime = new ClaudeRuntime(sdk, runtimeId, claudeQueryOptions({
    cwd,
    model: null,
    effort: null,
    adaptiveThinking: false,
    resume: null,
    runtimeId,
    mcpServers: {}
  }), { onMessage: () => {}, onEnd: () => {} })
  try {
    const [models, account] = await Promise.all([
      runtime.supportedModels(),
      runtime.accountInfo().catch((): AccountInfo | null => null)
    ])
    return { models, account }
  } finally {
    await runtime.close()
  }
}

export type { ModelInfo }
