import { memo, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { Pin, PinOff } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.js'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip.js'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import { useAgentRuns } from '../agent-runs/agent-runs-store.js'
import { dockSummary, dockTiles } from '../agent-runs/agent-run-overview-model.js'
import { useBrowserDownloadsController } from '../browser-downloads-controller.js'
import { useSavedSitesList } from '../browser-saved-sites-controller.js'
import type { SpacesDockNav } from '../spaces/spaces-stage.js'
import { DOCK_HEIGHT, canPinTrayApp, dockIconPinPatch, pinnedTrayApps, setTrayAppPinned, trayApps, type DockPrefs, type TrayAppId } from './dock-model.js'
import { DockContextMenu } from './dock-context-menu.js'
import { useDockReveal } from './use-dock-reveal.js'
import { DockTray, DownloadsStack } from './dock-tray.js'
import { AppIconMark } from '../app-icons.js'
import type { TitlebarMenuProps } from '../application-menu-model.js'
import type { MinimizedWindow } from '../chat-layout/floating/minimized-windows.js'
import { useNotes } from '../notepad/notes-client.js'
import { UsageFlyout } from '../provider-usage/usage-flyout.js'

export type AppDockProps = {
  menu: TitlebarMenuProps
  nav: SpacesDockNav
  chats: readonly ChatRowSummary[]
  browserVisible: boolean
  videoActive?: boolean
  filesVisible?: boolean
  prefs: DockPrefs
  onPrefsChange: (patch: Partial<DockPrefs>) => void
  onLaunch: (id: Exclude<TrayAppId, 'saved-sites' | 'downloads'>) => void
  onAllSavedSites: () => void
  minimized: readonly MinimizedWindow[]
  onRestoreWindow: (id: string) => void
  /** Reports the reveal state so the workspace can give its native browser page way. */
  onShownChange: (shown: boolean) => void
}

/** A centered floating dock for workspace navigation, launchers and status. Library owns discovery. */
export const AppDock = memo(function AppDock({ menu, nav, chats, browserVisible, videoActive, filesVisible, prefs, onPrefsChange, onLaunch, onAllSavedSites, minimized, onRestoreWindow, onShownChange }: AppDockProps): JSX.Element {
  const [openList, setOpenList] = useState<'library' | 'downloads' | null>(null)
  const [usageOpen, setUsageOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const dockRef = useRef<HTMLDivElement>(null)
  const shown = useDockReveal(dockRef, openList !== null || usageOpen || contextOpen)
  useEffect(() => { onShownChange(shown); return () => onShownChange(false) }, [shown, onShownChange])
  const runs = useAgentRuns()
  const downloads = useBrowserDownloadsController().downloads
  const savedSites = useSavedSitesList(true)
  const notes = useNotes()
  const trayInput = useMemo(() => ({
    runningChats: chats.filter((row) => row.running).length,
    browserVisible,
    videoActive,
    filesVisible,
    agentRuns: dockTiles(runs, chats, []).length,
    runningAgentRuns: runs.filter((run) => run.status === 'running').length,
    agentSummary: dockSummary(dockTiles(runs, chats, [])),
    savedSites: savedSites.length,
    notes: notes.length,
    downloads: downloads.length,
    activeDownloads: downloads.filter((download) => download.state === 'progressing').length
  }), [runs, chats, browserVisible, videoActive, filesVisible, savedSites.length, notes.length, downloads])
  const apps = useMemo(() => trayApps(trayInput), [trayInput])
  const pinnedApps = useMemo(() => pinnedTrayApps(trayInput, prefs.pinnedTray), [trayInput, prefs.pinnedTray])
  const onLaunchApp = (id: TrayAppId): void => {
    setOpenList(null)
    if (id === 'saved-sites') onAllSavedSites()
    else if (id === 'downloads') setOpenList('downloads')
    else onLaunch(id)
  }

  return <TooltipProvider>
    <DockContextMenu prefs={prefs} onPin={(id, pinned) => onPrefsChange(dockIconPinPatch(prefs, id, pinned))}
      onOpenChange={(open) => { setContextOpen(open); if (open) setOpenList(null) }}>
    <div ref={dockRef} data-slot="app-dock" data-ui="dock.bar" data-state={shown ? 'open' : 'closed'}
      className="dock-bar fixed inset-x-0 bottom-0 z-40"
      style={{ height: DOCK_HEIGHT }}>
      <DockTray pinnedApps={pinnedApps} onLaunchApp={onLaunchApp} minimized={minimized} onRestoreWindow={onRestoreWindow}
        leading={prefs.pinnedControls.includes('workspaces') && <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="dock-bar-link dock-bar-app-icon" data-ui="dock.overview" data-dock-icon="workspaces"
              aria-label={`Workspaces: ${nav.spaceName}`} aria-pressed={nav.overview} disabled={nav.moving}
              onClick={nav.toggleOverview}><AppIconMark id="workspaces" size={58} /></button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6}>Workspaces · {nav.spaceName}</TooltipContent>
        </Tooltip>}
        trailing={<>
          {prefs.pinnedControls.includes('settings') && <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="dock-bar-link dock-bar-app-icon" data-ui="dock.settings" data-dock-icon="settings" aria-label="Settings"
                onClick={() => menu.onAction('settings')}><AppIconMark id="settings" size={58} /></button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>Settings</TooltipContent>
          </Tooltip>}
          <span className="dock-bar-divider" aria-hidden="true" />
          <UsageFlyout chats={chats} onOpenChange={setUsageOpen} />
        </>}
        library={prefs.pinnedControls.includes('library') && <Popover open={openList !== null} onOpenChange={(open) => setOpenList(open ? 'library' : null)}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button type="button" className="dock-bar-link dock-bar-app-icon" data-ui="dock.library" data-dock-icon="library" aria-label="Library">
                  <AppIconMark id="library" size={58} />
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>Library</TooltipContent>
          </Tooltip>
          <PopoverContent side="top" align="start" sideOffset={10} aria-label={openList === 'downloads' ? 'Downloads' : 'Workspace library'}
            className="dock-panel w-80 max-w-[calc(100vw-1.5rem)] max-h-[min(32rem,calc(100vh-6rem))] overflow-y-auto p-2">
            {openList === 'downloads' ? <>
              <Button variant="ghost" size="sm" onClick={() => setOpenList('library')}>Back to Library</Button>
              <DownloadsStack downloads={downloads} onRevealDownload={(id) => { void window.closedai.browserDownloads.reveal(id) }} />
            </> : <>
              <div className="px-2 py-2 text-xs font-medium text-muted-foreground">Workspace library</div>
              {apps.map((app) => <div key={app.id} className="flex items-center gap-1">
                <Button variant="ghost" className="h-14 min-w-0 flex-1 justify-start gap-3 px-2 py-2 font-normal has-[>svg]:px-2" data-ui="dock.library-app" data-ui-key={app.id}
                  onClick={() => onLaunchApp(app.id)}><AppIconMark id={app.id} size={40} className="size-10 shrink-0" /><span className="truncate">{app.label}</span></Button>
                {canPinTrayApp(app.id) && <Button variant="ghost" size="icon-sm" data-ui="dock.library-pin" data-ui-key={app.id}
                  aria-label={`${prefs.pinnedTray.includes(app.id) ? 'Unpin' : 'Pin'} ${app.label}`} aria-pressed={prefs.pinnedTray.includes(app.id)}
                  onClick={() => onPrefsChange({ pinnedTray: setTrayAppPinned(prefs.pinnedTray, app.id, !prefs.pinnedTray.includes(app.id)) })}>
                  {prefs.pinnedTray.includes(app.id) ? <PinOff size={14} /> : <Pin size={14} />}
                </Button>}
              </div>)}
              <Button variant="ghost" className="h-14 w-full justify-start gap-3 px-2 py-2 font-normal has-[>svg]:px-2" data-ui="dock.tools"
                onClick={() => { setOpenList(null); menu.onAction('tools') }}><AppIconMark id="tools" size={40} className="size-10 shrink-0" /><span className="truncate">Tools & capabilities</span></Button>
            </>}
          </PopoverContent>
        </Popover>} />
    </div>
    </DockContextMenu>
  </TooltipProvider>
})
