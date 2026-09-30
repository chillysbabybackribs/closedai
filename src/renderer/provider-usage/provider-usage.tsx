import { memo, Fragment, useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { CircleAlert, Clock3, Gauge, RefreshCw } from 'lucide-react'
import { Badge } from '../../components/ui/badge.js'
import { Button } from '../../components/ui/button.js'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.js'
import { ProviderMark } from '../../components/ui/provider-mark.js'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip.js'
import type { ChatProvider, ProviderUsageSnapshot } from '../../shared/chat.js'
import { CHAT_PROVIDERS, CHAT_PROVIDER_LABELS } from '../../shared/chat-providers.js'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import { ageNote, resetNote } from '../context-meter.js'
import { errorMessage } from '../error-message.js'
import { providerUsageEntries, usageChipDisplay, usageWindowState, type ProviderUsageEntry, type UsageChipDisplay } from './provider-usage-model.js'

const WARNING_LEVELS = ['low', 'critical', 'exhausted']

/** Title-bar subscription usage between the File dropdown and chat search: one chip per provider/account,
 * collapsing to a single Usage trigger when the gap is too narrow. */
export const ProviderUsage = memo(function ProviderUsage({ chats }: { chats: readonly ChatRowSummary[] }): JSX.Element | null {
  const [open, onOpenChange] = useState(false)
  const [readings, setReadings] = useState<ProviderUsageSnapshot[]>([])
  const entries = providerUsageEntries(chats, readings)
  const refreshProvider = useCallback(async (provider: ChatProvider): Promise<void> => {
    const reading = await window.closedai.chat.readProviderUsage(provider)
    setReadings((prior) => [...prior.filter((item) => item.provider !== provider), reading])
  }, [])
  const [selected, setSelected] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now)
  const [width, setWidth] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const lastTrigger = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    // Startup reads are independent of chat connection state.
    void Promise.allSettled(CHAT_PROVIDERS.map(refreshProvider))
    const refresh = (): void => {
      if (!document.hidden) void Promise.allSettled(CHAT_PROVIDERS.map(refreshProvider))
    }
    const timer = window.setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [refreshProvider])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const hasEntries = entries.length > 0
  useEffect(() => {
    if (!root.current) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(root.current)
    return () => observer.disconnect()
  }, [hasEntries])
  if (!hasEntries) return null
  const chip = (item: ProviderUsageEntry): UsageChipDisplay =>
    usageChipDisplay(item.usage, item.usage?.plan ?? item.account?.planType ?? null, now, CHAT_PROVIDER_LABELS[item.provider])
  // Button padding, mark, gap and figure, plus room for the dividers between entries.
  const chipWidth = (display: UsageChipDisplay): number => 34 + (display.remaining === null ? 0 : display.text.length * 6.5)
  const displays = entries.map(chip)
  const compact = width < displays.reduce((total, display) => total + chipWidth(display), 0) + Math.max(0, displays.length - 1) * 9
  const entry = entries.find((item) => item.key === selected) ?? entries[0]
  // The collapsed trigger carries the worst numeric reading so the title bar still says something at a glance.
  const worst = displays.filter((display) => display.remaining !== null)
    .reduce<UsageChipDisplay | null>((lowest, next) => !lowest || (next.remaining ?? 100) < (lowest.remaining ?? 100) ? next : lowest, null)
  const warning = displays.some((display) => WARNING_LEVELS.includes(display.level))
  const trigger = (item: ProviderUsageEntry, display: UsageChipDisplay): JSX.Element => <Tooltip key={item.key}>
    <TooltipTrigger asChild><Button variant="ghost" size="xs" className="provider-usage-chip" data-ui="titlebar.provider-usage"
      data-ui-item={item.key} data-level={display.level} aria-label={display.ariaLabel} aria-expanded={open && entry.key === item.key}
      onClick={(event) => { lastTrigger.current = event.currentTarget; setSelected(item.key); onOpenChange(!(open && entry.key === item.key)) }}>
      <ProviderMark provider={item.provider} />
      {display.remaining !== null && <span className="provider-usage-chip-value">{display.text}</span>}
    </Button></TooltipTrigger>
    {!open && <TooltipContent side="bottom">{display.ariaLabel}</TooltipContent>}
  </Tooltip>
  return <div ref={root} className="provider-usage">
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" className={`provider-usage-chip${compact ? '' : ' provider-usage-anchor'}`}
          data-ui="titlebar.provider-usage-all" aria-label="Provider subscription usage" tabIndex={compact ? 0 : -1}
          aria-hidden={compact ? undefined : true} onClick={(event) => { lastTrigger.current = event.currentTarget }}>
          <Gauge aria-hidden="true" /><span>Usage</span>
          {worst && <Badge variant="secondary" className="provider-usage-worst" data-level={worst.level}>
            {warning && <CircleAlert aria-hidden="true" />}{worst.text}
          </Badge>}
        </Button>
      </PopoverTrigger>
      {!compact && entries.map((item, index) => <Fragment key={item.key}>
        {index > 0 && <span className="provider-usage-divider" aria-hidden="true" />}
        {trigger(item, displays[index])}
      </Fragment>)}
      <PopoverContent side="bottom" align="center" sideOffset={8} collisionPadding={12}
        className="dock-panel provider-usage-panel" aria-label="Provider subscription usage"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          const target = lastTrigger.current?.isConnected ? lastTrigger.current : root.current?.querySelector<HTMLButtonElement>('button')
          target?.focus({ preventScroll: true })
        }}>
        <div className="provider-usage-tabs" aria-label="Providers">
          {entries.map((item) => <Button key={item.key} variant="ghost" className="provider-usage-tab"
            data-ui="titlebar.provider-usage-tab" data-ui-item={item.key} aria-pressed={item.key === entry.key}
            onClick={() => setSelected(item.key)}><ProviderMark provider={item.provider} />
            {CHAT_PROVIDER_LABELS[item.provider]}
            {entries.filter((other) => other.provider === item.provider).length > 1 && <span>{item.account?.email ?? 'Unknown account'}</span>}
          </Button>)}
        </div>
        <ProviderUsageDetail key={entry.key} entry={entry} now={now} refreshProvider={refreshProvider} />
      </PopoverContent>
    </Popover>
  </div>
})

