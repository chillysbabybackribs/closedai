import type { ToolRegistry } from '../tools/registry.js'
import { runPokerAutopilot } from '../poker-autopilot/runner.js'

export async function runPokerAutopilotLiveVerify(registry: ToolRegistry, userData: string): Promise<Record<string, unknown>> {
  return runPokerAutopilot({ registry, userData })
}
