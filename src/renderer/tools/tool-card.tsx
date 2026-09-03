import type { JSX } from 'react'
import { Switch } from '../../components/ui/switch.js'
import type { ToolStats } from '../../shared/tools.js'

/** One switchable capability: a plain tool, or one action of an action tool. */
export type ToolCardItem = {
  id: string
  name: string
  enabled: boolean
  stat: ToolStats | null
}

export type ToolCardProps = {
  item: ToolCardItem
  onToggle: (enabled: boolean) => void
}

/** One aggregate-only row: switch, name, run count, error count, and timeout count. */
export function ToolCard({ item, onToggle }: ToolCardProps): JSX.Element {
  const calls = item.stat?.calls ?? 0
  const failures = item.stat?.failures ?? 0
  const timeouts = item.stat?.timeouts ?? 0

  return (
    <li className="tool-card" data-enabled={item.enabled}>
      <div className="tool-card-row">
        <Switch
          checked={item.enabled}
          onCheckedChange={onToggle}
          aria-label={`${item.enabled ? 'Turn off' : 'Turn on'} ${item.id}`}
          data-ui="tools.toggle"
          data-ui-key={item.id}
          className="tool-card-switch"
        />
        <div className="tool-card-main">
          <span className="tool-card-title">
            <span className="tool-card-name">{item.name}</span>
          </span>
        </div>
        <span className="tool-card-usage" aria-label="Usage">
          <span className="tool-card-usage-count">{calls} run{calls === 1 ? '' : 's'}</span>
          <span className="tool-card-error-count" data-tone={failures > 0 ? 'bad' : undefined}>
            {failures} error{failures === 1 ? '' : 's'}
          </span>
          <span className="tool-card-timeout-count" data-tone={timeouts > 0 ? 'warn' : undefined}>
            {timeouts} timeout{timeouts === 1 ? '' : 's'}
          </span>
        </span>
      </div>
    </li>
  )
}
