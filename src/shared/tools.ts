// Cross-process contracts for the Tools modal: what tools exist (the manifest) and how
// they have been used (telemetry). Pure types; the main process builds them from the
// registry and the renderer only reads them.

export type ToolFieldInfo = {
  name: string
  /** JSON Schema type(s), joined with " | ". */
  type: string
  required: boolean
  description: string
  enum: string[] | null
}

export type ToolActionInfo = {
  /** `namespace.tool.action`; the id the switch and telemetry use. */
  id: string
  name: string
  description: string
  fields: ToolFieldInfo[]
  /** Off: dropped from the tool's description and enum on new threads; calls are refused. */
  enabled: boolean
}

/**
 * What switching a tool on lets the model do to the user. Groups in the Tools dialog are effects,
 * not namespaces, because the switch decision is a trust decision.
 */
export type ToolEffect = 'reads-web' | 'acts-in-browser' | 'controls-app' | 'reads-secrets' | 'runs-native'

export type ToolGroupInfo = {
  id: ToolEffect
  /** Group heading, for a person: "Read the web". */
  label: string
  /** The effect in two or three words: "Reads only", "Acts as you". */
  effect: string
  /** One sentence under the heading. */
  summary: string
}

export type ToolInfo = {
  /** `namespace.tool`; stable key for telemetry. */
  id: string
  namespace: string
  name: string
  /** Exactly the description the model sees. */
  description: string
  /** Human name for the row: "Browse a page". */
  label: string
  /** One line for a person, not the model. */
  summary: string
  /** What changes when the switch is off. */
  offEffect: string
  group: ToolEffect
  /**
   * Estimated tokens the tool's advertised name, description, and schema add to every turn
   * (characters / 4). A deferred tool costs only its name until the model loads it.
   */
  costTokens: number
  deferLoading: boolean
  /** Off: not advertised to providers on new threads, and calls are refused. */
  enabled: boolean
  timeoutMs: number | null
  /** Empty for a plain tool; one entry per verb for an action tool. */
  actions: ToolActionInfo[]
  /** The advertised (flat) schema, as fields. */
  fields: ToolFieldInfo[]
  inputSchema: unknown
}

export type ToolNamespaceInfo = {
  name: string
  description: string
  tools: ToolInfo[]
}

export type ToolManifest = {
  namespaces: ToolNamespaceInfo[]
  /** Providers the registry is currently advertised to. */
  providers: string[]
  /** Effect groups in display order. */
  groups: ToolGroupInfo[]
  /** Estimated tokens the enabled set adds to every turn; deferred tools count their name only. */
  advertisedTokens: number
  /** Tool ids the Read-only preset keeps on: they observe and never act for the user. */
  readOnlyIds: string[]
  /**
   * When true, Codex advertises a task slice's eager set instead of the legacy pair
   * (`closedai_app.state` + `embedded_browser.page`). Execution still uses the full registry.
   */
  chatToolSliceEnabled: boolean
  /** When false, `closedai.workspace.ledger` is not attached on send (default on). */
  chatWorkspaceLedgerEnabled: boolean
}

/** One switch change; a batch of these is one persisted write and one refresh. */
export type ToolSwitch = { id: string; enabled: boolean }

/** Aggregate-only call event. No arguments, results, messages, or conversation ids cross IPC. */
export type ToolCallEvent = {
  /** `namespace.tool`, or the raw name for a call that matched no tool. */
  toolId: string
  action: string | null
  ok: boolean
  timedOut: boolean
  /** The app refused the call before the tool ran: wrong name, wrong arguments, broken rule. */
  misuse: boolean
  /** When the call finished, ms since epoch. */
  at: number
  /**
   * For a failed call, the first line of what the model was told, cut to a short bound. Never
   * arguments, never a successful result, never a sensitive result. This is what "Send to chat
   * for repair" carries, so the fix can start from the actual failure text.
   */
  message: string | null
}

export type ToolStats = {
  toolId: string
  /** Null for the whole tool; set for one action of an action tool. */
  action: string | null
  calls: number
  failures: number
  /** Condition or execution timeouts; excluded from `failures`. */
  timeouts: number
  /** Calls refused as misuse, a subset of `failures`: what the tool's directions failed to prevent. */
  misuses: number
  /** Most recent call, ms since epoch; null before timestamps were recorded. */
  lastCalledAt: number | null
  lastFailedAt: number | null
}

export type ToolErrorNote = {
  toolId: string
  action: string | null
  at: number
  kind: 'error' | 'timeout' | 'misuse'
  message: string
}

export type ToolTelemetrySnapshot = {
  stats: ToolStats[]
  /** Total tool invocations represented by the aggregate counters. */
  totalCalls: number
  /** When timestamps began, ms since epoch; "unused" is only meaningful relative to this. */
  since: number | null
  /** The last few failure messages per tool, newest first. */
  errors: ToolErrorNote[]
}

export type ToolsEvent =
  | { type: 'call'; record: ToolCallEvent }
  | { type: 'cleared' }
  | { type: 'enabled'; toolId: string; enabled: boolean }
  /** Many switches changed at once; readers re-read the manifest. */
  | { type: 'changed' }
