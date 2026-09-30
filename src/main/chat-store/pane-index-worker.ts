import { parentPort, workerData } from 'node:worker_threads'
import type { ChatPaneLexicalIndexRecord } from '../../shared/chat-index.js'
import { buildFtsMatchQuery, ChatPaneLexicalFts } from './chat-pane-lexical-fts.js'

if (!parentPort) throw new Error('Pane index requires a worker port')
const port = parentPort
const fts = new ChatPaneLexicalFts(workerData.dir)
// JSON is authoritative. Only the pane being searched needs SQLite rows, and identical
// searches must not rebuild them. A new worker distrusts previously persisted SQLite rows.
const revisions = new Map<string, string>()
port.on('message', ({ id, record, query, limit }: {
  id: number; record: ChatPaneLexicalIndexRecord; query: string; limit: number
}) => {
  try {
    fts.open()
    const revision = JSON.stringify(record)
    if (revisions.get(record.chatId) !== revision) {
      fts.replaceChat(record)
      revisions.set(record.chatId, revision)
    }
    const match = buildFtsMatchQuery(query)
    port.postMessage({ id, rows: match ? fts.search(record.chatId, match, limit) : [] })
  } catch (error) {
    revisions.delete(record.chatId)
    port.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
})
