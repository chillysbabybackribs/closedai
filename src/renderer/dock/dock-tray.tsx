import type { JSX, ReactNode } from 'react'
import { Button } from '../../components/ui/button.js'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip.js'
import type { BrowserDownload } from '../../shared/types.js'
import { APP_ICONS, AppIconMark } from '../app-icons.js'
import type { MinimizedWindow } from '../chat-layout/floating/minimized-windows.js'
import type { TrayApp, TrayAppId } from './dock-model.js'
import { downloadActions, downloadDetail } from '../browser-downloads-model.js'
import { cn } from '../../lib/utils.js'
import { DockSurface } from './dock-surface.js'

const STACK_ROWS = 8

export type DockTrayProps = {
  leading: ReactNode
  trailing: ReactNode
  library: ReactNode
  /** Launchers the user pinned to the dock. */
  pinnedApps: readonly TrayApp[]
  onLaunchApp: (id: TrayAppId) => void
  minimized: readonly MinimizedWindow[]
  onRestoreWindow: (id: string) => void
}

/** One centered surface: workspace navigation, app artwork, settings, then provider status. */
export function DockTray({ leading, trailing, library, pinnedApps, onLaunchApp, minimized, onRestoreWindow }: DockTrayProps): JSX.Element {
  return <nav data-slot="app-dock-tray" className="dock-bar-tray" aria-label="Workspace">
    <DockSurface>
      {leading}
      {minimized.length > 0 && <div className="dock-bar-windows" role="group" aria-label="Minimized windows">
        {minimized.map((entry) => <MinimizedLink key={entry.id} entry={entry} onRestore={onRestoreWindow} />)}
      </div>}
      <div data-slot="dock-launchers" className="dock-bar-launchers" role="group" aria-label="Applications">
        {pinnedApps.map((app) => <PinnedLink key={app.id} app={app} onLaunch={() => onLaunchApp(app.id)} />)}
        {library}
      </div>
      {trailing}
    </DockSurface>
  </nav>
}

function PinnedLink({ app, onLaunch }: { app: TrayApp; onLaunch: () => void }): JSX.Element {
  // Illustrated app icons replace their text label as the dock artwork is added.
  const illustrated = APP_ICONS[app.id].kind === 'picture'
  return <Tooltip>
    <TooltipTrigger asChild>
      <button type="button" className={cn('dock-bar-link dock-bar-pinned', illustrated && 'dock-bar-app-icon', app.active && 'is-active')}
        aria-pressed={app.id === 'files' || app.id === 'browser' || app.id === 'video' ? app.active : undefined}
        data-ui="dock.pinned" data-ui-key={app.id} data-dock-icon={app.id} aria-label={`${app.label}: ${app.note}`} onClick={onLaunch}>
        <AppIconMark id={app.id} size={illustrated ? 58 : 20} />
        {!illustrated && <span>{app.label}</span>}
        {app.active && <span className="dock-bar-pinned-dot" aria-hidden="true" />}
      </button>
    </TooltipTrigger>
    <TooltipContent side="top" sideOffset={6} className="flex flex-col gap-0.5">
      <span className="font-medium">{app.label}</span>
      <span className="text-muted-foreground">{app.note}</span>
    </TooltipContent>
  </Tooltip>
}

function MinimizedLink({ entry, onRestore }: { entry: MinimizedWindow; onRestore: (id: string) => void }): JSX.Element {
  const detail = entry.tabs > 1 ? `${entry.tabs} tabs` : 'Minimized'
  return <Tooltip>
    <TooltipTrigger asChild>
      <button type="button" className="dock-bar-link dock-bar-minimized max-w-[9rem] truncate"
        data-ui="dock.window" data-ui-key={entry.id} aria-label={`Restore ${entry.title} (${detail})`}
        onClick={() => onRestore(entry.id)}>
        {entry.title}
      </button>
    </TooltipTrigger>
    <TooltipContent side="top" sideOffset={6} className="flex flex-col gap-0.5">
      <span className="font-medium">{entry.title}</span>
      <span className="text-muted-foreground">Restore · {detail}</span>
    </TooltipContent>
  </Tooltip>
}

function StackList({ title, empty, children }: { title: string; empty: string | null; children: ReactNode }): JSX.Element {
  return <div className="flex flex-col gap-0.5">
    <div className="px-2 pt-1 pb-1.5 text-xs font-medium text-muted-foreground">{title}</div>
    {empty ? <div className="px-2 pb-2 text-sm text-muted-foreground">{empty}</div> : children}
  </div>
}

function StackRow({ control, uiKey, icon, name, detail, disabled, onSelect }: {
  control: string; uiKey: string; icon: ReactNode; name: string; detail: string; disabled?: boolean; onSelect: () => void
}): JSX.Element {
  return <Button variant="ghost" size="sm" className="h-auto justify-start gap-2.5 px-2 py-1.5 text-left font-normal disabled:opacity-100"
    data-ui={control} data-ui-key={uiKey} disabled={disabled} onClick={onSelect}>
    <span className="grid size-5 shrink-0 place-items-center [&_img]:size-4">{icon}</span>
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-sm">{name}</span>
      <span className="truncate text-xs text-muted-foreground">{detail}</span>
    </span>
  </Button>
}

/** The recent-downloads list. Opened from Library; downloads have no own surface. */
export function DownloadsStack({ downloads, onRevealDownload }: {
  downloads: readonly BrowserDownload[]; onRevealDownload: (id: string) => void
}): JSX.Element {
  const recent = downloads.slice(0, STACK_ROWS)
  return <StackList title="Downloads" empty={recent.length ? null : 'Files you download in the browser show here.'}>
    {recent.map((download) => <StackRow key={download.id} control="dock.download" uiKey={download.id}
      icon={<AppIconMark id="downloads" size={15} />} name={download.filename} detail={downloadDetail(download)}
      disabled={!downloadActions(download).canReveal} onSelect={() => onRevealDownload(download.id)} />)}
  </StackList>
}
