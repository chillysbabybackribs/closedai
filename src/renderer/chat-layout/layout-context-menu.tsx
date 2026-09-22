import { createContext, useContext, type ReactNode } from 'react'
import { ContextMenu } from 'radix-ui'
import { ArrowLeftToLine, ArrowRightToLine, LayoutGrid, PanelLeftClose, Pause, Pencil, Pin, PinOff, Play, X } from 'lucide-react'
import type { TabActivity } from './tab-activity.js'
import type { TileDirection } from './layout-tabs.js'

const ICON = 16

/** Workspace-level layout actions the menu can offer without every canvas prop threading them. */
export const ChatLayoutActions = createContext<{ moveTab?: (id: string, direction: TileDirection) => void }>({})

export function ChatLayoutContextMenu({ activeId, tabs, chatCount, busy, hideHint, closeHint, tabActivity,
  pinned, onOpenPresets, onRename, onTogglePin, onPause, onResume, onCloseTab, onHide
}: {
  activeId: string
  tabs: string[]
  chatCount: number
  busy: boolean
  hideHint: string
  closeHint: string
  tabActivity?: TabActivity
  pinned: boolean
  onOpenPresets?: () => void
  onRename?: () => void
  onTogglePin?: () => void
  onPause?: () => void
  onResume?: () => void
  onCloseTab: () => void
  onHide: () => void
}): ReactNode {
  return <ContextMenu.Portal>
    <ChatLayoutContextMenuContent activeId={activeId} tabs={tabs} chatCount={chatCount} busy={busy}
      hideHint={hideHint} closeHint={closeHint} tabActivity={tabActivity} pinned={pinned}
      onOpenPresets={onOpenPresets} onRename={onRename} onTogglePin={onTogglePin}
      onPause={onPause} onResume={onResume} onCloseTab={onCloseTab} onHide={onHide} />
  </ContextMenu.Portal>
}

/** Menu body (also mounted in tests without Radix portal). */
export function ChatLayoutContextMenuContent(props: Parameters<typeof ChatLayoutContextMenu>[0]): ReactNode {
  const { activeId, tabs, chatCount, busy, hideHint, closeHint, tabActivity, pinned, onOpenPresets, onRename,
    onTogglePin, onPause, onResume, onCloseTab, onHide } = props
  const { moveTab } = useContext(ChatLayoutActions)
  const canHidePane = chatCount >= 2
  const canCloseTab = tabs.length > 1
  // The keyboard path for a tab drag between tiles; the chat stays selected, so no IPC is involved.
  const canMoveTab = Boolean(moveTab) && chatCount >= 2
  const turnControl = tabActivity?.state === 'working' ? 'pause'
    : tabActivity?.state === 'paused' ? 'resume' : null
  const hasChatActions = Boolean(onRename || onTogglePin || turnControl)
  const hasCloseActions = canCloseTab || canHidePane || canMoveTab
  const hasFollowing = Boolean(onOpenPresets || hasChatActions)

  return <ContextMenu.Content className="titlebar-menu-content chat-layout-context-menu" loop>
    {canCloseTab && (
      <LayoutMenuRow data-ui="layout.tab-close" data-ui-key={activeId} label="Close tab" hint={closeHint}
        shortcut="Ctrl+W" icon={<X size={ICON} aria-hidden="true" />} disabled={busy} onSelect={onCloseTab} />
    )}
    {canHidePane && (
      <LayoutMenuRow data-ui="layout.pane-hide" data-ui-key={activeId} label="Hide pane" hint={hideHint}
        icon={<PanelLeftClose size={ICON} aria-hidden="true" />} disabled={busy} onSelect={onHide} />
    )}
    {canMoveTab && <>
      <LayoutMenuRow data-ui="layout.tab-move" data-ui-key="next" label="Move tab to next pane"
        icon={<ArrowRightToLine size={ICON} aria-hidden="true" />} disabled={busy} onSelect={() => moveTab!(activeId, 'next')} />
      <LayoutMenuRow data-ui="layout.tab-move" data-ui-key="previous" label="Move tab to previous pane"
        icon={<ArrowLeftToLine size={ICON} aria-hidden="true" />} disabled={busy} onSelect={() => moveTab!(activeId, 'previous')} />
    </>}
    {hasCloseActions && hasFollowing && <ContextMenu.Separator className="titlebar-menu-separator" />}
    {onOpenPresets && (
      <LayoutMenuRow data-ui="layout.presets" data-ui-key={activeId} label="Workspace layout…"
        icon={<LayoutGrid size={ICON} aria-hidden="true" />} disabled={busy} onSelect={onOpenPresets} />
    )}
    {hasChatActions && <>
      {onOpenPresets && <ContextMenu.Separator className="titlebar-menu-separator" />}
      {onRename && (
        <LayoutMenuRow data-ui="layout.rename" data-ui-key={activeId} label="Rename…"
          icon={<Pencil size={ICON} aria-hidden="true" />} onSelect={onRename} />
      )}
      {onTogglePin && (
        <LayoutMenuRow data-ui="layout.pin" data-ui-key={activeId} label={pinned ? 'Unpin chat' : 'Pin chat'}
          icon={pinned ? <PinOff size={ICON} aria-hidden="true" /> : <Pin size={ICON} aria-hidden="true" />}
          onSelect={onTogglePin} />
      )}
      {turnControl === 'pause' && onPause && (
        <LayoutMenuRow data-ui="layout.pause-tab" data-ui-key={activeId} label="Pause task"
          icon={<Pause size={ICON} aria-hidden="true" />} disabled={busy} onSelect={onPause} />
      )}
      {turnControl === 'resume' && onResume && (
        <LayoutMenuRow data-ui="layout.resume-tab" data-ui-key={activeId} label="Resume task"
          icon={<Play size={ICON} aria-hidden="true" />} disabled={busy} onSelect={onResume} />
      )}
    </>}
  </ContextMenu.Content>
}

function LayoutMenuRow({ label, hint, shortcut, icon, disabled, onSelect, ...rest }: {
  label: string
  hint?: string
  shortcut?: string
  icon: ReactNode
  disabled?: boolean
  onSelect: () => void
  'data-ui': string
  'data-ui-key': string
}): ReactNode {
  return <ContextMenu.Item className="titlebar-menu-item chat-layout-menu-item" disabled={disabled}
    onSelect={onSelect} {...rest}>
    <div className="chat-layout-menu-item-main">
      <div className="chat-layout-menu-item-left">
        {icon}
        <span>{label}</span>
      </div>
      {hint && <span className="chat-layout-menu-item-hint">{hint}</span>}
    </div>
    {shortcut && <span className="titlebar-menu-shortcut">{shortcut}</span>}
  </ContextMenu.Item>
}
