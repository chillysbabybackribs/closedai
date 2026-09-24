import { Fragment, type JSX } from 'react'
import { MessageSquareText } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import { cn } from '../../lib/utils.js'
import { useAgentRunAction } from '../agent-runs/use-agent-run-action.js'
import { DOCK_STATE_LABEL, type DockTile, type DockTileState } from './agent-run-overview-model.js'

// One agent run in the Agents tab runs table: a row with status, activity, and controls, then a
// second row of plain sentences on progress, the last reply, cost, and errors.

/** The status colour a run shows on its icon badge, in theme tokens. */
export const DOCK_STATE_TONE: Record<DockTileState, string> = {
  running: 'bg-(--ok-ink)',
  retrying: 'bg-(--ok-ink) animate-pulse',
  paused: 'bg-muted-foreground',
  finished: 'bg-(--link-ink)',
  approval: 'bg-(--link-ink) animate-pulse',
  failed: 'bg-destructive animate-pulse'
}

export type AgentRunCardProps = {
  tile: DockTile
  onOpenChat: (chatId: string) => void
  onPause: (chatId: string) => Promise<unknown>
  onResume: (chatId: string) => Promise<unknown>
  onStop: (chatId: string) => Promise<unknown>
}

export function AgentRunCard({ tile, onOpenChat, onPause, onResume, onStop }: AgentRunCardProps): JSX.Element {
  const { busy, error, act } = useAgentRunAction()
  const review = tile.state === 'approval'
  const finished = tile.state === 'finished'
  const detailTone = tile.state === 'failed' ? 'text-destructive' : review || finished ? 'text-(--link-ink)' : 'text-muted-foreground'
  const detail = error || tile.detail
  return (
    <Fragment>
    <tr data-ui="agents.run" data-ui-key={tile.chatId} data-state={tile.state}>
      <td className="agent-run-table-name">
        <span className={cn('agent-run-table-dot', DOCK_STATE_TONE[tile.state])} aria-hidden="true" />
        <span className="truncate font-medium" title={tile.name}>{tile.name}</span>
      </td>
      <td className="agent-run-table-meta text-muted-foreground">
        {DOCK_STATE_LABEL[tile.state]} · {tile.cycleLabel}
      </td>
      <td className={cn('agent-run-table-detail truncate', error ? 'text-destructive' : detailTone)} title={detail}>
        {detail}
      </td>
      <td className="agent-run-table-actions">
        <Button type="button" variant="ghost" size="icon-xs" data-ui="agents.open-chat" data-ui-key={tile.chatId}
          aria-label={`Open ${tile.name} as a chat`} title="Open as a chat" onClick={() => onOpenChat(tile.chatId)}>
          <MessageSquareText />
        </Button>
        {review ? (
          <Button type="button" variant="ghost" size="xs" data-ui="agents.review" data-ui-key={tile.chatId}
            onClick={() => onOpenChat(tile.chatId)}>Review</Button>
        ) : tile.running ? (
          <Button type="button" variant="ghost" size="xs" data-ui="agents.pause" data-ui-key={tile.chatId} disabled={busy}
            onClick={() => void act(() => onPause(tile.chatId))}>Pause</Button>
        ) : finished ? null : (
          <Button type="button" variant="ghost" size="xs" data-ui="agents.resume" data-ui-key={tile.chatId} disabled={busy}
            onClick={() => void act(() => onResume(tile.chatId))}>Resume</Button>
        )}
        <Button type="button" variant="ghost" size="xs" data-ui="agents.stop" data-ui-key={tile.chatId}
          disabled={busy} onClick={() => void act(() => onStop(tile.chatId))}>{finished ? 'Dismiss' : 'Stop'}</Button>
      </td>
    </tr>
    <tr className="agent-run-table-brief" data-state={tile.state}>
      <td colSpan={4}>
        {tile.brief.map((line) => (
          <p key={line.kind} className="agent-run-brief-line" data-kind={line.kind}
            title={line.kind === 'reply' ? undefined : line.text}>{line.text}</p>
        ))}
      </td>
    </tr>
    </Fragment>
  )
}
