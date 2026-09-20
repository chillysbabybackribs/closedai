import type { ToolAction } from '../action-tool.js'
import { jsonResult, objectSchema } from '../json-result.js'
import { booleanArg, numberArg, stringArg, type JsonObject, type ToolContext } from '../tool.js'
import { requireHost, type AppBrowserTabRequest, type AppCommandHost } from './host.js'

const paneField: JsonObject = {
  type: 'string', minLength: 1,
  description: 'Target chat pane id from state.workspace or new_chat; defaults to the selected pane.'
}

const AWAIT_TURN_MAX_MS = 120_000

/** Deterministic app commands over the same services the renderer's IPC calls. */
export function appCommandActions(app: () => AppCommandHost | null): ToolAction[] {
  return [
    {
      action: 'project_switch',
      description: 'Request or cancel a deferred project switch. request validates an absolute existing directory and queues a switch after all chats become idle. Acceptance is pending: finish your turn. The app verifies the destination and starts a fresh chat with your conversation handoff to continue the authorized task. cancel releases only the caller’s pending request. Restart cancels pending work. Inspect state.workspace.projectSwitch for status; completed means the continuation was submitted, not the task finished.',
      inputSchema: objectSchema({
        project_op: { type: 'string', enum: ['request', 'cancel'] },
        project_path: { type: 'string', minLength: 1, maxLength: 4096, description: 'Required for request: absolute path to an existing directory.' }
      }, ['project_op']),
      run: async (input, context) => {
        if (!context.paneId) throw new Error('A calling chat is required')
        const host = requireHost(app, 'app commands')
        if (input.project_op === 'cancel') return jsonResult({ projectSwitch: host.cancelProjectSwitch(context.paneId) })
        if (!context.threadId || !context.turnId) throw new Error('A current calling thread and turn are required')
        const projectPath = stringArg(input, 'project_path')
        if (!projectPath) throw new Error('project_path is required for request')
        return jsonResult(await host.queueProjectSwitch({
          paneId: context.paneId, threadId: context.threadId, turnId: context.turnId, projectPath
        }, context.signal))
      }
    },
    {
      action: 'new_chat',
      description: 'Open a new agent chat pane (what the New Agent button does) and select it. Returns its pane id.',
      inputSchema: objectSchema({}),
      run: async () => {
        const host = requireHost(app, 'app commands')
        const created = await host.newChat()
        return jsonResult({ ...created, ...host.state(['workspace'], created.paneId, null) })
      }
    },
    {
      action: 'send_message',
      description:
        'Submit a message to another pane. await_turn (default true) waits for completion; read state.chat for the reply. Refused for the calling pane.',
      inputSchema: objectSchema({
        pane_id: paneField,
        text: { type: 'string', minLength: 1, maxLength: 20_000, description: 'Message text.' },
        await_turn: { type: 'boolean', description: 'Wait for the turn to finish; default true.' },
        timeout_ms: {
          type: 'integer', minimum: 1_000, maximum: AWAIT_TURN_MAX_MS,
          description: `Maximum wait for the turn; default 60000, max ${AWAIT_TURN_MAX_MS}.`
        }
      }, ['text']),
      timeoutMs: AWAIT_TURN_MAX_MS + 10_000,
      run: async (input, context) => {
        const host = requireHost(app, 'app commands')
        const paneId = otherPane(host, input, context, 'send a message to')
        const result = await host.sendMessage({
          paneId,
          text: stringArg(input, 'text')!,
          awaitTurn: booleanArg(input, 'await_turn', true),
          timeoutMs: numberArg(input, 'timeout_ms', 60_000),
          signal: context.signal
        })
        return jsonResult({ ...result, ...host.state(['chat'], paneId, context.paneId ?? null) })
      }
    },
    {
      action: 'stop_agent',
      description: 'Interrupt the running turn of another pane. Refused for the calling pane itself.',
      inputSchema: objectSchema({ pane_id: paneField }),
      run: async (input, context) => {
        const host = requireHost(app, 'app commands')
        const paneId = otherPane(host, input, context, 'stop')
        await host.stopAgent(paneId)
        return jsonResult(host.state(['chat'], paneId, context.paneId ?? null))
      }
    },
    {
      action: 'open_chat',
      description:
        'Select a pane, or open a thread by thread_id or unique title substring. Ambiguous titles fail with candidate ids.',
      inputSchema: objectSchema({
        pane_id: paneField,
        thread_id: { type: 'string', minLength: 1 },
        title: { type: 'string', minLength: 1, maxLength: 200 }
      }),
      run: async (input, context) => {
        const host = requireHost(app, 'app commands')
        const opened = await host.openChat({
          paneId: stringArg(input, 'pane_id'), threadId: stringArg(input, 'thread_id'), title: stringArg(input, 'title')
        })
        return jsonResult({ ...opened, ...host.state(['workspace', 'chat'], opened.paneId, context.paneId ?? null) })
      }
    },
    {
      action: 'close_chat',
      description: 'Retire another pane from the workspace shelf back to history. Refused for the calling pane itself.',
      inputSchema: objectSchema({ pane_id: paneField }, ['pane_id']),
      run: async (input, context) => {
        const host = requireHost(app, 'app commands')
        const paneId = otherPane(host, input, context, 'close')
        await host.closeChat(paneId)
        return jsonResult(host.state(['workspace'], undefined, context.paneId ?? null))
      }
    },
    {
      action: 'select_model',
      description: 'Set the model (and optionally reasoning effort) of a pane; ids come from state.chat and the model menu.',
      inputSchema: objectSchema({
        pane_id: paneField,
        model_id: { type: 'string', minLength: 1 },
        reasoning_effort: { type: 'string', minLength: 1 }
      }, ['model_id']),
      run: async (input, context) => {
        const host = requireHost(app, 'app commands')
        const paneId = stringArg(input, 'pane_id') ?? host.selectedPaneId()
        await host.selectModel(paneId, stringArg(input, 'model_id')!, stringArg(input, 'reasoning_effort'))
        return jsonResult(host.state(['chat'], paneId, context.paneId ?? null))
      }
    },
    {
      action: 'browser_tab',
      description:
        'Browser strip: new, new_right, select, close, close_others, close_right, duplicate, rename, back, forward, reload. Returns browser state.',
      inputSchema: objectSchema({
        op: {
          type: 'string',
          enum: [
            'new', 'new_right', 'select', 'close', 'close_others', 'close_right',
            'duplicate', 'back', 'forward', 'reload', 'rename'
          ]
        },
        tab_id: {
          type: 'string',
          minLength: 1,
          description: 'Required for select, close, close_others, close_right, duplicate, rename, and new_right.'
        },
        url: { type: 'string', minLength: 1, maxLength: 2_000, description: 'Optional URL or query for new.' },
        tab_title: { type: 'string', maxLength: 300, description: 'Custom title for rename; empty clears the custom title.' }
      }, ['op']),
      run: async (input) => {
        const host = requireHost(app, 'app commands')
        return jsonResult(await host.browserTab({
          op: stringArg(input, 'op') as AppBrowserTabRequest['op'],
          tabId: stringArg(input, 'tab_id'),
          url: stringArg(input, 'url'),
          title: stringArg(input, 'tab_title')
        }))
      }
    }
  ]
}

function otherPane(host: AppCommandHost, input: JsonObject, context: ToolContext, verb: string): string {
  const paneId = stringArg(input, 'pane_id') ?? host.selectedPaneId()
  if (context.paneId && paneId === context.paneId) {
    throw new Error(`Cannot ${verb} the calling pane (${paneId}); pass the pane_id of another pane, for example one returned by new_chat`)
  }
  return paneId
}
