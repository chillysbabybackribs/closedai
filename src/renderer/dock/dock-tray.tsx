import type { JSX, ReactNode } from 'react'
import { Grid2X2 } from 'lucide-react'
import { cn } from '../../lib/utils.js'
import { Dock, DockIcon } from '../../components/ui/dock.js'
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar.js'
import { Button } from '../../components/ui/button.js'
import { Separator } from '../../components/ui/separator.js'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.js'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip.js'
import type { SavedSite } from '../../shared/saved-sites.js'
import type { BrowserDownload } from '../../shared/types.js'
import { APP_ICONS, AppIconMark, type AppIconId } from '../app-icons.js'
import type { MinimizedWindow } from '../chat-layout/floating/minimized-windows.js'
import { BrowserSiteIcon } from '../browser-site-icon.js'
import { downloadActions, downloadDetail } from '../browser-downloads-model.js'
import { TRAY_ICON, TRAY_MAGNIFIED, type TrayApp, type TrayAppId } from './dock-model.js'
const STACK_ROWS = 8

export type DockTrayProps = {
  /** Start tile trigger (wrapped by the dock-level popover). */
  startTrigger: ReactNode
  apps: readonly TrayApp[]
  magnify: boolean
  /** The stack whose list is open above its icon. */
  openStack: TrayAppId | null
  onOpenStack: (id: TrayAppId | null) => void
  onLaunch: (id: TrayAppId) => void
  savedSites: readonly SavedSite[]
  downloads: readonly BrowserDownload[]
  onOpenSite: (url: string) => void
  onAllSavedSites: () => void
  onRevealDownload: (id: string) => void
  /** Windows minimized in the shown workspace, after the apps like a desktop dock's. */
  minimized: readonly MinimizedWindow[]
  onRestoreWindow: (id: string) => void
}

/**
 * The app tray: Magic UI's Dock holding one rounded-square tile per ClosedAI surface. Every tile is
 * the same shape whatever it holds (a line icon today, a full-colour picture later), so a new icon
 * never changes the tray's size or spacing. The dot, tooltip and lists stay neutral.
 */
export function DockTray(props: DockTrayProps): JSX.Element {
  const { startTrigger, apps, magnify, openStack, onOpenStack, onLaunch, minimized, onRestoreWindow } = props
  return <Dock data-slot="app-dock-tray" direction="bottom" iconSize={TRAY_ICON} iconMagnification={TRAY_MAGNIFIED}
    disableMagnification={!magnify}
    // The tab behind it is DockSurface, so the tray itself draws nothing. It fills the tab above the
    // strip: height TRAY_ICON + TAB_PADDING, and p-2.5 is TAB_PADDING at the sides and top.
    className="mx-0 mt-0 h-[58px] gap-2 rounded-none border-0 bg-transparent p-2.5 pb-0 backdrop-blur-none">
    <DockIcon padding={0} className="relative rounded-[22%]">{startTrigger}</DockIcon>
    {apps.map((app) => <DockIcon key={app.id} padding={0} className="relative rounded-[22%]">
      {app.stack
        ? <Popover open={openStack === app.id} onOpenChange={(open) => onOpenStack(open ? app.id : null)}>
            <TrayButton app={app} stackOpen={openStack === app.id} />
            <PopoverContent side="top" sideOffset={12} className="w-72 p-1.5" onCloseAutoFocus={(event) => event.preventDefault()}>
              {app.id === 'saved-sites' ? <SavedSitesStack {...props} /> : <DownloadsStack {...props} />}
            </PopoverContent>
          </Popover>
        : <TrayButton app={app} onLaunch={onLaunch} />}
    </DockIcon>)}
    {minimized.length > 0 && <Separator orientation="vertical" className="mx-1 h-9 self-center" />}
    {minimized.map((entry) => <DockIcon key={entry.id} padding={0} className="relative rounded-[22%]">
      <MinimizedButton entry={entry} onRestore={onRestoreWindow} />
    </DockIcon>)}
  </Dock>
}

export function StartTrayButton({ open, overviewActive }: { open: boolean; overviewActive: boolean }): JSX.Element {
  const button = <button type="button" className={cn('relative size-full rounded-[22%] outline-none focus-visible:ring-2 focus-visible:ring-ring',
    overviewActive && 'ring-2 ring-ring ring-offset-2 ring-offset-background')}
    data-ui="dock.start" aria-expanded={open} aria-haspopup="dialog" aria-label="Open Start">
    <Avatar className="size-full rounded-[22%] border border-border">
      <AvatarFallback className="rounded-[22%] bg-secondary text-foreground">
        <Grid2X2 className="size-[50%]" aria-hidden="true" />
      </AvatarFallback>
    </Avatar>
  </button>
  return <Tooltip>
    <TooltipTrigger asChild>
      <PopoverTrigger asChild>{button}</PopoverTrigger>
    </TooltipTrigger>
    {!open && <TooltipContent side="top" sideOffset={10} className="flex flex-col gap-0.5">
      <span className="font-medium">Start</span>
      <span className="text-muted-foreground">Apps, search, and workspace</span>
    </TooltipContent>}
  </Tooltip>
}

