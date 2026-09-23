/** Run async work with a fixed concurrency limit (order of results matches input order). */
export async function mapParallel<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const limit = Math.max(1, Math.min(concurrency, items.length || 1))
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  async function runOne(): Promise<void> {
    while (true) {
      const index = nextIndex++
      if (index >= items.length) return
      results[index] = await worker(items[index]!, index)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runOne()))
  return results
}
