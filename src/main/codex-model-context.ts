import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** The Codex-managed catalog is richer than app-server `model/list`: it includes each model's
 * maximum supported active-context size. Keep that provider detail here, outside shared types. */
export type CodexModelContextWindows = ReadonlyMap<string, number>

/** Read maximum context windows from the same cache the installed Codex CLI owns. */
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

/** Parse only positive integer maxima; malformed entries never become runtime overrides. */
export function parseCodexModelContextWindows(value: unknown): CodexModelContextWindows {
  if (!value || typeof value !== 'object') return new Map()
  const models = (value as { models?: unknown }).models
  if (!Array.isArray(models)) return new Map()
  const windows = new Map<string, number>()
  for (const entry of models) {
    if (!entry || typeof entry !== 'object') continue
    const model = entry as Record<string, unknown>
    const id = typeof model.slug === 'string' ? model.slug : typeof model.id === 'string' ? model.id : ''
    const maximum = positiveInteger(model.max_context_window) ?? positiveInteger(model.context_window)
    if (id && maximum) windows.set(id, maximum)
  }
  return windows
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}