/** A tray icon with its tooltip; a stack's icon is also the trigger of its list. */
function TrayButton({ app, stackOpen = false, onLaunch }: { app: TrayApp; stackOpen?: boolean; onLaunch?: (id: TrayAppId) => void }): JSX.Element {
  const button = <button type="button" className="relative size-full rounded-[22%] outline-none focus-visible:ring-2 focus-visible:ring-ring"
    data-ui="dock.app" data-ui-key={app.id} aria-label={`${app.label}: ${app.note}`}
    onClick={onLaunch ? () => onLaunch(app.id) : undefined}>
    <TrayTile id={app.id} />
    {app.active && <span className="absolute -bottom-[5px] left-1/2 size-1 -translate-x-1/2 rounded-full bg-foreground/70" aria-hidden="true" />}
  </button>
  return <Tooltip>
    <TooltipTrigger asChild>{app.stack ? <PopoverTrigger asChild>{button}</PopoverTrigger> : button}</TooltipTrigger>
    {!stackOpen && <TooltipContent side="top" sideOffset={10} className="flex flex-col gap-0.5">
      <span className="font-medium">{app.label}</span>
      <span className="text-muted-foreground">{app.note}</span>
    </TooltipContent>}
  </Tooltip>
}

/** A minimized window's tile: its kind's icon, named by its front tab; a click puts it back. */
function MinimizedButton({ entry, onRestore }: { entry: MinimizedWindow; onRestore: (id: string) => void }): JSX.Element {
  const detail = entry.tabs > 1 ? `Minimized, ${entry.tabs} tabs` : 'Minimized'
  return <Tooltip>
    <TooltipTrigger asChild>
      <button type="button" className="relative size-full rounded-[22%] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-ui="dock.window" data-ui-key={entry.id} aria-label={`Restore ${entry.title} (${detail.toLowerCase()})`}
        onClick={() => onRestore(entry.id)}>
        <TrayTile id={entry.icon} />
      </button>
    </TooltipTrigger>
    <TooltipContent side="top" sideOffset={10} className="flex flex-col gap-0.5">
      <span className="font-medium">{entry.title}</span>
      <span className="text-muted-foreground">{detail}</span>
    </TooltipContent>
  </Tooltip>
}

/** One tile: a picture fills it, a line icon sits in its middle on the tile's plain face. */
function TrayTile({ id }: { id: TrayAppId | AppIconId }): JSX.Element {
  const icon = APP_ICONS[id]
  return <Avatar className="size-full rounded-[22%] border border-border">
    {icon.kind === 'picture' && <AvatarImage src={icon.src} alt="" draggable={false} />}
    <AvatarFallback className="rounded-[22%] bg-secondary text-foreground">
      {icon.kind === 'line' && <AppIconMark id={id} size={TRAY_ICON} className="size-[50%]" />}
    </AvatarFallback>
  </Avatar>
}

function StackList({ title, empty, children, footer }: { title: string; empty: string | null; children: ReactNode; footer?: ReactNode }): JSX.Element {
  return <div className="flex flex-col gap-0.5">
    <div className="px-2 pt-1 pb-1.5 text-xs font-medium text-muted-foreground">{title}</div>
    {empty ? <div className="px-2 pb-2 text-sm text-muted-foreground">{empty}</div> : children}
    {footer}
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

function siteHost(url: string): string {
  try { return new URL(url).host } catch { return url }
}

function SavedSitesStack({ savedSites, onOpenSite, onAllSavedSites }: DockTrayProps): JSX.Element {
  return <StackList title="Saved sites" empty={savedSites.length ? null : 'Star a page in the browser to keep it here.'}
    footer={<Button variant="ghost" size="sm" className="justify-start px-2 text-muted-foreground" data-ui="dock.all-saved-sites"
      onClick={onAllSavedSites}>All saved sites</Button>}>
    {savedSites.slice(0, STACK_ROWS).map((site) => <StackRow key={site.id} control="dock.saved-site" uiKey={site.id}
      icon={<BrowserSiteIcon favicon={site.favicon ?? undefined} />} name={site.title || siteHost(site.url)}
      detail={siteHost(site.url)} onSelect={() => onOpenSite(site.url)} />)}
  </StackList>
}

function DownloadsStack({ downloads, onRevealDownload }: DockTrayProps): JSX.Element {
  // Main lists newest first; a finished file opens its folder, a moving one only reports progress.
  const recent = downloads.slice(0, STACK_ROWS)
  return <StackList title="Downloads" empty={recent.length ? null : 'Files you download in the browser show here.'}>
    {recent.map((download) => <StackRow key={download.id} control="dock.download" uiKey={download.id}
      icon={<AppIconMark id="downloads" size={15} />} name={download.filename} detail={downloadDetail(download)}
      disabled={!downloadActions(download).canReveal} onSelect={() => onRevealDownload(download.id)} />)}
  </StackList>
}
