import type { WebContents } from 'electron'
import { readPageText, waitForPageReady, type PageText, type ScriptRunner } from '../browser-page-ready.js'
import type { BrowserWorkerPool, Worker } from './worker-pool.js'

export type RenderedWorker = Worker & { contents(): (ScriptRunner & Pick<WebContents, 'stop'>) | null }

// A rendered read waits for the page's text to stop changing, bounded so a page that streams
// forever still yields what it has. The whole read is bounded again by the caller's signal.
const SETTLE_TIMEOUT_MS = 8_000

/**
 * Load a URL in a hidden worker and return the page's rendered text. No page state survives
 * the read: the worker is shared, so the next lease navigates it elsewhere.
 */
export async function readRenderedPage(
  pool: BrowserWorkerPool,
  owner: string,
  url: string,
  signal: AbortSignal,
  maxChars = 120_000
): Promise<PageText> {
  return pool.lease(owner, signal, async (leased) => {
    const worker = leased as RenderedWorker
    const contents = () => {
      const live = worker.contents()
      if (!live || live.isDestroyed()) throw new Error('The hidden page worker was closed')
      return live
    }
    // A stop during navigation resolves the load as aborted; the signal check after it is
    // what turns that into the caller's own cancellation.
    const stop = () => { try { contents().stop() } catch { /* already gone */ } }
    signal.addEventListener('abort', stop, { once: true })
    try {
      signal.throwIfAborted()
      await worker.navigate(url)
      signal.throwIfAborted()
      await waitForPageReady(contents(), { until: 'idle', timeoutMs: SETTLE_TIMEOUT_MS })
      signal.throwIfAborted()
      const page = await readPageText(contents(), { maxChars: maxChars === 0 ? Number.MAX_SAFE_INTEGER : maxChars })
      if (!page) throw new Error('The rendered page did not answer')
      return page
    } finally {
      signal.removeEventListener('abort', stop)
    }
  })
}
