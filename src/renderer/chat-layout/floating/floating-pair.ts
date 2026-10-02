import { BROWSER_PANE_ID, chatPaneIds, type ChatLayout, type Rect } from '../layout-tree.js'
import { findWindow, floatWindow, mapWindow, resizeRect, clampWindow, windowMinimum, type ResizeEdge, type WindowSize } from './window-layout.js'

/** Chat pane id stored on both chat and browser while they share a floating pair. */
export type FloatingPair = { chatId: string; chat: Rect; browser: Rect }

export function linkFloatingPair(tree: ChatLayout, chatId: string): ChatLayout {
  const tag = (pane: ReturnType<typeof findWindow>) => pane ? { ...pane, floatPair: chatId } : pane
  let next = mapWindow(tree, chatId, tag)
  return mapWindow(next, BROWSER_PANE_ID, tag)
}

export function clearFloatingPair(tree: ChatLayout, chatId: string): ChatLayout {
  const untag = (pane: ReturnType<typeof findWindow>) => {
    if (!pane || pane.floatPair !== chatId) return pane
    const { floatPair: _pair, ...rest } = pane
    return rest
  }
  let next = mapWindow(tree, chatId, untag)
  return mapWindow(next, BROWSER_PANE_ID, untag)
}

/** The chat linked to the browser by `floatPair`, when both are floating on screen. */
export function getFloatingPair(tree: ChatLayout): FloatingPair | null {
  for (const chatId of chatPaneIds(tree)) {
    const chatPane = findWindow(tree, chatId)
    const browserPane = findWindow(tree, BROWSER_PANE_ID)
    const chat = chatPane?.float
    const browser = browserPane?.float
    if (chatPane?.floatPair !== chatId || browserPane?.floatPair !== chatId) continue
    if (!chat || !browser || chatPane.docked || browserPane.docked) continue
    if (Math.abs(chat.y - browser.y) > 2 || Math.abs(chat.height - browser.height) > 2) continue
    if (browser.x < chat.x + chat.width - 2) continue
    return { chatId, chat, browser }
  }
  return null
}

export function pairContains(tree: ChatLayout, paneId: string): boolean {
  const pair = getFloatingPair(tree)
  return pair !== null && (paneId === pair.chatId || paneId === BROWSER_PANE_ID)
}

export function pairBounds(pair: FloatingPair): Rect {
  const { chat, browser } = pair
  return { x: chat.x, y: chat.y, width: browser.x + browser.width - chat.x, height: Math.max(chat.height, browser.height) }
}

export function flushPairRects(chat: Rect, browser: Rect): { chat: Rect; browser: Rect } {
  const height = Math.max(chat.height, browser.height)
  const totalWidth = chat.width + browser.width
  return {
    chat: { x: chat.x, y: chat.y, width: chat.width, height },
    browser: { x: chat.x + chat.width, y: chat.y, width: totalWidth - chat.width, height }
  }
}

function clampPairRects(chatId: string, chat: Rect, browser: Rect, canvas: WindowSize): { chat: Rect; browser: Rect } {
  const flushed = flushPairRects(chat, browser)
  const chatOut = clampWindow(flushed.chat, canvas, windowMinimum(chatId))
  const browserOut = clampWindow({ ...flushed.browser, x: chatOut.x + chatOut.width }, canvas, windowMinimum(BROWSER_PANE_ID))
  return flushPairRects(chatOut, browserOut)
}

export function previewPairBoxResize(pair: FloatingPair, edge: ResizeEdge, dx: number, dy: number): { chat: Rect; browser: Rect } {
  const bounds = pairBounds(pair)
  const chatMin = windowMinimum(pair.chatId)
  const browserMin = windowMinimum(BROWSER_PANE_ID)
  const minimum = { width: chatMin.width + browserMin.width, height: Math.max(chatMin.height, browserMin.height) }
  const nextBounds = resizeRect(bounds, edge, dx, dy, minimum)
  const ratio = pair.chat.width / Math.max(1, pair.chat.width + pair.browser.width)
  const chatWidth = Math.round(Math.max(chatMin.width, Math.min(nextBounds.width - browserMin.width, nextBounds.width * ratio)))
  return flushPairRects(
    { x: nextBounds.x, y: nextBounds.y, width: chatWidth, height: nextBounds.height },
    { x: 0, y: nextBounds.y, width: nextBounds.width - chatWidth, height: nextBounds.height }
  )
}

export function applyFloatingPairRects(tree: ChatLayout, chatId: string, chat: Rect, browser: Rect, canvas: WindowSize): ChatLayout {
  const { chat: nextChat, browser: nextBrowser } = clampPairRects(chatId, chat, browser, canvas)
  let next = floatWindow(tree, chatId, nextChat)
  next = floatWindow(next, BROWSER_PANE_ID, nextBrowser)
  return linkFloatingPair(next, chatId)
}

export function resizeFloatingPairDivider(tree: ChatLayout, chatId: string, chatWidth: number, canvas: WindowSize): ChatLayout | null {
  const pair = getFloatingPair(tree)
  if (!pair || pair.chatId !== chatId) return null
  const chatMin = windowMinimum(chatId).width
  const browserMin = windowMinimum(BROWSER_PANE_ID).width
  const total = pair.browser.x + pair.browser.width - pair.chat.x
  const width = Math.round(Math.max(chatMin, Math.min(total - browserMin, chatWidth)))
  const rects = flushPairRects({ ...pair.chat, width }, { ...pair.browser, width: total - width })
  return applyFloatingPairRects(tree, chatId, rects.chat, rects.browser, canvas)
}

export function resizeFloatingPairBox(
  tree: ChatLayout, chatId: string, edge: ResizeEdge, dx: number, dy: number, canvas: WindowSize
): ChatLayout | null {
  const pair = getFloatingPair(tree)
  if (!pair || pair.chatId !== chatId) return null
  const bounds = pairBounds(pair)
  const chatMin = windowMinimum(chatId)
  const browserMin = windowMinimum(BROWSER_PANE_ID)
  const minimum = { width: chatMin.width + browserMin.width, height: Math.max(chatMin.height, browserMin.height) }
  const nextBounds = resizeRect(bounds, edge, dx, dy, minimum)
  const ratio = pair.chat.width / Math.max(1, pair.chat.width + pair.browser.width)
  const chatWidth = Math.round(Math.max(chatMin.width, Math.min(nextBounds.width - browserMin.width, nextBounds.width * ratio)))
  const rects = flushPairRects(
    { x: nextBounds.x, y: nextBounds.y, width: chatWidth, height: nextBounds.height },
    { x: 0, y: nextBounds.y, width: nextBounds.width - chatWidth, height: nextBounds.height }
  )
  return applyFloatingPairRects(tree, chatId, rects.chat, rects.browser, canvas)
}
