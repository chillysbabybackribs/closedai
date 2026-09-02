import type { JSX } from 'react'
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

import { Switch } from '../../components/ui/switch.js'
import type { ToolCallRecord, ToolFieldInfo, ToolStats } from '../../shared/tools.js'
import { ToolDetail } from './tool-detail.js'

/** One switchable capability: a plain tool, or one action of an action tool. */
export type ToolCardItem = {
  id: string
  name: string
  badges: string[]
  description: string
  fields: ToolFieldInfo[]
  enabled: boolean
  stat: ToolStats | null
  /** Newest first, already filtered to this item. */
  recent: ToolCallRecord[]
  /** Plain tools only: the advertised schema. */
  inputSchema: unknown
}

export type ToolCardProps = {
  item: ToolCardItem
  onToggle: (enabled: boolean) => void
}

/** Switch, name, one-line summary, failure rate; click to expand details. */
export function ToolCard({ item, onToggle }: ToolCardProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const detailId = `tool-card-detail-${item.id.replace(/[^a-z0-9_]/gi, '-')}`
  const calls = item.stat?.calls ?? 0
  const failures = item.stat?.failures ?? 0
  const failedPct = calls > 0 ? Math.round((failures / calls) * 100) : 0

  return (
    <li className="tool-card" data-enabled={item.enabled} data-open={open || undefined}>
      <div className="tool-card-row">
        <Switch
          checked={item.enabled}
          onCheckedChange={onToggle}
          aria-label={`${item.enabled ? 'Turn off' : 'Turn on'} ${item.id}`}
          className="tool-card-switch"
        />
        <button
          type="button"
          className="tool-card-main"
          aria-expanded={open}
          aria-controls={detailId}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="tool-card-title">
            <span className="tool-card-name">{item.name}</span>
            {item.badges.map((badge) => <span key={badge} className="tool-card-badge">{badge}</span>)}
            {!item.enabled && <span className="tool-card-badge" data-tone="off">off</span>}
          </span>
          <span className="tool-card-summary">{summarize(item.description)}</span>
        </button>
        <span className="tool-card-usage" aria-label="Usage">
          {calls === 0 ? (
            <span className="tool-card-usage-none">No calls yet</span>
          ) : (
            <>
              <span className="tool-card-usage-pct" data-tone={failures > 0 ? 'bad' : 'good'}>{failedPct}% failed</span>
              <span className="tool-card-usage-count">{failures} of {calls} call{calls === 1 ? '' : 's'}</span>
            </>
          )}
        </span>
        <ChevronDown className="tool-card-chevron" aria-hidden="true" />
      </div>
      {open && (
        <div id={detailId} className="tool-card-detail">
          <ToolDetail
            description={item.description}
            fields={item.fields}
            stat={item.stat}
            recent={item.recent}
            inputSchema={item.inputSchema}
          />
        </div>
      )}
    </li>
  )
}

/** First sentence of the description. */
function summarize(description: string): string {
  const preamble = description.split('\n')[0] ?? ''
  const sentence = preamble.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? preamble
  return sentence.length > 140 ? `${sentence.slice(0, 139).trimEnd()}…` : sentence
}
