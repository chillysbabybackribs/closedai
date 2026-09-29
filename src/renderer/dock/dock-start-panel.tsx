import { useMemo, useState, type JSX } from 'react'
import { LayoutGrid, MessageSquarePlus, Search, Settings } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import { AppIconMark } from '../app-icons.js'
import {
  menuItemDisabled, runMenuItem, type MenuItem, type TitlebarMenuProps
} from '../application-menu-model.js'
import { formatChatTime } from '../chat-history/history-format.js'
import { chatSearchMeta } from '../chat-history/history-search.js'
import {
  allStartMenuGroups, recentChatsForStart, searchStartMenu, startPinVisual, startPins, startScreenForRow,
  type StartPinKey, type StartPinVisual, type StartView
} from './dock-start-model.js'
import { StartScreenView, type StartServices } from './dock-start-views.js'

export type DockStartPanelProps = {
  menu: TitlebarMenuProps
  chats: readonly ChatRowSummary[]
  spaceName: string
  overviewActive: boolean
  overviewDisabled: boolean
  onToggleOverview: () => void
  onOpenChat: (paneId: string) => void
  onClose: () => void
  /** Home, or a screen a row opened inside Start; the dock owns it so Escape can step back first. */
  view: StartView
  onViewChange: (view: StartView) => void
  services: StartServices
}

export function DockStartPanel({ menu, chats, spaceName, overviewActive, overviewDisabled, onToggleOverview,
  onOpenChat, onClose, view, onViewChange, services }: DockStartPanelProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [allApps, setAllApps] = useState(false)
  const now = useMemo(() => Date.now(), [])
  const searchHits = useMemo(() => searchStartMenu(query), [query])
  const pins = useMemo(() => startPins(), [])
  const recentChats = useMemo(() => query.trim() ? [] : recentChatsForStart(chats), [chats, query])

  // Rows with a screen open it here; the same rows in the title-bar menus keep their own behaviour.
  const run = (row: MenuItem): void => {
    const screen = startScreenForRow(row)
    if (screen) { onViewChange(screen); return }
    runMenuItem(row, menu)
    onClose()
  }

  const searching = query.trim().length > 0

  return <div className="dock-start" aria-label="Start" data-view={view}>
    {view !== 'home'
      ? <StartScreenView screen={view} services={services} onBack={() => onViewChange('home')} onClose={onClose} />
      : <>
        <div className="chat-history">
          <label className="chat-history-search">
            <Search className="size-3.5" aria-hidden="true" />
            <input type="search" data-ui="dock.start-search" placeholder="Search apps and commands" spellCheck={false} autoFocus
              value={query} onChange={(event) => { setQuery(event.target.value); setAllApps(false) }} />
          </label>
        </div>
        <div className="dock-start-scroll">
          {searching
            ? <SearchResults hits={searchHits} menu={menu} onRun={run} />
            : <>
              <StartSection title="Pinned" action={allApps
                ? <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" data-ui="dock.start-all-apps"
                  onClick={() => setAllApps(false)}>Back to pinned</Button>
                : <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" data-ui="dock.start-all-apps"
                  onClick={() => setAllApps(true)}>All apps ›</Button>}>
                {allApps
                  ? <AllAppsList menu={menu} onRun={run} />
                  : <div className="dock-start-pin-grid">
                    {pins.map((row) => <StartPin key={row.key} row={row} menu={menu} onRun={run} />)}
                  </div>}
              </StartSection>
              {recentChats.length > 0 && <StartSection title="Recent chats">
                <ul className="chat-history-list">
                  {recentChats.map((hit) => <li key={hit.row.paneId} className="chat-history-row">
                    <button type="button" className="chat-history-open" data-ui="dock.start-chat" data-ui-key={hit.row.paneId}
                      onClick={() => { onOpenChat(hit.row.paneId); onClose() }}>
                      <span className="chat-history-title">{hit.row.title}</span>
                      <span className="chat-history-meta">
                        <span>{chatSearchMeta(hit, (timestamp) => formatChatTime(timestamp, now))}</span>
                      </span>
                    </button>
                  </li>)}
                </ul>
              </StartSection>}
            </>}
        </div>
      </>}
    <footer className="dock-start-footer">
      <span className="dock-start-workspace" title={spaceName}>{spaceName}</span>
      <Button variant={overviewActive ? 'secondary' : 'outline'} size="sm" className="shrink-0 gap-1.5"
        data-ui="dock.overview" aria-pressed={overviewActive} disabled={overviewDisabled}
        onClick={() => { onToggleOverview(); onClose() }}>
        <LayoutGrid className="size-4" aria-hidden="true" />
        All workspaces
      </Button>
    </footer>
  </div>
}

