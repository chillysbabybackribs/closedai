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

export type StyleSheetRecord = { id: string; url: string; length: number }

/** How many stylesheets a stop verifies; a document with more is already past useful ranking. */
const MAX_TRACKED_STYLESHEETS = 40

/**
 * `CSS.stopRuleUsageTracking` answers with a coverage *delta* — the rules whose used flag changed
 * since tracking began — so it lists what ran and never mentions what did not. Totals therefore
 * have to come from the stylesheets themselves; folding the delta against itself would report
 * every sheet as 100% used.
 */
export function foldRuleCoverage(raw: unknown, sheets: StyleSheetRecord[], limit: number): CoverageSummary {
  const usedRanges = new Map<string, CoverageRange[]>()
  for (const entry of list(record(raw).ruleUsage)) {
    const rule = record(entry)
    if (rule.used !== true) continue
    const startOffset = Number(rule.startOffset)
    const endOffset = Number(rule.endOffset)
    if (!Number.isFinite(startOffset) || !Number.isFinite(endOffset) || endOffset <= startOffset) continue
    const sheetId = String(rule.styleSheetId ?? '')
    const ranges = usedRanges.get(sheetId) ?? []
    ranges.push({ startOffset, endOffset, count: 1 })
    usedRanges.set(sheetId, ranges)
  }
  if (!sheets.length && !usedRanges.size) return EMPTY_COVERAGE

  const byUrl = new Map<string, { total: number; used: number }>()
  for (const sheet of sheets) {
    if (sheet.length <= 0) continue
    const totals = byUrl.get(sheet.url) ?? { total: 0, used: 0 }
    totals.total += sheet.length
    totals.used += Math.min(sheet.length, disjointUsedBytes(usedRanges.get(sheet.id) ?? []))
    usedRanges.delete(sheet.id)
    byUrl.set(sheet.url, totals)
  }
  // Rules whose stylesheet header never reached the event buffer still ran: count them as fully
  // used rather than dropping the bytes, so the totals stay honest about what was measured.
  for (const ranges of usedRanges.values()) {
    const used = disjointUsedBytes(ranges)
    if (used <= 0) continue
    const totals = byUrl.get('(untracked stylesheet)') ?? { total: 0, used: 0 }
    totals.total += used
    totals.used += used
    byUrl.set('(untracked stylesheet)', totals)
  }
  return summarize(byUrl, limit)
}

/** The stylesheets currently known to the tab, from the buffered `CSS` lifecycle events. */
export function styleSheetIndex(events: { method: string; params: unknown }[]): StyleSheetRecord[] {
  const sheets = new Map<string, StyleSheetRecord>()
  for (const event of events) {
    const params = record(event.params)
    if (event.method === 'CSS.styleSheetAdded') {
      const header = record(params.header)
      const id = String(header.styleSheetId ?? '')
      if (!id) continue
      sheets.set(id, {
        id,
        url: String(header.sourceURL || '(inline stylesheet)'),
        length: Number(header.length) || 0
      })
      continue
    }
    if (event.method === 'CSS.styleSheetRemoved') {
      const id = String(params.styleSheetId ?? '')
      if (id) sheets.delete(id)
    }
  }
  return [...sheets.values()]
}

/**
 * Ask the page for each stylesheet's text. Ids from a document that has since been discarded fail
 * here, which is what separates the current document's sheets from stale buffer entries, and the
 * returned text is the authoritative byte total for the unused-bytes arithmetic.
 */
export async function liveStyleSheets(send: ProfileSend, sheets: StyleSheetRecord[]): Promise<StyleSheetRecord[]> {
  const checked = await Promise.all(sheets.slice(-MAX_TRACKED_STYLESHEETS).map(async (sheet) => {
    try {
      const text = String(record(await send('CSS.getStyleSheetText', { styleSheetId: sheet.id })).text ?? '')
      return { ...sheet, length: text.length || sheet.length }
    } catch {
      return null
    }
  }))
  return checked.filter((sheet): sheet is StyleSheetRecord => sheet !== null)
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

/**
 * `cpu` is not part of the default set. Measured in this app against a real tab: arming precise
 * coverage and the sampling profiler together makes the next cross-process navigation to a heavy
 * page fail with `ERR_FAILED`, and repeating it crashes the renderer. Both are Profiler-domain
 * recordings over one V8 isolate, which is also why DevTools separates its Coverage and
 * Performance panels. Everything else composes, so the default arms the three that do.
 */
export function channelsFrom(requested: string[]): ProfileChannels {
  const all = requested.length === 0 || requested.includes('all')
  return {
    script: all || requested.includes('script'),
    style: all || requested.includes('style'),
    cpu: !all && requested.includes('cpu'),
    heap: all || requested.includes('heap')
  }
}

export const SCRIPT_WITH_CPU_REFUSAL =
  'profile: script and cpu cannot be armed together. Precise coverage and the sampling profiler are ' +
  'both Profiler-domain recordings over one V8 isolate; measured here, arming both makes the next ' +
  'navigation to a heavy page fail with ERR_FAILED and can crash the tab. Run two profiles instead.'

/**
 * Coverage and sampling must be armed before the code under test runs, so `start` is a separate
 * call from `stop` and the caller navigates or interacts in between.
 */
export async function startProfiling(send: ProfileSend, channels: ProfileChannels): Promise<string[]> {
  if (channels.script && channels.cpu) throw new Error(SCRIPT_WITH_CPU_REFUSAL)
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
    // Page events drive the re-arm below; without them a navigation silently ends heap sampling.
    await send('Page.enable').catch(() => undefined)
    await armHeapSampling(send)
    started.push('heap')
  }
  return started
}

