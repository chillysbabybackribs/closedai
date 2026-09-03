import type { JSX } from 'react'

import type { TracePerformance } from './trace-performance.js'
import { duration } from './trace-row.js'

export function TracePerformanceSummary({ value }: { value: TracePerformance }): JSX.Element | null {
  const metrics: Array<{ label: string; value: string; title?: string }> = []
  if (value.response) {
    metrics.push(
      { label: 'First text', value: duration(value.response.firstTextMs), title: 'Send received in main → first non-empty assistant text, including commentary. Excludes renderer paint; not provider-only TTFT.' },
      { label: 'Preparation', value: duration(value.response.preparationMs), title: 'Before provider dispatch, including pane wake-up and any compaction wait' },
      { label: 'Compaction wait', value: duration(value.response.compactionWaitMs), title: 'Measured Codex send wait; a subset of preparation, not additional time. Provider-internal compaction is not separately measured.' },
      { label: 'After dispatch', value: duration(value.response.afterDispatchMs), title: 'Provider dispatch → first assistant text; can include queueing, input processing, reasoning, and tools' }
    )
  }
  if (value.modelPasses > 0) metrics.push({ label: 'Model passes', value: String(value.modelPasses) })
  if (value.tokens) {
    const cachePercent = value.tokens.input > 0 ? (value.tokens.cachedInput / value.tokens.input) * 100 : 0
    metrics.push(
      { label: 'Input', value: compactNumber(value.tokens.input), title: `${value.tokens.input.toLocaleString()} tokens` },
      { label: 'Cache hit', value: `${cachePercent.toFixed(1)}%`, title: `${value.tokens.cachedInput.toLocaleString()} cached input tokens` },
      { label: 'Uncached', value: compactNumber(value.tokens.uncachedInput), title: `${value.tokens.uncachedInput.toLocaleString()} tokens` },
      { label: 'Output', value: compactNumber(value.tokens.output), title: `${value.tokens.output.toLocaleString()} tokens` },
      { label: 'Reasoning', value: compactNumber(value.tokens.reasoning), title: `${value.tokens.reasoning.toLocaleString()} tokens` }
    )
  }
  if (value.toolCalls > 0) {
    metrics.push({
      label: 'Tools',
      value: `${value.toolCalls} / ${duration(value.toolDurationMs)}`,
      title: `${value.toolCalls} calls taking ${duration(value.toolDurationMs)} total${value.toolFailures > 0 ? `; ${value.toolFailures} failed` : ''}`
    })
  }
  if (value.nonToolDurationMs !== null) {
    metrics.push({
      label: 'Model + orchestration',
      value: duration(value.nonToolDurationMs),
      title: 'Turn wall time minus traced tool execution time'
    })
  }
  if (value.lastContext) {
    metrics.push({
      label: 'Last context',
      value: `${compactNumber(value.lastContext.used)} / ${compactNumber(value.lastContext.window)} (${value.lastContext.percent}%)`,
      title: `${value.lastContext.used.toLocaleString()} of ${value.lastContext.window.toLocaleString()} tokens`
    })
  }
  if (metrics.length === 0) return null

  return (
    <div className="trace-performance" aria-label="Performance summary">
      {metrics.map((metric) => (
        <span className="trace-performance-metric" key={metric.label} title={metric.title}>
          <span className="trace-performance-label">{metric.label}</span>
          <strong>{metric.value}</strong>
        </span>
      ))}
    </div>
  )
}

export function compactNumber(value: number): string {
  if (value < 1_000) return Math.round(value).toLocaleString()
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`
  return `${(value / 1_000_000).toFixed(1)}m`
}
