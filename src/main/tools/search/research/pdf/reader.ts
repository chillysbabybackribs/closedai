import { Worker } from 'node:worker_threads'
import { RequestBudget } from '../../request-budget.js'
import type { PdfCoverage } from '../../../../../shared/web-research.js'

export type PdfText = { text: string; title: string; incomplete: boolean; pdf: PdfCoverage }
export type PdfReader = (path: string, maxTextChars: number, signal: AbortSignal) => Promise<PdfText>

/** Parsing is off-thread and bounded across runs; abort terminates even a stuck parser. */
export function createPdfReader(workerUrl: URL): PdfReader {
  const budget = new RequestBudget(2, 2)
  return (path, maxTextChars, signal) => budget.run('pdf', 'pdf', signal, async () => {
    signal.throwIfAborted()
    const worker = new Worker(workerUrl, {
      workerData: { path, maxTextChars }, resourceLimits: { maxOldGenerationSizeMb: 256 }
    })
    let abort!: () => void
    try {
      return await new Promise<PdfText>((resolve, reject) => {
        abort = () => reject(signal.reason)
        signal.addEventListener('abort', abort, { once: true })
        worker.once('error', reject)
        worker.once('exit', (code) => reject(new Error(`PDF parser exited before returning text (${code})`)))
        worker.once('message', (message: { result?: PdfText; error?: string }) => {
          if (message.result) resolve(message.result)
          else reject(new Error(message.error ?? 'PDF parser returned no result'))
        })
        if (signal.aborted) abort()
      })
    } finally {
      signal.removeEventListener('abort', abort)
      await worker.terminate()
    }
  })
}
