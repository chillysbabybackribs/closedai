import { useState, type JSX } from 'react'
import { Avatar, AvatarBadge, AvatarFallback } from '../../components/ui/avatar.js'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.js'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip.js'
import { cn } from '../../lib/utils.js'
import { DOCK_STATE_LABEL, dockInitials, type DockTile } from './agent-dock-model.js'
import { AgentDockTile, DOCK_STATE_TONE, type AgentDockTileProps } from './agent-dock-tile.js'

// One run in the dock: its initials with a status badge, the state and current line on hover, and
// its card with the run controls on click. A run that needs the user rings its icon.

const ATTENTION_RING: Partial<Record<DockTile['state'], string>> = {
  approval: 'ring-2 ring-(--link-ink)',
  finished: 'ring-2 ring-(--link-ink)',
  failed: 'ring-2 ring-destructive'
}

export function AgentDockIcon({ tile, onOpenChat, ...controls }: AgentDockTileProps): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button type="button" data-ui="dock.run" data-ui-key={tile.chatId} data-state={tile.state}
              aria-label={`${tile.name}: ${DOCK_STATE_LABEL[tile.state]}`}
              className="absolute inset-0 rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              <Avatar className={cn('size-full overflow-visible', ATTENTION_RING[tile.state])}>
                <AvatarFallback className="bg-accent text-[0.6rem] font-semibold text-accent-foreground">
                  {dockInitials(tile.name)}
                </AvatarFallback>
                <AvatarBadge className={cn('-right-0.5 -bottom-0.5 size-2 ring-(--titlebar-surface)', DOCK_STATE_TONE[tile.state])} />
              </Avatar>
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-64">
          <p className="font-medium">{tile.name}</p>
          <p className="text-muted-foreground">{DOCK_STATE_LABEL[tile.state]} · {tile.detail}</p>
        </TooltipContent>
      </Tooltip>
      {/* Portaled content inherits body type; text-xs keeps the card's Buttons at their own size. */}
      <PopoverContent side="top" sideOffset={10} className="w-72 p-0 text-xs" aria-label={`${tile.name} agent`}>
        <AgentDockTile tile={tile} {...controls} onOpenChat={(chatId) => { setOpen(false); onOpenChat(chatId) }} />
      </PopoverContent>
    </Popover>
  )
}
