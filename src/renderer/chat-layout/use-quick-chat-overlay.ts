import { useEffect, useRef } from 'react'
import { onAppWindowCommand } from '../app-windows/app-window-store.js'

/**
 * The browser's quick chat floats over the page in a layer of its own (main process
 * quick-chat-overlay/, renderer quick-chat-overlay/). The main window's layout still owns which
 * chat it is and whether it is open: it reports both to the layer, and carries out the layer's
 * requests to open, renew, close or toggle it (Ctrl+J, caught by main wherever it is pressed).
 */
export function useQuickChatOverlay({ enabled, paneId, open, openChat, setOpen }: {
  enabled: boolean
  paneId: string | null
  open: boolean
  /** Open the quick chat, creating it first when there is none; `fresh` replaces the current one. */
  openChat: (fresh?: boolean) => Promise<void>
  setOpen: (open: boolean) => void
}): void {
  useEffect(() => {
    if (enabled) void window.closedai.quickChat.setState({ paneId, open })
  }, [enabled, paneId, open])
  const actions = useRef({ open, openChat, setOpen })
  actions.current = { open, openChat, setOpen }
  useEffect(() => {
    if (!enabled) return
    return onAppWindowCommand((command) => {
      if (command.type !== 'quickChat') return
      const request = command.request === 'toggle' ? (actions.current.open ? 'close' : 'open') : command.request
      if (request === 'close') actions.current.setOpen(false)
      else void actions.current.openChat(request === 'new')
    })
  }, [enabled])
}
