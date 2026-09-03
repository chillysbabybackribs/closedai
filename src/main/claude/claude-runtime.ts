import type {
  AccountInfo,
  ModelInfo,
  Options,
  Query,
  SDKMessage,
  SDKUserMessage,
  SDKControlGetContextUsageResponse
} from '@anthropic-ai/claude-agent-sdk'
import type { ClaudeSdk } from './claude-sdk.js'
import { terminateClaudeRuntimeProcesses } from './claude-process-tree.js'
import type { ContextUsage } from '../chat-context/context-compaction.js'
import { claudePlanUsage } from '../chat-context/plan-usage.js'
import type { ChatPlanUsage } from '../../shared/chat.js'

// One live Claude Code process: a single `query()` over a streaming input, so follow-up turns
// reuse the process and its prompt cache instead of paying a spawn per message. Control calls
// (models, account, live model or effort changes) ride the same process. Closing ends the
// input, closes the query, and then retires every process still tagged with this runtime's id.

export type ClaudeRuntimeEvents = {
  onMessage: (message: SDKMessage) => void
  /** The message stream ended; `error` is set when it ended by throwing. */
  onEnd: (error: unknown) => void
}

export class ClaudeRuntime {
  private readonly query: Query
  private readonly queue: SDKUserMessage[] = []
  private wake: (() => void) | null = null
  private inputClosed = false
  private closing: Promise<void> | null = null

  constructor(
    sdk: Pick<ClaudeSdk, 'query'>,
    readonly id: string,
    options: Options,
    private readonly events: ClaudeRuntimeEvents
  ) {
    this.query = sdk.query({ prompt: this.input(), options })
    void this.consume()
  }

  get closed(): boolean {
    return this.inputClosed
  }

  /** Queue a user turn for the live process. */
  push(message: SDKUserMessage): void {
    if (this.inputClosed) throw new Error('Claude Code is not running')
    this.queue.push(message)
    this.wake?.()
  }

  async interrupt(): Promise<void> {
    await this.query.interrupt()
  }

  /** Switch the live session's model; undefined restores the CLI default. */
  async setModel(model: string | null): Promise<void> {
    await this.query.setModel(model ?? undefined)
  }

  /** Effort reaches the live CLI through its flag-settings layer; null restores the default. */
  async setEffort(effort: Options['effort'] | null): Promise<void> {
    await this.query.applyFlagSettings({ effortLevel: effort ?? null })
  }

  supportedModels(): Promise<ModelInfo[]> {
    return this.query.supportedModels()
  }

  accountInfo(): Promise<AccountInfo> {
    return this.query.accountInfo()
  }

  /** Read Claude's current context after a turn, including its compaction/tool accounting. */
  async contextUsage(): Promise<ContextUsage | null> {
    try {
      const usage: SDKControlGetContextUsageResponse = await this.query.getContextUsage({ detail: 'summary' })
      const contextWindow = usage.rawMaxTokens > 0 ? usage.rawMaxTokens : usage.maxTokens
      return usage.totalTokens > 0 && contextWindow > 0
        ? { usedTokens: usage.totalTokens, contextWindow }
        : null
    } catch {
      // Older or shutting-down SDK processes may not answer control requests. The stream result
      // remains the fallback context signal in that case.
      return null
    }
  }

  /**
   * The account's plan windows, the same reading `/usage` renders. Experimental in the SDK, so
   * a build without it (or a process on its way out) simply reports nothing.
   */
  async planUsage(): Promise<ChatPlanUsage | null> {
    try {
      const read = this.query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET
      if (typeof read !== 'function') return null
      return claudePlanUsage(await read.call(this.query))
    } catch {
      return null
    }
  }

  /** End the input, close the query, and terminate every process carrying this runtime's id. */
  close(): Promise<void> {
    this.closing ??= this.doClose()
    return this.closing
  }

  private async doClose(): Promise<void> {
    this.inputClosed = true
    this.wake?.()
    try {
      this.query.close()
    } catch {
      // Already gone; the process-tree sweep below is what matters.
    }
    await terminateClaudeRuntimeProcesses(this.id).catch((error: unknown) => {
      console.warn('[claude] process-tree cleanup failed:', error instanceof Error ? error.message : error)
    })
  }

  private async *input(): AsyncGenerator<SDKUserMessage> {
    while (true) {
      while (this.queue.length) yield this.queue.shift()!
      if (this.inputClosed) return
      await new Promise<void>((resolve) => { this.wake = resolve })
      this.wake = null
    }
  }

  private async consume(): Promise<void> {
    try {
      for await (const message of this.query) this.events.onMessage(message)
      this.events.onEnd(null)
    } catch (error) {
      this.events.onEnd(error)
    } finally {
      this.inputClosed = true
    }
  }
}
