import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type JSX, type RefObject } from 'react'
import { MessageSquareMore } from 'lucide-react'
import type { QuickChatOverlayView } from '../../shared/quick-chat-overlay.js'
import { useChatController } from '../chat-controller.js'
import { chatRunning } from '../chat-state.js'
import { useWorkspacePaneSlice } from '../chat-layout/workspace-pane-subscription.js'
import { readAppearanceSettings, type AppearanceSettings } from '../settings/appearance-settings.js'
import { QuickChatCard } from './quick-chat-card.js'
import { feedLead, quickChatFeed } from './quick-chat-feed.js'
import { layerMenuOpen } from './layer-menu.js'
import '../styles.css'

// While a menu inside the layer is open, the layer grows upward to this height so the menu is not
// clipped by the layer's edge; the card stays in the page's corner.
const MENU_ROOM = 560

/**
 * The browser's quick chat layer: the floating button, or the open quick chat card. It runs in a
 * transparent native view above the page (main quick-chat-overlay/), follows the workspace like any
 * window, and reports its content box so main can fit the view to it.
 */
export function QuickChatOverlay(): JSX.Element {
  const view = useOverlayView()
  const chat = useChatController()
  const appearance = useAppearance()
  const rootRef = useRef<HTMLDivElement>(null)
  useLayerSize(rootRef, view?.page.height ?? 0)
  useLayoutEffect(() => {
    document.documentElement.classList.add('quick-chat-surface')
  }, [])
  const paneId = view?.paneId && chat.snapshot.chats.some((row) => row.paneId === view.paneId) ? view.paneId : null
  const style = view ? { '--page-width': `${view.page.width}px`, '--page-height': `${view.page.height}px` } as CSSProperties : undefined
  return (
    <div ref={rootRef} className="quick-chat-layer" style={style} data-ui-surface="browser-quick-chat" data-composer-panels="viewport">
      {!view ? null : view.open && paneId ? (
        <QuickChatCard key={paneId} paneId={paneId} site={view.site} dispatch={chat.dispatch} appearance={appearance} />
      ) : (
        <QuickChatButton paneId={paneId} site={view.site} />
      )}
    </div>
  )
}

/**
 * The closed quick chat. While its task runs the button carries a progress ring and the site's
 * name; a task that ends while it is closed leaves "Done on espn.com" until the chat is opened.
 */
function QuickChatButton({ paneId, site }: { paneId: string | null; site: string | null }): JSX.Element {
  const slice = useWorkspacePaneSlice(paneId ?? '')
  const state = paneId !== null ? slice.state : undefined
  const running = state !== undefined && chatRunning(state)
  const ended = useEndedWhileClosed(running)
  const status = ended && state ? quickChatFeed(state, 1).status : null
  const { lead, where } = feedLead(status ?? 'working', site)
  const label = running ? where : status ? `${lead} ${where}` : null
  const title = running ? `Quick chat is working on ${where} (Ctrl+J)` : 'Quick chat about this page (Ctrl+J)'
  return (
    <button type="button" className={`quick-chat-fab${running ? ' is-running' : ''}`} data-ui="browser.quick-chat"
      title={title} aria-label={label ? `Open quick chat: ${label}` : 'Open quick chat'}
      onClick={() => { void window.closedai.quickChat.request('open') }}>
      {label ? <span className={`quick-chat-fab-label${status ? ` is-${status}` : ''}`}>{label}</span> : null}
      <span className="quick-chat-fab-disc"><MessageSquareMore size={19} aria-hidden="true" /></span>
    </button>
  )
}

/** Whether a task ended since the button appeared; opening the chat (which unmounts it) clears it. */
function useEndedWhileClosed(running: boolean): boolean {
  const [ended, setEnded] = useState(false)
  const wasRunning = useRef(running)
  useEffect(() => {
    if (running) setEnded(false)
    else if (wasRunning.current) setEnded(true)
    wasRunning.current = running
  }, [running])
  return ended
}

function useOverlayView(): QuickChatOverlayView | null {
  const [view, setView] = useState<QuickChatOverlayView | null>(null)
  useEffect(() => {
    let live = true
    const unsubscribe = window.closedai.quickChat.onView((next) => setView(next))
    // A view sent before this subscribed is read once; anything later arrives as an event.
    void window.closedai.quickChat.view().then((current) => {
      if (live && current) setView((value) => value ?? current)
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [])
  return view
}

/** Appearance is the main window's (same storage); follow its changes. */
function useAppearance(): AppearanceSettings {
  const [appearance, setAppearance] = useState(() => readAppearanceSettings(window.localStorage))
  useEffect(() => {
    const onStorage = (): void => setAppearance(readAppearanceSettings(window.localStorage))
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  return appearance
}

/** Report the layer's box, with room above it while a menu is open, whenever either changes. */
function useLayerSize(rootRef: RefObject<HTMLDivElement | null>, pageHeight: number): void {
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    let last = ''
    const report = (): void => {
      const box = root.getBoundingClientRect()
      const menu = layerMenuOpen()
      const height = Math.ceil(menu ? Math.max(box.height, Math.min(MENU_ROOM, pageHeight)) : box.height)
      const size = { width: Math.ceil(box.width), height }
      const key = `${size.width}x${size.height}`
      if (key === last || size.width < 1 || size.height < 1) return
      last = key
      void window.closedai.quickChat.setSize(size)
    }
    report()
    const resize = new ResizeObserver(report)
    resize.observe(root)
    const menus = new MutationObserver(report)
    // Panels portal into <body> and leave it when they close.
    menus.observe(document.body, { childList: true })
    return () => {
      resize.disconnect()
      menus.disconnect()
    }
  }, [rootRef, pageHeight])
}
