import type { ToolRegistry } from '../tools/registry.js'
import { createBrowserFixtureRegistry } from './browser-fixture.js'
import { createSearchFixtureRegistry } from './search-fixture.js'
import type { RecordedToolCall } from './types.js'

export function fixtureRegistry(fixture?: string): {
  registry: ToolRegistry
  recorded: () => RecordedToolCall[]
} {
  if (!fixture || fixture.startsWith('browser/')) {
    const { registry, drainRecordedCalls } = createBrowserFixtureRegistry()
    return { registry, recorded: drainRecordedCalls }
  }
  if (fixture.startsWith('search/')) {
    const { registry, drainRecordedCalls } = createSearchFixtureRegistry()
    return { registry, recorded: drainRecordedCalls }
  }
  throw new Error(`Unknown harness fixture: ${fixture}`)
}
