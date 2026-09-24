import { useEffect, useState } from 'react'
import { PanelBottom } from 'lucide-react'
import { HoverCard, Toolbar } from 'radix-ui'
import type { layoutGeometry } from './layout-tree.js'
import { isViewTabId } from './layout-tree.js'
import { useWorkspacePaneSlice } from './workspace-pane-subscription.js'
import type { DockGroup } from './layout-docking.js'
import type { Rect } from './layout-tree.js'

type Rail = ReturnType<typeof layoutGeometry>['rails'][number]
const position = (rect: Rect) => ({ left: rect.x, top: rect.y, width: rect.width, height: rect.height })

function LivePreview({ paneId }: { paneId: string }) {
  const { state, chats } = useWorkspacePaneSlice(paneId)
  const row = chats.find((chat) => chat.paneId === paneId)
  const messages = state?.items.filter((item) => item.type === 'user' || item.type === 'assistant').slice(-3)
  return <>
    <div className="chat-dock-preview-heading"><strong>{row?.title ?? 'Chat preview'}</strong>
      <span>{state?.activeTurnId || row?.running ? 'Working' : row?.paused ? 'Paused' : 'Chat'}</span></div>
    <div className="chat-dock-preview-messages">
      {messages?.length ? messages.map((item) => <div key={item.id} className="chat-dock-message" data-role={item.type}>
        <span>{item.type === 'user' ? 'You' : 'Assistant'}</span>
        <p>{'text' in item ? item.text.slice(-1000) : ''}</p>
      </div>) : <p className="chat-dock-empty">{row?.preview || 'No messages yet'}</p>}
    </div>
  </>
}

function DockTab({ group, boundary, width, busy, onRestore, onPreview }: {
  group: DockGroup; boundary: HTMLElement | null; width: number; busy: boolean
  onRestore: (id: string) => void; onPreview: (id: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const chatIds = (group.tabs ?? [group.id]).filter((id) => !isViewTabId(id))
  const previewId = chatIds.includes(group.id) ? group.id : chatIds[0]
  const { chats } = useWorkspacePaneSlice(previewId ?? group.id)
  const activeTitle = previewId
    ? chats.find((row) => row.paneId === previewId)?.title?.trim()
    : undefined
  const detail = activeTitle && activeTitle !== 'New chat' ? activeTitle : null
  useEffect(() => {
    if (!open || !previewId) return
    onPreview(previewId)
    return () => onPreview(null)
  }, [open, previewId, onPreview])
  return <HoverCard.Root open={open} onOpenChange={setOpen} openDelay={350} closeDelay={150}>
    <HoverCard.Trigger asChild>
      <Toolbar.Button className="chat-dock-tab" data-ui="layout.dock-restore" data-ui-key={group.id}
        disabled={busy} aria-label={`Restore Group ${group.dockNumber ?? 1}${detail ? `: ${detail}` : ''}${chatIds.length > 1 ? `, ${chatIds.length} chats` : ''}`}
        onClick={() => { setOpen(false); onRestore(group.id) }}>
        <span className="chat-dock-tab-name">Group {group.dockNumber ?? 1}</span>
        {detail ? <span className="chat-dock-tab-detail">{detail}</span> : null}
      </Toolbar.Button>
    </HoverCard.Trigger>
    <HoverCard.Portal>
      <HoverCard.Content className="chat-dock-preview" side="top" align="start" sideOffset={8}
        collisionBoundary={boundary} collisionPadding={8} style={{ width: Math.min(340, Math.max(120, width - 16)) }}>
        {previewId ? <LivePreview paneId={previewId} /> : <p className="chat-dock-empty">Workspace view</p>}
        <div className="chat-dock-preview-footer">{chatIds.length > 1 ? `${chatIds.length} chats · ` : ''}Click tab to restore</div>
      </HoverCard.Content>
    </HoverCard.Portal>
  </HoverCard.Root>
}

export function ChatDockRail({ rail, busy, onRestore, onPreview }: {
  rail: Rail; busy: boolean; onRestore: (id: string) => void; onPreview: (id: string | null) => void
}) {
  const [boundary, setBoundary] = useState<HTMLDivElement | null>(null)
  return <>
    <div className="chat-dock-boundary" ref={setBoundary} style={position(rail.boundary)} data-dock-boundary={rail.id} />
    <div className="chat-dock-rail" style={position(rail.rect)} data-dock-rail={rail.id}>
      <Toolbar.Root className="chat-dock-rail-track" aria-label="Docked chat groups">
        <span className="chat-dock-rail-mark" aria-hidden="true">
          <PanelBottom size={14} strokeWidth={1.65} />
        </span>
        {rail.groups.map((group) => <DockTab key={group.id} group={group} boundary={boundary} width={rail.rect.width}
          busy={busy} onRestore={onRestore} onPreview={onPreview} />)}
      </Toolbar.Root>
    </div>
  </>
}
