import type { JSX } from 'react'
import {
  Bot,
  CalendarClock,
  CircleAlert,
  Gauge,
  PlayCircle,
  ServerCog,
  Settings
} from 'lucide-react'
import { attentionRunCount, type OperationsRun } from './operations-data.js'

const primaryItems = [
  { Icon: Gauge, label: 'Overview' },
  { Icon: Bot, label: 'Workers' },
  { Icon: PlayCircle, label: 'Runs' },
  { Icon: CircleAlert, label: 'Approvals' },
  { Icon: CalendarClock, label: 'Schedules' },
  { Icon: ServerCog, label: 'Runtimes' }
]

function NavigationItem({
  Icon,
  label,
  count,
  enabled = false
}: {
  Icon: typeof Gauge
  label: string
  count?: string
  enabled?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      className={enabled ? 'is-active' : ''}
      disabled={!enabled}
      aria-current={enabled ? 'page' : undefined}
      title={enabled ? label : `${label} is planned for a later Operations slice`}
    >
      <Icon size={16} />
      <span>{label}</span>
      {count ? <em>{count}</em> : null}
    </button>
  )
}

export function OperationsHeader({ runs }: { runs: OperationsRun[] }): JSX.Element {
  return (
    <header className="ops-header">
      <div className="ops-header-brand">
        <span className="ops-header-mark" aria-hidden="true">O</span>
        <div><strong>Operations</strong><span>Control room</span></div>
      </div>
      <nav className="ops-header-nav" aria-label="Operations navigation">
        {primaryItems.map((item) => item.label === 'Runs'
          ? <NavigationItem key={item.label} Icon={item.Icon} label={item.label} count={String(runs.length)} enabled />
          : <NavigationItem key={item.label} {...item} count={item.label === 'Approvals' ? String(attentionRunCount(runs)) : undefined} />)}
      </nav>
      <div className="ops-header-tools">
        <span className="ops-runtime-chip"><span className="ops-runtime-dot" />Codex runtime</span>
        <button type="button" className="ops-header-icon" disabled title="Operations settings are planned" aria-label="Operations settings">
          <Settings size={15} />
        </button>
      </div>
    </header>
  )
}
