// The shutdown flush. `before-quit` waits for stores and bridges to settle, but a listener that
// is still serving a connection, or a store whose disk is slow, must not be able to hold the
// process open: the user asked to quit, so the wait is bounded and the quit proceeds regardless.

export const QUIT_SETTLE_TIMEOUT_MS = 5_000

export type SettleOutcome = 'settled' | 'timed-out'

/** Resolve once every entry has settled, or after `timeoutMs`, whichever comes first. Never rejects. */
export function settleWithin(work: Iterable<unknown>, timeoutMs: number): Promise<SettleOutcome> {
  let timer: NodeJS.Timeout | null = null
  const deadline = new Promise<SettleOutcome>((resolve) => {
    timer = setTimeout(() => resolve('timed-out'), timeoutMs)
  })
  const settled = Promise.allSettled(work).then((): SettleOutcome => 'settled')
  return Promise.race([settled, deadline]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}
