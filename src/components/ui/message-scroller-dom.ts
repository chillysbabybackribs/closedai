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
