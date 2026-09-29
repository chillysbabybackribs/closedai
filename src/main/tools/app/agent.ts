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
 * so a chat keeps cycling after every finished turn until someone pauses or stops it. The one
 * verb that targets the caller is finish: a run may end itself once its work is complete.
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
        'Attach a run to another pane and send its standing prompt now. Name a saved agent with agent_id (ids under state.workspace.savedAgents; its prompt and cycle cap apply) or pass prompt for a one-off. After every finished turn the app sends the next Cycle N message until the run is paused or stopped; a turn already in flight is folded in. Refused for the calling pane and for a pane whose run is running.',
      inputSchema: objectSchema({
        pane_id: paneField,
        agent_id: { type: 'string', minLength: 1, description: 'Saved agent to start; supplies the prompt, cycle cap, and name. Required unless prompt is given.' },
        prompt: { type: 'string', minLength: 1, maxLength: AGENT_RUN_MAX_PROMPT_CHARS, description: 'Standing instructions for a one-off run; re-sent whenever the provider thread changes. Required unless agent_id is given.' },
        max_cycles: { type: 'integer', minimum: 1, description: 'Pause after this many cycles; omit to use the saved cap, or to run until paused.' }
      }, ['pane_id']),
      run: async (input, context) => {
        const { host, paneId } = target(input, context, 'start an agent in')
        const prompt = stringArg(input, 'prompt')
        const agentId = stringArg(input, 'agent_id')
        if (!prompt && !agentId) throw new Error('agent start needs agent_id (a saved agent from state.workspace.savedAgents) or prompt (standing instructions)')
        const options = { ...(prompt ? { prompt } : {}), ...(typeof input.max_cycles === 'number' ? { maxCycles: input.max_cycles } : {}) }
        const run = await host.agentRun({ op: 'start', paneId, agentId: agentId ?? null, options })
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
      action: 'finish',
      description:
        'End your own run: the calling pane\'s run pauses with "Finished: <summary>" on its strip and sends no further cycles; ' +
        'the current turn finishes normally. Call it when your standing instructions\' work is done (for example a ledger ' +
        'reports complete), not to take a break. Refused when the calling pane has no running run.',
      inputSchema: objectSchema({
        summary: { type: 'string', minLength: 1, maxLength: 200, description: 'One line: what was completed.' }
      }, ['summary']),
      run: async (input, context) => {
        const host = requireHost(app, 'agent runs')
        if (!context.paneId) throw new Error('agent finish ends the calling chat\'s own run; no calling chat was identified')
        const run = await host.agentRun({ op: 'finish', paneId: context.paneId, summary: stringArg(input, 'summary')! })
        return jsonResult({ run: run && { status: run.status, cycle: run.cycle, reason: run.reason } })
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
