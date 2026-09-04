import assert from 'node:assert/strict'
import test from 'node:test'

import {
  channelsFrom,
  disjointUsedBytes,
  foldCpuProfile,
  foldHeapProfile,
  foldMetrics,
  foldRuleCoverage,
  foldScriptCoverage,
  liveStyleSheets,
  startProfiling,
  stopProfiling,
  styleSheetIndex
} from './cdp-profile.js'

test('nested coverage ranges count once, with the innermost range deciding', () => {
  // A covered function containing an uncovered branch: 0-100 ran, 40-60 did not.
  assert.equal(disjointUsedBytes([
    { startOffset: 0, endOffset: 100, count: 1 },
    { startOffset: 40, endOffset: 60, count: 0 }
  ]), 80)
  // An uncovered function containing a covered inner function re-adds the inner extent.
  assert.equal(disjointUsedBytes([
    { startOffset: 0, endOffset: 100, count: 0 },
    { startOffset: 40, endOffset: 60, count: 3 }
  ]), 20)
  assert.equal(disjointUsedBytes([]), 0)
})

test('script coverage folds per URL, dedupes script ids and ranks by wasted bytes', () => {
  const summary = foldScriptCoverage({
    result: [
      {
        scriptId: '1',
        url: 'https://site/app.js',
        functions: [
          { ranges: [{ startOffset: 0, endOffset: 1_000, count: 1 }] },
          { ranges: [{ startOffset: 100, endOffset: 900, count: 0 }] }
        ]
      },
      { scriptId: '1', url: 'https://site/app.js', functions: [{ ranges: [{ startOffset: 0, endOffset: 5, count: 1 }] }] },
      { scriptId: '2', url: 'https://site/small.js', functions: [{ ranges: [{ startOffset: 0, endOffset: 100, count: 1 }] }] }
    ]
  }, 10)
  assert.equal(summary.files, 2)
  assert.equal(summary.totalBytes, 1_100)
  assert.equal(summary.usedBytes, 300)
  assert.deepEqual(summary.entries.map((entry) => entry.url), ['https://site/app.js', 'https://site/small.js'])
  assert.equal(summary.entries[0].unusedBytes, 800)
  assert.equal(summary.entries[0].usedPercent, 20)
  assert.equal(summary.usedPercent, 27.3)
})

test('stylesheet index tracks added sheets, drops removed ones and labels inline sheets', () => {
  const sheets = styleSheetIndex([
    { method: 'CSS.styleSheetAdded', params: { header: { styleSheetId: 'a', sourceURL: 'https://site/main.css', length: 400 } } },
    { method: 'CSS.styleSheetAdded', params: { header: { styleSheetId: 'b', sourceURL: '', length: 50 } } },
    { method: 'CSS.styleSheetAdded', params: { header: { styleSheetId: 'gone', sourceURL: 'https://site/old.css', length: 900 } } },
    { method: 'CSS.styleSheetRemoved', params: { styleSheetId: 'gone' } },
    { method: 'Network.requestWillBeSent', params: {} }
  ])
  assert.deepEqual(sheets, [
    { id: 'a', url: 'https://site/main.css', length: 400 },
    { id: 'b', url: '(inline stylesheet)', length: 50 }
  ])
})

test('style coverage measures used rules against stylesheet size, not against the delta', () => {
  // stopRuleUsageTracking answers with used rules only; unused bytes exist solely in the sheet.
  const summary = foldRuleCoverage({
    ruleUsage: [
      { styleSheetId: 'a', startOffset: 0, endOffset: 100, used: true },
      { styleSheetId: 'a', startOffset: 50, endOffset: 80, used: true },
      { styleSheetId: 'a', startOffset: 900, endOffset: 999, used: false },
      { styleSheetId: 'untracked', startOffset: 0, endOffset: 50, used: true }
    ]
  }, [
    { id: 'a', url: 'https://site/main.css', length: 400 },
    { id: 'b', url: 'https://site/unused.css', length: 200 }
  ], 10)

  assert.equal(summary.files, 3)
  assert.deepEqual(summary.entries.map((entry) => entry.url), [
    'https://site/main.css', 'https://site/unused.css', '(untracked stylesheet)'
  ])
  // Overlapping used ranges count once, and the rest of the sheet is unused.
  assert.equal(summary.entries[0].usedBytes, 100)
  assert.equal(summary.entries[0].unusedBytes, 300)
  assert.equal(summary.entries[1].usedPercent, 0)
  assert.equal(summary.entries[2].unusedBytes, 0)
})

test('live stylesheets keep the sheets the page can still produce text for', async () => {
  const asked: string[] = []
  const live = await liveStyleSheets(async (method, params) => {
    assert.equal(method, 'CSS.getStyleSheetText')
    const id = String((params ?? {}).styleSheetId)
    asked.push(id)
    if (id === 'stale') throw new Error('No style sheet with given id found')
    return { text: 'a'.repeat(120) }
  }, [
    { id: 'live', url: 'https://site/main.css', length: 400 },
    { id: 'stale', url: 'https://site/old.css', length: 900 }
  ])
  assert.deepEqual(asked, ['live', 'stale'])
  assert.deepEqual(live, [{ id: 'live', url: 'https://site/main.css', length: 120 }])
})

