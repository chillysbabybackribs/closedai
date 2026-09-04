// A read tool's job is to fit useful results into a model's context, not to relay a whole
// transport payload and let the serializer cut it blind. Projection decides the shape before
// the value is serialised: pick a subtree by path, keep only the fields that matter, cap the
// item count. Pure and synchronous, so the part worth testing needs no browser.

export type Projection = {
  /** Dot/bracket path into the document, for example `data.items` or `results[0].rows`. */
  path?: string
  /** Field paths kept from each item; every field when empty. */
  fields?: string[]
  /** Maximum items kept when the selection is an array. */
  limit?: number
}

export type ProjectionResult = {
  value: unknown
  /** Items in the selection before `limit` was applied; null when it is not an array. */
  matched: number | null
  /** True when `limit` dropped items. */
  limited: boolean
}

export function projectJson(document: unknown, projection: Projection): ProjectionResult {
  const selected = selectPath(document, projection.path)
  if (!Array.isArray(selected)) {
    return { value: pickFields(selected, projection.fields), matched: null, limited: false }
  }
  const limit = projection.limit ?? selected.length
  const kept = selected.slice(0, Math.max(0, limit)).map((item) => pickFields(item, projection.fields))
  return { value: kept, matched: selected.length, limited: selected.length > kept.length }
}

/**
 * Walk `path` through objects and arrays. Segments split on `.` and `[]`, so `a.b[0].c` and
 * `a[b][0]` both work; a key containing a literal dot is not addressable, which is a fair
 * trade for a path syntax a model writes correctly the first time.
 */
export function selectPath(value: unknown, path?: string): unknown {
  if (!path) return value
  let current: unknown = value
  for (const token of tokenize(path)) {
    if (current === null || current === undefined) return undefined
    if (Array.isArray(current)) {
      const index = Number(token)
      current = Number.isInteger(index) ? current[index] : undefined
    } else if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[token]
    } else {
      return undefined
    }
  }
  return current
}

/** Keep only `fields` from an item, naming each result by the path that produced it. */
function pickFields(item: unknown, fields?: string[]): unknown {
  if (!fields?.length) return item
  if (item === null || typeof item !== 'object') return item
  const picked: Record<string, unknown> = {}
  for (const field of fields) {
    const value = selectPath(item, field)
    if (value !== undefined) picked[field] = value
  }
  return picked
}

function tokenize(path: string): string[] {
  return path.split(/[.[\]]+/).map((token) => token.trim()).filter(Boolean)
}
