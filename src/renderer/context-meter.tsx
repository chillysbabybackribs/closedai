import type { JSX } from 'react'

import type { ChatContextUsage } from '../shared/chat.js'

/** Latency stays flat with context (prompt cache), so the colour tracks how much old history the
 * model is wading through; past these, quality drifts and a fresh chat is worth considering. */
const WARM_PERCENT = 50
const HOT_PERCENT = 75

const RADIUS = 5.25
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** How full the model's window is, drawn as a ring beside the model that owns that window.
 *  Silent until the first response reports usage, and self-explaining once it is warm: the
 *  ring carries the proportion, the label the number, the tooltip the raw token counts. */
export function ContextMeter({ usage, onInspect }: { usage: ChatContextUsage | null; onInspect: () => void }): JSX.Element {
  const percent = Math.min(100, Math.max(0, usage?.percent ?? 0))
  const level = percent >= HOT_PERCENT ? 'hot' : percent >= WARM_PERCENT ? 'warm' : 'cool'
  const detail = usage
    ? `Inspect context — ${percent}% full, ${formatTokens(usage.usedTokens)} of ${formatTokens(usage.contextWindow)} tokens`
    : 'Inspect context for the latest turn'
  return (
    <button type="button" className="context-meter" data-ui="composer.context" data-level={level} title={detail} aria-label={detail} onClick={onInspect}>
      <svg className="context-meter-ring" viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
        <circle className="context-meter-track" cx="7" cy="7" r={RADIUS} />
        <circle
          className="context-meter-fill"
          cx="7"
          cy="7"
          r={RADIUS}
          strokeDasharray={`${(CIRCUMFERENCE * percent) / 100} ${CIRCUMFERENCE}`}
        />
      </svg>
      <span className="context-meter-value">{usage ? `${percent}%` : 'Context'}</span>
      {usage && <span className="context-meter-detail">{formatTokens(usage.usedTokens)}/{formatTokens(usage.contextWindow)}</span>}
    </button>
  )
}

function formatTokens(tokens: number): string {
  return tokens >= 1_000 ? `${(tokens / 1_000).toFixed(tokens >= 100_000 ? 0 : 1)}k` : String(tokens)
}
