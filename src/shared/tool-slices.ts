/** Task-scoped tool promotion packs (see docs/tool-task-slice-design-2026-09-29.md). */

export type ToolSliceDefinition = {
  label: string
  description: string
  /** When true, defer every tool then promote (task-scoped eager set). When false, keep registry defaults and only add promotions. */
  resetEager?: boolean
  /** Reserved Cursor namespace proposal; currently ignored to preserve capability access. */
  cursorNamespaces?: readonly string[]
  /** Tool ids in descending priority; greedy promotion stops at `codexEagerWireCap`. */
  promotePriority: readonly string[]
}

export type ToolSliceCatalog = {
  version: number
  codexEagerWireCap: number
  slices: Readonly<Record<string, ToolSliceDefinition>>
  signals?: Readonly<Record<string, { slice: string; when?: string }>>
}

export function parseToolSliceCatalog(raw: unknown): ToolSliceCatalog {
  const record = recordOf(raw)
  if (!record) throw new Error('tool slice catalog must be an object')
  const version = numberField(record.version)
  const codexEagerWireCap = numberField(record.codexEagerWireCap)
  const slicesRaw = recordOf(record.slices)
  if (!slicesRaw) throw new Error('tool slice catalog missing slices')
  const slices: Record<string, ToolSliceDefinition> = {}
  for (const [id, entry] of Object.entries(slicesRaw)) {
    const slice = recordOf(entry)
    if (!slice) throw new Error(`slice "${id}" must be an object`)
    const label = stringField(slice.label)
    const description = stringField(slice.description)
    const promotePriority = stringArray(slice.promotePriority)
    const resetEager = slice.resetEager === true
    const cursorNamespaces = slice.cursorNamespaces === undefined ? undefined : stringArray(slice.cursorNamespaces)
    slices[id] = {
      label,
      description,
      promotePriority,
      ...(resetEager ? { resetEager: true } : {}),
      ...(cursorNamespaces ? { cursorNamespaces } : {})
    }
  }
  return { version, codexEagerWireCap, slices, signals: parseSignals(record.signals) }
}

function parseSignals(raw: unknown): ToolSliceCatalog['signals'] {
  const record = recordOf(raw)
  if (!record) return undefined
  const signals: Record<string, { slice: string; when?: string }> = {}
  for (const [key, entry] of Object.entries(record)) {
    const signal = recordOf(entry)
    if (!signal) continue
    const slice = stringField(signal.slice)
    const when = typeof signal.when === 'string' ? signal.when : undefined
    signals[key] = { slice, when }
  }
  return signals
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function stringField(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('expected non-empty string')
  return value
}

function numberField(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('expected number')
  return value
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('expected string array')
  return value.map((entry) => stringField(entry))
}
