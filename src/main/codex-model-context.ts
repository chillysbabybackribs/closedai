import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** The Codex-managed catalog is richer than app-server `model/list`: it includes context metadata.
 * Keep that provider detail here, outside shared types. */
export type CodexModelContextWindows = ReadonlyMap<string, number>

/** Native capacities from OpenAI's public model catalog. Codex's cache can advertise a lower
 * product default in `max_context_window`, so known exact model ids must take precedence. */
const NATIVE_CONTEXT_WINDOWS: Readonly<Record<string, number>> = Object.freeze({
  'gpt-6-astra': 1_050_000,
  'gpt-5.6-sol': 1_050_000,
  'gpt-5.6-terra': 1_050_000,
  'gpt-5.6-luna': 1_050_000,
  'gpt-5.5': 1_050_000,
  'gpt-5.4': 1_050_000,
  'gpt-5.4-mini': 400_000,
  'gpt-5.3-codex-spark': 400_000
})

/** Read model ids from the installed Codex CLI cache and resolve their native context windows. */
export async function loadCodexModelContextWindows(
  cachePath = join(process.env.CODEX_HOME?.trim() || join(homedir(), '.codex'), 'models_cache.json')
): Promise<CodexModelContextWindows> {
  try {
    return parseCodexModelContextWindows(JSON.parse(await readFile(cachePath, 'utf8')))
  } catch {
    // Context metadata is optional enrichment. Codex remains usable with its own defaults when
    // the cache has not been created yet, is being replaced, or belongs to an older CLI.
    return new Map()
  }
}

/** Prefer known native capacities, then accept only positive integer cache maxima as a fallback. */
export function parseCodexModelContextWindows(value: unknown): CodexModelContextWindows {
  if (!value || typeof value !== 'object') return new Map()
  const models = (value as { models?: unknown }).models
  if (!Array.isArray(models)) return new Map()
  const windows = new Map<string, number>()
  for (const entry of models) {
    if (!entry || typeof entry !== 'object') continue
    const model = entry as Record<string, unknown>
    const id = typeof model.slug === 'string' ? model.slug : typeof model.id === 'string' ? model.id : ''
    const maximum = NATIVE_CONTEXT_WINDOWS[id]
      ?? positiveInteger(model.max_context_window)
      ?? positiveInteger(model.context_window)
    if (id && maximum) windows.set(id, maximum)
  }
  return windows
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}
