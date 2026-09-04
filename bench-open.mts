import { loadClaudeSdk } from './src/main/claude/claude-sdk.js'
import { replayClaudeSession } from './src/main/claude/claude-history.js'

const sessionId = process.argv[2]!
const cwd = '/home/dp/Desktop/closedai'
const t0 = performance.now()
const sdk = await loadClaudeSdk()
const t1 = performance.now()
const raw = await sdk.getSessionMessages(sessionId, { dir: cwd })
const t2 = performance.now()
const items = await replayClaudeSession(sdk, sessionId, { cwd, displayScreenshot: () => null })
const t3 = performance.now()
const full = JSON.stringify(items)
const page = JSON.stringify(items.slice(-200))
console.log(JSON.stringify({
  loadSdkMs: +(t1 - t0).toFixed(1),
  getSessionMessagesMs: +(t2 - t1).toFixed(1),
  replayTotalMs: +(t3 - t1).toFixed(1),
  rawMessages: raw.length,
  items: items.length,
  fullSnapshotBytes: full.length,
  last200Bytes: page.length
}, null, 2))