function ProviderUsageDetail({ entry, now, refreshProvider }: { entry: ProviderUsageEntry; now: number; refreshProvider: (provider: ChatProvider) => Promise<void> }): JSX.Element {
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { usage, source } = entry
  const telemetry = source?.providerUsage
  async function refresh(): Promise<void> {
    setRefreshing(true)
    setError(null)
    try { await refreshProvider(entry.provider) }
    catch (error) { setError(errorMessage(error, 'Could not refresh usage')) }
    finally { setRefreshing(false) }
  }
  return <section className="provider-usage-detail">
    <header><div><h3>{CHAT_PROVIDER_LABELS[entry.provider]}</h3>
      <p>{usage?.plan ?? entry.account?.planType ?? 'Subscription usage'}</p></div>
      <Button variant="ghost" size="icon-sm" data-ui="titlebar.provider-usage-refresh" disabled={refreshing}
        aria-label="Refresh provider usage" onClick={() => { void refresh() }}>
        <RefreshCw aria-hidden="true" className={refreshing ? 'animate-spin motion-reduce:animate-none' : undefined} />
      </Button></header>
    {entry.account?.email && <p className="provider-usage-account">{entry.account.email}</p>}
    {source && <div className="provider-usage-connection">Session: {telemetry?.connection.state === 'ready' ? 'connected' : telemetry?.connection.state ?? 'unknown'}</div>}
    {usage?.unavailable ? <p className="provider-usage-note">{usage.unavailable}</p> : usage?.windows.length ?
      <dl className="provider-usage-windows">{usage.windows.map((window, index) => {
        const state = usageWindowState(window, usage, now)
        return <div key={`${window.label}-${index}`} data-level={state.level}>
          <dt>{window.label}</dt><dd>{state.remaining === null ? 'Unavailable' : `${state.remaining}% remaining`}
            {state.level === 'stale' && <span className="provider-usage-stale"><Clock3 aria-hidden="true" />Stale</span>}
            {['low', 'critical', 'exhausted'].includes(state.level) && <span className="provider-usage-stale"><CircleAlert aria-hidden="true" />{state.level}</span>}
          </dd>
          <p>{window.resetsAt ? window.resetsAt <= now ? 'Reset passed · awaiting provider reading' :
            `Resets in ${resetNote(window.resetsAt, now)} · ${new Date(window.resetsAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : 'Reset time not reported'}</p>
          <p>{state.observedAt > 0 ? now - state.observedAt < 60_000 ? 'Updated just now' : `Read ${ageNote(Math.max(0, now - state.observedAt))}` : 'Observation time unavailable'}</p>
        </div>
      })}</dl> : <p className="provider-usage-note">No provider reading yet. Refresh to request available usage.</p>}
    {usage?.note && entry.provider !== 'codex' && <p className="provider-usage-note">{usage.note}</p>}
    {error && <p role="status" className="provider-usage-note">{error}</p>}
    <footer>{entry.provider === 'codex'
      ? 'Codex app-server · only primary and secondary rate-limit windows when reported. Credits stay in the composer usage card.'
      : entry.provider === 'cursor'
        ? 'Cursor CLI · plan from about; quota percentages are not exposed on the CLI.'
        : 'Provider-reported · lowest reported window shown in the title bar. Model-specific windows keep their original labels.'}</footer>
  </section>
}
