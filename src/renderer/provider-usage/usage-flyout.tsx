import { memo, useEffect, useState, type JSX } from 'react'
import { RefreshCw } from '../icons/index.js'
import { Button } from '../../components/ui/button.js'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.js'
import { Progress } from '../../components/ui/progress.js'
import { ProviderMark } from '../../components/ui/provider-mark.js'
import { Skeleton } from '../../components/ui/skeleton.js'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip.js'
import { cn } from '../../lib/utils.js'
import type { ChatPlanUsage, ChatPlanUsageWindow, ChatProvider } from '../../shared/chat.js'
import { CHAT_PROVIDERS, CHAT_PROVIDER_LABELS } from '../../shared/chat-providers.js'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import { ageNote } from '../context-meter.js'
import {
  roughSpan, spanNote, tightestUsage, usageHeadline, usagePace, usageVerdict, usageWindowState,
  type ProviderUsageEntry, type UsageLevel
} from './provider-usage-model.js'
import { useProviderUsage } from './use-provider-usage.js'

// styles.css gives every button `font: inherit`, so a button here takes its text size from the
// element that holds it, not from its own size variant.

/** Level ink goes on the figure and its bar only, never on the provider mark. */
const LEVEL_INK: Record<UsageLevel, string> = {
  normal: 'text-foreground',
  low: 'text-(--usage-low-ink)',
  critical: 'text-(--usage-critical-ink)',
  exhausted: 'text-(--usage-critical-ink)',
  stale: 'text-muted-foreground',
  unknown: 'text-muted-foreground'
}

const LEVEL_BAR: Record<UsageLevel, string> = {
  // A healthy bar stays quiet so the eye lands on the one that is not.
  normal: '[&>[data-slot=progress-indicator]]:bg-foreground/45',
  low: '[&>[data-slot=progress-indicator]]:bg-(--usage-low-ink)',
  critical: '[&>[data-slot=progress-indicator]]:bg-(--usage-critical-ink)',
  exhausted: '[&>[data-slot=progress-indicator]]:bg-(--usage-critical-ink)',
  stale: '[&>[data-slot=progress-indicator]]:bg-muted-foreground/50',
  unknown: '[&>[data-slot=progress-indicator]]:bg-muted-foreground/50'
}

/** One mark per provider beside the app icons in the dock. */
function UsageDome({ provider, remaining }: {
  provider: ChatProvider; level: UsageLevel; remaining: number | null
}): JSX.Element {
  return <ProviderMark provider={provider} className={cn('size-8 shrink-0', remaining === null && 'opacity-40')} data-provider={provider} />
}

/** One figure per provider; each carries that provider's tightest window across its signed-in accounts. */
function providerDomes(entries: readonly ProviderUsageEntry[], now: number): {
  provider: ChatProvider; level: UsageLevel; remaining: number | null
}[] {
  return CHAT_PROVIDERS.map((provider) => {
    let best: { level: UsageLevel; remaining: number } | null = null
    for (const entry of entries) {
      if (entry.provider !== provider) continue
      const { level, remaining } = usageHeadline(entry.usage, now)
      if (remaining === null) continue
      if (!best || remaining < best.remaining) best = { level, remaining }
    }
    return { provider, level: best?.level ?? 'unknown', remaining: best?.remaining ?? null }
  })
}

/** One line per window: name, bar, percent left, time to reset. Every row in every plan shares it. */
const ROW = 'grid grid-cols-[9.25rem_minmax(0,1fr)_2.5rem_4.5rem] items-center gap-x-2.5'

export type UsageFlyoutProps = {
  chats: readonly ChatRowSummary[]
  onOpenChange?: (open: boolean) => void
}

/**
 * The dock's subscription flyout. The trigger carries the one figure worth a glance, the tightest
 * window across every plan. The panel floats above the control cluster and lists every plan's windows in
 * one table: nothing in it selects, expands or collapses, so it keeps its size while open.
 */
