import { Worker } from 'node:worker_threads'

/** Abort tears down the thread and its children, including Tesseract's worker. */
export async function pdfWorkerTask<T>(workerUrl: URL, workerData: unknown, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  const worker = new Worker(workerUrl, { workerData, resourceLimits: { maxOldGenerationSizeMb: 256 } })
  let abort!: () => void
  try {
    return await new Promise<T>((resolve, reject) => {
      abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
      worker.once('error', reject)
      worker.once('exit', (code) => reject(new Error(`PDF worker exited before returning evidence (${code})`)))
      worker.once('message', (message: { result?: T; error?: string }) => {
        if (message.result) resolve(message.result)
        else reject(new Error(message.error ?? 'PDF worker returned no evidence'))
      })
      if (signal.aborted) abort()
    })
  } finally {
    signal.removeEventListener('abort', abort)
    await worker.terminate()
  }
}
