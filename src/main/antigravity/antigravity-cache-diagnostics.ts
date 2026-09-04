/** Minimum input tokens before implicit caching can engage (Gemini 3.x conservative bound). */
export const ANTIGRAVITY_IMPLICIT_CACHE_MIN_TOKENS = 4096

export type AntigravityCacheReport = {
  eligible: boolean
  anomaly: boolean
  hitPercent: number | null
}

/** Classifies one turn's reported usage; a measured zero cache read on a large prompt is flagged. */
export function classifyAntigravityCache(input: {
  inputTokens: number
  cacheReadTokens?: number | undefined
}): AntigravityCacheReport {
  const { inputTokens, cacheReadTokens } = input
  const usable = Number.isFinite(inputTokens) && inputTokens > 0
  const eligible = usable && inputTokens >= ANTIGRAVITY_IMPLICIT_CACHE_MIN_TOKENS
  const measured =
    typeof cacheReadTokens === 'number' && Number.isFinite(cacheReadTokens) && cacheReadTokens >= 0
  return {
    eligible,
    anomaly: eligible && measured && cacheReadTokens === 0,
    hitPercent: usable && measured ? Math.round((cacheReadTokens / inputTokens) * 1000) / 10 : null
  }
}
