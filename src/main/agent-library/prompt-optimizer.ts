import { SAVED_AGENT_DESCRIPTION_MAX } from '../../shared/agent-library.js'
import {
  AGENT_OPTIMIZE_CANCELLED, AGENT_OPTIMIZE_MIN_DESCRIPTION_CHARS, type AgentOptimizeRequest, type AgentOptimizeResult
} from '../../shared/agent-optimizer.js'
import { ephemeralModelRequest, type EphemeralModelRequester } from '../ephemeral-model/ephemeral-request.js'
import { optimizerInstructions, optimizerPrompt, parseOptimizerReply } from './optimizer-instructions.js'

// The agent builder's Optimize action. One ephemeral request to the launching pane's model at
// high effort: no tools, no session, nothing written to a chat. A request is cancellable by its
// id and bounded in time, and it never touches the library; the renderer decides what to do with
// the result.

/** Writing a long prompt at high effort takes a while; past this the request is abandoned. */
export const OPTIMIZE_TIMEOUT_MS = 240_000
/** The reply is a prompt plus, on Codex, the JSON event stream around it. */
const OPTIMIZE_OUTPUT_CHARS = 600_000

export type AgentPromptOptimizerDeps = {
  /** The model selected in a chat pane; null when the pane is unknown or has no model yet. */
  modelFor: (paneId: string) => string | null
  request?: EphemeralModelRequester
  timeoutMs?: number
}

export class AgentPromptOptimizer {
  private readonly pending = new Map<string, AbortController>()

  constructor(private readonly deps: AgentPromptOptimizerDeps) {}

  async optimize(request: AgentOptimizeRequest): Promise<AgentOptimizeResult> {
    const description = typeof request.description === 'string' ? request.description.trim() : ''
    if (description.length < AGENT_OPTIMIZE_MIN_DESCRIPTION_CHARS) throw new Error('Describe what the agent should do before optimizing')
    if (description.length > SAVED_AGENT_DESCRIPTION_MAX) throw new Error(`Agent descriptions are limited to ${SAVED_AGENT_DESCRIPTION_MAX} characters`)
    if (typeof request.requestId !== 'string' || !request.requestId) throw new Error('An optimize request needs an id')
    const modelId = this.deps.modelFor(request.paneId)
    if (!modelId) throw new Error('Select a chat with a model first; its model writes the instructions')
    this.cancel(request.requestId)
    const controller = new AbortController()
    this.pending.set(request.requestId, controller)
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, this.deps.timeoutMs ?? OPTIMIZE_TIMEOUT_MS)
    try {
      let reply: string
      try {
        reply = await (this.deps.request ?? ephemeralModelRequest)({
          modelId, instructions: optimizerInstructions(), prompt: optimizerPrompt({ ...request, description }),
          effort: 'high', label: 'Optimizing the instructions', maxOutputChars: OPTIMIZE_OUTPUT_CHARS
        }, controller.signal)
        controller.signal.throwIfAborted()
      } catch (error) {
        if (timedOut) throw new Error(`The model did not answer within ${Math.round((this.deps.timeoutMs ?? OPTIMIZE_TIMEOUT_MS) / 60_000)} minutes. Your description is unchanged; try again.`)
        if (controller.signal.aborted) throw new Error(AGENT_OPTIMIZE_CANCELLED)
        // The provider's own failure text is not recorded, so say what usually causes it.
        throw new Error(`${error instanceof Error ? error.message : String(error)}. Check that this chat's provider is signed in; nothing was changed.`)
      }
      return { ...parseOptimizerReply(reply), modelId }
    } finally {
      clearTimeout(timer)
      if (this.pending.get(request.requestId) === controller) this.pending.delete(request.requestId)
    }
  }

  /** Abandon a request in flight; its promise rejects as cancelled. Unknown ids are ignored. */
  cancel(requestId: string): void {
    this.pending.get(requestId)?.abort()
    this.pending.delete(requestId)
  }

  /** Abandon everything, for app shutdown. */
  cancelAll(): void {
    for (const controller of this.pending.values()) controller.abort()
    this.pending.clear()
  }
}
