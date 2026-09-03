export type ScrollMetrics = {
  clientHeight: number
  scrollHeight: number
  scrollTop: number
}

export type ScrollEdges = {
  /** There is content above the viewport. */
  start: boolean
  /** There is content below the viewport. */
  end: boolean
}

export type AnchorScrollLayout = {
  scrollTop: number
  spacerHeight: number
}

/**
 * Keep following through layout-driven scroll events. Images, disclosures, async syntax
 * highlighting, and composer resizes can dispatch scroll before ResizeObserver runs; treating
 * that event as user intent strands the viewport above the new bottom. Explicit wheel/touch/key
 * handlers own escaping follow mode, while reaching the end opts back in.
 */
export function followingAfterViewportSync(
  following: boolean,
  autoScroll: boolean,
  edges: ScrollEdges
): boolean {
  return edges.end ? following : autoScroll
}

/** Constant-time edge calculation; no transcript-row geometry is involved. */
export function scrollEdges(metrics: ScrollMetrics, threshold: number): ScrollEdges {
  const maxScrollTop = Math.max(0, metrics.scrollHeight - metrics.clientHeight)
  const scrollTop = clamp(metrics.scrollTop, 0, maxScrollTop)
  return {
    start: scrollTop > threshold,
    end: maxScrollTop - scrollTop > threshold
  }
}

/** Keep the same content under the reader after older rows are inserted above it. */
export function preservedScrollTop(
  before: Pick<ScrollMetrics, 'scrollHeight' | 'scrollTop'>,
  nextScrollHeight: number
): number {
  return Math.max(0, before.scrollTop + nextScrollHeight - before.scrollHeight)
}

/** Add only enough trailing space to place a newly submitted prompt at the viewport top. */
export function anchorScrollLayout({
  anchorTop,
  contentHeight,
  previousItemPeek,
  viewportHeight
}: {
  anchorTop: number
  contentHeight: number
  previousItemPeek: number
  viewportHeight: number
}): AnchorScrollLayout {
  const scrollTop = Math.max(0, anchorTop - previousItemPeek)
  return {
    scrollTop,
    spacerHeight: Math.max(0, Math.ceil(scrollTop + viewportHeight - contentHeight))
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}


/** Prepending history never counts as a newly sent prompt. End mode never pins a prompt. */
export function resizeScrollAction(input: {
  prepending: boolean
  newAnchor: boolean
  anchorMode: boolean
  anchored: boolean
  following: boolean
  autoScroll: boolean
}): 'preserve' | 'anchor' | 'end' | 'none' {
  if (input.prepending) return 'preserve'
  if (input.newAnchor && input.anchorMode) return 'anchor'
  if (input.newAnchor && input.autoScroll) return 'end'
  if (input.anchored && input.anchorMode) return 'anchor'
  return input.following ? 'end' : 'none'
}
