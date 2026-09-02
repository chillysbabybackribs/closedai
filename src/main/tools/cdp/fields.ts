import { numberArg, stringArg, type JsonObject } from '../tool.js'

export const tabIdField: JsonObject = {
  type: 'string',
  minLength: 1,
  description: 'ClosedAI tab id. Defaults to the active tab.'
}

export const refField: JsonObject = {
  type: 'string',
  minLength: 1,
  description: 'Element ref returned by the latest inspect_page call.'
}

export const sessionIdField: JsonObject = {
  type: 'string',
  minLength: 1,
  description: 'Flat CDP child-target session id returned by Target.attachToTarget.'
}

export function tabIdFrom(input: JsonObject): string | undefined {
  return stringArg(input, 'tab_id')
}

export function sessionIdFrom(input: JsonObject): string | undefined {
  return stringArg(input, 'session_id')
}

export function paramsFrom(input: JsonObject): Record<string, unknown> {
  const params = input.params
  if (params === undefined || params === null) return {}
  if (typeof params !== 'object' || Array.isArray(params)) throw new Error('`params` must be an object')
  return params as Record<string, unknown>
}

export function eventCursorFrom(input: JsonObject): number {
  return numberArg(input, 'after_cursor', 0)
}

export function eventLimitFrom(input: JsonObject): number {
  return numberArg(input, 'limit', 100)
}
