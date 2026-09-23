import type { PageReadyResult } from '../browser-page-ready.js'
import { ToolRegistry } from '../tools/registry.js'
import type { ToolCallObserver, ToolCallTrace } from '../tools/registry.js'
import type { BrowserToolHost } from '../tools/browser/host.js'
import { browserTools } from '../tools/browser/index.js'
import type { RecordedToolCall } from './types.js'

const ready: PageReadyResult = {
  readyState: 'complete',
  reached: true,
  conditionMet: null,
  elapsedMs: 800,
  url: 'https://a.test/',
  title: 'A'
}

export type BrowserFixtureOptions = {
  hostOverrides?: Partial<BrowserToolHost>
  pdfPage?: number
  pdfAvailable?: boolean
}

/** Stub browser host aligned with `browser.test.ts` defaults. */
export function createBrowserFixtureRegistry(options: BrowserFixtureOptions = {}): {
  registry: ToolRegistry
  calls: unknown[]
  drainRecordedCalls: () => RecordedToolCall[]
} {
  const calls: unknown[] = []
  const recorded: RecordedToolCall[] = []
  const pdfAvailable = options.pdfAvailable !== false

  const host: BrowserToolHost = {
    listTabs: () => [{
      id: 'tab-1',
      pos: 1,
      title: 'A',
      url: 'https://a.test/paper.pdf',
      favicon: null,
      isLoading: false,
      active: true
    }],
    readPage: async (tabId, readOptions) => {
      calls.push(['readPage', tabId, readOptions])
      if (tabId === 'missing') return null
      const page = readOptions.pdfPage ?? options.pdfPage ?? 1
      return {
        url: 'https://a.test/paper.pdf',
        title: 'Paper',
        readyState: 'complete',
        text: `PDF paragraph page ${page}`,
        truncated: false,
        pdf: {
          page,
          totalPages: 17,
          pagesAvailable: pdfAvailable ? 3 : 0,
          available: pdfAvailable
        }
      }
    },
    fetchPage: async (tabId, request) => {
      calls.push(['fetchPage', tabId, request])
      return tabId === 'missing' ? null : {
        url: 'https://a.test/data',
        status: 200,
        ok: true,
        contentType: 'text/plain',
        text: 'Hello world',
        bodyLength: 11,
        truncated: false
      }
    },
    navigate: async (url, navOptions) => {
      calls.push(['navigate', url, navOptions])
      return { ok: true, tabId: 'tab-1', ready }
    },
    waitFor: async (tabId, readiness) => {
      calls.push(['waitFor', tabId, readiness])
      return { ...ready, reached: true, conditionMet: true, elapsedMs: Math.min(readiness.timeoutMs, 400) }
    },
    evaluate: async (tabId, request) => {
      calls.push(['evaluate', tabId, request])
      return tabId === 'missing' ? null : { ok: true, type: 'object', value: { title: 'A' }, truncated: false }
    },
    query: async (tabId, request) => {
      calls.push(['query', tabId, request])
      return tabId === 'missing' ? null : { selector: request.selector, matched: 1, returned: 1, items: [] }
    },
    consoleMessages: (tabId, filter) => {
      calls.push(['console', tabId, filter])
      return tabId === 'missing' ? null : { matched: 0, returned: 0, nextCursor: 0, lastNavigationAt: null, entries: [] }
    },
    ...options.hostOverrides
  }

  const registry = new ToolRegistry([browserTools(() => host)])
  const observer: ToolCallObserver = (trace: ToolCallTrace) => {
    if (trace.phase !== 'end') return
    recorded.push({
      namespace: trace.request.namespace ?? '',
      tool: trace.request.tool,
      arguments: (trace.request.arguments ?? {}) as Record<string, unknown>,
      isError: trace.result.isError,
      errorKind: trace.result.errorKind
    })
  }
  registry.observe(observer)

  return {
    registry,
    calls,
    drainRecordedCalls: () => {
      const copy = [...recorded]
      recorded.length = 0
      return copy
    }
  }
}
