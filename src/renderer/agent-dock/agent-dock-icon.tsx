import { useState, type JSX } from 'react'
import { HeroDockIcon } from '../../components/ui/hero-dock.js'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.js'
import { cn } from '../../lib/utils.js'
import { DOCK_STATE_LABEL, dockInitials, type DockTile } from './agent-dock-model.js'
import { AgentDockTile, DOCK_STATE_TONE, type AgentDockTileProps } from './agent-dock-tile.js'

// One run in the dock: a hero tile with its initials and a status dot, the state and current line
// in its tooltip, and its card with the run controls on click. A run that needs the user rings its tile.

const ATTENTION_RING: Partial<Record<DockTile['state'], string>> = {
  approval: 'ring-2 ring-(--link-ink)',
  finished: 'ring-2 ring-(--link-ink)',
  failed: 'ring-2 ring-destructive'
}

export function AgentDockIcon({ tile, onOpenChat, ...controls }: AgentDockTileProps): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <HeroDockIcon data-ui="dock.run" data-ui-key={tile.chatId} data-state={tile.state} side="top"
          label={`${tile.name}: ${DOCK_STATE_LABEL[tile.state]}`} className={ATTENTION_RING[tile.state]}
          tip={<>
            <p className="font-medium">{tile.name}</p>
            <p className="text-muted-foreground">{DOCK_STATE_LABEL[tile.state]} · {tile.detail}</p>
          </>}>
          <span className="text-sm font-semibold tracking-wide">{dockInitials(tile.name)}</span>
          <span aria-hidden="true"
            className={cn('absolute -right-1 -bottom-1 size-3 rounded-full ring-2 ring-(--surface-raised)', DOCK_STATE_TONE[tile.state])} />
        </HeroDockIcon>
      </PopoverTrigger>
      {/* Portaled content inherits body type; text-xs keeps the card's Buttons at their own size. */}
      <PopoverContent side="top" sideOffset={10} className="w-72 p-0 text-xs" aria-label={`${tile.name} agent`}>
        <AgentDockTile tile={tile} {...controls} onOpenChat={(chatId) => { setOpen(false); onOpenChat(chatId) }} />
      </PopoverContent>
    </Popover>
  )
}
