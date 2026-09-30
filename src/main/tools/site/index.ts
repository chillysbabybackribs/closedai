import type { ToolNamespace } from '../tool.js'
import type { SessionHostProvider } from '../browser/network-host.js'
import type { BrowserHostProvider } from '../browser/host.js'
import { discoverTool } from './bootstrap.js'

/**
 * Namespace `site`: read-only origin discovery (robots, sitemap, llms.txt, OpenAPI hints)
 * using the browser session partition. Distinct from `embedded_browser` page tools.
 */
export function siteTools(sessions: SessionHostProvider, browser?: BrowserHostProvider): ToolNamespace {
  return {
    name: 'site',
    description: 'Read-only discovery helpers for web origins: bootstrap metadata before deep browsing or API work.',
    tools: [discoverTool(sessions, browser)]
  }
}

export type { SessionHostProvider, BrowserHostProvider }
