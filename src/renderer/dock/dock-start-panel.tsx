import { useMemo, useState, type JSX } from 'react'
import { LayoutGrid, MessageSquarePlus, Search, Settings } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import { Input } from '../../components/ui/input.js'
import { cn } from '../../lib/utils.js'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import { AppIconMark } from '../app-icons.js'
import {
  menuItemDisabled, runMenuItem, type MenuItem, type TitlebarMenuProps
} from '../application-menu-model.js'
import { relativeTime } from '../tools/tools-model.js'
import {
  allStartMenuGroups, recentChatsForStart, searchStartMenu, startPinVisual, startPins, type StartPinKey, type StartPinVisual
} from './dock-start-model.js'

export type DockStartPanelProps = {
  menu: TitlebarMenuProps
  chats: readonly ChatRowSummary[]
  spaceName: string
  overviewActive: boolean
  overviewDisabled: boolean
  onToggleOverview: () => void
  onOpenChat: (paneId: string) => void
  onClose: () => void
}

export function DockStartPanel({ menu, chats, spaceName, overviewActive, overviewDisabled, onToggleOverview,
  onOpenChat, onClose }: DockStartPanelProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [allApps, setAllApps] = useState(false)
  const now = useMemo(() => Date.now(), [])
  const searchHits = useMemo(() => searchStartMenu(query), [query])
  const pins = useMemo(() => startPins(), [])
  const recommended = useMemo(() => query.trim() ? [] : recentChatsForStart(chats), [chats, query])

  const run = (row: MenuItem): void => {
    runMenuItem(row, menu)
    onClose()
  }

  const searching = query.trim().length > 0

  return <div className="dock-start flex max-h-[min(70vh,520px)] w-[min(92vw,560px)] flex-col" aria-label="Start">
    <div className="border-b border-border/60 px-4 py-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input data-ui="dock.start-search" className="h-10 pl-9" placeholder="Search apps and commands"
          value={query} onChange={(event) => { setQuery(event.target.value); setAllApps(false) }} autoFocus />
      </div>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      {searching
        ? <SearchResults hits={searchHits} menu={menu} onRun={run} />
        : <>
          <StartSection title="Pinned" action={allApps
            ? <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" data-ui="dock.start-all-apps"
              onClick={() => setAllApps(false)}>Back to pinned</Button>
            : <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" data-ui="dock.start-all-apps"
              onClick={() => setAllApps(true)}>All apps ›</Button>}>
            {allApps
              ? <AllAppsList menu={menu} onRun={run} />
              : <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                {pins.map((row) => <StartPin key={row.key} row={row} menu={menu} onRun={run} />)}
              </div>}
          </StartSection>
          {recommended.length > 0 && <StartSection title="Recommended">
            <ul className="flex flex-col gap-0.5">
              {recommended.map((chat) => <li key={chat.paneId}>
                <button type="button" className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-accent/60"
                  data-ui="dock.start-chat" data-ui-key={chat.paneId}
                  onClick={() => { onOpenChat(chat.paneId); onClose() }}>
                  <span className="grid size-9 shrink-0 place-items-center rounded-md bg-secondary">
                    <AppIconMark id="chats" size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{chat.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{chat.preview || 'Chat'}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(chat.updatedAt, now)}</span>
                </button>
              </li>)}
            </ul>
          </StartSection>}
        </>}
    </div>
    <div className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-2.5">
      <span className="truncate text-sm font-medium" title={spaceName}>{spaceName}</span>
      <Button variant={overviewActive ? 'secondary' : 'ghost'} size="sm" className="shrink-0 gap-1.5"
        data-ui="dock.overview" aria-pressed={overviewActive} disabled={overviewDisabled}
        onClick={() => { onToggleOverview(); onClose() }}>
        <LayoutGrid className="size-4" aria-hidden="true" />
        All workspaces
      </Button>
    </div>
  </div>
}

function StartSection({ title, action, children }: { title: string; action?: JSX.Element; children: JSX.Element }): JSX.Element {
  return <section className="mb-4 last:mb-0">
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      {action}
    </div>
    {children}
  </section>
}

function StartPin({ row, menu, onRun }: { row: MenuItem; menu: TitlebarMenuProps; onRun: (row: MenuItem) => void }): JSX.Element {
  const visual = startPinVisual(row.key as StartPinKey)
  const disabled = menuItemDisabled(row, menu)
  return <button type="button" disabled={disabled}
    className={cn('flex flex-col items-center gap-1.5 rounded-lg p-2 text-center transition-colors',
      'hover:bg-accent/60 disabled:pointer-events-none disabled:opacity-40')}
    data-ui="dock.start-pin" data-ui-key={row.key} onClick={() => onRun(row)}>
    <span className="grid size-11 place-items-center rounded-xl border border-border/80 bg-secondary shadow-sm">
      <StartPinIcon visual={visual} />
    </span>
    <span className="line-clamp-2 w-full text-[11px] leading-tight font-medium">{row.label.replace(/…$/, '')}</span>
  </button>
}

function StartPinIcon({ visual }: { visual: StartPinVisual }): JSX.Element {
  if (visual.kind === 'app') return <AppIconMark id={visual.id} size={22} />
  if (visual.id === 'new-chat') return <MessageSquarePlus size={22} aria-hidden="true" />
  if (visual.id === 'search') return <Search size={22} aria-hidden="true" />
  return <Settings size={22} aria-hidden="true" />
}

function SearchResults({ hits, menu, onRun }: { hits: ReturnType<typeof searchStartMenu>; menu: TitlebarMenuProps; onRun: (row: MenuItem) => void }): JSX.Element {
  if (hits.length === 0) {
    return <p className="px-1 py-6 text-center text-sm text-muted-foreground">No matching commands.</p>
  }
  return <ul className="flex flex-col gap-0.5">
    {hits.map(({ menu: group, row }) => {
      const disabled = menuItemDisabled(row, menu)
      return <li key={row.key}>
        <button type="button" disabled={disabled}
          className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left hover:bg-accent/60 disabled:opacity-40"
          data-ui={row.ui?.control ?? 'titlebar.menu-item'} data-ui-key={row.ui?.item ?? row.key}
          onClick={() => onRun(row)}>
          <span className="min-w-0">
            <span className="block truncate text-sm">{row.label}</span>
            <span className="block truncate text-xs text-muted-foreground">{group}</span>
          </span>
          {row.shortcut && <span className="shrink-0 text-xs text-muted-foreground">{row.shortcut}</span>}
        </button>
      </li>
    })}
  </ul>
}

function AllAppsList({ menu, onRun }: { menu: TitlebarMenuProps; onRun: (row: MenuItem) => void }): JSX.Element {
  return <div className="flex flex-col gap-3">
    {allStartMenuGroups().map((group) => <div key={group.menu}>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{group.menu}</div>
      <ul className="flex flex-col gap-0.5">
        {group.rows.map((row) => {
          const disabled = menuItemDisabled(row, menu)
          return <li key={row.key}>
            <button type="button" disabled={disabled}
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/60 disabled:opacity-40"
              data-ui={row.ui?.control ?? 'titlebar.menu-item'} data-ui-key={row.ui?.item ?? row.key}
              onClick={() => onRun(row)}>
              <span className="truncate">{row.label}</span>
              {row.shortcut && <span className="shrink-0 text-xs text-muted-foreground">{row.shortcut}</span>}
            </button>
          </li>
        })}
      </ul>
    </div>)}
  </div>
}
