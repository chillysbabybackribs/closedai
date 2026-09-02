import type { JSX } from 'react'
import {
  CalendarClock,
  CircleAlert,
  Gauge,
  PlayCircle,
  Settings
} from 'lucide-react'
import { attentionRunCount, type OperationsRun } from './operations-data.js'

const primaryItems = [
  { Icon: Gauge, id: 'overview', label: 'Overview' },
  { Icon: PlayCircle, id: 'runs', label: 'Runs' },
  { Icon: CircleAlert, id: 'approvals', label: 'Approvals' },
  { Icon: CalendarClock, id: 'schedules', label: 'Schedules' }
] as const

export type OperationsView = typeof primaryItems[number]['id']

function NavigationItem({
  Icon,
  label,
  id,
  count,
  active,
  onSelect
}: {
  Icon: typeof Gauge
  label: string
  id: OperationsView
  count?: string
  active: boolean
  onSelect: (view: OperationsView) => void
}): JSX.Element {
  return (
    <button
      type="button"
      className={active ? 'is-active' : ''}
      aria-current={active ? 'page' : undefined}
      onClick={() => onSelect(id)}
    >
      <Icon size={16} />
      <span>{label}</span>
      {count ? <em>{count}</em> : null}
    </button>
  )
}

export function OperationsHeader({
  runs,
  view,
  onViewChange
}: {
  runs: OperationsRun[]
  view: OperationsView
  onViewChange: (view: OperationsView) => void
}): JSX.Element {
  return (
    <header className="ops-header">
      <div className="ops-header-brand">
        <span className="ops-header-mark" aria-hidden="true">O</span>
        <div><strong>Operations</strong><span>Control room</span></div>
      </div>
      <nav className="ops-header-nav" aria-label="Operations navigation">
        {primaryItems.map((item) => (
          <NavigationItem
            key={item.id}
            {...item}
            active={view === item.id}
            count={item.id === 'runs'
              ? String(runs.length)
              : item.id === 'approvals' ? String(attentionRunCount(runs)) : undefined}
            onSelect={onViewChange}
          />
        ))}
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
