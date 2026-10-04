import type { ResponsePerformanceGroup, ResponsePerformanceSummary, ResponseSample } from '../../shared/performance.js'

/** Averages have independent sample counts: hidden panes contribute no renderer timing. */
export function summarizeResponsePerformance(samples: readonly ResponseSample[], capacity: number): ResponsePerformanceSummary {
  const buckets = new Map<string, ResponseSample[]>()
  for (const sample of samples) {
    const key = `${sample.provider}:${sample.baselineEnabled}`
    const bucket = buckets.get(key) ?? []
    bucket.push(sample)
    buckets.set(key, bucket)
  }
  const average = (values: Array<number | null>): number | null => {
    const present = values.filter((value): value is number => value !== null)
    return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null
  }
  const groups: ResponsePerformanceGroup[] = [...buckets.values()].map((rows) => ({
    provider: rows[0]!.provider,
    baselineEnabled: rows[0]!.baselineEnabled,
    turns: rows.length,
    completed: rows.filter((row) => row.totalMs !== null).length,
    rendererSamples: rows.filter((row) => row.rendererMs !== null).length,
    preparationMs: average(rows.map((row) => row.preparationMs))!,
    firstTextMs: average(rows.map((row) => row.firstTextMs)),
    totalMs: average(rows.map((row) => row.totalMs)),
    rendererMs: average(rows.map((row) => row.rendererMs))
  }))
  return { capacity, samples: samples.length, groups }
}
