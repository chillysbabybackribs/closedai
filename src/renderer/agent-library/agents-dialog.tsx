import { lazy, Suspense, type JSX } from 'react'
import type { AgentRunStartOptions } from '../../shared/agent-runs.js'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog.js'

const AgentLibraryView = lazy(async () => {
  const module = await import('./agent-library-view.js')
  return { default: module.AgentLibraryView }
})

/**
 * Agents is a modal over the workspace, never a tab. `anchor` is the chat it was opened from (null
 * when closed): runs start beside that chat's window. Opening a chat or starting a run closes it so
 * the chat is in view.
 */
export function AgentsDialog({ anchor, chats, onClose, onOpenChat, onStart }: {
  anchor: string | null
  chats: ChatRowSummary[]
  onClose: () => void
  onOpenChat: (chatId: string) => void
  onStart: (chatId: string, options: AgentRunStartOptions) => Promise<void>
}): JSX.Element {
  return <Dialog open={anchor !== null} onOpenChange={(open) => { if (!open) onClose() }}>
    <DialogContent className="agents-dialog" data-ui="view.agents" aria-describedby={undefined}>
      <DialogTitle className="sr-only">Agents</DialogTitle>
      <Suspense fallback={null}>
        {anchor !== null && <AgentLibraryView active startEnabled={chats.some((row) => row.paneId === anchor)} chats={chats}
          onOpenChat={(chatId) => { onClose(); onOpenChat(chatId) }}
          onStart={async (options) => { await onStart(anchor, options); onClose() }} />}
      </Suspense>
    </DialogContent>
  </Dialog>
}
