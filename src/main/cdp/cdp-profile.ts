// CDP's profiling payloads are shaped for DevTools, not for a model: one precise-coverage take
// on a real article page is ~950k characters of nested byte ranges, which no tool response can
// carry and no generic truncator can make meaningful. These folds do the arithmetic in the main
// process and return the answer instead of the evidence — used vs unused bytes per file, self
// time per function, retained bytes per allocation site.

export type ProfileSend = (method: string, params?: Record<string, unknown>) => Promise<unknown>

export type CoverageRange = { startOffset: number; endOffset: number; count: number }

export type CoverageEntry = {
  url: string
  totalBytes: number
  usedBytes: number
  unusedBytes: number
  usedPercent: number
}

export type CoverageSummary = {
  files: number
  totalBytes: number
  usedBytes: number
  unusedBytes: number
  usedPercent: number
  entries: CoverageEntry[]
}

export type FunctionCost = { functionName: string; url: string; line: number; selfMs: number; percent: number }

export type CpuSummary = { durationMs: number; sampledMs: number; samples: number; functions: FunctionCost[] }

export type AllocationSite = { functionName: string; url: string; line: number; selfBytes: number; percent: number }

export type HeapSummary = { totalBytes: number; sites: AllocationSite[] }

const EMPTY_COVERAGE: CoverageSummary = {
  files: 0, totalBytes: 0, usedBytes: 0, unusedBytes: 0, usedPercent: 0, entries: []
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1_000) / 10 : 0
}

/**
 * Byte ranges from V8 nest: an uncovered `else` branch sits inside a covered function, which
 * sits inside the covered script. Summing per-function counts would double count, so flatten to
 * disjoint segments where the innermost range wins, then measure the segments that ran.
 */
export function disjointUsedBytes(ranges: CoverageRange[]): number {
  type Point = { offset: number; open: boolean; range: CoverageRange }
  const points: Point[] = []
  for (const range of ranges) {
    if (range.endOffset <= range.startOffset) continue
    points.push({ offset: range.startOffset, open: true, range })
    points.push({ offset: range.endOffset, open: false, range })
  }
  if (!points.length) return 0
  points.sort((a, b) => {
    if (a.offset !== b.offset) return a.offset - b.offset
    // Close before open at a shared offset, then widest-first so nesting stays well formed.
    if (a.open !== b.open) return a.open ? 1 : -1
    const aLength = a.range.endOffset - a.range.startOffset
    const bLength = b.range.endOffset - b.range.startOffset
    return a.open ? bLength - aLength : aLength - bLength
  })

  const counts: number[] = []
  let used = 0
  let cursor = points[0].offset
  for (const point of points) {
    const innermost = counts.length ? counts[counts.length - 1] : 0
    if (counts.length && point.offset > cursor && innermost > 0) used += point.offset - cursor
    cursor = point.offset
    if (point.open) counts.push(point.range.count)
    else counts.pop()
  }
  return used
}

function coverageRanges(value: unknown): CoverageRange[] {
  return list(value).flatMap((entry) => {
    const range = record(entry)
    const startOffset = Number(range.startOffset)
    const endOffset = Number(range.endOffset)
    if (!Number.isFinite(startOffset) || !Number.isFinite(endOffset)) return []
    return [{ startOffset, endOffset, count: Number(range.count) || 0 }]
  })
}

function summarize(byUrl: Map<string, { total: number; used: number }>, limit: number): CoverageSummary {
  const entries = [...byUrl.entries()]
    .map(([url, totals]): CoverageEntry => ({
      url,
      totalBytes: totals.total,
      usedBytes: totals.used,
      unusedBytes: Math.max(0, totals.total - totals.used),
      usedPercent: percent(totals.used, totals.total)
    }))
    .sort((a, b) => b.unusedBytes - a.unusedBytes)
  const totalBytes = entries.reduce((sum, entry) => sum + entry.totalBytes, 0)
  const usedBytes = entries.reduce((sum, entry) => sum + entry.usedBytes, 0)
  return {
    files: entries.length,
    totalBytes,
    usedBytes,
    unusedBytes: Math.max(0, totalBytes - usedBytes),
    usedPercent: percent(usedBytes, totalBytes),
    entries: entries.slice(0, limit)
  }
}

