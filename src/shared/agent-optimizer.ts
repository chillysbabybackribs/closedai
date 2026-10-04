// The agent builder's Optimize action: the user's description goes to a model, and standing
// instructions come back with a suggested name, suggested limits, and the assumptions the model
// made where the description was silent. The result has no autonomy or access field on purpose:
// those settings are the user's, and nothing the optimizer returns can change them.

export type AgentOptimizeRequest = {
  /** Chosen by the renderer, so it can cancel the request it started. */
  requestId: string
  /** What the user wants the agent to do, in their own words. */
  description: string
  /** The chat the Agents dialog was opened from; its model writes the instructions. */
  paneId: string
  /** The name already in the editor; empty asks for a suggestion. */
  name: string
  /** The limits and autonomy chosen in the editor: context for the instructions, never changed by them. */
  maxCycles: number | null
  maxMinutes: number | null
  autonomous: boolean
}

export type AgentOptimizeResult = {
  /** A short suggested name; empty when the model gave none. */
  name: string
  /** The standing instructions, ready to review. */
  prompt: string
  /** Suggested limits; null suggests running without that limit. */
  maxCycles: number | null
  maxMinutes: number | null
  /** Choices the model made where the description was silent, one sentence each. */
  assumptions: string[]
  /** The model that wrote the instructions. */
  modelId: string
}

/** The description must say something before a model is asked to expand it. */
export const AGENT_OPTIMIZE_MIN_DESCRIPTION_CHARS = 12
/** Why a cancelled request rejects; the renderer treats it as a cancel, not a failure. */
export const AGENT_OPTIMIZE_CANCELLED = 'Optimizing was cancelled'
