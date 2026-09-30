import type { ToolNamespace } from '../tool.js'
import type { SessionHostProvider } from '../browser/network-host.js'
import type { BrowserHostProvider } from '../browser/host.js'
import type { CdpHostProvider } from '../cdp/host.js'
import { discoverTool } from './bootstrap.js'

/**
 * Namespace `site`: read-only origin discovery (robots, sitemap, llms.txt, OpenAPI hints)
 * using the browser session partition. Distinct from `embedded_browser` page tools.
 */
export function siteTools(
  sessions: SessionHostProvider,
  browser?: BrowserHostProvider,
  cdp?: CdpHostProvider
): ToolNamespace {
  return {
    name: 'site',
    description: 'Read-only discovery helpers for web origins: bootstrap metadata, bounded expand excerpts, and instrument API maps.',
    tools: [discoverTool(sessions, browser, cdp)]
  }
}

export type { SessionHostProvider, BrowserHostProvider }