/** `Profiler.takePreciseCoverage` folded to used vs unused bytes per script URL. */
export function foldScriptCoverage(raw: unknown, limit: number): CoverageSummary {
  const scripts = list(record(raw).result)
  if (!scripts.length) return EMPTY_COVERAGE
  const byUrl = new Map<string, { total: number; used: number }>()
  const seenScripts = new Set<string>()
  for (const entry of scripts) {
    const script = record(entry)
    const scriptId = String(script.scriptId ?? '')
    if (seenScripts.has(scriptId)) continue
    seenScripts.add(scriptId)
    const url = String(script.url || '(inline)')
    const ranges = list(script.functions).flatMap((fn) => coverageRanges(record(fn).ranges))
    if (!ranges.length) continue
    const total = ranges.reduce((max, range) => Math.max(max, range.endOffset), 0)
    const totals = byUrl.get(url) ?? { total: 0, used: 0 }
    totals.total += total
    totals.used += disjointUsedBytes(ranges)
    byUrl.set(url, totals)
  }
  return summarize(byUrl, limit)
}

/** `CSS.stopRuleUsageTracking` folded to used vs unused bytes per stylesheet URL. */
export function foldRuleCoverage(raw: unknown, urls: Record<string, string>, limit: number): CoverageSummary {
  const rules = list(record(raw).ruleUsage)
  if (!rules.length) return EMPTY_COVERAGE
  const byUrl = new Map<string, { total: number; used: number }>()
  for (const entry of rules) {
    const rule = record(entry)
    const start = Number(rule.startOffset)
    const end = Number(rule.endOffset)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
    const sheetId = String(rule.styleSheetId ?? '')
    const url = urls[sheetId] || '(inline stylesheet)'
    const totals = byUrl.get(url) ?? { total: 0, used: 0 }
    totals.total += end - start
    if (rule.used === true) totals.used += end - start
    byUrl.set(url, totals)
  }
  return summarize(byUrl, limit)
}

/** Stylesheet id to URL, read from the buffered `CSS.styleSheetAdded` events. */
export function styleSheetUrls(events: { method: string; params: unknown }[]): Record<string, string> {
  const urls: Record<string, string> = {}
  for (const event of events) {
    if (event.method !== 'CSS.styleSheetAdded') continue
    const header = record(record(event.params).header)
    const id = String(header.styleSheetId ?? '')
    if (id) urls[id] = String(header.sourceURL || '(inline stylesheet)')
  }
  return urls
}

/** `Profiler.stop` folded to the functions that actually held the main thread. */
export function foldCpuProfile(raw: unknown, limit: number): CpuSummary {
  const profile = record(record(raw).profile)
  const nodes = list(profile.nodes).map((entry) => record(entry))
  const samples = list(profile.samples).map((value) => Number(value))
  const deltas = list(profile.timeDeltas).map((value) => Number(value) || 0)
  const selfMicros = new Map<number, number>()
  samples.forEach((nodeId, index) => {
    const delta = Math.max(0, deltas[index] ?? 0)
    selfMicros.set(nodeId, (selfMicros.get(nodeId) ?? 0) + delta)
  })
  const sampledMicros = [...selfMicros.values()].reduce((sum, value) => sum + value, 0)
  const functions = nodes
    .flatMap((node): FunctionCost[] => {
      const micros = selfMicros.get(Number(node.id)) ?? 0
      if (micros <= 0) return []
      const frame = record(node.callFrame)
      return [{
        functionName: String(frame.functionName || '(anonymous)'),
        url: String(frame.url || '(native)'),
        line: Number(frame.lineNumber ?? -1) + 1,
        selfMs: Math.round(micros / 100) / 10,
        percent: percent(micros, sampledMicros)
      }]
    })
    .sort((a, b) => b.selfMs - a.selfMs)
  const startTime = Number(profile.startTime) || 0
  const endTime = Number(profile.endTime) || 0
  return {
    durationMs: Math.round((endTime - startTime) / 100) / 10,
    sampledMs: Math.round(sampledMicros / 100) / 10,
    samples: samples.length,
    functions: functions.slice(0, limit)
  }
}