/** Keep the reload glyph turning long enough to read, even when a cached answer returns instantly. */
const REFRESH_SPIN_MS = 520

export const UsageFlyout = memo(function UsageFlyout({ chats, onOpenChange }: UsageFlyoutProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [refreshAllActive, setRefreshAllActive] = useState(false)
  const [spinUntil, setSpinUntil] = useState(0)
  const { entries, now, reading, refresh } = useProviderUsage(chats, open)
  const tightest = tightestUsage(entries, now)
  const tightestName = tightest ? `${CHAT_PROVIDER_LABELS[tightest.entry.provider]} ${tightest.window.label}` : null
  const domes = providerDomes(entries, now)
  const refreshSpinning = refreshAllActive && (reading.size > 0 || now < spinUntil)
  useEffect(() => {
    if (!refreshAllActive || reading.size > 0 || now < spinUntil) return
    setRefreshAllActive(false)
  }, [refreshAllActive, reading, spinUntil, now])
  useEffect(() => {
    if (spinUntil <= now) return
    const timer = window.setTimeout(() => setSpinUntil(0), spinUntil - now + 16)
    return () => window.clearTimeout(timer)
  }, [spinUntil, now])
  function changeOpen(next: boolean): void {
    setOpen(next)
    onOpenChange?.(next)
  }
  function refreshAll(): void {
    setRefreshAllActive(true)
    setSpinUntil(Date.now() + REFRESH_SPIN_MS)
    refresh(undefined, true)
  }
  return <Popover open={open} onOpenChange={changeOpen}>
    <Tooltip>
      <TooltipTrigger asChild>
        <PopoverTrigger asChild>
          <button type="button" data-ui="dock.usage"
            className="dock-bar-link dock-bar-usage"
            aria-label={tightest ? `Subscription usage. Tightest: ${tightestName}, ${tightest.remaining}% left` : 'Subscription usage'}>
            {domes.map((dome) => <UsageDome key={dome.provider} {...dome} />)}
          </button>
        </PopoverTrigger>
      </TooltipTrigger>
      {!open && <TooltipContent side="top" className="flex flex-col gap-0.5">
        <span className="font-medium">Subscription usage</span>
        {domes.map((dome) => <span key={dome.provider} className="text-muted-foreground">
          {CHAT_PROVIDER_LABELS[dome.provider]} · {dome.remaining === null ? 'no reading' : `${dome.remaining}% left`}
        </span>)}
      </TooltipContent>}
    </Tooltip>
    {/* The dock does not take focus back on close: the trigger's tooltip would reopen over the page. */}
    <PopoverContent side="top" align="end" sideOffset={12} collisionPadding={8} aria-label="Subscription usage"
      className="dock-panel dock-flyout flex max-h-(--radix-popover-content-available-height) w-[min(410px,calc(100vw-16px))] flex-col overflow-y-auto p-0 text-xs"
      onCloseAutoFocus={(event) => event.preventDefault()}>
      <header className="flex items-start justify-between gap-3 px-3.5 pt-3 pb-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-sm font-semibold">Subscription usage</h2>
          <p className="text-muted-foreground">{usageVerdict(tightest, tightest ? CHAT_PROVIDER_LABELS[tightest.entry.provider] : '', now)}</p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" data-ui="dock.usage-refresh" aria-label="Read every plan again"
          aria-busy={refreshSpinning}
          className="-mt-1 -mr-1.5 shrink-0 cursor-pointer" disabled={refreshSpinning} onClick={refreshAll}>
          <RefreshCw aria-hidden="true" className={refreshSpinning ? 'animate-spin motion-reduce:animate-none' : undefined} />
        </Button>
      </header>
      <div className={cn(ROW, 'px-3.5 pb-1.5 text-[11px] text-muted-foreground')} aria-hidden="true">
        <span /><span /><span className="text-right">Left</span><span className="text-right">Resets in</span>
      </div>
      {entries.map((entry) => <PlanSection key={entry.key} entry={entry} now={now}
        reading={reading.has(entry.provider)} onRetry={() => refresh(entry.provider, true)} />)}
    </PopoverContent>
  </Popover>
})

