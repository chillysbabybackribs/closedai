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

function DockTab({ group, boundary, busy, onRestore, onPreview, onPeekGroup }: {
  group: DockGroup; boundary: HTMLElement | null; busy: boolean
  onRestore: (id: string) => void; onPreview: (id: string | null) => void; onPeekGroup: (id: string | null) => void
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
    if (!open) {
      onPreview(null)
      onPeekGroup(null)
      return
    }
    if (previewId) onPreview(previewId)
    onPeekGroup(group.id)
    return () => {
      onPreview(null)
      onPeekGroup(null)
    }
  }, [open, previewId, group.id, onPreview, onPeekGroup])
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
      <HoverCard.Content className="chat-dock-preview-anchor" side="top" align="start" sideOffset={0}
        collisionBoundary={boundary} collisionPadding={8}>
        <span className="chat-dock-preview-sr">
          {detail ? `${detail}. ` : ''}{chatIds.length > 1 ? `${chatIds.length} chats in group. ` : ''}Live preview shown above the dock rail. Click tab to restore.
        </span>
      </HoverCard.Content>
    </HoverCard.Portal>
  </HoverCard.Root>
}

export function ChatDockRail({ rail, busy, onRestore, onPreview, onPeekGroup }: {
  rail: Rail; busy: boolean; onRestore: (id: string) => void; onPreview: (id: string | null) => void
  onPeekGroup: (id: string | null) => void
}) {
  const [boundary, setBoundary] = useState<HTMLDivElement | null>(null)
  return <>
    <div className="chat-dock-boundary" ref={setBoundary} style={position(rail.boundary)} data-dock-boundary={rail.id} />
    <div className="chat-dock-rail" style={position(rail.rect)} data-dock-rail={rail.id}>
      <Toolbar.Root className="chat-dock-rail-track" aria-label="Docked chat groups">
        <span className="chat-dock-rail-mark" aria-hidden="true">
          <PanelBottom size={14} strokeWidth={1.65} />
        </span>
        {rail.groups.map((group) => <DockTab key={group.id} group={group} boundary={boundary}
          busy={busy} onRestore={onRestore} onPreview={onPreview} onPeekGroup={onPeekGroup} />)}
      </Toolbar.Root>
    </div>
  </>
}
