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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
