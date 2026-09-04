/** One-shot repair when the CLI reports SUCCESS after tool work but omits final assistant text. */
export const ANTIGRAVITY_EMPTY_SUCCESS_RECOVERY_PROMPT =
  'Your previous turn ended without an assistant response. Continue the same task and provide the complete final answer now. Reuse the work already completed; call more tools only if they are necessary to finish correctly.'