/** `HeapProfiler.stopSampling` folded to the call sites that allocated the most. */
export function foldHeapProfile(raw: unknown, limit: number): HeapSummary {
  const head = record(record(raw).profile).head
  const sites: AllocationSite[] = []
  let totalBytes = 0
  const walk = (value: unknown): void => {
    const node = record(value)
    const selfBytes = Number(node.selfSize) || 0
    if (selfBytes > 0) {
      const frame = record(node.callFrame)
      totalBytes += selfBytes
      sites.push({
        functionName: String(frame.functionName || '(anonymous)'),
        url: String(frame.url || '(native)'),
        line: Number(frame.lineNumber ?? -1) + 1,
        selfBytes,
        percent: 0
      })
    }
    for (const child of list(node.children)) walk(child)
  }
  if (head) walk(head)
  const ranked = sites.sort((a, b) => b.selfBytes - a.selfBytes).slice(0, limit)
  for (const site of ranked) site.percent = percent(site.selfBytes, totalBytes)
  return { totalBytes, sites: ranked }
}

/** `Performance.getMetrics` as a plain name/value record. */
export function foldMetrics(raw: unknown): Record<string, number> {
  const metrics: Record<string, number> = {}
  for (const entry of list(record(raw).metrics)) {
    const metric = record(entry)
    const name = String(metric.name ?? '')
    if (name) metrics[name] = Number(metric.value) || 0
  }
  return metrics
}

export type ProfileChannels = { script: boolean; style: boolean; cpu: boolean; heap: boolean }

export function channelsFrom(requested: string[]): ProfileChannels {
  const all = requested.length === 0 || requested.includes('all')
  return {
    script: all || requested.includes('script'),
    style: all || requested.includes('style'),
    cpu: all || requested.includes('cpu'),
    heap: all || requested.includes('heap')
  }
}

/**
 * Coverage and sampling must be armed before the code under test runs, so `start` is a separate
 * call from `stop` and the caller navigates or interacts in between.
 */
export async function startProfiling(send: ProfileSend, channels: ProfileChannels): Promise<string[]> {
  const started: string[] = []
  if (channels.script) {
    await send('Profiler.enable')
    await send('Profiler.startPreciseCoverage', { callCount: false, detailed: true })
    started.push('script')
  }
  if (channels.style) {
    await send('DOM.enable')
    await send('CSS.enable')
    await send('CSS.startRuleUsageTracking')
    started.push('style')
  }
  if (channels.cpu) {
    await send('Profiler.enable')
    await send('Profiler.setSamplingInterval', { interval: 100 })
    await send('Profiler.start')
    started.push('cpu')
  }
  if (channels.heap) {
    await send('HeapProfiler.enable')
    await send('HeapProfiler.startSampling', { samplingInterval: 16_384 })
    started.push('heap')
  }
  return started
}

export type ProfileReport = {
  scriptCoverage?: CoverageSummary
  styleCoverage?: CoverageSummary
  cpu?: CpuSummary
  heap?: HeapSummary
  metrics: Record<string, number>
}

export async function stopProfiling(
  send: ProfileSend,
  channels: ProfileChannels,
  options: { limit: number; styleSheetUrls: Record<string, string> }
): Promise<ProfileReport> {
  const report: ProfileReport = { metrics: {} }
  if (channels.script) {
    report.scriptCoverage = foldScriptCoverage(await send('Profiler.takePreciseCoverage'), options.limit)
    await send('Profiler.stopPreciseCoverage')
  }
  if (channels.style) {
    report.styleCoverage = foldRuleCoverage(
      await send('CSS.stopRuleUsageTracking'),
      options.styleSheetUrls,
      options.limit
    )
  }
  if (channels.cpu) report.cpu = foldCpuProfile(await send('Profiler.stop'), options.limit)
  if (channels.heap) report.heap = foldHeapProfile(await send('HeapProfiler.stopSampling'), options.limit)
  await send('Performance.enable').catch(() => undefined)
  report.metrics = foldMetrics(await send('Performance.getMetrics'))
  return report
}
