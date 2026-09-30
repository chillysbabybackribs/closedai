import { memo, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { ChevronLeft, ChevronRight, SlidersHorizontal } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.js'
import { Switch } from '../../components/ui/switch.js'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip.js'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import { useAgentRuns } from '../agent-runs/agent-runs-store.js'
import { dockSummary, dockTiles } from '../agent-runs/agent-run-overview-model.js'
import { useBrowserDownloadsController } from '../browser-downloads-controller.js'
import { useSavedSitesList } from '../browser-saved-sites-controller.js'
import type { SpacesDockNav } from '../spaces/spaces-stage.js'
import { DOCK_HEIGHT, DOCK_REACH, DOCK_REST, TRAY_LIFT, dockLocation, dockLocationLabel, trayApps, type DockPrefs, type TrayAppId } from './dock-model.js'
import { DockSurface } from './dock-surface.js'
import { DockStartPanel } from './dock-start-panel.js'
import type { StartView } from './dock-start-model.js'
import type { StartServices } from './dock-start-views.js'
import { DockTray, StartTrayButton } from './dock-tray.js'
import type { TitlebarMenuProps } from '../application-menu-model.js'
import { DockLayoutSection } from './dock-layout-menu.js'
import type { LayoutPreset } from '../chat-layout/layout-presets.js'
import type { MinimizedWindow } from '../chat-layout/floating/minimized-windows.js'
import { useDockReveal } from './use-dock-reveal.js'
import { useNotes } from '../notepad/notes-client.js'

const SLIDE_MS = 200

export type AppDockProps = {
  menu: TitlebarMenuProps
  nav: SpacesDockNav
  chats: readonly ChatRowSummary[]
  chatTitle: string | null
  browserVisible: boolean
  prefs: DockPrefs
  onPrefsChange: (patch: Partial<DockPrefs>) => void
  onLaunch: (id: Exclude<TrayAppId, 'saved-sites' | 'downloads'>) => void
  onOpenSite: (url: string) => void
  onAllSavedSites: () => void
  minimized: readonly MinimizedWindow[]
  onRestoreWindow: (id: string) => void
  /** Some window floats: Tile windows puts every window back into the last tiled layout. */
  canTile: boolean
  onTileWindows: () => void
  onApplyPreset: (preset: LayoutPreset) => void
  onOpenLayouts: () => void
  onOpenChat: (paneId: string) => void
  /** What Start's own screens (Search chats, History, Agents, Tools, Settings) act on. */
  startServices: StartServices
}

/**
 * The dock along the bottom of the main window. Left: back/forward through where you have zoomed.
 * Centre: Start and the app tray. Right: dock settings (layout options live in that popover). It hides until the pointer
 * reaches the bottom edge unless Keep visible is on.
 */
export const AppDock = memo(function AppDock({ menu, nav, chats, chatTitle, browserVisible, prefs, onPrefsChange, onLaunch, onOpenSite, onAllSavedSites, minimized, onRestoreWindow, canTile, onTileWindows, onApplyPreset, onOpenLayouts, onOpenChat, startServices }: AppDockProps): JSX.Element {
  const [openList, setOpenList] = useState<TrayAppId | 'settings' | 'start' | null>(null)
  const [keyboard, setKeyboard] = useState(false)
  // Start opens on its home every time; a screen is where one visit went, not a preference.
  const [startView, setStartView] = useState<StartView>('home')
  useEffect(() => { if (openList !== 'start') setStartView('home') }, [openList])
  const { shown, show } = useDockReveal({ pinned: prefs.keepVisible, held: openList !== null || keyboard })
  // The freeze reads data-state: the page stays a still until the dock has slid fully away.
  const [down, setDown] = useState(!shown)
  useEffect(() => {
    if (shown) { setDown(false); return }
    const timer = window.setTimeout(() => setDown(true), SLIDE_MS)
    return () => window.clearTimeout(timer)
  }, [shown])
  useEffect(() => { if (!shown) setOpenList(null) }, [shown])
  const root = useRef<HTMLDivElement>(null)

  const runs = useAgentRuns()
  const downloads = useBrowserDownloadsController().downloads
  const savedSites = useSavedSitesList(true)
  const notes = useNotes()
  const apps = useMemo(() => {
    const tiles = dockTiles(runs, chats, [])
    return trayApps({
      runningChats: chats.filter((row) => row.running).length,
      browserVisible,
      agentRuns: tiles.length,
      runningAgentRuns: runs.filter((run) => run.status === 'running').length,
      agentSummary: dockSummary(tiles),
      savedSites: savedSites.length,
      notes: notes.length,
      downloads: downloads.length,
      activeDownloads: downloads.filter((download) => download.state === 'progressing').length
    })
  }, [runs, chats, browserVisible, savedSites.length, notes.length, downloads])
  const location = dockLocation({ overview: nav.overview, space: nav.spaceName, chat: chatTitle })
  const where = dockLocationLabel(location)

  return <TooltipProvider>
    <div ref={root} data-slot="app-dock" data-ui="dock.bar" data-state={shown || !down ? 'open' : 'closed'}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40" style={{ height: DOCK_REST }}
      onFocus={(event) => { if (event.target.matches(':focus-visible')) { setKeyboard(true); show() } }}
      onBlur={(event) => { if (!root.current?.contains(event.relatedTarget as Node | null)) setKeyboard(false) }}>
      {/* The strip; the tray's tiles stand out of it, so hiding moves both past the edge. */}
      <div style={{ height: DOCK_HEIGHT, transform: shown ? undefined : `translateY(${DOCK_REACH + 8}px)` }}
        className="pointer-events-auto absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 px-3 transition-transform duration-200 ease-out motion-reduce:transition-none">
        {/* Behind the strip's controls: the strip's transform keeps -z-10 inside the dock. */}
        <DockSurface />
        {openList !== 'start' && <button type="button" tabIndex={-1} aria-hidden="true"
          className="pointer-events-none absolute size-0 overflow-hidden opacity-0"
          data-ui="dock.overview" aria-pressed={nav.overview} onClick={nav.toggleOverview} />}
        <div className="flex items-center gap-0.5">
          <DockIconButton control="dock.back" label="Back (Alt+Left)" detail={where} disabled={!nav.canBack || nav.moving} onClick={() => nav.step(-1)}>
            <ChevronLeft aria-hidden="true" />
          </DockIconButton>
          <DockIconButton control="dock.forward" label="Forward (Alt+Right)" detail={where} disabled={!nav.canForward || nav.moving} onClick={() => nav.step(1)}>
            <ChevronRight aria-hidden="true" />
          </DockIconButton>
        </div>
        <Popover open={openList === 'start'} onOpenChange={(open) => setOpenList(open ? 'start' : null)}>
          <div className="absolute left-1/2 flex -translate-x-1/2 flex-col items-center" style={{ bottom: TRAY_LIFT }}>
            <DockTray startTrigger={
              <StartTrayButton open={openList === 'start'} overviewActive={nav.overview} />
            } apps={apps} magnify={prefs.magnify}
              openStack={openList === 'saved-sites' || openList === 'downloads' ? openList : null}
              onOpenStack={(id) => setOpenList(id)}
              onLaunch={(id) => { if (id !== 'saved-sites' && id !== 'downloads') onLaunch(id) }}
              savedSites={savedSites} downloads={downloads}
              onOpenSite={(url) => { setOpenList(null); onOpenSite(url) }}
              onAllSavedSites={() => { setOpenList(null); onAllSavedSites() }}
              onRevealDownload={(id) => { void window.closedai.browserDownloads.reveal(id) }}
              minimized={minimized} onRestoreWindow={onRestoreWindow} />
          </div>
          <PopoverContent side="top" align="center" sideOffset={16} collisionPadding={12}
            className="dock-panel dock-start-shell z-[100] border p-0 shadow-none motion-reduce:animate-none" data-start-view={startView}
            onCloseAutoFocus={(event) => event.preventDefault()}
            onEscapeKeyDown={(event) => {
              if (startView === 'home') return
              event.preventDefault()
              setStartView('home')
            }}>
            <DockStartPanel menu={menu} chats={chats} spaceName={nav.spaceName} overviewActive={nav.overview}
              overviewDisabled={nav.moving} onToggleOverview={nav.toggleOverview} onOpenChat={onOpenChat}
              onClose={() => setOpenList(null)} view={startView} onViewChange={setStartView} services={startServices} />
          </PopoverContent>
        </Popover>
        <div>
          {/* Dock lists do not hand focus back on close: the button's tooltip would reopen over the page. */}
          <Popover open={openList === 'settings'} onOpenChange={(open) => setOpenList(open ? 'settings' : null)}>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon-sm" data-ui="dock.settings" aria-label="Dock and layout"><SlidersHorizontal aria-hidden="true" /></Button>
                </PopoverTrigger>
              </TooltipTrigger>
              {openList !== 'settings' && <TooltipContent side="top">Dock and layout</TooltipContent>}
            </Tooltip>
            <PopoverContent side="top" align="end" sideOffset={10} className="dock-panel flex w-72 flex-col gap-3 p-3"
              onCloseAutoFocus={(event) => event.preventDefault()}>
              <div className="text-xs font-medium text-muted-foreground">Layout</div>
              <DockLayoutSection canTile={canTile} onTileWindows={onTileWindows} onApplyPreset={onApplyPreset}
                onOpenLayouts={onOpenLayouts} onClose={() => setOpenList(null)} />
              <div className="h-px bg-border" role="separator" />
              <div className="text-xs font-medium text-muted-foreground">Dock</div>
              <DockSetting control="dock.keep-visible" title="Keep visible"
                detail="Off: the dock shows when the pointer reaches the bottom edge."
                checked={prefs.keepVisible} onChange={(keepVisible) => onPrefsChange({ keepVisible })} />
              <DockSetting control="dock.magnify" title="Magnify icons" detail="Icons grow under the pointer."
                checked={prefs.magnify} onChange={(magnify) => onPrefsChange({ magnify })} />
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  </TooltipProvider>
})

function DockIconButton({ control, label, detail, disabled, onClick, children }: {
  control: string; label: string; detail?: string; disabled: boolean; onClick: () => void; children: JSX.Element
}): JSX.Element {
  const aria = detail ? `${label}. ${detail}` : label
  return <Tooltip>
    <TooltipTrigger asChild>
      <Button variant="ghost" size="icon-sm" data-ui={control} aria-label={aria} disabled={disabled} onClick={onClick}>{children}</Button>
    </TooltipTrigger>
    <TooltipContent side="top" className={detail ? 'flex flex-col gap-0.5' : undefined}>
      <span>{label}</span>
      {detail && <span className="text-muted-foreground">{detail}</span>}
    </TooltipContent>
  </Tooltip>
}

function DockSetting({ control, title, detail, checked, onChange }: {
  control: string; title: string; detail: string; checked: boolean; onChange: (checked: boolean) => void
}): JSX.Element {
  return <label className="flex cursor-pointer items-start justify-between gap-3">
    <span className="flex flex-col gap-0.5">
      <span className="text-sm">{title}</span>
      <span className="text-xs text-muted-foreground">{detail}</span>
    </span>
    <Switch data-ui={control} checked={checked} onCheckedChange={onChange} />
  </label>
}
