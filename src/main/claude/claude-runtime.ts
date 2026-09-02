import type {
  AccountInfo,
  ModelInfo,
  Options,
  Query,
  SDKMessage,
  SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
import type { ClaudeSdk } from './claude-sdk.js'
import { terminateClaudeRuntimeProcesses } from './claude-process-tree.js'

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
