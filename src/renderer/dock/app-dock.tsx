import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { ChevronLeft, ChevronRight, LayoutGrid, SlidersHorizontal } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.js'
import { Switch } from '../../components/ui/switch.js'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip.js'
import { cn } from '../../lib/utils.js'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import { useAgentRuns } from '../agent-runs/agent-runs-store.js'
import { dockSummary, dockTiles } from '../agent-runs/agent-run-overview-model.js'
import { useBrowserDownloadsController } from '../browser-downloads-controller.js'
import { useSavedSitesList } from '../browser-saved-sites-controller.js'
import type { SpacesDockNav } from '../spaces/spaces-stage.js'
import { DOCK_HEIGHT, DOCK_REACH, TRAY_LIFT, dockLocation, trayApps, type DockPrefs, type TrayAppId } from './dock-model.js'
import { DockSurface } from './dock-surface.js'
import { DockTray } from './dock-tray.js'
import { useDockReveal } from './use-dock-reveal.js'

const SLIDE_MS = 200

export type AppDockProps = {
  nav: SpacesDockNav
  chats: readonly ChatRowSummary[]
  chatTitle: string | null
  browserVisible: boolean
  prefs: DockPrefs
  onPrefsChange: (patch: Partial<DockPrefs>) => void
  onLaunch: (id: Exclude<TrayAppId, 'saved-sites' | 'downloads'>) => void
  onOpenSite: (url: string) => void
  onAllSavedSites: () => void
}

/**
 * The dock along the bottom of the main window. Left: the overview, back/forward through where you
 * have zoomed, and where you are. Centre: the app tray. Right: dock settings. It hides until the
 * pointer reaches the bottom edge unless Keep visible is on.
 */
export function AppDock({ nav, chats, chatTitle, browserVisible, prefs, onPrefsChange, onLaunch, onOpenSite, onAllSavedSites }: AppDockProps): JSX.Element {
  const [openList, setOpenList] = useState<TrayAppId | 'settings' | null>(null)
  const [keyboard, setKeyboard] = useState(false)
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
  // State, not a ref: the surface renders first and has to measure the tray once it exists.
  const [tray, setTray] = useState<HTMLDivElement | null>(null)

  const runs = useAgentRuns()
  const downloads = useBrowserDownloadsController().downloads
  const savedSites = useSavedSitesList(true)
  const apps = useMemo(() => {
    const tiles = dockTiles(runs, chats, [])
    return trayApps({
      runningChats: chats.filter((row) => row.running).length,
      browserVisible,
      agentRuns: tiles.length,
      runningAgentRuns: runs.filter((run) => run.status === 'running').length,
      agentSummary: dockSummary(tiles),
      savedSites: savedSites.length,
      downloads: downloads.length,
      activeDownloads: downloads.filter((download) => download.state === 'progressing').length
    })
  }, [runs, chats, browserVisible, savedSites.length, downloads])
  const location = dockLocation({ overview: nav.overview, space: nav.spaceName, chat: chatTitle })

  return <TooltipProvider>
    <div ref={root} data-slot="app-dock" data-ui="dock.bar" data-state={shown || !down ? 'open' : 'closed'}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40" style={{ height: DOCK_REACH }}
      onFocus={(event) => { if (event.target.matches(':focus-visible')) { setKeyboard(true); show() } }}
      onBlur={(event) => { if (!root.current?.contains(event.relatedTarget as Node | null)) setKeyboard(false) }}>
      {/* The strip; the tray's tab rises out of its centre, so hiding moves both past the edge. */}
      <div style={{ height: DOCK_HEIGHT }} className={cn('pointer-events-auto absolute inset-x-0 bottom-0 flex items-center justify-between gap-2',
        'px-3 transition-transform duration-200 ease-out motion-reduce:transition-none',
        shown ? 'translate-y-0' : 'translate-y-[calc(100%+32px)]')}>
        {/* Behind the strip's controls: the strip's transform keeps -z-10 inside the dock. */}
        <DockSurface tray={tray} />
        <div className="flex max-w-[calc(50%-190px)] min-w-0 items-center gap-0.5">
          <Button variant="ghost" size="sm" data-ui="dock.overview" aria-pressed={nav.overview} disabled={nav.moving}
            className={cn(nav.overview && 'bg-accent text-accent-foreground')} onClick={nav.toggleOverview}>
            <LayoutGrid aria-hidden="true" />Overview
          </Button>
          <DockIconButton control="dock.back" label="Back (Alt+Left)" disabled={!nav.canBack || nav.moving} onClick={() => nav.step(-1)}>
            <ChevronLeft aria-hidden="true" />
          </DockIconButton>
          <DockIconButton control="dock.forward" label="Forward (Alt+Right)" disabled={!nav.canForward || nav.moving} onClick={() => nav.step(1)}>
            <ChevronRight aria-hidden="true" />
          </DockIconButton>
          <span className="ml-1.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground" aria-label={`You are in ${location.join(', ')}`}>
            {location.map((part, index) => <span key={index} className="flex min-w-0 items-center gap-1">
              {index > 0 && <ChevronRight className="size-3 shrink-0" aria-hidden="true" />}
              <span className={cn('truncate', index === location.length - 1 && 'text-foreground')}>{part}</span>
            </span>)}
          </span>
        </div>
        <div ref={setTray} className="absolute left-1/2 -translate-x-1/2" style={{ bottom: TRAY_LIFT }}>
          <DockTray apps={apps} magnify={prefs.magnify}
            openStack={openList === 'saved-sites' || openList === 'downloads' ? openList : null}
            onOpenStack={setOpenList}
            onLaunch={(id) => { if (id !== 'saved-sites' && id !== 'downloads') onLaunch(id) }}
            savedSites={savedSites} downloads={downloads}
            onOpenSite={(url) => { setOpenList(null); onOpenSite(url) }}
            onAllSavedSites={() => { setOpenList(null); onAllSavedSites() }}
            onRevealDownload={(id) => { void window.closedai.browserDownloads.reveal(id) }} />
        </div>
        {/* Dock lists do not hand focus back on close: the button's tooltip would reopen over the page. */}
        <Popover open={openList === 'settings'} onOpenChange={(open) => setOpenList(open ? 'settings' : null)}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon-sm" data-ui="dock.settings" aria-label="Dock settings"><SlidersHorizontal aria-hidden="true" /></Button>
              </PopoverTrigger>
            </TooltipTrigger>
            {openList !== 'settings' && <TooltipContent side="top">Dock settings</TooltipContent>}
          </Tooltip>
          <PopoverContent side="top" align="end" sideOffset={10} className="flex w-72 flex-col gap-3 p-3"
            onCloseAutoFocus={(event) => event.preventDefault()}>
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
  </TooltipProvider>
}

function DockIconButton({ control, label, disabled, onClick, children }: {
  control: string; label: string; disabled: boolean; onClick: () => void; children: JSX.Element
}): JSX.Element {
  return <Tooltip>
    <TooltipTrigger asChild>
      <Button variant="ghost" size="icon-sm" data-ui={control} aria-label={label} disabled={disabled} onClick={onClick}>{children}</Button>
    </TooltipTrigger>
    <TooltipContent side="top">{label}</TooltipContent>
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
