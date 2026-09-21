import type { ToolManifest, ToolSwitch, ToolTelemetrySnapshot, ToolsEvent } from '../../shared/tools.js'

const GROUPS: ToolManifest['groups'] = [
  { id: 'reads-web', label: 'Read the web', effect: 'Reads only', summary: 'Open pages, search, and read sources. Nothing is changed on any site.' },
  { id: 'acts-in-browser', label: 'Act in the browser', effect: 'Acts as you', summary: 'Runs code and requests inside your signed-in tabs. Sites see it as you.' },
  { id: 'controls-app', label: 'Control ClosedAI', effect: 'Controls the app', summary: 'Read app state, open chats, switch models, press buttons, take screenshots.' },
  { id: 'reads-secrets', label: 'Your secrets', effect: 'Reads secrets', summary: 'Decrypts credentials from the vault for a task you asked for.' },
  { id: 'runs-native', label: 'This machine', effect: 'Runs native code', summary: 'Attaches to local processes and can inject code. Can crash the target.' }
]

type Sample = [id: string, group: ToolManifest['groups'][number]['id'], label: string, summary: string, enabled: boolean, cost: number, actions?: string[]]

const SAMPLES: Sample[] = [
  ['embedded_browser.page', 'reads-web', 'Browse a page', 'Open a URL in the browser pane and read what is on it.', true, 310, ['navigate', 'read_page', 'wait_for']],
  ['search.query', 'reads-web', 'Web search', 'Look things up across several search providers.', true, 540],
  ['search.library', 'reads-web', 'Paper library', 'Search the papers saved in the Research library.', true, 210, ['status', 'search', 'read']],
  ['embedded_browser.script', 'acts-in-browser', 'Run page scripts', 'Fetch, extract, or evaluate JavaScript inside the open page.', true, 620, ['fetch', 'extract', 'query', 'evaluate', 'console']],
  ['embedded_browser.network_replay', 'acts-in-browser', 'Replay a request', 'Send a captured request again, with edits. Can repeat a mutation.', false, 180],
  ['browser_cdp.protocol', 'acts-in-browser', 'Raw DevTools protocol', 'Send any DevTools command, list targets, and read captured request bodies.', true, 700, ['capabilities', 'targets', 'command']],
  ['closedai_app.state', 'controls-app', 'App state', 'Read which chats, tabs, models, downloads, and dialogs are open.', true, 240],
  ['closedai_ui.capture', 'controls-app', 'Screenshots', 'Capture the app window or a page for visual checks.', true, 260, ['app_window', 'browser_page', 'crop']],
  ['credential_vault.read', 'reads-secrets', 'Read a credential', 'Decrypt one field for immediate use in a task you asked for.', true, 160],
  ['native_instrument.probe', 'runs-native', 'Custom probes', 'Inject a script into a local process. Can modify or crash it.', false, 330]
]

/** Enough of a registry for the preview to show every dialog state; nothing here runs. */
export function sampleToolManifest(): ToolManifest {
  const tools = SAMPLES.map(([id, group, label, summary, enabled, costTokens, actions = []]) => {
    const [namespace, name] = id.split('.') as [string, string]
    return {
      id, namespace, name, label, summary, group, enabled, costTokens,
      description: `Preview description of ${id}: what it does, when to use it, what it returns.`,
      offEffect: 'Calls are refused at once and the tool is not offered to new chats.',
      deferLoading: id.startsWith('browser_cdp'),
      timeoutMs: 30_000,
      fields: [{ name: 'action', type: 'string', required: true, description: 'Which operation to perform.', enum: actions.length ? actions : null }],
      inputSchema: {},
      actions: actions.map((action) => ({ id: `${id}.${action}`, name: action, description: `${action} verb`, fields: [], enabled }))
    }
  })
  const byNamespace = new Map<string, typeof tools>()
  for (const tool of tools) byNamespace.set(tool.namespace, [...(byNamespace.get(tool.namespace) ?? []), tool])
  return {
    providers: ['codex', 'claude-code'],
    groups: GROUPS,
    namespaces: [...byNamespace].map(([name, entries]) => ({ name, description: `${name} namespace`, tools: entries })),
    advertisedTokens: tools.filter((tool) => tool.enabled).reduce((sum, tool) => sum + tool.costTokens, 0),
    readOnlyIds: ['embedded_browser.page', 'search.query', 'search.library', 'closedai_app.state', 'closedai_ui.capture']
  }
}

