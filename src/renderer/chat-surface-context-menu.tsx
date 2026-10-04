import { type ReactNode } from 'react'
import { ContextMenu } from 'radix-ui'
import { ClipboardPaste, Copy, RotateCcw, ZoomIn, ZoomOut } from './icons/index.js'
import { type ChatZoomCommand, chatZoomCommandDisabled } from './chat-zoom.js'
import { copySelectedText, pasteTextToComposer } from './chat-clipboard-actions.js'
import { LayoutMenuRow } from './chat-layout/layout-context-menu.js'

const ICON = 16

export function ChatSurfacePrimaryMenuItems({ paneId, chatZoom, copyEnabled, onChatZoomChange }: {
  paneId: string
  chatZoom: number
  copyEnabled: boolean
  onChatZoomChange: (command: ChatZoomCommand) => void
}): ReactNode {
  return <>
    <LayoutMenuRow data-ui="chat.zoom-in" data-ui-key={paneId} label="Zoom in" shortcut="Ctrl+="
      icon={<ZoomIn size={ICON} aria-hidden="true" />}
      disabled={chatZoomCommandDisabled('in', chatZoom)}
      onSelect={() => onChatZoomChange('in')} />
    <LayoutMenuRow data-ui="chat.zoom-out" data-ui-key={paneId} label="Zoom out" shortcut="Ctrl+-"
      icon={<ZoomOut size={ICON} aria-hidden="true" />}
      disabled={chatZoomCommandDisabled('out', chatZoom)}
      onSelect={() => onChatZoomChange('out')} />
    <LayoutMenuRow data-ui="chat.reset-zoom" data-ui-key={paneId} label="Reset zoom"
      shortcut={`Ctrl+0 · ${chatZoom}%`}
      icon={<RotateCcw size={ICON} aria-hidden="true" />}
      disabled={chatZoomCommandDisabled('reset', chatZoom)}
      onSelect={() => onChatZoomChange('reset')} />
    <ContextMenu.Separator className="titlebar-menu-separator" />
    <LayoutMenuRow data-ui="chat.copy" data-ui-key={paneId} label="Copy" shortcut="Ctrl+C"
      icon={<Copy size={ICON} aria-hidden="true" />}
      disabled={!copyEnabled}
      onSelect={() => { void copySelectedText() }} />
    <LayoutMenuRow data-ui="chat.paste" data-ui-key={paneId} label="Paste" shortcut="Ctrl+V"
      icon={<ClipboardPaste size={ICON} aria-hidden="true" />}
      onSelect={() => { void pasteTextToComposer(paneId) }} />
  </>
}