test('cpu profile folds sample deltas into per-function self time', () => {
  const summary = foldCpuProfile({
    profile: {
      startTime: 0,
      endTime: 30_000,
      nodes: [
        { id: 1, callFrame: { functionName: 'slow', url: 'https://site/a.js', lineNumber: 9 } },
        { id: 2, callFrame: { functionName: '', url: '', lineNumber: -1 } }
      ],
      samples: [1, 2, 1],
      timeDeltas: [10_000, 5_000, 5_000]
    }
  }, 10)
  assert.equal(summary.samples, 3)
  assert.equal(summary.durationMs, 30)
  assert.deepEqual(summary.functions[0], {
    functionName: 'slow', url: 'https://site/a.js', line: 10, selfMs: 15, percent: 75
  })
  assert.equal(summary.functions[1].functionName, '(anonymous)')
  assert.equal(summary.functions[1].url, '(native)')
})

test('heap profile walks the allocation tree and ranks call sites', () => {
  const summary = foldHeapProfile({
    profile: {
      head: {
        callFrame: { functionName: 'root', url: '', lineNumber: 0 },
        selfSize: 0,
        children: [
          { callFrame: { functionName: 'alloc', url: 'https://site/a.js', lineNumber: 4 }, selfSize: 3_000, children: [] },
          { callFrame: { functionName: 'small', url: 'https://site/b.js', lineNumber: 1 }, selfSize: 1_000, children: [] }
        ]
      }
    }
  }, 10)
  assert.equal(summary.totalBytes, 4_000)
  assert.deepEqual(summary.sites.map((site) => site.functionName), ['alloc', 'small'])
  assert.equal(summary.sites[0].percent, 75)
  assert.equal(summary.sites[0].line, 5)
})

test('metrics fold to a plain record and missing payloads stay empty', () => {
  assert.deepEqual(foldMetrics({ metrics: [{ name: 'Nodes', value: 12 }, { name: '', value: 1 }] }), { Nodes: 12 })
  assert.deepEqual(foldMetrics(null), {})
  assert.deepEqual(foldScriptCoverage(null, 5).entries, [])
})

test('cpu stays out of the default set and cannot be armed alongside script', async () => {
  // Measured: precise coverage plus the sampling profiler breaks the next heavy navigation.
  assert.deepEqual(channelsFrom([]), { script: true, style: true, cpu: false, heap: true })
  assert.deepEqual(channelsFrom(['all']), { script: true, style: true, cpu: false, heap: true })
  assert.deepEqual(channelsFrom(['cpu']), { script: false, style: false, cpu: true, heap: false })

  await assert.rejects(
    () => startProfiling(async () => ({}), channelsFrom(['script', 'cpu'])),
    /cannot be armed together/
  )
})

test('channels arm exactly what was asked for', async () => {
  assert.deepEqual(channelsFrom(['style']), { script: false, style: true, cpu: false, heap: false })

  const sent: string[] = []
  const started = await startProfiling(async (method) => { sent.push(method); return {} }, channelsFrom(['script', 'heap']))
  assert.deepEqual(started, ['script', 'heap'])
  assert.deepEqual(sent, [
    'Profiler.enable',
    'Profiler.startPreciseCoverage',
    // Page events are what let the heap sampler be re-armed after a navigation.
    'Page.enable',
    'HeapProfiler.enable',
    'HeapProfiler.startSampling'
  ])
})

test('every channel stop is bounded, so a dead renderer reports instead of hanging', async () => {
  const report = await stopProfiling(
    // A crashed target answers nothing at all, on any of these commands.
    async () => new Promise(() => {}),
    { script: true, style: true, cpu: true, heap: true },
    { limit: 5, styleSheets: [], stopTimeoutMs: 20 }
  )

  assert.deepEqual(
    [report.scriptCoverage, report.styleCoverage, report.cpu, report.heap],
    [undefined, undefined, undefined, undefined]
  )
  assert.deepEqual(Object.keys(report.unavailable ?? {}), ['script', 'style', 'cpu', 'heap'])
  assert.match(String(report.unavailable?.heap), /isolate this tab has since replaced/)
  assert.match(String(report.unavailable?.cpu), /Profiler.stop did not answer/)
  assert.deepEqual(report.metrics, {})
})

test('stop folds only the armed channels and always reports metrics', async () => {
  const sent: string[] = []
  const report = await stopProfiling(async (method) => {
    sent.push(method)
    if (method === 'Profiler.takePreciseCoverage') {
      return { result: [{ scriptId: '1', url: 'https://site/a.js', functions: [{ ranges: [{ startOffset: 0, endOffset: 10, count: 1 }] }] }] }
    }
    if (method === 'Performance.getMetrics') return { metrics: [{ name: 'Nodes', value: 4 }] }
    return {}
  }, channelsFrom(['script']), { limit: 5, styleSheets: [] })

  assert.equal(report.scriptCoverage?.usedBytes, 10)
  assert.equal(report.styleCoverage, undefined)
  assert.equal(report.cpu, undefined)
  assert.deepEqual(report.metrics, { Nodes: 4 })
  assert.ok(sent.includes('Profiler.stopPreciseCoverage'))
  assert.ok(!sent.includes('Profiler.stop'))
})