/**
 * V8 restores the profiler and coverage agents into a new document itself, but not the sampling
 * heap profiler: after a navigation the sampler armed by `start` belongs to an isolate that no
 * longer exists, and `stopSampling` never answers at all. Re-arming on each main-frame commit is
 * what keeps `stop` able to report the document the caller actually asked about.
 */
export async function armHeapSampling(send: ProfileSend): Promise<void> {
  await send('HeapProfiler.enable')
  await send('HeapProfiler.startSampling', { samplingInterval: 16_384 })
}

/**
 * Bound for a stop addressed at a renderer that may be gone. Any of these commands can be left
 * unanswered by a crashed or replaced target, and an unbounded one consumes the whole tool budget
 * and returns nothing — so every channel gets the same deadline, not just the heap sampler.
 */
const STOP_TIMEOUT_MS = 8_000

async function withDeadline<T>(work: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs) })
  try {
    return await Promise.race([work, deadline])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export type ProfileReport = {
  scriptCoverage?: CoverageSummary
  styleCoverage?: CoverageSummary
  cpu?: CpuSummary
  heap?: HeapSummary
  /** Channels whose stop command went unanswered, and why, instead of a stalled call. */
  unavailable?: Record<string, string>
  metrics: Record<string, number>
}

const HEAP_LOST_ISOLATE =
  'the sampler was armed in an isolate this tab has since replaced; arm it again and stop it without ' +
  'an intervening cross-process navigation'

export async function stopProfiling(
  send: ProfileSend,
  channels: ProfileChannels,
  options: { limit: number; styleSheets: StyleSheetRecord[]; stopTimeoutMs?: number }
): Promise<ProfileReport> {
  const timeoutMs = options.stopTimeoutMs ?? STOP_TIMEOUT_MS
  const report: ProfileReport = { metrics: {} }
  const unavailable: Record<string, string> = {}
  const ask = (method: string): Promise<unknown> =>
    withDeadline(send(method).catch(() => null), timeoutMs)
  const lost = (channel: string, method: string, detail?: string): void => {
    unavailable[channel] = `${method} did not answer within ${timeoutMs / 1_000}s: `
      + (detail ?? 'the tab\'s renderer is gone or was replaced')
  }

  if (channels.script) {
    const raw = await ask('Profiler.takePreciseCoverage')
    if (raw) {
      report.scriptCoverage = foldScriptCoverage(raw, options.limit)
      await ask('Profiler.stopPreciseCoverage')
    } else lost('script', 'Profiler.takePreciseCoverage')
  }
  if (channels.style) {
    const raw = await ask('CSS.stopRuleUsageTracking')
    if (raw) report.styleCoverage = foldRuleCoverage(raw, options.styleSheets, options.limit)
    else lost('style', 'CSS.stopRuleUsageTracking')
  }
  if (channels.cpu) {
    const raw = await ask('Profiler.stop')
    if (raw) report.cpu = foldCpuProfile(raw, options.limit)
    else lost('cpu', 'Profiler.stop')
  }
  if (channels.heap) {
    const raw = await ask('HeapProfiler.stopSampling')
    if (raw) report.heap = foldHeapProfile(raw, options.limit)
    else lost('heap', 'HeapProfiler.stopSampling', HEAP_LOST_ISOLATE)
  }
  if (Object.keys(unavailable).length) report.unavailable = unavailable
  await send('Performance.enable').catch(() => undefined)
  report.metrics = foldMetrics(await withDeadline(send('Performance.getMetrics').catch(() => null), timeoutMs))
  return report
}