function PlanSection({ entry, now, reading, onRetry }: {
  entry: ProviderUsageEntry
  now: number
  reading: boolean
  onRetry: () => void
}): JSX.Element {
  const { usage } = entry
  const identity = [usage?.plan ?? entry.account?.planType, entry.account?.email].filter(Boolean).join(' · ')
  return <section className="flex flex-col gap-1 border-t border-border px-3.5 pt-2.5 pb-3" data-provider={entry.provider}>
    <div className="flex items-center gap-2 pb-0.5">
      <ProviderMark provider={entry.provider} className="size-3.5 shrink-0" />
      <h3 className="shrink-0 text-[13px] font-medium">{CHAT_PROVIDER_LABELS[entry.provider]}</h3>
      {identity && <span className="ml-auto min-w-0 truncate text-[11px] text-muted-foreground" title={identity}>{identity}</span>}
    </div>
    {usage?.windows.length && !usage.unavailable
      ? usage.windows.map((window, index) => <WindowRow key={`${window.label}-${index}`} window={window} usage={usage} now={now} />)
      : !usage && reading
        ? <div className={cn(ROW, 'h-6')} aria-label="Reading the plan">
          <Skeleton className="h-3 w-24" /><Skeleton className="h-1 w-full" /><span /><span />
        </div>
        : <div className="flex items-center justify-between gap-3">
          <p className="line-clamp-2 break-words text-muted-foreground">
            {usage?.unavailable ?? (usage ? 'This plan reports no quota windows.' : 'No reading yet.')}
          </p>
          <Button variant="secondary" size="xs" data-ui="dock.usage-retry" data-ui-key={entry.key} className="shrink-0"
            disabled={reading} onClick={onRetry}>Try again</Button>
        </div>}
    {usage?.note && <p className="pt-0.5 text-[11px] text-muted-foreground">{usage.note}</p>}
  </section>
}

function WindowRow({ window, usage, now }: { window: ChatPlanUsageWindow; usage: ChatPlanUsage; now: number }): JSX.Element {
  const state = usageWindowState(window, usage, now)
  const pace = usagePace(window, usage, now)
  const { resetsAt } = window
  const stale = state.level === 'stale'
  const reset = resetsAt === null ? '' : resetsAt <= now ? 'passed' : spanNote(resetsAt - now)
  const detail = [
    resetsAt !== null && resetsAt > now ? `Resets ${resetClock(resetsAt, now)}` : null,
    stale ? state.observedAt > 0 ? `Last read ${ageNote(now - state.observedAt)}` : 'Never read' : null
  ].filter(Boolean).join(' · ')
  return <>
    <div className={cn(ROW, 'h-6')} data-level={state.level} title={detail || undefined}>
      <span className="truncate">{window.label}</span>
      <Progress value={state.remaining ?? 0} aria-label={`${window.label} remaining`} className={cn('h-1', LEVEL_BAR[state.level])} />
      <span className={cn('text-right font-medium tabular-nums', LEVEL_INK[state.level])}>
        {state.remaining === null ? '–' : `${state.remaining}%`}
      </span>
      <span className="truncate text-right text-muted-foreground tabular-nums">{stale && reset !== 'passed' ? 'stale' : reset}</span>
    </div>
    {pace && <p className="pb-0.5 text-[11px] text-(--usage-low-ink)">
      At this pace it is empty in {spanNote(pace.runsOutAt - now)}, {roughSpan(pace.shortBy)} before the reset.
    </p>}
  </>
}

function resetClock(resetsAt: number, now: number): string {
  const reset = new Date(resetsAt)
  if (reset.toDateString() === new Date(now).toDateString()) return `at ${reset.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
  if (resetsAt - now < 6 * 24 * 3_600_000) return reset.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  return reset.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
