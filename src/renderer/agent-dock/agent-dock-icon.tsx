import { useState, type JSX } from 'react'
import { HeroDockIcon } from '../../components/ui/hero-dock.js'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.js'
import { cn } from '../../lib/utils.js'
import { DOCK_STATE_LABEL, dockInitials, type DockTileState } from './agent-dock-model.js'
import { AgentDockTile, type AgentDockTileProps } from './agent-dock-tile.js'

// One run in the dock: a hero tile with its initials and its name beneath on hover, the hero's
// white badge when it needs the user, a small light under the tile while it works, and its card
// with the run controls on click.

const ATTENTION_BADGE: Partial<Record<DockTileState, string>> = { approval: '!', failed: '!', finished: '✓' }

export function AgentDockIcon({ tile, onOpenChat, ...controls }: AgentDockTileProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const working = tile.state === 'running' || tile.state === 'retrying'
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <HeroDockIcon data-ui="dock.run" data-ui-key={tile.chatId} data-run-state={tile.state}
          aria-label={`${tile.name}: ${DOCK_STATE_LABEL[tile.state]}`} label={tile.name} badge={ATTENTION_BADGE[tile.state]}>
          <span className="text-sm font-semibold tracking-wide transition-transform duration-200 group-hover:scale-110">
            {dockInitials(tile.name)}
          </span>
          {working && <span aria-hidden="true" data-slot="agent-dock-working"
            className={cn('absolute -bottom-2 size-1 rounded-full bg-white/70', tile.state === 'retrying' && 'animate-pulse')} />}
        </HeroDockIcon>
      </PopoverTrigger>
      {/* Portaled content inherits body type; text-xs keeps the card's Buttons at their own size. */}
      <PopoverContent side="top" sideOffset={10} className="w-72 p-0 text-xs" aria-label={`${tile.name} agent`}>
        <AgentDockTile tile={tile} {...controls} onOpenChat={(chatId) => { setOpen(false); onOpenChat(chatId) }} />
      </PopoverContent>
    </Popover>
  )
}
