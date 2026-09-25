import type { JSX, ReactNode } from 'react'
import { Dock, DockIcon } from '../../components/ui/dock.js'
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar.js'
import { Button } from '../../components/ui/button.js'
import { Popover, PopoverAnchor, PopoverContent } from '../../components/ui/popover.js'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip.js'
import type { SavedSite } from '../../shared/saved-sites.js'
import type { BrowserDownload } from '../../shared/types.js'
import { APP_ICONS, AppIconMark } from '../app-icons.js'
import { BrowserSiteIcon } from '../browser-site-icon.js'
import { downloadActions, downloadDetail } from '../browser-downloads-model.js'
import { TRAY_ICON, TRAY_MAGNIFIED, type TrayApp, type TrayAppId } from './dock-model.js'

const STACK_ROWS = 8

export type DockTrayProps = {
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
}

/**
 * The app tray: Magic UI's Dock holding one rounded-square tile per ClosedAI surface. Every tile is
 * the same shape whatever it holds (a line icon today, a full-colour picture later), so a new icon
 * never changes the tray's size or spacing. The dot, tooltip and lists stay neutral.
 */
export function DockTray(props: DockTrayProps): JSX.Element {
  const { apps, magnify, openStack, onOpenStack, onLaunch } = props
  return <Dock data-slot="app-dock-tray" direction="bottom" iconSize={TRAY_ICON} iconMagnification={TRAY_MAGNIFIED}
    disableMagnification={!magnify}
    className="mx-0 mt-0 h-[54px] gap-1.5 border-border bg-background/70 px-2 py-[3px] shadow-lg">
    {apps.map((app) => <DockIcon key={app.id} padding={0} className="relative rounded-[22%]">
      <Popover open={openStack === app.id} onOpenChange={(open) => onOpenStack(open ? app.id : null)}>
        <PopoverAnchor asChild>
          <span className="absolute inset-0" aria-hidden="true" />
        </PopoverAnchor>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="relative size-full rounded-[22%] outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-ui="dock.app" data-ui-key={app.id} aria-label={`${app.label}: ${app.note}`}
              aria-haspopup={app.stack ? 'dialog' : undefined} aria-expanded={app.stack ? openStack === app.id : undefined}
              onClick={() => app.stack ? onOpenStack(openStack === app.id ? null : app.id) : onLaunch(app.id)}>
              <TrayTile id={app.id} />
              {app.active && <span className="absolute -bottom-[3px] left-1/2 size-1 -translate-x-1/2 rounded-full bg-foreground/70" aria-hidden="true" />}
            </button>
          </TooltipTrigger>
          {openStack !== app.id && <TooltipContent side="top" sideOffset={10} className="flex flex-col gap-0.5">
            <span className="font-medium">{app.label}</span>
            <span className="text-muted-foreground">{app.note}</span>
          </TooltipContent>}
        </Tooltip>
        {app.stack && <PopoverContent side="top" sideOffset={12} className="w-72 p-1.5">
          {app.id === 'saved-sites' ? <SavedSitesStack {...props} /> : <DownloadsStack {...props} />}
        </PopoverContent>}
      </Popover>
    </DockIcon>)}
  </Dock>
}

/** One tile: a picture fills it, a line icon sits in its middle on the tile's plain face. */
function TrayTile({ id }: { id: TrayAppId }): JSX.Element {
  const icon = APP_ICONS[id]
  return <Avatar className="size-full rounded-[22%] border border-border">
    {icon.kind === 'picture' && <AvatarImage src={icon.src} alt="" draggable={false} />}
    <AvatarFallback className="rounded-[22%] bg-secondary text-foreground">
      {icon.kind === 'line' && <AppIconMark id={id} size={TRAY_ICON} className="size-[46%]" />}
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

function StackRow({ ui, uiKey, icon, name, detail, disabled, onSelect }: {
  ui: string; uiKey: string; icon: ReactNode; name: string; detail: string; disabled?: boolean; onSelect: () => void
}): JSX.Element {
  return <Button variant="ghost" size="sm" className="h-auto justify-start gap-2.5 px-2 py-1.5 text-left font-normal disabled:opacity-100"
    data-ui={ui} data-ui-key={uiKey} disabled={disabled} onClick={onSelect}>
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
    {savedSites.slice(0, STACK_ROWS).map((site) => <StackRow key={site.id} ui="dock.saved-site" uiKey={site.id}
      icon={<BrowserSiteIcon favicon={site.favicon ?? undefined} />} name={site.title || siteHost(site.url)}
      detail={siteHost(site.url)} onSelect={() => onOpenSite(site.url)} />)}
  </StackList>
}

function DownloadsStack({ downloads, onRevealDownload }: DockTrayProps): JSX.Element {
  // Main lists newest first; a finished file opens its folder, a moving one only reports progress.
  const recent = downloads.slice(0, STACK_ROWS)
  return <StackList title="Downloads" empty={recent.length ? null : 'Files you download in the browser show here.'}>
    {recent.map((download) => <StackRow key={download.id} ui="dock.download" uiKey={download.id}
      icon={<AppIconMark id="downloads" size={15} />} name={download.filename} detail={downloadDetail(download)}
      disabled={!downloadActions(download).canReveal} onSelect={() => onRevealDownload(download.id)} />)}
  </StackList>
}
