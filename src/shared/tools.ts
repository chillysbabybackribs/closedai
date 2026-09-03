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

export type ToolInfo = {
  /** `namespace.tool`; stable key for telemetry. */
  id: string
  namespace: string
  name: string
  /** Exactly the description the model sees. */
  description: string
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
}

/** Aggregate-only call event. No arguments, results, messages, or conversation ids cross IPC. */
export type ToolCallEvent = {
  /** `namespace.tool`, or the raw name for a call that matched no tool. */
  toolId: string
  action: string | null
  ok: boolean
  timedOut: boolean
}

export type ToolStats = {
  toolId: string
  /** Null for the whole tool; set for one action of an action tool. */
  action: string | null
  calls: number
  failures: number
  timeouts: number
}

export type ToolTelemetrySnapshot = {
  stats: ToolStats[]
  /** Total tool invocations represented by the aggregate counters. */
  totalCalls: number
}

export type ToolsEvent =
  | { type: 'call'; record: ToolCallEvent }
  | { type: 'cleared' }
  | { type: 'enabled'; toolId: string; enabled: boolean }
