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

export function viewportMetrics(viewport: HTMLElement): ScrollMetrics {
  return {
    clientHeight: viewport.clientHeight,
    scrollHeight: viewport.scrollHeight,
    scrollTop: viewport.scrollTop
  }
}