/** A registry the preview can switch: toggles apply in memory and fire the same events. */
export function createToolsFixture(): {
  manifest: () => Promise<ToolManifest>
  telemetry: () => Promise<ToolTelemetrySnapshot>
  setEnabled: (id: string, enabled: boolean) => Promise<void>
  setEnabledMany: (switches: ToolSwitch[]) => Promise<void>
  clearTelemetry: () => Promise<void>
  onEvent: (listener: (event: ToolsEvent) => void) => () => void
} {
  let manifest = sampleToolManifest()
  let telemetry = sampleToolTelemetry()
  const listeners = new Set<(event: ToolsEvent) => void>()
  const emit = (event: ToolsEvent): void => { for (const listener of listeners) listener(event) }
  const apply = (switches: ToolSwitch[]): void => {
    const wanted = new Map(switches.map((entry) => [entry.id, entry.enabled]))
    manifest = {
      ...manifest,
      namespaces: manifest.namespaces.map((namespace) => ({
        ...namespace,
        tools: namespace.tools.map((tool) => {
          const actions = tool.actions.map((action) => ({ ...action, enabled: wanted.get(action.id) ?? action.enabled }))
          const enabled = actions.length ? actions.some((action) => action.enabled) : (wanted.get(tool.id) ?? tool.enabled)
          return { ...tool, actions, enabled }
        })
      }))
    }
    manifest.advertisedTokens = manifest.namespaces.flatMap((namespace) => namespace.tools)
      .filter((tool) => tool.enabled).reduce((sum, tool) => sum + tool.costTokens, 0)
  }
  return {
    manifest: async () => manifest,
    telemetry: async () => telemetry,
    setEnabled: async (id, enabled) => { apply([{ id, enabled }]); emit({ type: 'enabled', toolId: id, enabled }) },
    setEnabledMany: async (switches) => { apply(switches); emit({ type: 'changed' }) },
    clearTelemetry: async () => { telemetry = { ...telemetry, stats: [], errors: [], totalCalls: 0, since: Date.now() }; emit({ type: 'cleared' }) },
    onEvent: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }
  }
}

export function sampleToolTelemetry(): ToolTelemetrySnapshot {
  const now = Date.now()
  const hours = (n: number): number => now - n * 3_600_000
  return {
    totalCalls: 41,
    since: hours(24 * 60),
    stats: [
      { toolId: 'browser_cdp.protocol', action: null, calls: 12, failures: 3, timeouts: 0, misuses: 0, lastCalledAt: hours(2), lastFailedAt: hours(2) },
      { toolId: 'embedded_browser.network_replay', action: null, calls: 2, failures: 2, timeouts: 0, misuses: 2, lastCalledAt: hours(30), lastFailedAt: hours(30) },
      { toolId: 'embedded_browser.page', action: null, calls: 27, failures: 0, timeouts: 1, misuses: 0, lastCalledAt: hours(0.1), lastFailedAt: hours(50) },
      { toolId: 'search.query', action: null, calls: 3, failures: 0, timeouts: 0, misuses: 0, lastCalledAt: hours(24 * 45), lastFailedAt: null }
    ],
    errors: [
      { toolId: 'browser_cdp.protocol', action: 'command', at: hours(2), kind: 'error', message: 'Target closed: the tab navigated during Runtime.evaluate' },
      { toolId: 'browser_cdp.protocol', action: 'targets', at: hours(5), kind: 'error', message: 'Session detached before the response arrived' },
      { toolId: 'embedded_browser.network_replay', action: null, at: hours(30), kind: 'misuse', message: 'Tool is switched off' }
    ]
  }
}
