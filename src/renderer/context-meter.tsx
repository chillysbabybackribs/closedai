import type { JSX } from 'react'
import { useEffect, useState } from 'react'

import { HoverCard, HoverCardContent, HoverCardTrigger } from '../components/ui/hover-card.js'
import type { ChatContextUsage, ChatPlanUsage, ChatProvider } from '../shared/chat.js'
import { CHAT_PROVIDER_LABELS } from '../shared/chat-providers.js'

/** Latency stays flat with context (prompt cache), so the colour tracks how much old history the
 * model is wading through; past these, quality drifts and a fresh chat is worth considering. */
const WARM_PERCENT = 50
const HOT_PERCENT = 75

const RADIUS = 5.25
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** Past this a reading is worth dating, so a parked provider's numbers are not read as live. */
const STALE_MS = 5 * 60 * 1000

export type ContextMeterProps = {
  usage: ChatContextUsage | null
  provider: ChatProvider
  /** The account's plan windows, cached between readings; null until one lands. */
  planUsage: ChatPlanUsage | null
  onInspect: () => void
  /** Asked for a fresh reading each time the card opens, including mid-turn. */
  onRefreshPlanUsage: () => Promise<void>
}

/** How full the model's window is, drawn as a ring beside the model that owns that window.
 *  Silent until the first response reports usage, and self-explaining once it is warm: the
 *  ring carries the proportion, the label the number, and the card the token counts plus the
 *  subscription windows the turn is spending — the one place both meters belong together. */
export function ContextMeter({ usage, provider, planUsage, onInspect, onRefreshPlanUsage }: ContextMeterProps): JSX.Element {
  const percent = Math.min(100, Math.max(0, usage?.percent ?? 0))
  const level = percent >= HOT_PERCENT ? 'hot' : percent >= WARM_PERCENT ? 'warm' : 'cool'
  const detail = usage
    ? `Context — ${percent}% full, ${formatTokens(usage.usedTokens)} of ${formatTokens(usage.contextWindow)} tokens`
    : 'Context and plan usage'
  return (
    <HoverCard openDelay={120} closeDelay={80} onOpenChange={(open) => { if (open) void onRefreshPlanUsage() }}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="context-meter"
          data-ui="composer.context"
          data-level={level}
          aria-label={detail}
          onClick={onInspect}
        >
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
        </button>
      </HoverCardTrigger>
      <HoverCardContent className="usage-card" align="end" side="top" data-ui="composer.usage-card">
        <section className="usage-card-section">
          <h3 className="usage-card-heading">Context window</h3>
          {usage ? (
            <UsageBar label={`${percent}% full`} percent={percent} aside={`${formatTokens(usage.usedTokens)}/${formatTokens(usage.contextWindow)}`} />
          ) : (
            <p className="usage-card-empty">Nothing yet — the first response reports it.</p>
          )}
        </section>
        <PlanSection provider={provider} planUsage={planUsage} />
        <p className="usage-card-footnote">Click the meter to inspect what this turn sent.</p>
      </HoverCardContent>
    </HoverCard>
  )
}

function PlanSection({ provider, planUsage }: { provider: ChatProvider; planUsage: ChatPlanUsage | null }): JSX.Element {
  const now = useNow(planUsage !== null)
  const heading = `${CHAT_PROVIDER_LABELS[provider]} plan${planUsage?.plan ? ` · ${planUsage.plan}` : ''}`
  return (
    <section className="usage-card-section">
      <h3 className="usage-card-heading">{heading}</h3>
      {planUsage?.windows.length ? (
        planUsage.windows.map((window) => (
          <UsageBar
            key={window.label}
            label={window.label}
            percent={window.percent}
            aside={`${window.percent}%${window.resetsAt ? ` · ${resetNote(window.resetsAt, now)}` : ''}`}
          />
        ))
      ) : (
        <p className="usage-card-empty">{planUsage?.unavailable ?? 'Reading usage…'}</p>
      )}
      {planUsage?.note && <p className="usage-card-note">{planUsage.note}</p>}
      {planUsage && planUsage.updatedAt > 0 && now - planUsage.updatedAt > STALE_MS && (
        <p className="usage-card-note">Last read {ageNote(now - planUsage.updatedAt)}.</p>
      )}
    </section>
  )
}

function UsageBar({ label, percent, aside }: { label: string; percent: number; aside: string }): JSX.Element {
  const level = percent >= HOT_PERCENT ? 'hot' : percent >= WARM_PERCENT ? 'warm' : 'cool'
  return (
    <div className="usage-bar" data-level={level}>
      <div className="usage-bar-line">
        <span className="usage-bar-label">{label}</span>
        <span className="usage-bar-aside">{aside}</span>
      </div>
      <div className="usage-bar-track" role="presentation">
        <div className="usage-bar-fill" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </div>
    </div>
  )
}

/** A minute-resolution clock, running only while the card is showing a reading to date. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

function formatTokens(tokens: number): string {
  return tokens >= 1_000 ? `${(tokens / 1_000).toFixed(tokens >= 100_000 ? 0 : 1)}k` : String(tokens)
}

/** When the window rolls over, phrased as the wait rather than a timestamp to decode. */
export function resetNote(resetsAt: number, now: number): string {
  const minutes = Math.round((resetsAt - now) / 60_000)
  if (minutes <= 0) return 'resetting'
  if (minutes < 60) return `resets in ${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 ? `resets in ${hours}h ${minutes % 60}m` : `resets in ${hours}h`
  const days = Math.floor(hours / 24)
  return hours % 24 ? `resets in ${days}d ${hours % 24}h` : `resets in ${days}d`
}

/** How old a reading is, for the line that admits it is not live. */
export function ageNote(ageMs: number): string {
  const minutes = Math.round(ageMs / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`
}
