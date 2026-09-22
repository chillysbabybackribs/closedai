import type { App } from 'electron'
import type { ResearchService } from './tools/search/research/service.js'
import type { ToolRegistry } from './tools/registry.js'

export type LiveVerifyHandle = {
  requested: boolean
  pending: { mode: string; quitAfter: boolean } | null
  toolRegistry: ToolRegistry | null
  researchService: ResearchService | null
  userDataPath: () => string
}

export function liveVerifyFromArgv(): string | undefined {
  return process.argv.find((arg) => arg.startsWith('--live-verify='))?.slice('--live-verify='.length).trim()
}

export function requestLiveVerify(handle: LiveVerifyHandle, app: App, mode: string, quitAfter: boolean): void {
  handle.requested = true
  handle.pending = { mode, quitAfter }
  void runPendingLiveVerify(handle, app)
}

export async function runPendingLiveVerify(handle: LiveVerifyHandle, app: App): Promise<void> {
  const pending = handle.pending
  if (!pending || !handle.toolRegistry) return
  handle.pending = null
  try {
    const { runLiveVerify } = await import('./live-verify/search-pipeline.js')
    const result = await runLiveVerify(pending.mode, handle.toolRegistry, handle.researchService, handle.userDataPath())
    console.log(`[live-verify:${pending.mode}]`, JSON.stringify(result))
  } catch (error) {
    console.error(`[live-verify:${pending.mode}]`, error)
    if (pending.quitAfter) process.exitCode = 1
  } finally {
    if (pending.quitAfter) app.quit()
  }
}
