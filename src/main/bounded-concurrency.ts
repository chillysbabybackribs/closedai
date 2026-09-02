export type SettledResult<T> = PromiseSettledResult<T>

// Runs independent work with a hard in-flight bound without eagerly starting one
// promise per item. Result order matches input order, which keeps reconciliation
// deterministic while still allowing the expensive reads to overlap.
export async function allSettledBounded<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<SettledResult<R>[]> {
  if (items.length === 0) return []
  const width = Math.max(1, Math.min(Math.floor(concurrency), items.length))
  const results: SettledResult<R>[] = Array(items.length)
  let nextIndex = 0

  async function drain(): Promise<void> {
    while (true) {
      const index = nextIndex++
      if (index >= items.length) return
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index], index) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }

  await Promise.all(Array.from({ length: width }, () => drain()))
  return results
}