function StartSection({ title, action, children }: { title: string; action?: JSX.Element; children: JSX.Element }): JSX.Element {
  return <section className="mb-5 last:mb-0">
    <div className="dock-start-section-head">
      <h3 className="dock-start-section-title">{title}</h3>
      {action}
    </div>
    {children}
  </section>
}

function StartPin({ row, menu, onRun }: { row: MenuItem; menu: TitlebarMenuProps; onRun: (row: MenuItem) => void }): JSX.Element {
  const visual = startPinVisual(row.key as StartPinKey)
  const disabled = menuItemDisabled(row, menu)
  return <button type="button" disabled={disabled} className="dock-start-pin"
    data-ui="dock.start-pin" data-ui-key={row.key} onClick={() => onRun(row)}>
    <span className="dock-start-pin-icon"><StartPinIcon visual={visual} /></span>
    <span className="dock-start-pin-label">{row.label.replace(/…$/, '')}</span>
  </button>
}

function StartPinIcon({ visual }: { visual: StartPinVisual }): JSX.Element {
  if (visual.kind === 'app') return <AppIconMark id={visual.id} size={24} />
  if (visual.id === 'new-chat') return <MessageSquarePlus size={24} aria-hidden="true" />
  if (visual.id === 'search') return <Search size={24} aria-hidden="true" />
  return <Settings size={24} aria-hidden="true" />
}

function SearchResults({ hits, menu, onRun }: { hits: ReturnType<typeof searchStartMenu>; menu: TitlebarMenuProps; onRun: (row: MenuItem) => void }): JSX.Element {
  if (hits.length === 0) {
    return <p className="chat-history-status"><span>No matching commands.</span></p>
  }
  return <ul className="chat-history-list">
    {hits.map(({ menu: group, row }) => {
      const disabled = menuItemDisabled(row, menu)
      return <li key={row.key} className="chat-history-row">
        <button type="button" disabled={disabled} className="dock-start-command"
          data-ui={row.ui?.control ?? 'titlebar.menu-item'} data-ui-key={row.ui?.item ?? row.key}
          onClick={() => onRun(row)}>
          <span className="min-w-0">
            <span className="chat-history-title">{row.label}</span>
            <span className="chat-history-meta"><span>{group}</span></span>
          </span>
          {row.shortcut && <span className="dock-start-command-shortcut">{row.shortcut}</span>}
        </button>
      </li>
    })}
  </ul>
}

function AllAppsList({ menu, onRun }: { menu: TitlebarMenuProps; onRun: (row: MenuItem) => void }): JSX.Element {
  return <div className="flex flex-col gap-4">
    {allStartMenuGroups().map((group) => <div key={group.menu}>
      <h4 className="dock-start-section-title mb-2">{group.menu}</h4>
      <ul className="chat-history-list">
        {group.rows.map((row) => {
          const disabled = menuItemDisabled(row, menu)
          return <li key={row.key} className="chat-history-row">
            <button type="button" disabled={disabled} className="dock-start-command"
              data-ui={row.ui?.control ?? 'titlebar.menu-item'} data-ui-key={row.ui?.item ?? row.key}
              onClick={() => onRun(row)}>
              <span className="truncate text-sm">{row.label}</span>
              {row.shortcut && <span className="dock-start-command-shortcut">{row.shortcut}</span>}
            </button>
          </li>
        })}
      </ul>
    </div>)}
  </div>
}
