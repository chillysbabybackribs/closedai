import { useEffect, useState, type JSX } from 'react'
import { Switch } from '../../components/ui/switch.js'
import type { ResponsePerformanceSummary } from '../../shared/performance.js'
import { usePerformanceSettings, updatePerformanceSettings } from '../performance/performance-settings.js'
import { errorMessage } from '../error-message.js'

const time = (value: number | null): string => value === null ? '—' : value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`

export function PerformancePanel({ active }: { active: boolean }): JSX.Element {
  const { settings, loaded, saving, error } = usePerformanceSettings()
  const [summary, setSummary] = useState<ResponsePerformanceSummary | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  useEffect(() => {
    if (!active) return
    let live = true
    let reading = false
    const refresh = async () => {
      if (reading) return
      reading = true
      try {
        const value = await window.closedai.performance.summary()
        if (live) { setSummary(value); setSummaryError(null) }
      } catch (cause) { if (live) setSummaryError(errorMessage(cause)) }
      finally { reading = false }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 3000)
    return () => { live = false; clearInterval(timer) }
  }, [active])
  const disabled = !loaded || saving
  return <div className="settings-panel performance-panel" data-ui="dialog.performance">
    {error || summaryError ? <p role="alert">{error ?? summaryError}</p> : null}
    <div className="performance-setting">
      <div><label id="instant-streaming-label">Instant streaming</label><p>Show text as it arrives, without typewriter pacing.</p></div>
      <Switch data-ui="settings.instant-streaming" aria-labelledby="instant-streaming-label" checked={settings.instantStreaming}
        disabled={disabled} onCheckedChange={(instantStreaming) => { void updatePerformanceSettings({ instantStreaming }) }} />
    </div>
    <div className="performance-setting">
      <div><label htmlFor="provider-warm-minutes">Provider warm-time</label><p>Background chats stay warm this long after a turn. The selected chat gets four times longer. More time uses more memory; applies at the next idle period.</p></div>
      <select id="provider-warm-minutes" data-ui="settings.provider-warm-time" disabled={disabled} value={settings.warmMinutes}
        onChange={(event) => { void updatePerformanceSettings({ warmMinutes: Number(event.target.value) }) }}>
        {[...new Set([1, 5, 10, 15, 30, 60, settings.warmMinutes])].sort((a, b) => a - b).map((minutes) => <option key={minutes} value={minutes}>{minutes} min</option>)}
      </select>
    </div>
    <div className="performance-setting">
      <div><label htmlFor="provider-warm-chats">Warm background chats</label><p>Keep this many idle background chats awake when opening another chat. Active turns are protected. Codex shares a process per workspace.</p></div>
      <select id="provider-warm-chats" data-ui="settings.provider-warm-chats" disabled={disabled} value={settings.warmIdleChats}
        onChange={(event) => { void updatePerformanceSettings({ warmIdleChats: Number(event.target.value) }) }}>
        {Array.from({ length: 9 }, (_, value) => <option key={value} value={value}>{value}</option>)}
      </select>
    </div>
    <div className="performance-setting">
      <div><label id="auto-titles-label">Automatic chat titles</label><p>Generate titles after completed turns, one request at a time. Off keeps the first-message fallback; manual rename and retry still work.</p></div>
      <Switch data-ui="settings.auto-titles" aria-labelledby="auto-titles-label" checked={settings.autoTitles}
        disabled={disabled} onCheckedChange={(autoTitles) => { void updatePerformanceSettings({ autoTitles }) }} />
    </div>
    <section className="performance-results" aria-label="Response timings">
      <h3>Response timings</h3>
      <p>Averages from the latest {summary?.samples ?? 0} responses (up to {summary?.capacity ?? 200}). Reset on app restart or Clear Turn Trace.</p>
      <div className="performance-table-scroll">
        <table><thead><tr><th>Provider / mode</th><th>Turns</th><th>Prepare</th><th>First text</th><th>Total</th><th>Renderer</th></tr></thead>
          <tbody>{summary?.groups.map((row) => <tr key={`${row.provider}:${row.baselineEnabled}`}>
            <th scope="row">{row.provider}<span>{row.provider === 'cursor' ? 'Native Cursor' : row.baselineEnabled ? 'Baseline on' : 'Standard'}</span></th>
            <td title={`${row.completed} ended responses`}>{row.turns}</td><td>{time(row.preparationMs)}</td>
            <td>{time(row.firstTextMs)}</td><td>{time(row.totalMs)}</td><td title={`${row.rendererSamples} visible-response samples`}>{time(row.rendererMs)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {summary && summary.samples === 0 ? <p>Send a message to collect timings.</p> : null}
      <p>First text includes commentary. Renderer measures receipt to a visible frame estimate, including pacing, only in visible panes. It is separate from the main-process timings. Different tasks and models can take different amounts of time.</p>
    </section>
  </div>
}
