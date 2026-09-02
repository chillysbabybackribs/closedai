import type { ViewportPoint } from './types.js'

export function mapIntoQuad(point: ViewportPoint, width: number, height: number, quad: number[]): ViewportPoint {
  const u = point.x / width
  const v = point.y / height
  const topX = quad[0]! + u * (quad[2]! - quad[0]!)
  const topY = quad[1]! + u * (quad[3]! - quad[1]!)
  const bottomX = quad[6]! + u * (quad[4]! - quad[6]!)
  const bottomY = quad[7]! + u * (quad[5]! - quad[7]!)
  return { x: topX + v * (bottomX - topX), y: topY + v * (bottomY - topY) }
}

export function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export function stringOf(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function numberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function numberArray(value: unknown): number[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
    ? value as number[]
    : null
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
