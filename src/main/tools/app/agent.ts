import type { ToolAction } from '../action-tool.js'
import { jsonResult, objectSchema } from '../json-result.js'
import { stringArg, type JsonObject, type ToolContext } from '../tool.js'
import { AGENT_RUN_MAX_PROMPT_CHARS } from '../../../shared/agent-runs.js'
import { requireHost, type AppCommandHost } from './host.js'

const paneField: JsonObject = {
  type: 'string', minLength: 1,
  description: 'Target chat pane id from state.workspace or command new_chat; required and must not be the calling pane.'
}

/**
 * Drive the agent run of another pane: the same main-process loop the agent builder's Start uses,
 * so a chat keeps cycling after every finished turn until someone pauses or stops it.
 */
export function appAgentActions(app: () => AppCommandHost | null): ToolAction[] {
  const target = (input: JsonObject, context: ToolContext, verb: string) => {
    const host = requireHost(app, 'agent runs')
    const paneId = stringArg(input, 'pane_id')
    if (!paneId) {
      throw new Error(`agent ${verb} needs pane_id of another chat; omitting it would follow UI focus and can start a run on the wrong pane`)
    }
    if (context.paneId && paneId === context.paneId) {
      throw new Error(`Cannot ${verb} the calling pane (${paneId}); pass the pane_id of another pane, for example one returned by command new_chat`)
    }
    return { host, paneId }
  }
  const respond = (host: AppCommandHost, paneId: string, context: ToolContext, run: unknown) =>
    jsonResult({ run, ...host.state(['chat'], paneId, context.paneId ?? null) })
  return [
    {
      action: 'start',
      description:
        'Attach a run to another pane and send its standing prompt now. After every finished turn the app sends the next Cycle N message until the run is paused or stopped; a turn already in flight is folded in. Refused for the calling pane and for a pane whose run is running.',
      inputSchema: objectSchema({
        pane_id: paneField,
        prompt: { type: 'string', minLength: 1, maxLength: AGENT_RUN_MAX_PROMPT_CHARS, description: 'Standing instructions; re-sent whenever the provider thread changes.' },
        max_cycles: { type: 'integer', minimum: 1, description: 'Pause after this many cycles; omit to run until paused.' }
      }, ['prompt', 'pane_id']),
      run: async (input, context) => {
        const { host, paneId } = target(input, context, 'start an agent in')
        const maxCycles = typeof input.max_cycles === 'number' ? input.max_cycles : null
        const run = await host.agentRun({ op: 'start', paneId, options: { prompt: stringArg(input, 'prompt')!, maxCycles } })
        return respond(host, paneId, context, run)
      }
    },
    {
      action: 'pause',
      description: 'Pause the run of another pane and end its turn in flight; the run keeps its prompt and cycle count.',
      inputSchema: objectSchema({ pane_id: paneField }, ['pane_id']),
      run: async (input, context) => {
        const { host, paneId } = target(input, context, 'pause the agent of')
        return respond(host, paneId, context, await host.agentRun({ op: 'pause', paneId }))
      }
    },
    {
      action: 'resume',
      description: 'Resume a paused run: the next cycle goes out at once when the pane is idle, or after the current turn ends.',
      inputSchema: objectSchema({ pane_id: paneField }, ['pane_id']),
      run: async (input, context) => {
        const { host, paneId } = target(input, context, 'resume the agent of')
        return respond(host, paneId, context, await host.agentRun({ op: 'resume', paneId }))
      }
    },
    {
      action: 'stop',
      description: 'End the run entirely and interrupt any turn in flight; the chat stays open as an ordinary chat. Use command stop_agent to interrupt a turn without ending the run.',
      inputSchema: objectSchema({ pane_id: paneField }, ['pane_id']),
      run: async (input, context) => {
        const { host, paneId } = target(input, context, 'stop the agent of')
        return respond(host, paneId, context, await host.agentRun({ op: 'stop', paneId }))
      }
    }
  ]
}
