import { RequestBudget } from '../../request-budget.js'
import type { PdfCoverage } from '../../../../../shared/web-research.js'
import { pdfWorkerTask } from './worker-task.js'

export type PdfText = { text: string; title: string; incomplete: boolean; pdf: PdfCoverage }
export type PdfReader = (path: string, maxTextChars: number, signal: AbortSignal) => Promise<PdfText>

/** Parsing is off-thread and bounded across runs; abort terminates even a stuck parser. */
export function createPdfReader(workerUrl: URL): PdfReader {
  const budget = new RequestBudget(2, 2)
  return (path, maxTextChars, signal) => budget.run('pdf', 'pdf', signal,
    () => pdfWorkerTask<PdfText>(workerUrl, { path, maxTextChars }, signal))
}
