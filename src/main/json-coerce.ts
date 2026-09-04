export function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** Like `recordOf`, but returns an empty object when the value is not a plain record. */
export function recordOfOrEmpty(value: unknown): Record<string, unknown> {
  return recordOf(value) ?? {}
}

export function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}
