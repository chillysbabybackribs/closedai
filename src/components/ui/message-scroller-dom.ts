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

/** Offset geometry uses the same unscaled coordinates as scrollTop, even inside chat zoom. */
function layoutTop(element: HTMLElement): number {
  let top = element.offsetTop
  for (let parent = element.offsetParent as HTMLElement | null; parent; parent = parent.offsetParent as HTMLElement | null) {
    top += parent.offsetTop + parent.clientTop
  }
  return top
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
): { anchorTop: number; contentHeight: number; spacerGap: number } {
  const origin = layoutTop(viewport) + viewport.clientTop
  const contentStyle = window.getComputedStyle(content)
  const viewportStyle = window.getComputedStyle(viewport)
  let last = content.lastElementChild as HTMLElement | null
  if (last === spacer) last = last.previousElementSibling as HTMLElement | null
  const bottom = last
    ? layoutTop(last) + last.offsetHeight + pixels(window.getComputedStyle(last).marginBottom)
    : layoutTop(content) + content.clientTop + pixels(contentStyle.paddingTop)
  return {
    anchorTop: layoutTop(anchor) - origin,
    contentHeight: bottom - origin + pixels(contentStyle.paddingBottom) +
      pixels(contentStyle.borderBottomWidth) + pixels(contentStyle.marginBottom) + pixels(viewportStyle.paddingBottom),
    spacerGap: pixels(contentStyle.rowGap)
  }
}

function pixels(value: string): number {
  return Number.parseFloat(value) || 0
}
