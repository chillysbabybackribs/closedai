import { createContext, useContext, type JSX, type PointerEvent as ReactPointerEvent } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import type { ResizeEdge } from './window-layout.js'

const EDGES: readonly ResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

/** A window's minimize, maximize and close buttons, at the right end of its header. */
export function WindowControls({ id, busy, maximized, floating = false, canMinimize, canMaximize, closeLabel, canClose, onMinimize, onToggleMaximize, onClose }: {
  id: string
  busy: boolean
  maximized: boolean
  /** A floating window's header double-click tiles it instead of maximizing. */
  floating?: boolean
  canMinimize: boolean
  canMaximize: boolean
  /** Omitted for a window that closes some other way (the browser hides from the dock). */
  closeLabel?: string
  canClose?: boolean
  onMinimize: () => void
  onToggleMaximize: () => void
  onClose?: () => void
}): JSX.Element {
  const maximizeLabel = maximized ? 'Restore window size' : 'Maximize window'
  return <div className="chat-window-controls" role="group" aria-label="Window">
    <button type="button" data-ui="layout.window-minimize" data-ui-key={id} disabled={busy || !canMinimize}
      title="Minimize to the dock" aria-label="Minimize to the dock" onClick={onMinimize}>
      <Minus size={14} aria-hidden="true" />
    </button>
    <button type="button" data-ui="layout.window-maximize" data-ui-key={id} disabled={!canMaximize && !maximized}
      title={floating ? maximizeLabel : `${maximizeLabel} · double-click the header`} aria-label={maximizeLabel} aria-pressed={maximized}
      onClick={onToggleMaximize}>
      {maximized ? <Copy size={12} aria-hidden="true" /> : <Square size={11} aria-hidden="true" />}
    </button>
    {onClose && <button type="button" data-ui="layout.pane-hide" data-ui-key={id} disabled={busy || !canClose}
      title={closeLabel} aria-label={closeLabel} onClick={onClose}>
      <X size={14} aria-hidden="true" />
    </button>}
  </div>
}

/** Edge and corner grips around a floating window; they reach past its border, clear of the native page. */
export function WindowResizeHandles({ id, onStart }: {
  id: string
  onStart: (event: ReactPointerEvent, id: string, edge: ResizeEdge) => void
}): JSX.Element {
  return <>
    {EDGES.map((edge) => <div key={edge} className="chat-window-resize" data-edge={edge} aria-hidden="true"
      data-ui="layout.window-resize" data-ui-key={edge} onPointerDown={(event) => onStart(event, id, edge)} />)}
  </>
}

/** The canvas owns maximizing; the browser's header, rendered by the workspace, reads it here. */
export const BrowserWindowContext = createContext<{ maximized: boolean; floating: boolean; canMaximize: boolean; toggleMaximize: () => void }>({
  maximized: false, floating: false, canMaximize: false, toggleMaximize: () => {}
})

/** The browser window's buttons: minimizing hides it, and the dock's Browser icon brings it back. */
export function BrowserWindowControls({ busy, onMinimize }: { busy: boolean; onMinimize: () => void }): JSX.Element {
  const { maximized, floating, canMaximize, toggleMaximize } = useContext(BrowserWindowContext)
  return <WindowControls id="browser" busy={busy} maximized={maximized} floating={floating} canMinimize canMaximize={canMaximize}
    onMinimize={onMinimize} onToggleMaximize={toggleMaximize} />
}
