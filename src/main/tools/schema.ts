import type { JsonObject } from './tool.js'

// A deliberately small JSON Schema checker: enough to validate tool arguments (objects of
// scalars, nested objects, arrays, enums, ranges) without pulling a validator package
// through the closure gate. Unsupported keywords are ignored rather than rejected.

export function validateInput(schema: JsonObject, value: unknown): string[] {
  const errors: string[] = []
  check(schema, value, '$', errors)
  return errors
}

function check(schema: JsonObject, value: unknown, path: string, errors: string[]): void {
  const types = typesOf(schema.type)
  if (types.length && !types.some((type) => matchesType(type, value))) {
    errors.push(`${path} must be ${types.join(' or ')}`)
    return
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((option) => option === value)) {
    errors.push(`${path} must be one of ${schema.enum.map((option) => JSON.stringify(option)).join(', ')}`)
    return
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) errors.push(`${path} must be at least ${schema.minLength} characters`)
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) errors.push(`${path} must be at most ${schema.maxLength} characters`)
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push(`${path} must be >= ${schema.minimum}`)
    if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push(`${path} must be <= ${schema.maximum}`)
  }
  if (Array.isArray(value)) {
    const items = recordOf(schema.items)
    if (items) value.forEach((entry, index) => check(items, entry, `${path}[${index}]`, errors))
    return
  }
  if (value !== null && typeof value === 'object') {
    const record = value as JsonObject
    const properties = recordOf(schema.properties) ?? {}
    const required = Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === 'string') : []
    for (const key of required) {
      if (record[key] === undefined) errors.push(`${path}.${key} is required`)
    }
    for (const [key, entry] of Object.entries(record)) {
      const property = recordOf(properties[key])
      if (property) {
        check(property, entry, `${path}.${key}`, errors)
      } else if (schema.additionalProperties === false) {
        const suggestion = suggestMatch(key, Object.keys(properties))
        const hint = suggestion ? ` (did you mean "${suggestion}"?)` : ''
        errors.push(`${path}.${key} is not a recognised argument${hint}`)
      }
    }
  }
}

export function suggestMatch(key: string, candidates: string[]): string | null {
  if (candidates.length === 0) return null
  const snake = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[-\s]+/g, '_').toLowerCase()
  if (candidates.includes(snake)) return snake
  const lower = key.toLowerCase()
  if (candidates.includes(lower)) return lower
  let best: string | null = null
  let min = 3
  for (const candidate of candidates) {
    const maxDist = candidate.length <= 4 ? 1 : 2
    const dist = levenshtein(lower, candidate.toLowerCase())
    if (dist <= maxDist && dist < min) {
      min = dist
      best = candidate
    }
  }
  return best
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const row: number[] = []
  for (let i = 0; i <= b.length; i++) row[i] = i
  for (let i = 1; i <= a.length; i++) {
    let prev = i
    for (let j = 1; j <= b.length; j++) {
      const val = a[i - 1] === b[j - 1] ? row[j - 1]! : Math.min(row[j - 1]!, prev, row[j]!) + 1
      row[j - 1] = prev
      prev = val
    }
    row[b.length] = prev
  }
  return row[b.length]!
}

function typesOf(type: unknown): string[] {
  if (typeof type === 'string') return [type]
  if (Array.isArray(type)) return type.filter((entry): entry is string => typeof entry === 'string')
  return []
}

function matchesType(type: string, value: unknown): boolean {
  switch (type) {
    case 'string': return typeof value === 'string'
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'integer': return typeof value === 'number' && Number.isInteger(value)
    case 'boolean': return typeof value === 'boolean'
    case 'null': return value === null
    case 'array': return Array.isArray(value)
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value)
    default: return true
  }
}

function recordOf(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null
}
