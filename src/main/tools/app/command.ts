import type { ToolAction } from '../action-tool.js'
import { jsonResult, objectSchema } from '../json-result.js'
import { booleanArg, numberArg, stringArg, type JsonObject, type ToolContext } from '../tool.js'
import { DEFAULT_WAIT_MS } from '../browser/fields.js'
import { requireBrowser, type BrowserHostProvider } from '../browser/host.js'
import { requireHost, type AppBrowserTabRequest, type AppCommandHost, type AppUiHost } from './host.js'
import { resolveHtmlPreview } from './preview-html.js'

const paneField: JsonObject = {
  type: 'string', minLength: 1,
  description: 'Target chat pane id from state.workspace or new_chat; defaults to the selected pane.'
}

const AWAIT_TURN_MAX_MS = 120_000

/** Deterministic app commands over the same services the renderer's IPC calls. */
export function appCommandActions(
  app: () => AppCommandHost | null,
  ui: () => AppUiHost | null,
  page: BrowserHostProvider
): ToolAction[] {
  return [
    {
      action: 'project_switch',
      description: 'Request or cancel a deferred project switch. request needs an absolute existing directory and waits for all chats to become idle; acceptance is pending, so finish your turn. The app verifies the destination and starts a new chat with your conversation handoff so work can continue. cancel releases only your request; restart cancels pending switches. Check state.workspace.projectSwitch: completed means the continuation was submitted, not that the task is done.',
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
      description:
        'Create a chat and return its pane id. From a coordinator pane, returns a linked worker id without moving focus. Otherwise selects the new chat like File → New chat.',
      inputSchema: objectSchema({}),
      run: async (_input, context) => {
        const host = requireHost(app, 'app commands')
        const created = await host.newChat(context.paneId ?? null)
        return jsonResult({ ...created, ...host.state(['workspace'], created.paneId, context.paneId ?? null) })
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
          signal: context.signal,
          callerPaneId: context.paneId ?? null
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
        'Browser tab strip and workspace HTML previews. preview_html opens a .html/.htm file under the chat cwd in a new selected tab and reveals the browser pane when hidden — use after writing mocks, never xdg-open. Other ops: new/new_right, select, close, duplicate, reload, rename, claim, release. Returns tab state and assignments.',
      inputSchema: objectSchema({
        op: {
          type: 'string',
          enum: [
            'preview_html',
            'new', 'new_right', 'select', 'close', 'close_others', 'close_right',
            'duplicate', 'back', 'forward', 'reload', 'rename', 'claim', 'release', 'release_all'
          ]
        },
        path: {
          type: 'string', minLength: 1, maxLength: 4096,
          description: 'Required for preview_html: file path relative to the chat cwd or absolute inside it.'
        },
        reveal_browser: { type: 'boolean', description: 'For preview_html: show the browser pane when hidden; default true.' },
        tab_id: {
          type: 'string',
          minLength: 1,
          description: 'Required for select, close, close_others, close_right, duplicate, rename, new_right, and claim.'
        },
        url: { type: 'string', minLength: 1, maxLength: 2_000, description: 'Optional URL or query for new.' },
        tab_title: { type: 'string', maxLength: 300, description: 'Custom title for rename; empty clears the custom title.' }
      }, ['op']),
      run: async (input, context) => {
        const host = requireHost(app, 'app commands')
        const opRaw = stringArg(input, 'op')
        if (opRaw === 'preview_html') {
          const paneId = context.paneId ?? host.selectedPaneId()
          const chat = host.state(['chat'], paneId, context.paneId ?? null).chat as { cwd?: string } | null
          const cwd = chat?.cwd
          if (!cwd) throw new Error('Could not read the chat working directory for preview_html')
          const resolved = await resolveHtmlPreview(stringArg(input, 'path')!, cwd)
          const outcome = await requireBrowser(page).navigate(resolved.fileUrl, {
            newTab: true,
            ready: { until: 'load', timeoutMs: DEFAULT_WAIT_MS }
          })
          if (!outcome.ok) throw new Error(`Could not open ${resolved.path}: ${outcome.error}`)
          const browser = await host.browserTab({ op: 'claim', tabId: outcome.tabId }, context.paneId)
          let browserRevealed = false
          if (booleanArg(input, 'reveal_browser', true)) browserRevealed = await revealBrowserPane(ui)
          return jsonResult({
            ...resolved,
            tabId: outcome.tabId,
            title: outcome.ready.title,
            url: outcome.ready.url,
            browser,
            browserRevealed
          })
        }
        return jsonResult(await host.browserTab({
          op: opRaw as AppBrowserTabRequest['op'],
          tabId: stringArg(input, 'tab_id'),
          url: stringArg(input, 'url'),
          title: stringArg(input, 'tab_title')
        }, context.paneId))
      }
    }
  ]
}

async function revealBrowserPane(uiProvider: () => AppUiHost | null): Promise<boolean> {
  const automation = uiProvider()
  if (!automation) return false
  const layout = (await automation.uiState()).layout
  if (layout?.browserVisible) return false
  await automation.click({ control: 'layout.browser-toggle' })
  return true
}

function otherPane(host: AppCommandHost, input: JsonObject, context: ToolContext, verb: string): string {
  const paneId = stringArg(input, 'pane_id') ?? host.selectedPaneId()
  if (context.paneId && paneId === context.paneId) {
    throw new Error(`Cannot ${verb} the calling pane (${paneId}); pass the pane_id of another pane, for example one returned by new_chat`)
  }
  return paneId
}
