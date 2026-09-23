import type { ScrollMetrics } from './message-scroller-state.js'

export function findLastScrollAnchor(
  content: HTMLElement,
  spacer: HTMLElement | null
): HTMLElement | null {
  const children = Array.from(content.children)
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index]
    if (child === spacer) continue
    if (child instanceof HTMLElement && child.dataset.scrollAnchor === 'true') return child
  }
  return null
}

/**
 * Whether an anchor is the newest content row. A just-sent prompt has no response below it yet;
 * a replayed or re-keyed transcript lands with the response rows already following its last
 * prompt. Only the former is a user action the viewport should move for.
 */
export function isTrailingContent(element: HTMLElement, spacer: HTMLElement | null): boolean {
  const next = element.nextElementSibling
  return next === null || next === spacer
}

export function viewportMetrics(viewport: HTMLElement): ScrollMetrics {
  return {
    clientHeight: viewport.clientHeight,
    scrollHeight: viewport.scrollHeight,
    scrollTop: viewport.scrollTop
  }
}

/**
 * Measure the actual rows, not scrollHeight: the viewport and content's min-height can keep
 * scrollHeight constant while a spacer grows. Subtracting that spacer then feeds its own size
 * back into the next correction. Row geometry is independent of both the spacer and scrolling.
 */
export function measureScrollAnchor(
  viewport: HTMLElement,
  content: HTMLElement,
  anchor: HTMLElement,
  spacer: HTMLElement | null
): { anchorTop: number; contentHeight: number; spacerGap: number } | null {
  const contentStyle = window.getComputedStyle(content)
  const viewportStyle = window.getComputedStyle(viewport)
  const viewportRect = viewport.getBoundingClientRect()
  // offsetHeight/clientHeight round to whole pixels. Use the resolved CSS box size to retain
  // fractional row heights at zoom; rounding the rows can undersize the spacer and clamp scrollTop.
  const borderBoxHeight = pixels(viewportStyle.height) + (viewportStyle.boxSizing === 'border-box' ? 0 :
    pixels(viewportStyle.paddingTop) + pixels(viewportStyle.paddingBottom) +
    pixels(viewportStyle.borderTopWidth) + pixels(viewportStyle.borderBottomWidth))
  if (borderBoxHeight <= 0 || viewportRect.height <= 0) return null
  const scale = viewportRect.height / borderBoxHeight
  const toScrollY = (screenY: number): number =>
    viewport.scrollTop + (screenY - viewportRect.top) / scale - pixels(viewportStyle.borderTopWidth)
  let last = content.lastElementChild as HTMLElement | null
  if (last && last === spacer) last = last.previousElementSibling as HTMLElement | null
  const bottom = last
    ? toScrollY(last.getBoundingClientRect().bottom) + pixels(window.getComputedStyle(last).marginBottom)
    : toScrollY(content.getBoundingClientRect().top) + pixels(contentStyle.borderTopWidth) + pixels(contentStyle.paddingTop)
  return {
    anchorTop: toScrollY(anchor.getBoundingClientRect().top),
    contentHeight: bottom + pixels(contentStyle.paddingBottom) +
      pixels(contentStyle.borderBottomWidth) + pixels(contentStyle.marginBottom) + pixels(viewportStyle.paddingBottom),
    spacerGap: pixels(contentStyle.rowGap)
  }
}

function pixels(value: string): number {
  return Number.parseFloat(value) || 0
}
