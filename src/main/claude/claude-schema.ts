import { z, type ZodRawShape } from 'zod'

// The SDK's in-process MCP `tool()` helper takes a Zod shape, while every ClosedAI tool is
// declared in JSON Schema (the registry validates calls against it). Zod 4 imports JSON Schema
// natively, so the model sees the same descriptions, enums, and bounds Codex reads from the
// same spec. Precision here is informative, not protective: the registry re-validates.

export type ZodShapeConversion = {
  shape: ZodRawShape
  /** False when Zod could not import the schema and the shape fell back to typed-loose fields. */
  exact: boolean
}

export function zodShapeFromJsonSchema(schema: unknown): ZodShapeConversion {
  const record = recordOf(schema)
  try {
    const imported = z.fromJSONSchema(record as Parameters<typeof z.fromJSONSchema>[0])
    if (imported instanceof z.ZodObject) return { shape: imported.shape as ZodRawShape, exact: true }
  } catch {
    // Fall through: an unsupported keyword must not make the tool disappear from the model.
  }
  return { shape: looseShape(record), exact: false }
}

/** Every declared property as an optional unknown carrying its description; required ones stay required. */
function looseShape(schema: Record<string, unknown>): ZodRawShape {
  const properties = recordOf(schema.properties)
  const required = new Set(Array.isArray(schema.required) ? schema.required : [])
  const shape: ZodRawShape = {}
  for (const [name, property] of Object.entries(properties)) {
    const description = recordOf(property).description
    const base = typeof description === 'string' ? z.unknown().describe(description) : z.unknown()
    shape[name] = required.has(name) ? base : base.optional()
  }
  return shape
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
