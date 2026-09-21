/**
 * One-off live probe of production search routing quality. Run:
 *   node --experimental-transform-types --import ./scripts/ts-resolve-hook-register.mjs scripts/search-quality-probe.ts
 * Uses real keyring credentials; makes a handful of billed provider requests.
 */
import { braveClient } from '../src/main/tools/search/brave.js'
import { exaClient } from '../src/main/tools/search/exa.js'
import { serperClient } from '../src/main/tools/search/serper.js'
import { tavilyClient } from '../src/main/tools/search/tavily.js'
import { youClient } from '../src/main/tools/search/you.js'
import { readSearchKey } from '../src/main/tools/search/keyring.js'
import { SearchRouter } from '../src/main/tools/search/router.js'
import type { SearchRequest } from '../src/main/tools/search/types.js'

const deps = { fetch, readKey: readSearchKey }
const router = new SearchRouter([
  braveClient(deps), exaClient(deps), serperClient(deps), tavilyClient(deps), youClient(deps)
])

const probes: Array<{ label: string; request: SearchRequest }> = [
  {
    label: 'A. technical/quick (default route: brave, strict)',
    request: { query: 'electron BrowserWindow webContents setWindowOpenHandler documentation', intent: 'technical', depth: 'quick', count: 5 }
  },
  {
    label: 'B. same query, preferred_domains electronjs.org (brave goggles boost)',
    request: { query: 'electron BrowserWindow webContents setWindowOpenHandler documentation', intent: 'technical', depth: 'quick', count: 5, preferredDomains: ['electronjs.org'] }
  },
  {
    label: 'C. research/quick (exa) same query',
    request: { query: 'electron BrowserWindow webContents setWindowOpenHandler documentation', intent: 'research', depth: 'quick', count: 5 }
  },
  {
    label: 'D. technical/balanced (brave+serper), version-sensitive query',
    request: { query: 'electron 33 utilityProcess API changes official docs', intent: 'technical', depth: 'balanced', count: 5 }
  }
]

for (const probe of probes) {
  const controller = new AbortController()
  const started = Date.now()
  try {
    const response = await router.search(probe.request, controller.signal)
    console.log(`\n=== ${probe.label} (${Date.now() - started}ms, providers: ${response.providers.join(',')}) ===`)
    for (const item of response.results) {
      const snippet = (item.snippet ?? '').replace(/\s+/g, ' ').slice(0, 110)
      console.log(`  [${item.provider}${item.discoveredBy ? '+' + item.discoveredBy.join('+') : ''}] ${item.age ?? 'no-date'} ${item.url}`)
      console.log(`      ${item.title ?? '(no title)'} :: ${snippet}`)
    }
    if (response.errors.length) console.log('  errors:', JSON.stringify(response.errors))
  } catch (error) {
    console.log(`\n=== ${probe.label} FAILED after ${Date.now() - started}ms:`, error instanceof Error ? error.message : error)
  }
}
