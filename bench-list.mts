import { loadClaudeSdk } from './src/main/claude/claude-sdk.js'
import { listClaudeThreads } from './src/main/claude/claude-history.js'
const cwd = '/home/dp/Desktop/closedai'
const sdk = await loadClaudeSdk()
// event-loop lag probe
let maxLag = 0, last = performance.now()
const probe = setInterval(() => { const now = performance.now(); maxLag = Math.max(maxLag, now - last - 10); last = now }, 10)
for (let i = 0; i < 3; i++) {
  maxLag = 0; last = performance.now()
  const t = performance.now()
  const threads = await listClaudeThreads(sdk, cwd)
  console.log(`run${i}: ${(performance.now() - t).toFixed(0)}ms  threads=${threads.length}  maxEventLoopBlockMs=${maxLag.toFixed(0)}`)
}
clearInterval(probe)
