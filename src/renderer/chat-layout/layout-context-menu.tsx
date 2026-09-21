import type { ReactNode } from 'react'
import { ContextMenu } from 'radix-ui'
import {
  Maximize2, Minimize2, PanelBottom, PanelLeftClose, PanelRight, Pause, Pencil, Pin, PinOff, Play,
  Sparkles, X
} from 'lucide-react'
import type { TabActivity } from './tab-activity.js'

const ICON = 16

export function ChatLayoutContextMenu({ activeId, tabs, chatCount, busy, isTileSolo, canMaximize,
  hideHint, closeHint, tabActivity, pinned, canRegenerateTitle, onRestore, onMaximize, onSplitRight,
  onSplitBelow, onRename, onRetryTitle, onTogglePin, onPause, onResume, onCloseTab, onHide
}: {
  activeId: string
  tabs: string[]
  chatCount: number
  busy: boolean
  isTileSolo: boolean
  canMaximize: boolean
  hideHint: string
  closeHint: string
  tabActivity?: TabActivity
  pinned: boolean
  canRegenerateTitle: boolean
  onRestore: () => void
  onMaximize: () => void
  onSplitRight: () => void
  onSplitBelow: () => void
  onRename?: () => void
  onRetryTitle?: () => void
  onTogglePin?: () => void
  onPause?: () => void
  onResume?: () => void
  onCloseTab: () => void
  onHide: () => void
}): ReactNode {
  return <ContextMenu.Portal>
    <ChatLayoutContextMenuContent activeId={activeId} tabs={tabs} chatCount={chatCount} busy={busy}
      isTileSolo={isTileSolo} canMaximize={canMaximize} hideHint={hideHint} closeHint={closeHint}
      tabActivity={tabActivity} pinned={pinned} canRegenerateTitle={canRegenerateTitle}
      onRestore={onRestore} onMaximize={onMaximize} onSplitRight={onSplitRight} onSplitBelow={onSplitBelow}
      onRename={onRename} onRetryTitle={onRetryTitle} onTogglePin={onTogglePin} onPause={onPause}
      onResume={onResume} onCloseTab={onCloseTab} onHide={onHide} />
  </ContextMenu.Portal>
}

/** Menu body (also mounted in tests without Radix portal). */
export function ChatLayoutContextMenuContent(props: Parameters<typeof ChatLayoutContextMenu>[0]): ReactNode {
  const { activeId, tabs, chatCount, busy, isTileSolo, canMaximize, hideHint, closeHint, tabActivity,
    pinned, canRegenerateTitle, onRestore, onMaximize, onSplitRight, onSplitBelow, onRename, onRetryTitle,
    onTogglePin, onPause, onResume, onCloseTab, onHide } = props
  const canHidePane = chatCount >= 2
  const canCloseTab = tabs.length > 1
  const turnControl = tabActivity?.state === 'working' ? 'pause'
    : tabActivity?.state === 'paused' ? 'resume' : null

  return <ContextMenu.Content className="titlebar-menu-content chat-layout-context-menu" loop>
    {isTileSolo ? (
      <LayoutMenuRow data-ui="layout.restore" data-ui-key={activeId} label="Restore layout" shortcut="Esc"
        icon={<Minimize2 size={ICON} aria-hidden="true" />} onSelect={onRestore} />
    ) : (
      <LayoutMenuRow data-ui="layout.maximize" data-ui-key={activeId} label="Full height"
        icon={<Maximize2 size={ICON} aria-hidden="true" />} disabled={!canMaximize} onSelect={onMaximize} />
    )}
    <ContextMenu.Separator className="titlebar-menu-separator" />
    <LayoutMenuRow data-ui="layout.split-right" data-ui-key={activeId} label="Chat beside…"
      icon={<PanelRight size={ICON} aria-hidden="true" />} onSelect={onSplitRight} />
    <LayoutMenuRow data-ui="layout.split-below" data-ui-key={activeId} label="Chat below…"
      icon={<PanelBottom size={ICON} aria-hidden="true" />} onSelect={onSplitBelow} />
    <ContextMenu.Separator className="titlebar-menu-separator" />
    {onRename && (
      <LayoutMenuRow data-ui="layout.rename" data-ui-key={activeId} label="Rename…"
        icon={<Pencil size={ICON} aria-hidden="true" />} onSelect={onRename} />
    )}
    {onTogglePin && (
      <LayoutMenuRow data-ui="layout.pin" data-ui-key={activeId} label={pinned ? 'Unpin chat' : 'Pin chat'}
        icon={pinned ? <PinOff size={ICON} aria-hidden="true" /> : <Pin size={ICON} aria-hidden="true" />}
        onSelect={onTogglePin} />
    )}
    {canRegenerateTitle && onRetryTitle && (
      <LayoutMenuRow data-ui="layout.retry-title" data-ui-key={activeId} label="Regenerate title…"
        icon={<Sparkles size={ICON} aria-hidden="true" />} onSelect={onRetryTitle} />
    )}
    {turnControl === 'pause' && onPause && (
      <LayoutMenuRow data-ui="layout.pause-tab" data-ui-key={activeId} label="Pause task"
        icon={<Pause size={ICON} aria-hidden="true" />} disabled={busy} onSelect={onPause} />
    )}
    {turnControl === 'resume' && onResume && (
      <LayoutMenuRow data-ui="layout.resume-tab" data-ui-key={activeId} label="Resume task"
        icon={<Play size={ICON} aria-hidden="true" />} disabled={busy} onSelect={onResume} />
    )}
    {(canCloseTab || canHidePane) && <>
      <ContextMenu.Separator className="titlebar-menu-separator" />
      {canCloseTab && (
        <LayoutMenuRow data-ui="layout.tab-close" data-ui-key={activeId} label="Close tab" hint={closeHint}
          shortcut="Ctrl+W" icon={<X size={ICON} aria-hidden="true" />} disabled={busy} onSelect={onCloseTab} />
      )}
      {canHidePane && (
        <LayoutMenuRow data-ui="layout.pane-hide" data-ui-key={activeId} label="Hide pane" hint={hideHint}
          icon={<PanelLeftClose size={ICON} aria-hidden="true" />} disabled={busy} onSelect={onHide} />
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
