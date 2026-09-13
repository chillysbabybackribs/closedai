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
}

export const MAX_SESSION_ROTATIONS = 32
