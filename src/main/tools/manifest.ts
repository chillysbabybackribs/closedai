import type { ToolFieldInfo, ToolInfo, ToolManifest } from '../../shared/tools.js'
import type { ToolRegistry } from './registry.js'
import type { JsonObject, ToolDefinition } from './tool.js'

/** The registry, flattened for the Tools modal: exactly what the model is told, as data. */
export function toolManifest(registry: ToolRegistry, providers: string[]): ToolManifest {
  return {
    providers,
    namespaces: registry.namespaces.map((namespace) => ({
      name: namespace.name,
      description: namespace.description,
      tools: namespace.tools.map((tool) => toolInfo(namespace.name, tool, (id) => registry.isEnabled(id)))
    }))
  }
}

function toolInfo(namespace: string, tool: ToolDefinition, actionEnabled: (id: string) => boolean): ToolInfo {
  const toolId = `${namespace}.${tool.name}`
  // An action tool is "on" while any of its actions is; a plain tool has its own switch.
  const enabled = tool.actions?.length
    ? tool.actions.some((action) => actionEnabled(`${toolId}.${action.name}`))
    : actionEnabled(toolId)
  return {
    id: `${namespace}.${tool.name}`,
    namespace,
    name: tool.name,
    description: tool.description,
    deferLoading: tool.deferLoading === true,
    enabled,
    timeoutMs: tool.timeoutMs ?? null,
    actions: (tool.actions ?? []).map((action) => ({
      id: `${namespace}.${tool.name}.${action.name}`,
      name: action.name,
      description: action.description,
      fields: schemaFields(action.inputSchema),
      enabled: actionEnabled(`${namespace}.${tool.name}.${action.name}`)
    })),
    fields: schemaFields(tool.inputSchema),
    inputSchema: tool.inputSchema
  }
}

export function schemaFields(schema: JsonObject): ToolFieldInfo[] {
  const properties = recordOf(schema.properties) ?? {}
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === 'string') : [])
  return Object.entries(properties).flatMap(([name, raw]) => {
    const property = recordOf(raw)
    if (!property) return []
    const type = typeof property.type === 'string'
      ? property.type
      : Array.isArray(property.type) ? property.type.filter((entry): entry is string => typeof entry === 'string').join(' | ') : 'any'
    return [{
      name,
      type,
      required: required.has(name),
      description: typeof property.description === 'string' ? property.description : '',
      enum: Array.isArray(property.enum) ? property.enum.map((entry) => String(entry)) : null
    }]
  })
}

function recordOf(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null
}
