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

export type ToolCallRecord = {
  id: string
  /** Unix milliseconds when the call started. */
  at: number
  threadId: string | null
  turnId: string | null
  callId: string
  /** `namespace.tool`, or the raw name for a call that matched no tool. */
  toolId: string
  action: string | null
  /** Present for nested calls so one batch can be reconstructed from flat JSONL. */
  parentCallId?: string | null
  batchId?: string | null
  source?: 'model' | 'batch' | 'system' | 'external'
  /** JSON of the arguments, truncated. */
  argumentsPreview: string
  durationMs: number
  ok: boolean
  /** The failure text the model saw, when `ok` is false. */
  error: string | null
  /** First text content of the result, truncated. */
  outputPreview: string
}

export type ToolRegistration = {
  toolId: string
  namespace: string
  name: string
  actions: string[]
  firstSeenAt: number
  lastSeenAt: number
}

export type ToolStats = {
  toolId: string
  /** Null for the whole tool; set for one action of an action tool. */
  action: string | null
  calls: number
  failures: number
  averageMs: number
  lastAt: number | null
}

export type ToolTelemetrySnapshot = {
  stats: ToolStats[]
  /** Newest first. */
  recent: ToolCallRecord[]
  /** How many records the store keeps; stats cover only that window. */
  retained: number
  /** Total calls in the durable log, including calls older than the in-memory window. */
  totalCalls: number
  /** Every tool/action definition observed by the registry across app starts. */
  registeredTools: ToolRegistration[]
}

export type ToolsEvent =
  | { type: 'call'; record: ToolCallRecord }
  | { type: 'registered'; tool: ToolRegistration }
  | { type: 'cleared' }
  | { type: 'enabled'; toolId: string; enabled: boolean }
