/** Internal turn on a freshly spawned `agy` process so eager MCP declarations load before the user prompt. */
export const ANTIGRAVITY_MCP_PRIMER_PROMPT =
  'Internal ClosedAI runtime initialization. Reply with exactly READY. Do not call any tools.'

/** One-shot repair when the CLI reports SUCCESS after tool work but omits final assistant text. */
export const ANTIGRAVITY_EMPTY_SUCCESS_RECOVERY_PROMPT =
  'Your previous turn ended without an assistant response. Continue the same task and provide the complete final answer now. Reuse the work already completed; call more tools only if they are necessary to finish correctly.'
