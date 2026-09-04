import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { SearchProvider } from './types.js'

const execFileP = promisify(execFile)
const KEYRING_SERVICE = 'codeapp-vault'

const KEYS: Record<SearchProvider, { env: string; account: string }> = {
  brave: { env: 'BRAVE_SEARCH_API_KEY', account: 'brave_paid_search' },
  serper: { env: 'SERPER_API_KEY', account: 'serper_api_key' },
  tavily: { env: 'TAVILY_API_KEY', account: 'tavily_api_key' },
  you: { env: 'YOU_API_KEY', account: 'you_api_key' }
}

export type SearchKeyReader = (provider: SearchProvider) => Promise<string>

/** Environment variables are useful in CI; desktop installs use the OS keyring. */
export async function readSearchKey(provider: SearchProvider): Promise<string> {
  const config = KEYS[provider]
  const fromEnvironment = process.env[config.env]?.trim()
  if (fromEnvironment) return fromEnvironment
  try {
    const { stdout } = await execFileP('secret-tool', [
      'lookup', 'service', KEYRING_SERVICE, 'account', config.account
    ])
    const key = stdout.trim()
    if (key) return key
  } catch {
    // A missing/locked keyring is reported below without exposing command details.
  }
  throw new Error(`${provider} search credential is unavailable (${config.env} or keyring account ${config.account})`)
}
