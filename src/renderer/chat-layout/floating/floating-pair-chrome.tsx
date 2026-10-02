import { useCallback, type JSX, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { DIVIDER_SIZE } from '../layout-tree.js'
import { layoutTileElement } from '../layout-geometry-dom.js'
import { BROWSER_PANE_ID } from '../layout-tree.js'
import type { FloatingPair } from './floating-pair.js'
import { pairBounds, previewPairBoxResize } from './floating-pair.js'
import type { Rect } from '../layout-tree.js'
import type { ResizeEdge } from './window-layout.js'

const CORNERS: ResizeEdge[] = ['nw', 'ne', 'sw', 'se']

export function FloatingPairChrome({ pair, busy, canvas, onDividerCommit, onBoxCommit, onPaint }: {
  pair: FloatingPair
  busy: boolean
  canvas: RefObject<HTMLElement | null>
  onDividerCommit: (chatWidth: number) => void
  onBoxCommit: (edge: ResizeEdge, dx: number, dy: number, start: Rect) => void
  onPaint: (chat: Rect, browser: Rect) => void
}): JSX.Element | null {
  const bounds = pairBounds(pair)
  const paint = useCallback((chat: Rect, browser: Rect): void => {
    const host = canvas.current
    if (!host) return
    for (const [id, rect] of [[pair.chatId, chat], [BROWSER_PANE_ID, browser]] as const) {
      const element = layoutTileElement(host, id)
      if (!element) continue
      element.style.left = `${rect.x}px`
      element.style.top = `${rect.y}px`
      element.style.width = `${rect.width}px`
      element.style.height = `${rect.height}px`
    }
    onPaint(chat, browser)
  }, [canvas, onPaint, pair.chatId])

  const track = (event: ReactPointerEvent, run: (dx: number, dy: number, finish: boolean) => void): void => {
    if (event.button !== 0 || busy) return
    event.preventDefault()
    event.stopPropagation()
    const { pointerId, clientX: x0, clientY: y0 } = event
    const move = (e: PointerEvent): void => {
      if (e.pointerId !== pointerId) return
      run(e.clientX - x0, e.clientY - y0, false)
    }
    const finish = (e: PointerEvent): void => {
      if (e.pointerId !== pointerId) return
      run(e.clientX - x0, e.clientY - y0, true)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
    }
    const cancel = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
  }

  const dividerX = pair.chat.x + pair.chat.width - DIVIDER_SIZE / 2

  return (
    <div className="chat-floating-pair-chrome" style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }} aria-hidden="true">
      <div className="chat-floating-pair-divider chat-layout-divider" data-axis="horizontal"
        style={{ left: dividerX - bounds.x, top: 0, width: DIVIDER_SIZE, height: bounds.height }}
        data-ui="layout.floating-pair-divider" data-ui-key={pair.chatId} role="separator" tabIndex={-1}
        title="Drag to resize chat and browser"
        onPointerDown={(event) => {
          const startChat = pair.chat
          track(event, (dx, _dy, done) => {
            const width = startChat.width + dx
            if (done) onDividerCommit(width)
            else {
              const total = startChat.width + pair.browser.width
              const nextChat = { ...startChat, width: Math.max(1, Math.min(total - 1, width)) }
              const nextBrowser = { ...pair.browser, x: nextChat.x + nextChat.width, width: total - nextChat.width }
              paint(nextChat, nextBrowser)
            }
          })
        }} />
      {CORNERS.map((edge) => (
        <div key={edge} className="chat-window-resize chat-floating-pair-resize" data-edge={edge}
          data-ui="layout.floating-pair-resize" data-ui-key={edge}
          onPointerDown={(event) => {
            const start = pair
            track(event, (dx, dy, done) => {
              const rects = previewPairBoxResize(start, edge, dx, dy)
              if (done) onBoxCommit(edge, dx, dy, pairBounds(start))
              else paint(rects.chat, rects.browser)
            })
          }} />
      ))}
    </div>
  )
}
