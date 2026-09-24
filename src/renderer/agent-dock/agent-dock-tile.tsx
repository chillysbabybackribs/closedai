import type { JSX } from 'react'
import { MessageSquareText } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../components/ui/card.js'
import { useAgentRunAction } from '../agent-runs/use-agent-run-action.js'
import type { DockTile } from './agent-dock-model.js'

// One running or paused agent in the dock: name and status dot, the cycle it is on, one line of
// what it is doing or why it stopped, and the run controls. Open chat is the only way a run
// takes layout space, and the user chooses it.

export type AgentDockTileProps = {
  tile: DockTile
  onOpenChat: (chatId: string) => void
  onPause: (chatId: string) => Promise<unknown>
  onResume: (chatId: string) => Promise<unknown>
  onStop: (chatId: string) => Promise<unknown>
}

export function AgentDockTile({ tile, onOpenChat, onPause, onResume, onStop }: AgentDockTileProps): JSX.Element {
  const { busy, error, act } = useAgentRunAction()
  const review = tile.state === 'approval'
  const finished = tile.state === 'finished'
  return (
    <Card className="agent-dock-tile gap-2 rounded-lg py-3 shadow-none" data-state={tile.state}>
      <CardHeader className="gap-1 px-3">
        <CardTitle className="flex min-w-0 items-center gap-2 text-sm">
          <span className="agent-dock-dot" data-state={tile.state} aria-hidden="true" />
          <span className="truncate" title={tile.name}>{tile.name}</span>
        </CardTitle>
        <CardDescription className="text-xs">{tile.cycleLabel}</CardDescription>
        <CardAction>
          <Button type="button" variant="ghost" size="icon-xs" data-ui="dock.open-chat" data-ui-key={tile.chatId}
            aria-label={`Open ${tile.name} as a chat`} title="Open as a chat" onClick={() => onOpenChat(tile.chatId)}>
            <MessageSquareText />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="agent-dock-detail truncate px-3 text-xs" title={error || tile.detail}>
        {error || tile.detail}
      </CardContent>
      <CardFooter className="gap-1 px-3">
        {review ? (
          <Button type="button" variant="outline" size="xs" data-ui="dock.review" data-ui-key={tile.chatId}
            onClick={() => onOpenChat(tile.chatId)}>Review</Button>
        ) : tile.running ? (
          <Button type="button" variant="outline" size="xs" data-ui="dock.pause" data-ui-key={tile.chatId} disabled={busy}
            onClick={() => void act(() => onPause(tile.chatId))}>Pause</Button>
        ) : finished ? null : (
          <Button type="button" variant="outline" size="xs" data-ui="dock.resume" data-ui-key={tile.chatId} disabled={busy}
            onClick={() => void act(() => onResume(tile.chatId))}>Resume</Button>
        )}
        {/* A finished run has nothing left to stop; ending it clears the tile and keeps the chat. */}
        <Button type="button" variant={finished ? 'outline' : 'ghost'} size="xs" data-ui="dock.stop" data-ui-key={tile.chatId}
          disabled={busy} onClick={() => void act(() => onStop(tile.chatId))}>{finished ? 'Dismiss' : 'Stop'}</Button>
      </CardFooter>
    </Card>
  )
}
