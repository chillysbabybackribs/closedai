/**
 * Why a provider session rotated: an idle trigger (context percent, token budget, transcript
 * items), an explicit compact request, or a Codex tool-catalog change that needs a new thread.
 */
export type ChatSessionRotationReason = 'percent' | 'tokens' | 'items' | 'manual' | 'toolCatalog'

export const SESSION_ROTATION_REASONS: readonly ChatSessionRotationReason[] = ['percent', 'tokens', 'items', 'manual', 'toolCatalog']

/** One invisible provider-session rotation recorded on the chat. */
export type ChatSessionRotation = {
  /** Monotonic count within this chat; starts at 1. */
  epoch: number
  /** Transcript item id frozen for recall at rotation time. */
  sourceThroughItemId: string | null
  /** Provider thread id replaced by the rotation. */
  providerThreadId: string | null
  /** Unix milliseconds when the rotation completed. */
  at: number
  /** Absent on rotations recorded before reasons were saved. */
  reason?: ChatSessionRotationReason
}

export const MAX_SESSION_ROTATIONS = 32
