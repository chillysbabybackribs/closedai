import type { JSX } from 'react'
import {
  Activity,
  Bot,
  CalendarClock,
  ChartNoAxesCombined,
  CircleAlert,
  FileStack,
  FolderKanban,
  Gauge,
  PlayCircle,
  Settings,
  SquareStack
} from 'lucide-react'

const primaryItems = [
  { Icon: Gauge, label: 'Overview' },
  { Icon: Bot, label: 'Workers' },
  { Icon: PlayCircle, label: 'Runs', count: '6', enabled: true },
  { Icon: CircleAlert, label: 'Approvals', count: '1' },
  { Icon: CalendarClock, label: 'Schedules' }
]

const resourceItems = [
  { Icon: FileStack, label: 'Artifacts' },
  { Icon: SquareStack, label: 'Browser sessions' },
  { Icon: ChartNoAxesCombined, label: 'Usage' }
]

function NavigationItem({
  Icon,
  label,
  count,
  enabled = false
}: {
  Icon: typeof Activity
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

export function OperationsSidebar(): JSX.Element {
  return (
    <aside className="ops-sidebar" aria-label="Operations navigation">
      <nav>
        <p className="ops-section-label">Operations</p>
        {primaryItems.map((item) => <NavigationItem key={item.label} {...item} />)}
        <p className="ops-section-label ops-section-label-spaced">Resources</p>
        {resourceItems.map((item) => <NavigationItem key={item.label} {...item} />)}
      </nav>
      <div className="ops-workspaces">
        <p className="ops-section-label">Workspaces</p>
        <button type="button" disabled title="Workspace scoping is planned for a later slice">
          <span className="ops-workspace-icon" data-tone="violet">C</span><span>closedai</span>
        </button>
        <button type="button" disabled title="Workspace scoping is planned for a later slice">
          <span className="ops-workspace-icon" data-tone="blue">D</span><span>desktop</span>
        </button>
        <button type="button" disabled title="Workspace scoping is planned for a later slice">
          <span className="ops-workspace-icon" data-tone="green">P</span><span>platform</span>
        </button>
      </div>
      <button type="button" className="ops-sidebar-settings" disabled title="Operations settings are planned">
        <Settings size={16} /><span>Settings</span>
      </button>
    </aside>
  )
}
