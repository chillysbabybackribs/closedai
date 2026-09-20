import type { JSX } from 'react'

import {
  formatPercent,
  formatTokens,
  type ContextPressureAdvisory,
  type TokenBudgetBreakdown
} from './context-budget.js'

export function ContextPressureBadge({ budget }: { budget: TokenBudgetBreakdown }): JSX.Element {
  const hasWindow = budget.contextWindow !== null && budget.contextWindow > 0
  const label =
    budget.pressureLevel === 'hot'
      ? 'Hot'
      : budget.pressureLevel === 'warm'
        ? 'Warm'
        : budget.pressureLevel === 'cool'
          ? 'Cool'
          : 'Provider managed'

  return (
    <span
      className={`context-pressure-badge context-pressure-${budget.pressureLevel}`}
      title={`Context pressure: ${budget.pressureLevel}`}
    >
      <span className="pressure-badge-dot" aria-hidden="true" />
      {label}
      {hasWindow ? ` · ${budget.usedPercent}%` : ''}
    </span>
  )
}

export function ContextAdvisoryBanner({
  advisory,
  onCompact,
  compactEnabled,
  onNewChat
}: {
  advisory: ContextPressureAdvisory
  onCompact?: () => void | Promise<void>
  compactEnabled?: boolean
  onNewChat?: () => void
}): JSX.Element {
  return (
    <aside className={`context-advisory context-advisory-${advisory.level}`} data-level={advisory.level}>
      <div className="context-advisory-header">
        <span className="context-advisory-icon" aria-hidden="true">
          {advisory.level === 'hot' ? '⚠' : 'ℹ'}
        </span>
        <h4 className="context-advisory-title">{advisory.title}</h4>
      </div>
      <p className="context-advisory-desc">{advisory.description}</p>
      <div className="context-advisory-actions">
        {onCompact && (
          <button
            type="button"
            className="context-advisory-btn context-advisory-btn-compact"
            data-ui="context.compact"
            disabled={!compactEnabled}
            onClick={() => { void onCompact() }}
          >
            Compact conversation
          </button>
        )}
        {onNewChat && (
          <button
            type="button"
            className="context-advisory-btn context-advisory-btn-new-chat"
            data-ui="context.new-chat"
            onClick={onNewChat}
          >
            Start fresh chat
          </button>
        )}
      </div>
    </aside>
  )
}

export function ContextBudgetSection({ budget }: { budget: TokenBudgetBreakdown }): JSX.Element {
  const hasWindow = budget.contextWindow !== null && budget.contextWindow > 0

  return (
    <section className="context-budget-section" aria-label="Token budget breakdown">
      <div className="context-budget-header">
        <h3 className="context-budget-title">Token budget & distribution</h3>
        <span className="context-budget-meta">
          {hasWindow
            ? `${formatTokens(budget.usedTokens)} of ${formatTokens(budget.totalCapacityTokens)} tokens (${budget.usedPercent}%)`
            : `${formatTokens(budget.usedTokens)} turn tokens · Provider managed`}
        </span>
      </div>

      <div
        className="context-budget-track"
        role="progressbar"
        aria-valuenow={hasWindow ? budget.usedPercent : undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Context window usage bar"
      >
        {budget.segments.map((segment) => {
          if (segment.percent <= 0 && segment.tokens <= 0) return null
          return (
            <div
              key={segment.id}
              className={`context-budget-fill ${segment.colorClass}`}
              style={{ width: `${segment.percent}%` }}
              title={`${segment.label}: ${formatTokens(segment.tokens)} tokens (${formatPercent(segment.percent)}) - ${segment.description}`}
            />
          )
        })}
      </div>

      <div className="context-budget-legend">
        {budget.segments.map((segment) => (
          <div key={segment.id} className="context-budget-legend-item" title={segment.description}>
            <span className={`legend-dot ${segment.colorClass}`} aria-hidden="true" />
            <span className="legend-label">{segment.label}</span>
            <strong className="legend-value">
              {formatTokens(segment.tokens)}
              {hasWindow && <small>({formatPercent(segment.percent)})</small>}
            </strong>
          </div>
        ))}
      </div>
    </section>
  )
}
